// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The folder provider's work on the disk (folder.ts is the provider and its contract): the
 * revision's stamps, the walk, the error kinds, the lookups that never create (case, folders that
 * are files), the content check before an overwrite and the swap-file write. Lazy, with folder.ts.
 */
import type { Digest, FsDirHandle, FsFile, FsFileHandle } from './folder-handles';
import { isWorkspacePath } from '../workspace/paths';
import {
	isPlanFile,
	StorageFailure,
	storageError,
	type StorageError,
	type StorageErrorKind,
	type WorkspacePath,
} from './types';

const REVISION = 'folder:1:';
const KINDS: Readonly<Record<string, StorageErrorKind>> = {
	NotFoundError: 'not-found',
	NotAllowedError: 'permission',
	SecurityError: 'permission',
	QuotaExceededError: 'quota',
};

export type Stamp = readonly [size: number, mtime: number];
export type Stamps = ReadonlyMap<WorkspacePath, Stamp>;
export const nameOf = (e: unknown): string => {
	const n = (e as { name?: unknown } | null)?.name;
	return typeof n === 'string' ? n : 'error';
};

/** A failure as a `StorageError` (module comment). */
export function folderError(e: unknown): StorageError {
	if (e instanceof StorageFailure) return e.error;
	const n = nameOf(e);
	return storageError(KINDS[n] ?? 'server', `folder: ${n}`);
}

export const byPath = <T>(a: readonly [string, T], b: readonly [string, T]): number =>
	a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

export const revisionOf = (stamps: Stamps): string =>
	REVISION + JSON.stringify([...stamps].sort(byPath).map(([p, [s, m]]) => [p, s, m]));

/** The stamps a revision of this provider holds; null for any other string. */
export function stampsOf(revision: string): Map<WorkspacePath, Stamp> | null {
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

export const stampOf = (f: FsFile): Stamp => [f.size, f.lastModified];

export function sameStamps(a: Stamps, b: Stamps): boolean {
	if (a.size !== b.size) return false;
	for (const [p, [s, m]] of a) {
		const o = b.get(p);
		if (!o || o[0] !== s || o[1] !== m) return false;
	}
	return true;
}

/** Every plan file under `root`, by path (module comment). */
export async function walk(
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
export const racing = (e: unknown): boolean =>
	['NotReadableError', 'NotFoundError'].includes(nameOf(e));

/** Whether the folder itself is gone (its handle no longer lists). */
export async function gone(root: FsDirHandle): Promise<boolean> {
	try {
		for await (const _ of root.values()) break;
		return false;
	} catch (e) {
		return nameOf(e) === 'NotFoundError';
	}
}

/** Runs `f`, turning what it throws into a `StorageFailure`, or `signal.reason` once aborted. */
export async function guard<T>(signal: AbortSignal | undefined, f: () => Promise<T>): Promise<T> {
	try {
		signal?.throwIfAborted();
		return await f();
	} catch (e) {
		if (signal?.aborted) throw signal.reason;
		throw e instanceof StorageFailure ? e : new StorageFailure(folderError(e));
	}
}

/** Tries `f` up to three times while a file changes under it (module comment, "Revisions"). */
export async function settled<T>(signal: AbortSignal | undefined, f: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await f();
		} catch (e) {
			if (attempt >= 3 || signal?.aborted || !racing(e)) throw e;
		}
	}
}

/** Two of `paths` that differ only by case, or null (module comment, "Case"). */
export function caseClash(paths: Iterable<string>): readonly [string, string] | null {
	const seen = new Map<string, string>();
	for (const p of paths) {
		const low = p.toLowerCase();
		const other = seen.get(low);
		if (other !== undefined && other !== p) return [other, p];
		seen.set(low, p);
	}
	return null;
}

/** A path the provider may write: a plan file, a workspace path, not through `.git` (L1). */
export const writable = (p: string): boolean =>
	isWorkspacePath(p) && isPlanFile(p) && !p.split('/').includes('.git');

/**
 * Whether anything answers to `path` under `root`, looked up without `create`, so a disk that
 * ignores case answers for a file of another case (module comment, "Case"). A folder of the path
 * that is a file rejects with `TypeMismatchError` (L2).
 */
export async function present(root: FsDirHandle, path: WorkspacePath): Promise<boolean> {
	const parts = path.split('/');
	const name = parts.pop() ?? path;
	let dir = root;
	try {
		for (const p of parts) dir = await dir.getDirectoryHandle(p);
		await dir.getFileHandle(name);
		return true;
	} catch (e) {
		const n = nameOf(e);
		// A folder where the file would be: something is there.
		if (
			n === 'TypeMismatchError' &&
			(await dir.getDirectoryHandle(name).then(
				() => true,
				() => false,
			))
		)
			return true;
		if (n === 'NotFoundError') return false;
		throw e;
	}
}

/** The SHA-256 of `bytes`, hex. */
export async function sha256(bytes: Uint8Array): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
	return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the file is still what the base read (module comment, "Write"): its stamp is the base's,
 * and its content is what was read at that stamp when the digest knows it (M3).
 */
export async function unchanged(
	h: FsFileHandle,
	base: Stamp,
	known: Digest[string] | undefined,
): Promise<boolean> {
	const f = await h.getFile();
	if (f.size !== base[0] || f.lastModified !== base[1]) return false;
	if (!known || known[0] !== base[0] || known[1] !== base[1]) return true;
	try {
		return (await sha256(new Uint8Array(await f.arrayBuffer()))) === known[2];
	} catch (e) {
		if (racing(e)) return false;
		throw e;
	}
}

/** The file at `path` under `root`, its folders created when `create`. */
export async function fileAt(root: FsDirHandle, path: WorkspacePath): Promise<FsFileHandle> {
	const parts = path.split('/');
	const name = parts.pop() ?? path;
	let dir = root;
	for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
	return dir.getFileHandle(name, { create: true });
}

/** Writes `bytes` through a swap file (module comment) and returns the file's new stamp. */
export async function writeFile(h: FsFileHandle, bytes: Uint8Array): Promise<Stamp> {
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
