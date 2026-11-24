// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * An in-memory File System Access API for tests (phase-4.md 13.1): directory and file handles over
 * a tree, with Chromium's semantics where folder.ts relies on them.
 *
 * - **`getFile()` is a snapshot**: its size and `lastModified` are the file's at the call, and
 *   reading its bytes after the file changed (or went) rejects with `NotReadableError`.
 * - **`getFileHandle(name, { create: true })` creates an empty file at once**, as Chromium does.
 * - **`createWritable()` writes to a swap file**: nothing changes until `close()`, which replaces
 *   the file at once and stamps it with the clock's time; `abort()`, or a crash before `close()`
 *   (a writable never closed), leaves the old file as it was. `afterClose(name)` runs right after
 *   a file is replaced (another program writing at that moment).
 * - **A handle of a removed entry** rejects with `NotFoundError`.
 * - **Case**: `caseInsensitive` folders (the default disks of macOS and Windows) find an entry by
 *   any case of its name, keep the name it was made with, and `create` opens the entry that is there.
 * - **Permissions**: `queryPermission` answers `permission`; `requestPermission` answers `answer`
 *   and makes it the permission (a user who allows or refuses).
 * - **Faults**: `failNext(op, name)` makes the next call of `op` reject with a `DOMException` of
 *   that name (`QuotaExceededError` on `close`, say).
 *
 * **The clock** (`time`) stands still unless a test moves it (`advance`) or gives a `step`: a
 * coarse clock like a FAT disk's (2 s) or a network share's, so a write and an edit of the same size
 * have the same stamp by default (`put` and `touch` take a time too).
 */
import type { FsDirHandle, FsFile, FsFileHandle, FsWritable, HandleStore } from '../folder';

export type FakeOp =
	| 'values'
	| 'getFile'
	| 'read'
	| 'createWritable'
	| 'write'
	| 'close'
	| 'getFileHandle'
	| 'getDirectoryHandle';

class DirNode {
	readonly entries = new Map<string, DirNode | FileNode>();
	removed = false;
	constructor(readonly name: string) {}
}

class FileNode {
	version = 0;
	removed = false;
	constructor(
		readonly name: string,
		public bytes: Uint8Array,
		public lastModified: number,
	) {}
}

const domError = (name: string): DOMException => new DOMException(name, name);
const encoder = new TextEncoder();
const asBytes = (b: Uint8Array | string): Uint8Array =>
	typeof b === 'string' ? encoder.encode(b) : b.slice();

export interface FakeFsOptions {
	/** Names compare without case (module comment). */
	readonly caseInsensitive?: boolean;
	/** How far the clock moves on each read of it; default 0 (module comment). */
	readonly step?: number;
}

export class FakeFs {
	permission: PermissionState = 'granted';
	answer: PermissionState = 'granted';
	/** How many files `close()` replaced. */
	closes = 0;
	/** The clock, ms since the epoch (module comment). */
	time = 1_700_000_000_000;
	step: number;
	readonly caseInsensitive: boolean;
	/** Runs right after `close()` replaced the file `name` (module comment). */
	afterClose: ((name: string) => void) | null = null;
	readonly #faults = new Map<FakeOp, string>();
	readonly #root: DirNode;

	constructor(name = 'plans', o: FakeFsOptions = {}) {
		this.#root = new DirNode(name);
		this.caseInsensitive = o.caseInsensitive === true;
		this.step = o.step ?? 0;
	}

	/** The clock's time, moved by `step` first. */
	now(): number {
		return (this.time += this.step);
	}

	/** Moves the clock on. */
	advance(ms = 1000): void {
		this.time += ms;
	}

	/** A handle of the root folder (what the picker gives). */
	get root(): FsDirHandle {
		return new FakeDirHandle(this, this.#root);
	}

	/** A handle of the folder at `path` ('' for the root). */
	dir(path: string): FsDirHandle {
		return new FakeDirHandle(this, this.#dirAt(path, false));
	}

	failNext(op: FakeOp, name: string): void {
		this.#faults.set(op, name);
	}

	/** Throws the fault set for `op`, once. */
	fault(op: FakeOp): void {
		const name = this.#faults.get(op);
		if (name === undefined) return;
		this.#faults.delete(op);
		throw domError(name);
	}

	/** The entry of `dir` called `name`, by the folder's rule for case. */
	find(dir: DirNode, name: string): DirNode | FileNode | undefined {
		const exact = dir.entries.get(name);
		if (exact || !this.caseInsensitive) return exact;
		const low = name.toLowerCase();
		for (const [n, e] of dir.entries) if (n.toLowerCase() === low) return e;
		return undefined;
	}

	/** Writes a file (and its folders) at once, as another program would. */
	put(path: string, bytes: Uint8Array | string, at = this.now()): void {
		const parts = path.split('/');
		const name = parts.pop() ?? '';
		const dir = this.#dirAt(parts.join('/'), true);
		const old = this.find(dir, name);
		if (old instanceof FileNode) {
			old.bytes = asBytes(bytes);
			old.lastModified = at;
			old.version++;
		} else dir.entries.set(name, new FileNode(name, asBytes(bytes), at));
	}

	/** A new `lastModified` and the same bytes (a save with no change). */
	touch(path: string, at = this.now()): void {
		const f = this.#file(path);
		f.lastModified = at;
		f.version++;
	}

	/** Removes a file or a folder (and what is in it). */
	remove(path: string): void {
		const parts = path.split('/');
		const name = parts.pop() ?? '';
		const dir = this.#dirAt(parts.join('/'), false);
		const node = this.find(dir, name);
		if (!node) throw new Error(`no ${path}`);
		dir.entries.delete(node.name);
		const mark = (n: DirNode | FileNode): void => {
			n.removed = true;
			if (n instanceof DirNode) for (const c of n.entries.values()) mark(c);
		};
		mark(node);
	}

	/** The bytes of the file at `path`, or null. */
	bytes(path: string): Uint8Array | null {
		try {
			return this.#file(path).bytes.slice();
		} catch {
			return null;
		}
	}

	stamp(path: string): { size: number; lastModified: number } {
		const f = this.#file(path);
		return { size: f.bytes.length, lastModified: f.lastModified };
	}

	/** Every file's path, as it was made, sorted. */
	paths(): string[] {
		const out: string[] = [];
		const walk = (d: DirNode, prefix: string): void => {
			for (const [name, n] of d.entries) {
				if (n instanceof DirNode) walk(n, `${prefix}${name}/`);
				else out.push(prefix + name);
			}
		};
		walk(this.#root, '');
		return out.sort();
	}

	#dirAt(path: string, create: boolean): DirNode {
		let d = this.#root;
		for (const p of path === '' ? [] : path.split('/')) {
			let next = this.find(d, p);
			if (!next && create) d.entries.set(p, (next = new DirNode(p)));
			if (!(next instanceof DirNode)) throw new Error(`no folder ${path}`);
			d = next;
		}
		return d;
	}

	#file(path: string): FileNode {
		const parts = path.split('/');
		const name = parts.pop() ?? '';
		const f = this.find(this.#dirAt(parts.join('/'), false), name);
		if (!(f instanceof FileNode)) throw new Error(`no file ${path}`);
		return f;
	}
}

class FakeDirHandle implements FsDirHandle {
	readonly kind = 'directory' as const;
	constructor(
		readonly fs: FakeFs,
		readonly node: DirNode,
	) {}

	get name(): string {
		return this.node.name;
	}

	#live(op: FakeOp): void {
		if (this.node.removed) throw domError('NotFoundError');
		this.fs.fault(op);
	}

	async *values(): AsyncGenerator<FsDirHandle | FsFileHandle> {
		this.#live('values');
		for (const n of [...this.node.entries.values()]) {
			if (this.node.removed) throw domError('NotFoundError');
			yield n instanceof DirNode ? new FakeDirHandle(this.fs, n) : new FakeFileHandle(this.fs, n);
		}
	}

	async getDirectoryHandle(name: string, o?: { readonly create?: boolean }): Promise<FsDirHandle> {
		this.#live('getDirectoryHandle');
		let n = this.fs.find(this.node, name);
		if (!n && o?.create) this.node.entries.set(name, (n = new DirNode(name)));
		if (!n) throw domError('NotFoundError');
		if (!(n instanceof DirNode)) throw domError('TypeMismatchError');
		return new FakeDirHandle(this.fs, n);
	}

	async getFileHandle(name: string, o?: { readonly create?: boolean }): Promise<FsFileHandle> {
		this.#live('getFileHandle');
		let n = this.fs.find(this.node, name);
		if (!n && o?.create) {
			n = new FileNode(name, new Uint8Array(0), this.fs.now());
			this.node.entries.set(name, n);
		}
		if (!n) throw domError('NotFoundError');
		if (!(n instanceof FileNode)) throw domError('TypeMismatchError');
		return new FakeFileHandle(this.fs, n);
	}

	async isSameEntry(other: FsDirHandle): Promise<boolean> {
		return other instanceof FakeDirHandle && other.node === this.node;
	}

	async queryPermission(): Promise<PermissionState> {
		return this.fs.permission;
	}

	async requestPermission(): Promise<PermissionState> {
		this.fs.permission = this.fs.answer;
		return this.fs.answer;
	}
}

class FakeFileHandle implements FsFileHandle {
	readonly kind = 'file' as const;
	constructor(
		readonly fs: FakeFs,
		readonly node: FileNode,
	) {}

	get name(): string {
		return this.node.name;
	}

	#live(op: FakeOp): void {
		if (this.node.removed) throw domError('NotFoundError');
		this.fs.fault(op);
	}

	async getFile(): Promise<FsFile> {
		this.#live('getFile');
		const node = this.node;
		const { version, bytes, lastModified } = node;
		const fs = this.fs;
		return {
			size: bytes.length,
			lastModified,
			async arrayBuffer() {
				if (node.removed || node.version !== version) throw domError('NotReadableError');
				fs.fault('read');
				return bytes.slice().buffer;
			},
		};
	}

	async createWritable(o?: { readonly keepExistingData?: boolean }): Promise<FsWritable> {
		this.#live('createWritable');
		const node = this.node;
		const fs = this.fs;
		const chunks: Uint8Array[] = o?.keepExistingData ? [node.bytes.slice()] : [];
		let open = true;
		return {
			async write(data) {
				if (!open) throw new TypeError('closed');
				fs.fault('write');
				chunks.push(data.slice());
			},
			async close() {
				if (!open) throw new TypeError('closed');
				fs.fault('close');
				open = false;
				if (node.removed) throw domError('NotFoundError');
				const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
				let at = 0;
				for (const c of chunks) {
					all.set(c, at);
					at += c.length;
				}
				node.bytes = all;
				node.lastModified = fs.now();
				node.version++;
				fs.closes++;
				fs.afterClose?.(node.name);
			},
			async abort() {
				open = false;
			},
		};
	}
}

/** Folder handles kept in memory (folder.ts `HandleStore`). */
export function memoryHandles(): HandleStore & {
	readonly map: Map<string, FsDirHandle>;
	readonly digests: Map<string, Digest>;
} {
	const map = new Map<string, FsDirHandle>();
	const digests = new Map<string, Digest>();
	return {
		map,
		digests,
		get: (key) => Promise.resolve(map.get(key) ?? null),
		all: () => Promise.resolve([...map]),
		put: (key, h) => {
			map.set(key, h);
			return Promise.resolve();
		},
		digest: (key) => Promise.resolve(digests.get(key) ?? null),
		putDigest: (key, d) => {
			digests.set(key, d);
			return Promise.resolve();
		},
	};
}

type Digest = NonNullable<Awaited<ReturnType<HandleStore['digest']>>>;
