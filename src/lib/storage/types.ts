// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a plan lives and how a provider reads and writes it (phase-4.md 6.1, 7.2, 7.3, 7.4;
 * ADR-0019). Types and contracts only (T3): the folder provider is T5's (`folder.ts`), the GitHub
 * provider T8's (`github/provider.ts`). The local store's types are in store-types.ts (6.2).
 *
 * ## Contract
 *
 * - **Bytes at the boundary.** A provider deals in bytes (`Uint8Array`), never text: it reads a
 *   file's bytes exactly as stored and writes exactly the bytes it is given (no newline, BOM or
 *   encoding change). Text comes only from the codec (store-types.ts `DecodePlanFile`, ADR-0002
 *   #13), so every valid UTF-8 file round-trips byte for byte (ADR-0003 #1 amended, 18.11).
 * - **Plan files only** (7.4). The files of a location are every `.tjp` and `.tji` under its root
 *   (`isPlanFile`) whose path is a valid workspace path; other files are never read or written.
 *   Paths are relative to the root: the folder, or the repository's `dir`.
 * - **Limits** (`PLAN_LIMITS`). Past them, `read` rejects and `write` fails with `too-large`.
 *   Providers check sizes before they fetch content (`planLimitProblem`).
 * - **Never forced, never deleted** (8.1 #4, #5). Every write is conditional on its base, and no
 *   write removes or renames a file.
 * - **Files are added or changed, never removed** (21, "New file"). A plan can gain a `.tji` file
 *   in a session (`Workspace.addFile`, T27a), so a write may name a path the provider has never
 *   seen. The provider creates it: folder, with any missing subfolders; github, as a new entry of
 *   the tree (mode `100644`). A file outside the include graph ("Not included") is a plan file
 *   like any other: read, written and kept.
 * - **Errors.** `access` and `requestAccess` never reject. `head` and `read` reject with a
 *   `StorageFailure` (`isStorageFailure`). `write` resolves every failure as `failed`. Every
 *   method that takes a `signal` rejects with `signal.reason` once it aborts; nothing else
 *   rejects (another rejection is a bug, reported as such).
 * - **Offline.** Every method may be called offline: `access` answers from what it has stored,
 *   and the network calls fail as `offline` (`head`, `read`) or `failed` with `offline` (`write`).
 * - **Who owns what.** A provider holds no plan text: the local store does (store-types.ts). A
 *   provider may cache network metadata in memory (ETags, the last stamps it saw).
 *
 * Contract notes (T3; where the spec was silent or its types did not fit):
 * - `RemoteSnapshot` adds `author` and `at`: the conflict header needs "commit 3f2a91b by its
 *   author, 10 min ago" (8.3), and 6.1 had no field for it.
 * - `WriteResult.moved` adds `commit`: the commit GitHub made on `base` whose branch update was
 *   refused. 18.10 keeps queued commits as separate commits under a merge commit with both
 *   parents, so the merge commit must be able to name them in `WriteRequest.parents`.
 * - A folder revision is opaque to callers (compare for equality only); the folder provider may
 *   read its own revisions back (e.g. the per-file stamps it encodes), as 7.2's per-file check
 *   needs the stamps of the base after a reload.
 * - `head` and `read` reject with `StorageFailure` rather than returning a union: 6.1 types them
 *   as plain promises.
 * - The limits use binary megabytes (2 MiB per file, 8 MiB in all); 6.1 says "MB".
 * - `Location` keeps the spec's name. It shadows the DOM's `Location` in a module that imports
 *   it; such a module names the DOM one `globalThis.Location`.
 */
import type { WorkspacePath } from '../workspace/paths';
import { hasIncludeSuffix, isProjectFile } from '../workspace/paths';

export type { WorkspacePath };

/**
 * A stored plan's id: random and stable for the plan's life (store-types.ts `StoredPlan`). Made
 * with `crypto.randomUUID()`; opaque, and safe in a preference key, a URL and an IndexedDB key
 * (`isWorkspaceId`).
 */
export type WorkspaceId = string;

/** Where a plan lives (6.1). A location names a root; the plan's files are under it. */
export type Location =
	/** Only in this browser's storage (the local store); no provider. */
	| { readonly kind: 'browser' }
	/**
	 * A local folder (Chromium, 7.2). `handle` is the key of the stored `FileSystemDirectoryHandle`
	 * in the local store's database; `name` is the folder's name, for display.
	 */
	| { readonly kind: 'folder'; readonly handle: string; readonly name: string }
	/**
	 * A folder of a GitHub repository (7.3). `account` is the signed-in account's key
	 * (store-types.ts `GitHubCredential.account`); `branch` is the branch that was opened, the only
	 * one written (7.3); `dir` is '' for the repository root, else a workspace path (no leading or
	 * trailing '/').
	 */
	| {
			readonly kind: 'github';
			readonly account: string;
			readonly owner: string;
			readonly repo: string;
			readonly branch: string;
			readonly dir: string;
	  };

export type FolderLocation = Extract<Location, { kind: 'folder' }>;
export type GitHubLocation = Extract<Location, { kind: 'github' }>;
/** The locations a provider serves; a browser-only plan has none (the local store keeps it). */
export type ProviderLocation = FolderLocation | GitHubLocation;

/** A location's plan files at one revision (6.1). */
export interface RemoteSnapshot {
	/**
	 * github: the commit sha whose tree was read. folder: a fingerprint of the plan files' names,
	 * sizes and last-modified times as read (contract notes). Callers compare revisions for
	 * equality only.
	 */
	readonly revision: string;
	/** Every plan file under the root, relative to it, as stored (bytes). */
	readonly files: ReadonlyMap<WorkspacePath, Uint8Array>;
	/** github: the commit author's name. folder: null. For the conflict header (8.3). */
	readonly author: string | null;
	/** github: the commit's author date, ms since the epoch. folder: the newest file's mtime. */
	readonly at: number | null;
}

/** One write (6.1): the files that changed, on the revision they were made on. */
export interface WriteRequest {
	/**
	 * The revision the change was made on. github: also the tree the new tree starts from
	 * (`base_tree`), so files the request does not name, plan files and others, stay as they are
	 * at `base`. For a merge commit it is the remote head (the second parent).
	 */
	readonly base: string;
	/**
	 * Changed or added files, relative to the root, as the bytes to store. Never deletes. A file
	 * whose text equals its base text is never in it (6.2). An added file is a path `base` does not
	 * have (21): it is created, and if the location has one by then (someone else made it), that is
	 * `moved`, never an overwrite (folder: its stamp check; github: the branch moved past `base`).
	 * github: an empty map without `parents`
	 * makes no commit and returns `written` with `base`; with `parents` it is a merge commit whose
	 * tree is `base`'s.
	 */
	readonly files: ReadonlyMap<WorkspacePath, Uint8Array>;
	/** The commit message (subject, a blank line, the body); required for github, null for a folder. */
	readonly message: string | null;
	/**
	 * github only: the new commit's parents, in order; default `[base]`. A merge commit (18.10)
	 * names the local line's tip first (a `moved.commit`, or the base the queue started from) and
	 * the remote head (`base`) last.
	 */
	readonly parents?: readonly string[];
}

/** The result of a write (6.1). `write` resolves every failure here, never by rejecting. */
export type WriteResult =
	/** Everything was written. github: the branch now points at `revision`, the new commit. */
	| { readonly status: 'written'; readonly revision: string }
	/**
	 * Someone else wrote first: pull, merge, try again. `head` is the location's revision now.
	 * github: `commit` is the commit made on `base` whose branch update was refused (not on any
	 * branch; a later write may name it in `parents`), or null when none was made. folder: nothing
	 * was written (every file's stamp is checked before the first is written) and `commit` is null.
	 */
	| { readonly status: 'moved'; readonly head: string; readonly commit: string | null }
	/**
	 * Not written. folder: not atomic across files, so some files may have been written before the
	 * failure; the next attempt finds them moved, and the caller's pull merges them cleanly
	 * (identical changes on both sides), so only the rest is written (7.2). github: all or nothing
	 * (objects made before the failure are on no branch).
	 */
	| { readonly status: 'failed'; readonly error: StorageError };

export type StorageErrorKind =
	| 'offline'
	| 'auth'
	| 'permission'
	| 'not-found'
	| 'quota'
	| 'rate-limited'
	| 'too-large'
	| 'unsupported'
	| 'server';

/**
 * A failure a provider or the local store reports (6.1). What each kind means:
 * - `offline`: the network is unreachable (a fetch `TypeError`, or `navigator.onLine` false).
 * - `auth`: signed out, or a token that is refused after one refresh (401).
 * - `permission`: folder permission not granted; 403 without rate-limit headers; the account may
 *   read but not write the repository.
 * - `not-found`: the folder handle, repository or branch is gone (404).
 * - `quota`: `QuotaExceededError` from IndexedDB or a folder write.
 * - `rate-limited`: 403 or 429 with `retry-after`, or `x-ratelimit-remaining: 0`; `retryAfterMs`
 *   is set from `retry-after` or `x-ratelimit-reset`.
 * - `too-large`: past `PLAN_LIMITS`, or a tree listing GitHub truncated.
 * - `unsupported`: the browser lacks the API (no `showDirectoryPicker`, IndexedDB blocked).
 * - `server`: 5xx, a 422 that is not a moved branch, or a response that does not fit the contract.
 *
 * The UI words each kind from strings-storage.ts; it never shows `detail`.
 */
export interface StorageError {
	readonly kind: StorageErrorKind;
	/** When to try again, in ms from now; set for `rate-limited` (and a 503 with `retry-after`). */
	readonly retryAfterMs: number | null;
	/**
	 * For logs and tests. Never a token, a URL that carries one, or file content (10.1).
	 */
	readonly detail: string;
}

/** Whether a location can be used now (6.1). */
export type Access =
	/** Readable and writable now. */
	| 'granted'
	/** folder: permission must be asked again, inside a user gesture ("Reconnect", 7.2). */
	| 'prompt'
	/** github: no credential for `loc.account`, or one that cannot be refreshed. */
	| 'signed-out'
	/** folder: the user refused. github: the account has no access to the repository. */
	| 'denied';

/**
 * A provider of one kind of location (6.1). One instance serves every location of its kind and
 * holds no plan text (module comment). All methods are safe to call offline.
 */
export interface StorageProvider<L extends ProviderLocation> {
	readonly kind: L['kind'];
	/** What `requestAccess` would need, without asking anyone. Never rejects. */
	access(loc: L): Promise<Access>;
	/**
	 * Folder permission or sign-in; must run inside a user gesture. folder: asks for read and write
	 * permission. github: refreshes the credential if it can; it does not sign in (the sign-in sheet
	 * stores credentials, T15) and answers `signed-out` without one; offline, it answers from the
	 * stored credential as `access` does (being offline never signs anyone out). Never rejects.
	 */
	requestAccess(loc: L): Promise<Access>;
	/**
	 * Cheap check of the current revision; null when the location is gone (folder handle, branch
	 * or repository not found). github: one conditional request (`If-None-Match`; a 304 is free).
	 * folder: the fingerprint of the files as they are now. Rejects with `StorageFailure`.
	 */
	head(loc: L, signal?: AbortSignal): Promise<string | null>;
	/**
	 * Every plan file at the current revision. github: the files of one commit, so the snapshot is
	 * consistent. folder: file by file; a file that changes meanwhile shows in the next `head`.
	 * Rejects with `StorageFailure` (`too-large` past the limits, `not-found` when gone).
	 */
	read(loc: L, signal?: AbortSignal): Promise<RemoteSnapshot>;
	/**
	 * Conditional on `req.base`; never forces. github: one commit (blobs, a tree on `base`'s tree,
	 * a commit with `parents`, then the branch update with `force: false`, which GitHub refuses
	 * unless it is a fast-forward: `moved`). folder: per file (7.2): each file's size and
	 * `lastModified` are checked against the stamps of `base` before the first is written; any
	 * difference is `moved`. A file only touched (same text) then merges cleanly and silently, so
	 * 7.2's content comparison (19.14) is the merge's, not the provider's. An aborted write may be
	 * part done, as a failed one may.
	 */
	write(loc: L, req: WriteRequest, signal?: AbortSignal): Promise<WriteResult>;
}

/** What `head` and `read` reject with: an `Error` that carries its `StorageError`. */
export class StorageFailure extends Error {
	readonly error: StorageError;

	constructor(error: StorageError) {
		super(`${error.kind}: ${error.detail}`);
		this.name = 'StorageFailure';
		this.error = error;
	}
}

/** A `StorageError` (6.1); `retryAfterMs` defaults to null. */
export function storageError(
	kind: StorageErrorKind,
	detail: string,
	retryAfterMs: number | null = null,
): StorageError {
	return { kind, retryAfterMs, detail };
}

export function isStorageFailure(e: unknown): e is StorageFailure {
	return e instanceof StorageFailure;
}

/** Per plan (6.1): at most this many plan files, bytes per file and bytes in all. */
export const PLAN_LIMITS = Object.freeze({
	files: 200,
	fileBytes: 2 * 1024 * 1024,
	totalBytes: 8 * 1024 * 1024,
});

/** Which limit a plan's file sizes (bytes) pass, in the order checked; null within them. */
export function planLimitProblem(sizes: Iterable<number>): 'files' | 'file' | 'total' | null {
	let files = 0;
	let total = 0;
	let large = false;
	for (const size of sizes) {
		files++;
		total += size;
		if (size > PLAN_LIMITS.fileBytes) large = true;
	}
	if (files > PLAN_LIMITS.files) return 'files';
	if (large) return 'file';
	return total > PLAN_LIMITS.totalBytes ? 'total' : null;
}

/** A `.tjp` or `.tji` file (7.4): the only files a provider reads or writes. */
export function isPlanFile(p: WorkspacePath): boolean {
	return isProjectFile(p) || hasIncludeSuffix(p);
}

const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** True for a string that can be a `WorkspaceId` (from a URL or a stored record). */
export function isWorkspaceId(v: unknown): v is WorkspaceId {
	return typeof v === 'string' && WORKSPACE_ID.test(v);
}
