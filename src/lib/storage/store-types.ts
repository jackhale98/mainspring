// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The browser's own store of plans (phase-4.md 6.2, 7.1, 8.1, 9.4, 10.1; ADR-0019). Types and
 * contracts only (T3). T4 implements them: `codec.ts` exports `decodePlanFile: DecodePlanFile`
 * and `encodePlanFile: EncodePlanFile`, `local-store.ts` a `LocalStore`, `lock.ts`
 * `acquire: AcquirePlanFn`. T8's `github/credentials.ts` implements `CredentialStore`.
 *
 * ## Contract
 *
 * - **Text in the store, bytes at providers.** The store keeps each file's text exactly as the
 *   workspace holds it (decoded per ADR-0002 #13: invalid sequences replaced, a BOM kept as
 *   U+FEFF, '\r' kept). Bytes become text only through `DecodePlanFile` and text becomes bytes
 *   only through `EncodePlanFile`.
 * - **Round trip.** `encode(decode(b).text)` equals `b` exactly when `decode(b).lossy` is false;
 *   `decode(encode(s)).text` equals `s` for every well-formed string (no lone surrogates).
 * - **Writing rules** (6.2, 18.11). A file whose text equals its base text is never written. A
 *   changed file that was `lossy` when read asks before it is written ("plan.tji will be saved
 *   with replacement characters where it had bytes that are not UTF-8"). Credentials live in
 *   their own object store, never in `localStorage` (10.1).
 * - **A plan's files only grow** (21, "New file"). A file added in a session (`Workspace.addFile`,
 *   T27a) is stored and saved like a changed one: `saveFiles` may name a path the store has never
 *   seen, which adds it to the plan, and a write or queued snapshot may hold paths the base does
 *   not have. A file outside the include graph ("Not included", after its `include` line was
 *   undone) is stored, saved and queued like any other. Nothing here deletes or renames a file;
 *   only `remove` drops a whole plan.
 * - **Atomic and ordered.** Each `LocalStore` method that writes is one IndexedDB transaction: all
 *   or nothing. Only the tab holding a plan's lock (`AcquirePlanFn`) writes that plan (8.1 #7).
 * - **Failures are shown** (8.1 #8). Methods reject with `StorageFailure` (types.ts): `quota` for
 *   `QuotaExceededError`, `unsupported` when IndexedDB is missing or blocked. The caller shows a
 *   `failed` status with Export; nothing is swallowed.
 * - **Structured clone.** Every stored value is plain data: objects, arrays, strings, numbers,
 *   `Map`, `Set` and `Uint8Array` only, so IndexedDB stores it as is.
 * - **Offline.** Everything here works offline; nothing here touches the network.
 *
 * Contract notes (T3):
 * - `StoredConflict` is not defined in 6.2. It holds the remote side as decoded text with its
 *   header data, and the choices made so far; the merge is computed again from it, the base and
 *   the workspace (8.3: "On Apply, the merge is computed again from the current text"), so no
 *   merge result is stored.
 * - `SyncBase.kept`, `PendingWrite.changed` and `PendingWrite.summary` are added for sync (sync/types.ts): a file the
 *   provider deleted is kept but never silently written back, and a queued write's summary is the
 *   "before" of the next message once it is written.
 * - `SyncBase` and `StoredConflict.theirs` share `DecodedFiles` (the spec lists the fields).
 * - `PendingWrite.files` is the full checked snapshot (every workspace file, included or not,
 *   added ones too), not only the changed ones: the queue's last snapshot is what a merge takes
 *   (7.3). `PendingWrite.changed` records the changed set when it is queued, because a pull can
 *   move the base before the write is sent, and the text it followed is then no longer stored.
 * - `saveFiles`'s `version` orders writes within one session of a plan in one store instance:
 *   from the `open` with `own` (or the `create`) that made it the owner, until another such open.
 *   The workspace version starts again at 0 whenever a plan opens (a reload, or the same tab opening
 *   it again after another tab had it), so it is not compared across sessions (T4 review H1).
 * - `cleared()` is added for the eviction notice (9.4); 6.2 had no member for the marker.
 * - The last plan to open on start (18.7) is a preference in `localStorage` (state/storage.ts),
 *   not a store field: `StoredPlan.updatedAt` changes on edits, not on opening.
 * - `AcquirePlanFn` adds `{ steal }` and `PlanLock.lost` for "Open here instead" (7.1): the other
 *   tab loses its lock and becomes read-only, which `acquire`'s spec signature cannot express.
 * - `CredentialStore` is added for 10.1 (one record per account); `accounts()` returns no
 *   tokens, so views never hold one.
 *
 * Contract notes (T4, accepted in its review; local-store.ts and lock.ts are the implementations):
 * - `open`'s `own` and the `not-owner` error kind (types.ts) are T4 review M1's: one owner per plan
 *   in the database too, by an owner epoch that `open` with `own` raises and every write checks.
 *   `saveFiles`'s order is per session of a plan (H1, the note above).
 * - lock.ts's `acquire` returns a `HeldLock`: a `PlanLock` with `onAsked(f)`, which the owner uses
 *   to store what autosave holds before it hands the plan to a tab that asked for it.
 * - A write to the records of a plan that is gone (removed meanwhile) rejects with `not-found` and
 *   writes nothing.
 * - `cleared()` also reports when only the database half of the marker is left; it puts the
 *   `localStorage` half back when that alone was lost; `remove` of the last plan clears the marker,
 *   so a plan the user deleted is never reported as cleared. The key is storage/marker.ts's.
 * - The database (version 1) also has the `credentials` (key `account`, T8) and `handles` (T5)
 *   object stores, so that those tasks need no upgrade.
 * - `navigator.storage.persist()` (9.4) is not asked here: T11 asks it, with `PwaState.persisted`.
 *
 * Contract notes (T5):
 * - `StoredPlan.from.opened` adds `lossy`: a browser-only plan made of opened or imported files has
 *   no base to carry `DecodedFiles.lossy`, and its store keeps text only, so Export and Save to…
 *   would write replacement characters unasked (18.11) without it. Set once, when the plan is made.
 * - A folder's `SyncBase` is the decoded `RemoteSnapshot` of its read or of Save to…'s write, with
 *   `kept` empty and `summary` null (no schedule of it yet).
 * - **Proposal for T8 and T15, not implemented:** `relocate(id, location, base)`, one transaction
 *   that sets a stored plan's `location` (and `name`) and its base, keeping the id, the files, the
 *   queue and so the preferences (`ws:<id>`). Save to… today stores the plan anew at the target (a
 *   new id, the preferences copied) and removes the browser copy (state/app-storage.ts, T5 notes);
 *   with `relocate` it would be one atomic step, and "Save to GitHub…" (T8) the same.
 */
import type { ScheduleSummary } from '../sync/types';
import type { Resolution } from '../tjp/merge/types';
import type { SampleId } from '../workspace/samples';
import type { Location, WorkspaceId, WorkspacePath } from './types';

/** bytes -> text (6.2, ADR-0002 #13): `lossy` when invalid UTF-8 sequences were replaced. */
export type DecodePlanFile = (bytes: Uint8Array) => { text: string; lossy: boolean };
/** text -> bytes (6.2): UTF-8; U+FEFF and '\r' are kept, so every valid file round-trips. */
export type EncodePlanFile = (text: string) => Uint8Array;

/** A plan the store keeps (6.2). */
export interface StoredPlan {
	readonly id: WorkspaceId;
	/** As the chooser lists it: "Tutorial (copy)", a new plan's name, a folder's or file's name. */
	readonly name: string;
	readonly entry: WorkspacePath;
	readonly location: Location;
	/** ms since the epoch of the last write to this plan's records. */
	readonly updatedAt: number;
	/**
	 * A copy of a sample made by its first edit (18.7), a new plan, or files opened or imported.
	 * `opened.lossy` (T5, contract notes): the opened files whose bytes were not UTF-8 (18.11).
	 */
	readonly from:
		| { readonly sample: SampleId }
		| { readonly newPlan: true }
		| { readonly opened: true; readonly lossy?: ReadonlySet<WorkspacePath> };
}

/** A location's plan files as decoded text, with the files that were not valid UTF-8. */
export interface DecodedFiles {
	/** The provider's revision these files are (types.ts `RemoteSnapshot.revision`). */
	readonly revision: string;
	readonly files: ReadonlyMap<WorkspacePath, string>;
	/** Files whose bytes were not valid UTF-8 when read (`DecodePlanFile` `lossy`). */
	readonly lossy: ReadonlySet<WorkspacePath>;
}

/**
 * The provider's text as last read or written (6.2): the base of every three-way merge and of the
 * writing rules. A browser-only plan has none. `files` also holds the `kept` files, with their
 * last base text, although `revision` lacks them.
 */
export interface SyncBase extends DecodedFiles {
	/**
	 * Files the provider deleted that this plan keeps (sync/types.ts, "Files deleted on the
	 * provider"): never written back while their text equals their text here. Usually empty.
	 */
	readonly kept: ReadonlySet<WorkspacePath>;
	/**
	 * The schedule of the base text, for the commit message's "before" (6.5); null when that text
	 * was never scheduled as it is (a remote head taken in by a merge), which gives a message
	 * without the finish line.
	 */
	readonly summary: ScheduleSummary | null;
}

/** One write waiting in the sync queue (6.2, 7.3). The queue is oldest first. */
export interface PendingWrite {
	/** Unique in the plan's queue; what `SyncController.discardQueued` names. */
	readonly id: string;
	readonly createdAt: number;
	/**
	 * The base's revision when it was queued. The oldest write follows that revision; each later
	 * one follows the write before it, whose revision is not known until that one is written, so
	 * the controller chains them at push time (sync/types.ts, "History"). When the base has moved
	 * past `base` (a pull merged the remote head into the workspace meanwhile), the queue is already
	 * in that merge and goes out under the merge commit.
	 */
	readonly base: string;
	/** Every plan file's text as checked (contract notes). */
	readonly files: ReadonlyMap<WorkspacePath, string>;
	/**
	 * The paths whose text differs from the text this write follows (the base's when queued, or
	 * the write before it), worked out when it is queued: exactly what its write holds, so an
	 * unchanged file (a `lossy` one above all, 18.11) is never written.
	 */
	readonly changed: ReadonlySet<WorkspacePath>;
	/** The commit message (github); null for a folder. */
	readonly message: string | null;
	/**
	 * The schedule of exactly this text (`SummarizeFn` of the check), or null: once this write is
	 * written it becomes the base's `summary`, the "before" of the next write's message (6.5).
	 */
	readonly summary: ScheduleSummary | null;
	/**
	 * The workspace version whose engine result was ok for exactly this text (6.5). It names a
	 * version of the session that queued it; after a reload it is a record only, and the text in
	 * `files` is what was checked.
	 */
	readonly checkedVersion: number;
}

/** A conflict waiting for the user (8.3), kept across reloads until it is resolved. */
export interface StoredConflict {
	/** The remote side: its revision and text, with the header data of `RemoteSnapshot`. */
	readonly theirs: DecodedFiles & { readonly author: string | null; readonly at: number | null };
	/** When the conflict was found, ms since the epoch. */
	readonly foundAt: number;
	/**
	 * The user's choices so far, by `MergeConflict.id` (stable while base and theirs are fixed,
	 * tjp/merge/types.ts), so "Later" and a reload keep them (8.3).
	 */
	readonly choices: readonly Resolution[];
}

/** What `LocalStore.open` returns: everything needed to restore a plan (7.1). */
export interface OpenedPlan {
	readonly plan: StoredPlan;
	/** The text of every file, as last saved. */
	readonly files: ReadonlyMap<WorkspacePath, string>;
	readonly base: SyncBase | null;
	readonly queue: readonly PendingWrite[];
	readonly conflict: StoredConflict | null;
}

/**
 * The plans in this browser (6.2), in one IndexedDB database of its own (no Dexie, ADR-0019 #5).
 * Every method rejects with `StorageFailure` on a storage failure (module comment).
 */
export interface LocalStore {
	/** Every stored plan, most recently updated first. */
	plans(): Promise<readonly StoredPlan[]>;
	/**
	 * The plan with everything needed to restore it, or null when there is none with this id.
	 * `own` (T4 review M1): the tab that holds the plan's lock opens it to write: this raises the
	 * plan's owner epoch in the same transaction, starts a new session of the plan in this instance
	 * (the order of `saveFiles`), and makes every later write of another instance that owned it
	 * fail with `not-owner`. Without `own` it only reads (a read-only tab, a chooser).
	 */
	open(id: WorkspaceId, o?: { readonly own?: boolean }): Promise<OpenedPlan | null>;
	/** Stores a new plan with every file's text; returns its new random id. Sets the marker (9.4). */
	create(
		p: Omit<StoredPlan, 'id' | 'updatedAt'>,
		files: ReadonlyMap<WorkspacePath, string>,
		base: SyncBase | null,
	): Promise<WorkspaceId>;
	/**
	 * Autosave (7.1): the whole text of each changed or added file, tagged with the workspace
	 * version it is. A path the plan does not have yet is added to it (21). Files not named keep
	 * their stored text; nothing is deleted or renamed. A call with a lower version than
	 * the last this store instance saved for the plan in this session is ignored (a slower write
	 * that lost a race). A session starts with the `open` with `own` or the `create` that made this
	 * instance the plan's owner: a reopened plan is a new session, whose workspace versions start
	 * again at 0 (T4 review H1). Rejects with `not-owner` when another instance owns the plan now
	 * (`open`), with nothing written; so do `setBase`, `enqueue`, `dequeue` and `setConflict`.
	 */
	saveFiles(
		id: WorkspaceId,
		files: ReadonlyMap<WorkspacePath, string>,
		version: number,
	): Promise<void>;
	setBase(id: WorkspaceId, b: SyncBase): Promise<void>;
	/** Appends to the plan's queue. Invariant 8.1 #1: called before the network write starts. */
	enqueue(id: WorkspaceId, w: PendingWrite): Promise<void>;
	/** Removes one queued write (written, or discarded after the user confirmed, 8.1 #6). */
	dequeue(id: WorkspaceId, writeId: string): Promise<void>;
	setConflict(id: WorkspaceId, c: StoredConflict | null): Promise<void>;
	/** Deletes the plan and all its records. The UI asks first and offers Export (8.1 #6). */
	remove(id: WorkspaceId): Promise<void>;
	/** `navigator.storage.estimate()` and `persisted()`; zeros and false where they are missing. */
	estimate(): Promise<{ usage: number; quota: number; persisted: boolean }>;
	/**
	 * True once when the marker (in `localStorage` and the database, 9.4) says plans were stored
	 * but the database has none: the browser cleared them. Reading it resets the marker.
	 */
	cleared(): Promise<boolean>;
}

/** The lock a tab holds on one plan (Web Locks, one owner per plan, 7.1, 8.1 #7). */
export interface PlanLock {
	/** Gives the plan up (another plan opens, or the tab closes). Idempotent. */
	release(): void;
	/**
	 * Resolves when another tab took the plan ("Open here instead"): from then on this tab must not
	 * write the plan, and shows it read-only with a note. Never resolves after `release`.
	 */
	readonly lost: Promise<void>;
}

/**
 * lock.ts (T4): `export const acquire: AcquirePlanFn`. 'held-elsewhere' when another tab holds the
 * plan, unless `steal` (the user chose "Open here instead"), which takes it from that tab. Where
 * the browser has no Web Locks, the lock is granted and never lost.
 */
export type AcquirePlanFn = (
	id: WorkspaceId,
	o?: { readonly steal?: boolean },
) => Promise<PlanLock | 'held-elsewhere'>;

/**
 * One GitHub sign-in (10.1), one record per account. Kept in the `credentials` object store, or
 * only in memory for a session-only sign-in (18.2). The token goes only to `api.github.com`
 * (net.ts) and never into `localStorage`, a URL, a log, an error report or a toast.
 */
export interface GitHubCredential {
	/** The key: the GitHub user id as a decimal string (a login can be renamed). */
	readonly account: string;
	/** The GitHub login as last seen (`GET /user`), for display. */
	readonly login: string;
	/** `app`: the GitHub App's device flow (8 h tokens, refreshed). `token`: a pasted token. */
	readonly kind: 'app' | 'token';
	readonly token: string;
	/** app only; null for a token. */
	readonly refreshToken: string | null;
	/** When the token expires, ms since the epoch; null when not known (a token without expiry). */
	readonly expiresAt: number | null;
	readonly refreshExpiresAt: number | null;
	/** The permissions GitHub reports (`{ contents: 'write', metadata: 'read' }`), when known. */
	readonly permissions: Readonly<Record<string, string>> | null;
}

/** A credential without its secrets: what Settings and the sign-in views see. */
export type AccountInfo = Pick<GitHubCredential, 'account' | 'login' | 'kind' | 'expiresAt'> & {
	/** `device`: kept in IndexedDB (the default); `session`: in memory until the tab closes. */
	readonly keep: 'device' | 'session';
};

/** github/credentials.ts (T8). Rejects with `StorageFailure` on a storage failure. */
export interface CredentialStore {
	get(account: string): Promise<GitHubCredential | null>;
	/** Replaces the record for `c.account`; `session` keeps it in memory only. */
	put(c: GitHubCredential, keep: 'device' | 'session'): Promise<void>;
	/** Sign out: deletes the record (memory and IndexedDB). */
	remove(account: string): Promise<void>;
	accounts(): Promise<readonly AccountInfo[]>;
}
