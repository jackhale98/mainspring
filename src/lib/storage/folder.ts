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
 *   with nothing written. So is anything that answers to an added path (below, "Case"), and a path
 *   through `.git` or whose folder is a file is refused (`failed`) before anything is written.
 *   Then the files that exist are written, then the added ones, each in path order. Right before a
 *   file is overwritten it is looked at again: its stamp must be the base's, and its content what
 *   was read at that stamp (the digest, below); otherwise the write stops there as `moved`, and that
 *   file and the rest are not written. This catches a change made while other files were being
 *   written, and an edit with the same size and time (a disk with a coarse clock: FAT's 2 s, a
 *   network share's 1 s). Each file is written with `createWritable`: a swap file that replaces the
 *   file on `close`, so a crash leaves the old file whole; missing subfolders are created; nothing
 *   is deleted or renamed. The new revision is `base`'s stamps with the written files' new ones.
 *   Not atomic across files: a `failed` or a `moved` part way leaves the files before it written
 *   (types.ts, contract notes T5).
 * - **Digests**: what `read` read and `write` wrote, per file (size, `lastModified`, SHA-256), is
 *   kept beside the handle (folder-handles.ts `Digest`), so the content check holds after a reload.
 *   A file the digest does not know at the base's stamp is checked by its stamp alone.
 * - **Case**. A disk that ignores case (the default on macOS and Windows) opens `Plan.tjp` for
 *   `plan.tjp`. So an added path is first looked up without `create`, every folder of it and the
 *   file, and anything that answers is `moved`, never opened; this also covers `notes.TJI`, which is
 *   not a plan file. A write whose paths differ only by case is refused (`failed`, `folder: case`).
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
	type Digest,
	type FsDirHandle,
	type FsFile,
	type FsFileHandle,
	type HandleStore,
} from './folder-handles';
import {
	caseClash,
	fileAt,
	folderError,
	gone,
	guard,
	nameOf,
	planLike,
	present,
	revisionOf,
	settled,
	sha256,
	sameStamps,
	stampOf,
	stampsOf,
	unchanged,
	walk,
	writable,
	writeFile,
	type Stamp,
} from './folder-disk';
import { failure } from './idb';
import {
	planLimitProblem,
	StorageFailure,
	storageError,
	type Access,
	type FolderLocation,
	type RemoteSnapshot,
	type StorageErrorKind,
	type StorageProvider,
	type WorkspacePath,
	type WriteRequest,
	type WriteResult,
} from './types';

export { caseClash, folderError, revisionPaths } from './folder-disk';
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
	/**
	 * Every file under the folder whose name ends in `.tjp` or `.tji` in any case (walked as the
	 * plan files are), sorted: Save to… writes only into a folder without them (T5 review M5).
	 * Rejects as `read` does.
	 */
	planNames(loc: FolderLocation, signal?: AbortSignal): Promise<WorkspacePath[]>;
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
interface Listing {
	readonly handles: ReadonlyMap<WorkspacePath, FsFileHandle>;
	readonly files: ReadonlyMap<WorkspacePath, FsFile>;
}

type Picker = { showDirectoryPicker?: (o: object) => Promise<unknown> };

/** Whether this browser can open a folder in place (`showDirectoryPicker`, Chromium; 4). */
export function folderSupported(w: object = globalThis): boolean {
	return typeof (w as Picker).showDirectoryPicker === 'function';
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

	/** What was read or written of `loc`, with `add`; a digest the store cannot keep is lost. */
	const remember = async (
		loc: FolderLocation,
		add: Digest,
		keep?: Digest | null,
	): Promise<void> => {
		await handles.putDigest(loc.handle, { ...keep, ...add }).catch(() => undefined);
	};
	const moved = async (
		root: FsDirHandle,
		signal: AbortSignal | undefined,
	): Promise<WriteResult> => ({
		status: 'moved',
		head: revisionOf(stampsNow(await list(root, signal))),
		commit: null,
	});
	const write = async (
		loc: FolderLocation,
		req: WriteRequest,
		signal: AbortSignal | undefined,
	): Promise<WriteResult> => {
		const paths = [...req.files.keys()];
		if (!paths.every(writable)) return failed('server', 'folder: not a plan file');
		if (caseClash(paths)) return failed('server', 'folder: case');
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
		// Added paths: nothing may answer to them, in any case, and their folders are folders (H1, L2).
		const added = paths.filter((p) => !l.handles.has(p)).sort();
		for (const p of added) if (await present(root, p)) return moved(root, signal);
		const known = await handles.digest(loc.handle).catch(() => null);
		const wrote: Record<string, Digest[string]> = {};
		try {
			// The files that exist first, then the added ones (M4), each in path order.
			for (const path of [...paths.filter((p) => l.handles.has(p)).sort(), ...added]) {
				signal?.throwIfAborted();
				const bytes = req.files.get(path) ?? new Uint8Array(0);
				const there = l.handles.get(path);
				// Right before it is overwritten, the file is still what the base read (M3).
				if (
					there
						? !(await unchanged(there, base.get(path) ?? [-1, -1], known?.[path]))
						: await present(root, path)
				) {
					return await moved(root, signal);
				}
				const stamp = await writeFile(there ?? (await fileAt(root, path)), bytes);
				now.set(path, stamp);
				wrote[path] = [stamp[0], stamp[1], await sha256(bytes)];
			}
		} finally {
			if (Object.keys(wrote).length > 0) await remember(loc, wrote, known);
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
					const seen: Record<string, Digest[string]> = {};
					for (const [p, f] of l.files) {
						const bytes = new Uint8Array(await f.arrayBuffer());
						files.set(p, bytes);
						seen[p] = [f.size, f.lastModified, await sha256(bytes)];
					}
					signal?.throwIfAborted();
					await remember(loc, seen);
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

		planNames: (loc, signal) =>
			guard(signal, async () => [...(await walk(await dirOf(loc), signal, max, planLike)).keys()]),

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
