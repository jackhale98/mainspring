// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The local folder provider (phase-4.md 4, 7.2, 7.4; types.ts `StorageProvider` is the spec): a
 * folder picked with the File System Access API (Chromium), read and written in place. Lazy.
 *
 * - **Pick** (`pick`, inside a user gesture): `showDirectoryPicker({ mode: 'readwrite' })`. The
 *   handle is kept in the `handles` store of the storage database (folder-handles.ts) under a
 *   random key, the location's `handle`. A folder picked again (`isSameEntry`) keeps its key, so a
 *   location is one folder however often it is picked, and what was chosen there is remembered by
 *   it (18.22).
 * - **The plan files** are every `.tjp` and `.tji` under the folder whose path is a workspace path
 *   (7.4), found by walking it. `.git` is not entered (it holds git's objects, never a file a user
 *   edits), and a walk past `MAX_ENTRIES` entries is `too-large` (a home folder picked by mistake).
 * - **Revisions** are the plan files' stamps (path, size, `lastModified`), sorted by path, as JSON:
 *   `head` makes one from the files as they are now, `read` from the very `File` snapshots whose
 *   bytes it read (a file that changes meanwhile cannot be read from its old snapshot: it is read
 *   again, and shows in the next `head`). This module reads its own revisions back (`write`'s check,
 *   `revisionPaths`; types.ts contract notes).
 * - **Write** (7.2). Every plan file's stamp is checked against `base`'s before the first byte is
 *   written. Any difference (a file changed, only touched, added or deleted on disk) is `moved`,
 *   with nothing written; an added path that is on disk by then is such a difference, never an
 *   overwrite. Each file is written with `createWritable`: a swap file that replaces the file on
 *   `close`, so a crash leaves the old file whole; missing subfolders are created; nothing is
 *   deleted or renamed. The new revision is `base`'s stamps with the written files' new ones. Not
 *   atomic across files: a failure leaves the files before it written (types.ts `failed`).
 * - **Access**: `queryPermission` and `requestPermission` for `readwrite`; a handle without them (an
 *   origin-private folder) is granted. A location whose handle is not stored (the browser's storage
 *   was cleared) is `denied`: only picking the folder again can give it back.
 * - **External changes** (7.2, 19.14) are folder-changes.ts's: the revision first, then the text.
 * - **Errors** (types.ts): a `DOMException`'s name says the kind (`NotFoundError` not-found,
 *   `NotAllowedError` and `SecurityError` permission, `QuotaExceededError` quota, others server);
 *   the detail is that name, never a path or content.
 */
import {
	idbHandles,
	type FsDirHandle,
	type FsFile,
	type FsFileHandle,
	type HandleStore,
} from './folder-handles';
import { failure } from './idb';
import { isWorkspacePath } from '../workspace/paths';
import {
	isPlanFile,
	planLimitProblem,
	StorageFailure,
	storageError,
	type Access,
	type FolderLocation,
	type RemoteSnapshot,
	type StorageError,
	type StorageErrorKind,
	type StorageProvider,
	type WorkspacePath,
	type WriteRequest,
	type WriteResult,
} from './types';

export type {
	Digest,
	FsDirHandle,
	FsFile,
	FsFileHandle,
	FsWritable,
	HandleStore,
} from './folder-handles';

/** A folder provider; `pick` is its own (the other providers have no picker). */
export interface FolderProvider extends StorageProvider<FolderLocation> {
	/**
	 * The folder picker, inside a user gesture: the folder's location, its handle stored; null when
	 * the user closed the picker. Rejects with a `StorageFailure` (`unsupported` without the API).
	 */
	pick(): Promise<FolderLocation | null>;
}

export interface FolderOptions {
	readonly handles?: HandleStore;
	/** Default `showDirectoryPicker({ mode: 'readwrite' })`; null where the browser has none. */
	readonly pick?: (() => Promise<FsDirHandle>) | null;
	readonly maxEntries?: number;
}

/** The most entries (files and folders) a walk visits (module comment). */
export const MAX_ENTRIES = 20_000;
const MODE = { mode: 'readwrite' } as const;
const REVISION = 'folder:1:';
const KINDS: Readonly<Record<string, StorageErrorKind>> = {
	NotFoundError: 'not-found',
	NotAllowedError: 'permission',
	SecurityError: 'permission',
	QuotaExceededError: 'quota',
};

type Stamp = readonly [size: number, mtime: number];
type Stamps = ReadonlyMap<WorkspacePath, Stamp>;
interface Listing {
	readonly handles: ReadonlyMap<WorkspacePath, FsFileHandle>;
	readonly files: ReadonlyMap<WorkspacePath, FsFile>;
}

type Picker = { showDirectoryPicker?: (o: object) => Promise<unknown> };

/** Whether this browser can open a folder in place (`showDirectoryPicker`, Chromium; 4). */
export function folderSupported(w: object = globalThis): boolean {
	return typeof (w as Picker).showDirectoryPicker === 'function';
}

const nameOf = (e: unknown): string => {
	const n = (e as { name?: unknown } | null)?.name;
	return typeof n === 'string' ? n : 'error';
};

/** A failure as a `StorageError` (module comment). */
export function folderError(e: unknown): StorageError {
	if (e instanceof StorageFailure) return e.error;
	const n = nameOf(e);
	return storageError(KINDS[n] ?? 'server', `folder: ${n}`);
}

const byPath = <T>(a: readonly [string, T], b: readonly [string, T]): number =>
	a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

const revisionOf = (stamps: Stamps): string =>
	REVISION + JSON.stringify([...stamps].sort(byPath).map(([p, [s, m]]) => [p, s, m]));

/** The stamps a revision of this provider holds; null for any other string. */
function stampsOf(revision: string): Map<WorkspacePath, Stamp> | null {
	if (!revision.startsWith(REVISION)) return null;
	try {
		const rows: unknown = JSON.parse(revision.slice(REVISION.length));
		if (!Array.isArray(rows)) return null;
		const out = new Map<WorkspacePath, Stamp>();
		for (const r of rows as unknown[]) {
			if (!Array.isArray(r) || r.length !== 3) return null;
			const [p, s, m] = r as unknown[];
			if (typeof p !== 'string' || typeof s !== 'number' || typeof m !== 'number') return null;
			out.set(p, [s, m]);
		}
		return out;
	} catch {
		return null;
	}
}

/** The plan files a folder revision names (Save to… checks names against them); null if not one. */
export function revisionPaths(revision: string): ReadonlySet<WorkspacePath> | null {
	const s = stampsOf(revision);
	return s && new Set(s.keys());
}

const stampOf = (f: FsFile): Stamp => [f.size, f.lastModified];

function sameStamps(a: Stamps, b: Stamps): boolean {
	if (a.size !== b.size) return false;
	for (const [p, [s, m]] of a) {
		const o = b.get(p);
		if (!o || o[0] !== s || o[1] !== m) return false;
	}
	return true;
}

/** Every plan file under `root`, by path (module comment). */
async function walk(
	root: FsDirHandle,
	signal: AbortSignal | undefined,
	max: number,
): Promise<Map<WorkspacePath, FsFileHandle>> {
	const found: Array<readonly [WorkspacePath, FsFileHandle]> = [];
	const todo: Array<readonly [string, FsDirHandle]> = [['', root]];
	let seen = 0;
	for (let next = todo.pop(); next; next = todo.pop()) {
		const [prefix, dir] = next;
		for await (const h of dir.values()) {
			signal?.throwIfAborted();
			if (++seen > max) throw new StorageFailure(storageError('too-large', 'folder: entries'));
			const path = prefix + h.name;
			if (!isWorkspacePath(path)) continue;
			if (h.kind === 'directory') {
				if (h.name !== '.git') todo.push([`${path}/`, h]);
			} else if (isPlanFile(path)) found.push([path, h]);
		}
	}
	return new Map(found.sort(byPath));
}

/** Errors of a file that changed or went while it was being read: reading again helps. */
const racing = (e: unknown): boolean => ['NotReadableError', 'NotFoundError'].includes(nameOf(e));

/** Whether the folder itself is gone (its handle no longer lists). */
async function gone(root: FsDirHandle): Promise<boolean> {
	try {
		for await (const _ of root.values()) break;
		return false;
	} catch (e) {
		return nameOf(e) === 'NotFoundError';
	}
}

/** Runs `f`, turning what it throws into a `StorageFailure`, or `signal.reason` once aborted. */
async function guard<T>(signal: AbortSignal | undefined, f: () => Promise<T>): Promise<T> {
	try {
		signal?.throwIfAborted();
		return await f();
	} catch (e) {
		if (signal?.aborted) throw signal.reason;
		throw e instanceof StorageFailure ? e : new StorageFailure(folderError(e));
	}
}

/** Tries `f` up to three times while a file changes under it (module comment, "Revisions"). */
async function settled<T>(signal: AbortSignal | undefined, f: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await f();
		} catch (e) {
			if (attempt >= 3 || signal?.aborted || !racing(e)) throw e;
		}
	}
}

/** The file at `path` under `root`, its folders created when `create`. */
async function fileAt(root: FsDirHandle, path: WorkspacePath): Promise<FsFileHandle> {
	const parts = path.split('/');
	const name = parts.pop() ?? path;
	let dir = root;
	for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
	return dir.getFileHandle(name, { create: true });
}

/** Writes `bytes` through a swap file (module comment) and returns the file's new stamp. */
async function writeFile(h: FsFileHandle, bytes: Uint8Array): Promise<Stamp> {
	const w = await h.createWritable();
	try {
		await w.write(bytes);
		await w.close();
	} catch (e) {
		await w.abort().catch(() => undefined);
		throw e;
	}
	return stampOf(await h.getFile());
}

const failed = (kind: StorageErrorKind, detail: string): WriteResult => ({
	status: 'failed',
	error: storageError(kind, detail),
});

const asAccess = (p: PermissionState): Access => (p === 'granted' || p === 'prompt' ? p : 'denied');

export function createFolderProvider(o: FolderOptions = {}): FolderProvider {
	const handles = o.handles ?? idbHandles();
	const max = o.maxEntries ?? MAX_ENTRIES;
	const w = globalThis as Picker;
	const pick =
		o.pick !== undefined
			? o.pick
			: folderSupported(w)
				? () =>
						w.showDirectoryPicker!({ mode: 'readwrite', id: 'mainspring' }) as Promise<FsDirHandle>
				: null;

	/** The stored handle of `loc`; rejects with `not-found` when there is none. */
	const dirOf = async (loc: FolderLocation): Promise<FsDirHandle> => {
		const h = await handles.get(loc.handle);
		if (!h) throw new StorageFailure(storageError('not-found', 'folder: no handle'));
		return h;
	};
	const list = (root: FsDirHandle, signal: AbortSignal | undefined): Promise<Listing> =>
		settled(signal, async () => {
			const found = await walk(root, signal, max);
			const files = new Map<WorkspacePath, FsFile>();
			for (const [p, h] of found) files.set(p, await h.getFile());
			return { handles: found, files };
		});
	const stampsNow = (l: Listing): Map<WorkspacePath, Stamp> =>
		new Map([...l.files].map(([p, f]) => [p, stampOf(f)]));
	const permission = async (
		loc: FolderLocation,
		ask: (h: FsDirHandle) => Promise<PermissionState> | undefined,
	): Promise<Access> => {
		try {
			const h = await handles.get(loc.handle);
			if (!h) return 'denied';
			const p = ask(h);
			return p ? asAccess(await p) : 'granted';
		} catch {
			return 'denied';
		}
	};

	const write = async (
		loc: FolderLocation,
		req: WriteRequest,
		signal: AbortSignal | undefined,
	): Promise<WriteResult> => {
		for (const p of req.files.keys()) {
			if (!isWorkspacePath(p) || !isPlanFile(p)) return failed('server', 'folder: not a plan file');
		}
		const base = stampsOf(req.base);
		if (!base) return failed('server', 'folder: not a folder revision');
		const root = await dirOf(loc);
		const l = await list(root, signal);
		const now = stampsNow(l);
		if (!sameStamps(base, now)) return { status: 'moved', head: revisionOf(now), commit: null };
		const sizes = new Map([...now].map(([p, [s]]) => [p, s]));
		for (const [p, b] of req.files) sizes.set(p, b.byteLength);
		const problem = planLimitProblem(sizes.values());
		if (problem) return failed('too-large', `folder: ${problem}`);
		for (const [path, bytes] of [...req.files].sort(byPath)) {
			signal?.throwIfAborted();
			now.set(path, await writeFile(l.handles.get(path) ?? (await fileAt(root, path)), bytes));
		}
		return { status: 'written', revision: revisionOf(now) };
	};

	return {
		kind: 'folder',

		access: (loc) => permission(loc, (h) => h.queryPermission?.(MODE)),
		requestAccess: (loc) => permission(loc, (h) => h.requestPermission?.(MODE)),

		head: (loc, signal) =>
			guard(signal, async () => {
				const root = await handles.get(loc.handle);
				if (!root) return null;
				try {
					return revisionOf(stampsNow(await list(root, signal)));
				} catch (e) {
					if (nameOf(e) === 'NotFoundError' && (await gone(root))) return null;
					throw e;
				}
			}),

		read: (loc, signal) =>
			guard(signal, async (): Promise<RemoteSnapshot> => {
				const root = await dirOf(loc);
				return settled(signal, async () => {
					const l = await list(root, signal);
					const problem = planLimitProblem([...l.files.values()].map((f) => f.size));
					if (problem) throw new StorageFailure(storageError('too-large', `folder: ${problem}`));
					const files = new Map<WorkspacePath, Uint8Array>();
					for (const [p, f] of l.files) files.set(p, new Uint8Array(await f.arrayBuffer()));
					signal?.throwIfAborted();
					const times = [...l.files.values()].map((f) => f.lastModified);
					return {
						revision: revisionOf(stampsNow(l)),
						files,
						author: null,
						at: times.length > 0 ? Math.max(...times) : null,
					};
				});
			}),

		write: async (loc, req, signal) => {
			try {
				signal?.throwIfAborted();
				return await write(loc, req, signal);
			} catch (e) {
				if (signal?.aborted) throw signal.reason;
				return { status: 'failed', error: folderError(e) };
			}
		},

		pick: async () => {
			if (!pick) throw new StorageFailure(storageError('unsupported', 'folder: no picker'));
			let dir: FsDirHandle;
			try {
				dir = await pick();
			} catch (e) {
				if (nameOf(e) === 'AbortError') return null;
				throw new StorageFailure(folderError(e));
			}
			try {
				let key: string | null = null;
				for (const [k, h] of await handles.all()) {
					if (await h.isSameEntry?.(dir).catch(() => false)) {
						key = k;
						break;
					}
				}
				key ??= crypto.randomUUID();
				await handles.put(key, dir);
				return { kind: 'folder', handle: key, name: dir.name };
			} catch (e) {
				throw failure(e);
			}
		},
	};
}
