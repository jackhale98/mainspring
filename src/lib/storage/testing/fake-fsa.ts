// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * An in-memory File System Access API for tests (phase-4.md 13.1): directory and file handles over
 * a tree, with Chromium's semantics where folder.ts relies on them.
 *
 * - **`getFile()` is a snapshot**: its size and `lastModified` are the file's at the call, and
 *   reading its bytes after the file changed (or went) rejects with `NotReadableError`.
 * - **`createWritable()` writes to a swap file**: nothing changes until `close()`, which replaces
 *   the file at once and stamps it with the clock's time; `abort()`, or a crash before `close()`
 *   (a writable never closed), leaves the old file as it was.
 * - **A handle of a removed entry** rejects with `NotFoundError`.
 * - **Permissions**: `queryPermission` answers `permission`; `requestPermission` answers `answer`
 *   and makes it the permission (a user who allows or refuses).
 * - **Faults**: `failNext(op, name)` makes the next call of `op` reject with a `DOMException` of
 *   that name (`QuotaExceededError` on `close`, say).
 *
 * The clock starts at a fixed time and moves 1 s on every read of it, so stamps differ unless a
 * test sets them (`put` and `touch` take a time).
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

export class FakeFs {
	permission: PermissionState = 'granted';
	answer: PermissionState = 'granted';
	/** How many files `close()` replaced. */
	closes = 0;
	#time = 1_700_000_000_000;
	readonly #faults = new Map<FakeOp, string>();
	readonly #root: DirNode;

	constructor(name = 'plans') {
		this.#root = new DirNode(name);
	}

	/** The clock: 1 s later on every read. */
	now(): number {
		return (this.#time += 1000);
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

	/** Writes a file (and its folders) at once, as another program would. */
	put(path: string, bytes: Uint8Array | string, at = this.now()): void {
		const parts = path.split('/');
		const name = parts.pop() ?? '';
		const dir = this.#dirAt(parts.join('/'), true);
		const old = dir.entries.get(name);
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
		const node = dir.entries.get(name);
		if (!node) throw new Error(`no ${path}`);
		dir.entries.delete(name);
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

	/** Every file's path, sorted. */
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
			let next = d.entries.get(p);
			if (!next && create) d.entries.set(p, (next = new DirNode(p)));
			if (!(next instanceof DirNode)) throw new Error(`no folder ${path}`);
			d = next;
		}
		return d;
	}

	#file(path: string): FileNode {
		const parts = path.split('/');
		const name = parts.pop() ?? '';
		const f = this.#dirAt(parts.join('/'), false).entries.get(name);
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
		let n = this.node.entries.get(name);
		if (!n && o?.create) this.node.entries.set(name, (n = new DirNode(name)));
		if (!n) throw domError('NotFoundError');
		if (!(n instanceof DirNode)) throw domError('TypeMismatchError');
		return new FakeDirHandle(this.fs, n);
	}

	async getFileHandle(name: string, o?: { readonly create?: boolean }): Promise<FsFileHandle> {
		this.#live('getFileHandle');
		let n = this.node.entries.get(name);
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
			},
			async abort() {
				open = false;
			},
		};
	}
}

/** Folder handles kept in memory (folder.ts `HandleStore`). */
export function memoryHandles(): HandleStore & { readonly map: Map<string, FsDirHandle> } {
	const map = new Map<string, FsDirHandle>();
	return {
		map,
		get: (key) => Promise.resolve(map.get(key) ?? null),
		all: () => Promise.resolve([...map]),
		put: (key, h) => {
			map.set(key, h);
			return Promise.resolve();
		},
	};
}
