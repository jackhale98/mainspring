// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The sync controller, its status and the commit message (phase-4.md 6.3, 6.5, 8; ADR-0019).
 * Types and contracts only (T3); owner `grammar-specialist` (18.17). T7 implements them:
 * `controller.svelte.ts` a `SyncController` per stored plan, `commit-message.ts`
 * `summarize: SummarizeFn` and `commitMessage: CommitMessageFn`; `queue.ts` and `check.ts` are its
 * own. The merge it uses is tjp/merge/types.ts.
 *
 * ## Contract
 *
 * - **Never silent loss** (8.1). Local text is in the local store before any network write and
 *   before a merge result replaces it; remote or on-disk text replaces unsynced local text only
 *   through a three-way merge; a merge result is applied only when clean or fully resolved, as one
 *   labelled undo step ("Merged changes from GitHub", "Reloaded from disk"; ADR-0008 #1 amended);
 *   every write is conditional on its base; nothing on a provider is deleted; discarding asks
 *   first (the caller confirms before `discardQueued`) and offers Export; storage failures show.
 * - **The check is the runner's** (6.5). A commit writes exactly the snapshot of a version whose
 *   runner result is ok (`ScheduleChecker.checked`, run-types.ts); no other engine request is
 *   made, and nothing schedules outside the engine. A merge that does not schedule cannot be
 *   committed (no override); an ordinary commit with engine errors asks ("Commit anyway"); saving
 *   to the browser or a folder is never blocked (18.9).
 * - **Saving per location** (18.6). Browser storage autosaves always; a folder saves on `save()`
 *   (or automatically when the opt-in setting is on); GitHub commits on `save()`, queued offline.
 * - **History** (18.10). Queued commits stay separate commits, in order; a fast-forward when
 *   possible, else a merge commit with both parents (types.ts `WriteRequest.parents`). Never forced.
 * - **Added files** (21, "New file"). What a save or commit writes is every workspace file whose
 *   text differs from the base, including paths the base has never seen (a file added in the app,
 *   `Workspace.addFile`, T27a) and files outside the include graph ("Not included"). An added file
 *   is written like a changed one: stored at once, written by the folder's Save, added by a GitHub
 *   commit; `changes` counts it. Nothing deletes or renames a file, in the app or on a provider.
 * - **Never rejects.** Every method resolves with a `SyncOutcome`; failures are `failed`.
 * - **Offline.** Every method may be called offline. `save()` on GitHub queues; `sync()` answers
 *   `queued` (or `synced` when there is nothing to send) without touching the network.
 * - **One call at a time.** A call made while another runs waits for it (they do not interleave);
 *   `status` is `working` meanwhile.
 *
 * Contract notes (T3):
 * - `SyncOutcome` is not defined in 6.3; its variants follow the status and the flows of 8.
 * - `SaveOptions.anyway` confirms what the last `confirm` outcome named (engine errors, 18.9, and
 *   files with invalid bytes, 18.11) for the version it named; a newer version or a longer list
 *   asks again. 6.3's signature has one flag for both questions, so one sheet asks both.
 * - `SyncController` adds `location`, `queue`, `conflict`, `draft`, `reconnect` and `dispose`: the
 *   Sync panel lists the queue (`discardQueued` needs its ids), the conflict view needs the
 *   conflicts and their header (8.3), the Commit sheet shows the generated message and the check
 *   line before Commit (11.1), Reconnect needs a user gesture (7.2), and the controller listens
 *   to `online` and focus.
 * - `SyncStatus` holds one state at a time, the first that applies: `working`, `conflict`,
 *   `blocked`, `failed`, `needs-access`, `queued`, `changes`, then `saved` or `browser-only`.
 *   6.3 does not order them.
 * - Times in a `ScheduleSummary` are minutes since its own `start`: compare two summaries as
 *   instants (`start` plus minutes), as `finishDelta` does, since the project start may move.
 * - A plan that is not stored (a sample before its first edit, 18.7) has no controller
 *   (state/app-storage.ts `sync` is null).
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import type { TjpDiagnostic } from '../tjp/diagnostics-types';
import type { ResourceId, SymbolIndex, TaskId } from '../tjp/index';
import type { Resolution, WorkspaceMerge } from '../tjp/merge/types';
import type { PendingWrite } from '../storage/store-types';
import type {
	Access,
	Location,
	RemoteSnapshot,
	StorageError,
	WorkspacePath,
} from '../storage/types';

export type {
	ConflictSubject,
	Files,
	MergeConflict,
	Owner,
	Resolution,
	Take,
	WorkspaceMerge,
} from '../tjp/merge/types';

/** What the status control shows (6.3, 11.1); one state at a time (contract notes). */
export type SyncStatus =
	/** Stored here, no provider. `savedAt`: the last autosave, null before the first. */
	| { readonly kind: 'browser-only'; readonly savedAt: number | null }
	/** The provider has this text: nothing to save or commit, nothing queued. */
	| { readonly kind: 'saved'; readonly at: number; readonly revision: string }
	/** `files` files differ from the base: not yet saved (folder) or committed (GitHub). */
	| { readonly kind: 'changes'; readonly files: number }
	| { readonly kind: 'working'; readonly what: 'saving' | 'committing' | 'pulling' | 'checking' }
	/** Writes in the queue; `retryAt` (ms since the epoch) when a retry is scheduled (7.3 backoff). */
	| {
			readonly kind: 'queued';
			readonly writes: number;
			readonly why: 'offline' | 'needs-access' | 'retrying';
			readonly retryAt: number | null;
	  }
	| { readonly kind: 'conflict'; readonly conflicts: number }
	/** The text to commit does not schedule (18.9): `errors` engine errors. */
	| { readonly kind: 'blocked'; readonly errors: number }
	/** The location needs access before anything can be read or written (Reconnect, sign in). */
	| { readonly kind: 'needs-access'; readonly access: Access }
	/** The last local save (autosave) or provider call failed; the UI offers Export. */
	| { readonly kind: 'failed'; readonly error: StorageError };

/** What one controller call came to (contract notes). */
export type SyncOutcome =
	/**
	 * The provider and the base agree on `revision` now. `pulled`: remote text was applied (one
	 * undo step); `pushed`: how many writes or commits were made. Local changes may remain.
	 */
	| {
			readonly kind: 'synced';
			readonly revision: string;
			readonly pulled: boolean;
			readonly pushed: number;
	  }
	/** A browser-only plan has nowhere to save: the UI says where it is and offers Save to… */
	| { readonly kind: 'browser-only' }
	/** Kept in the queue (offline, needs access, or a retry is scheduled). */
	| {
			readonly kind: 'queued';
			readonly writes: number;
			readonly why: 'offline' | 'needs-access' | 'retrying';
	  }
	/**
	 * `resolve` applied a fully resolved merge (one undo step) and it schedules. `commit`: a merge
	 * commit waits for `save()` (the queue had commits, 18.10); otherwise the base moved to the
	 * remote head and the local changes stay as changes (8.2).
	 */
	| { readonly kind: 'merged'; readonly commit: boolean }
	/** The merge has conflicts: the conflict state is set and stored (8.3). */
	| { readonly kind: 'conflict'; readonly conflicts: number }
	/** The text to commit does not schedule: a merge cannot be committed (18.9, no override). */
	| { readonly kind: 'blocked'; readonly errors: readonly TjpDiagnostic[] }
	/**
	 * Asks first, then `save({ anyway: true })`: engine errors on an ordinary commit (18.9) and
	 * changed files that had invalid bytes (18.11), both for workspace `version`.
	 */
	| {
			readonly kind: 'confirm';
			readonly version: number;
			readonly errors: readonly TjpDiagnostic[];
			readonly lossy: readonly WorkspacePath[];
	  }
	/** Save to…: a file of that name exists at the target; nothing was written (7.3, never overwrites). */
	| { readonly kind: 'exists'; readonly files: readonly WorkspacePath[] }
	| { readonly kind: 'needs-access'; readonly access: Access }
	/** The plan was closed, or the controller disposed, before the call finished. */
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'failed'; readonly error: StorageError };

export interface SaveOptions {
	/** The commit message (GitHub), as the user edited it; default the generated one. */
	readonly message?: string;
	/** The user answered the last `confirm` outcome with "Commit anyway" (contract notes). */
	readonly anyway?: boolean;
}

/** What the Commit sheet shows before Commit (11.1). */
export interface CommitDraft {
	/** The workspace version it describes; its runner result is in `ok` and `errors`. */
	readonly version: number;
	/** The files that differ from the base (or the last queued write), added files included (21). */
	readonly files: readonly WorkspacePath[];
	/** The generated message (`CommitMessageFn`), which the user may edit. */
	readonly message: { readonly subject: string; readonly body: string };
	readonly ok: boolean;
	readonly errors: readonly TjpDiagnostic[];
	/** A merge commit with both parents (18.10), which cannot be committed unless `ok`. */
	readonly merge: boolean;
}

/** A conflict waiting for the user, as the conflict view shows it (8.3). */
export interface ConflictState {
	/** The remote side's revision and header data ("commit 3f2a91b by its author, 10 min ago"). */
	readonly theirs: Pick<RemoteSnapshot, 'revision' | 'author' | 'at'>;
	/** The merge as last computed; `resolve` computes it again from the current text. */
	readonly merge: WorkspaceMerge;
}

/** One per stored plan (6.3). Reactive members are Svelte runes state. */
export interface SyncController {
	readonly location: Location;
	readonly status: SyncStatus;
	/** The plan's queue, oldest first (the Sync panel lists it). */
	readonly queue: readonly PendingWrite[];
	/** Set while a conflict waits (also after a reload: it is stored); null otherwise. */
	readonly conflict: ConflictState | null;
	/**
	 * Folder: write. GitHub: commit (queued when offline). Browser-only: no-op, says so
	 * (`browser-only`). Waits for the runner's check of the current version (6.5).
	 */
	save(o?: SaveOptions): Promise<SyncOutcome>;
	/**
	 * Pull, merge, then push the queue (8.2). Runs on open, on focus (at most once a minute), on
	 * `online`, and on a tap. Folder: on focus and `visibilitychange`, never by polling (7.2).
	 */
	sync(): Promise<SyncOutcome>;
	/**
	 * Applies the resolutions: the merge is computed again from the current text, choices are kept
	 * where their conflict id still exists, and a fully resolved result is applied as one undo step
	 * and checked (8.3 "Apply and check"). `conflict` again while some remain.
	 */
	resolve(r: readonly Resolution[]): Promise<SyncOutcome>;
	/** Drops one queued write; the caller has asked first (8.1 #6). The text stays in the workspace. */
	discardQueued(writeId: string): Promise<void>;
	/** The Commit sheet's content for the current version, once checked; null when aborted. */
	draft(signal?: AbortSignal): Promise<CommitDraft | null>;
	/** "Reconnect" or sign-in refresh; must run inside a user gesture (types.ts `requestAccess`). */
	reconnect(): Promise<SyncOutcome>;
	/** Stops listening (online, focus, visibility) and cancels open calls (`cancelled`). */
	dispose(): void;
}

/** One task in a summary: its first active scenario's dates (minutes since `start`). */
export interface TaskSummary {
	readonly name: string;
	readonly parent: TaskId | null;
	readonly start: Minutes | null;
	readonly end: Minutes | null;
}

/** What the commit message compares (6.5): one schedule, reduced. Stored in `SyncBase`. */
export interface ScheduleSummary {
	/** The finish (`finishMinutes`, schedule/finish.ts), minutes since `start`; null when none. */
	readonly finish: Minutes | null;
	/** `ProjectInfo.start`, ISO 8601 UTC. */
	readonly start: string;
	/** `ProjectInfo.timezone` as written; null means UTC for display. */
	readonly zone: string | null;
	readonly tasks: ReadonlyMap<TaskId, TaskSummary>;
	/** Booked minutes per resource, first active scenario. */
	readonly booked: ReadonlyMap<ResourceId, number>;
}

/** commit-message.ts (T7): `export const summarize: SummarizeFn`. Pure. */
export type SummarizeFn = (r: ScheduleResult, index: SymbolIndex) => ScheduleSummary;

/**
 * commit-message.ts (T7): `export const commitMessage: CommitMessageFn`. Pure. Tasks added,
 * removed and moved (start or end changed), the finish before and after, and the people whose
 * booked time changed; dates with `Intl` in the plan's zone; copy in strings-sync.ts. Example:
 * `Plan: 2 tasks added, 1 moved; finish 12 Mar -> 19 Mar 2027`. Without `before`, no finish line.
 */
export type CommitMessageFn = (
	before: ScheduleSummary | null,
	after: ScheduleSummary,
	files: readonly WorkspacePath[],
) => { readonly subject: string; readonly body: string };
