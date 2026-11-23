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
 *   labelled undo step (below); every write is conditional on its base; nothing on a provider is
 *   deleted; discarding asks first (the caller confirms before `discardQueued`) and offers Export;
 *   storage failures show.
 * - **The check is the runner's** (6.5). A commit writes exactly the snapshot of a version whose
 *   runner result is ok (`ScheduleChecker.checked`, run-types.ts); no other engine request is
 *   made, and nothing schedules outside the engine. A merge that does not schedule cannot be
 *   committed (no override); an ordinary commit with engine errors asks ("Commit anyway"). Saving
 *   to the browser or a folder is never blocked (18.9): a folder's Save writes the text as it is
 *   at once, without waiting for a check, and only invalid bytes ask (18.11).
 * - **Saving per location** (18.6). Browser storage autosaves always; a folder saves on `save()`
 *   (or automatically when the opt-in setting is on); GitHub commits on `save()`, queued offline.
 * - **What a write holds.** Every file whose text differs from the base's text for it (`SyncBase`,
 *   kept files included; for a queued write, the text it follows: `PendingWrite.changed`), and
 *   nothing else: a file added in the app (`Workspace.addFile`, 21) or
 *   outside the include graph ("Not included") is written like a changed one, and a file whose
 *   text equals its base text never is. `changes` counts the same set. Nothing deletes or renames
 *   a file, in the app or on a provider.
 * - **Files deleted on the provider** (8.1 #5, 21). Such a file is **kept**: the merge keeps it
 *   (tjp/merge/types.ts, the table), the workspace keeps it, and the new base keeps its last base
 *   text and lists it in `SyncBase.kept` (the paths of the old base that the merged result keeps
 *   and the remote head lacks). It is never written back while its text equals that base text.
 *   The user changing it (typing, or Keep mine on its `deleted-theirs` conflict) makes it a changed file:
 *   the next write adds it again, and the Commit sheet says so (`CommitDraft.readded`). A provider
 *   that has the path again later ends the keeping (it is then an ordinary file of the base).
 * - **Applying remote text** (8.2, 18.8, ADR-0008 #1 amended): a pull with no local changes, a
 *   clean merge, or a resolved one.
 *   1. The workspace's text is in the store first: autosave for the current version has resolved.
 *   2. Paths the workspace lacks are added with `Workspace.addFile(path, text)` (T27a) with their
 *      full merged text, not as part of the undo step (21: adding a file is not an undo step). An
 *      undo therefore never empties or removes them; their text stays equal to the base text, so
 *      it is never written back, and an undone `include` shows them "Not included".
 *   3. Every other file the merge changes goes in **one** `Workspace.apply` of a `WorkspaceEdit`
 *      (per file, the change set from its text now to the merged text), origin 'intent', with the
 *      `historyLabel` annotation (history-steps.ts) "Merged changes from GitHub" or "Reloaded from
 *      disk" (strings-sync.ts): one undo step; both stacks are kept. A merge equal to the
 *      workspace applies nothing (no empty step).
 *   4. The edit's `base` is the file versions the merge was computed from. 'stale' (the user typed
 *      meanwhile) computes the merge again on the text now; nothing is applied to text the merge
 *      did not see.
 *   5. The merged text is stored (`saveFiles`), and only once that resolves the new base
 *      (`setBase`): a crash between them leaves the old base, and the next merge is clean.
 *   Undoing that step is an ordinary local change: the base stays at the remote head, and the
 *   text it brings back counts as changes.
 * - **History** (18.10). Queued commits stay separate commits, in order; a fast-forward when
 *   possible. When the remote moved, each queued commit is made on the one before it (the first on
 *   the base; `WriteResult.moved.commit` names each), then a merge commit with the last of them
 *   and the remote head as parents (types.ts `WriteRequest.parents`). Never forced. The merge
 *   commit writes a checked **workspace** version, the only text the runner checks (6.5): the
 *   merge of the workspace with the remote head. It is made by `sync()` without asking only when
 *   the workspace held nothing beyond the queue's last snapshot; otherwise the user's later
 *   changes would be committed unasked (18.6), so it waits for `save()` (`merged.commit`).
 * - **A waiting conflict** (8.3). The base and theirs stay fixed while it waits
 *   (`StoredConflict`). `save()` answers `conflict` and writes nothing. `sync()` writes nothing
 *   either; when the remote head moved again, theirs becomes the new head and the merge is
 *   computed again (choices on regions theirs changed are dropped by their ids). `resolve` keeps
 *   its choices across calls and reloads (`StoredConflict.choices`).
 * - **Never rejects.** Every method resolves with a `SyncOutcome`; failures are `failed`.
 * - **Offline.** Every method may be called offline. `save()` on GitHub queues; `sync()` answers
 *   `queued` (or `synced` when there is nothing to send) without touching the network.
 * - **One call at a time.** A call made while another runs waits for it (they do not interleave);
 *   `status` is `working` meanwhile.
 * - **One tab writes** (8.1 #7). When the plan's lock is lost (store-types.ts `PlanLock.lost`),
 *   the app disposes the controller; every call after `dispose` answers `cancelled`.
 *
 * Contract notes (T3):
 * - `SyncOutcome` is not defined in 6.3; its variants follow the status and the flows of 8.
 * - `SaveOptions.anyway` confirms what the last `confirm` outcome named (engine errors, 18.9, and
 *   files with invalid bytes, 18.11) for the version it named; a newer version or a longer list
 *   asks again. 6.3's signature has one flag for both questions, so one sheet asks both. A
 *   folder's `confirm` never names engine errors (18.9: never blocked).
 * - `SyncController` adds `location`, `queue`, `conflict`, `draft`, `reconnect` and `dispose`: the
 *   Sync panel lists the queue (`discardQueued` needs its ids), the conflict view needs the
 *   conflicts, their header and theirs' text for "Download both versions" (8.3), the Commit sheet
 *   shows the generated message and the check line before Commit (11.1), Reconnect needs a user
 *   gesture (7.2), and the controller listens to `online` and focus.
 * - `SyncStatus` holds one state at a time, the first that applies: `failed` at `store` (the text
 *   is not stored, 8.1 #1 and #8, so it outranks everything), `working`, `conflict`, `blocked`,
 *   `failed` at `provider`, `queued` (with `why`, `needs-access` included), `needs-access`
 *   (nothing queued), `changes`, then `saved` or `browser-only`. 6.3 does not order them;
 *   `failed.where` is added so a store failure is never hidden behind another state.
 * - 7.3's "the queue's last snapshot is merged with the remote head, checked, and committed" and
 *   6.5's "a commit writes exactly the snapshot of a version whose result is ok" meet in "History"
 *   above: the merged text is checked as a workspace version, never through a request of its own.
 * - Times in a `ScheduleSummary` are minutes since its own `start`: compare two summaries as
 *   instants (`start` plus minutes), as `finishDelta` does, since the project start may move.
 * - A plan that is not stored (a sample before its first edit, 18.7) has no controller
 *   (state/app-storage.ts `sync` is null).
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import type { TjpDiagnostic } from '../tjp/diagnostics-types';
import type { ResourceId, SymbolIndex, TaskId } from '../tjp/index';
import type { Resolution, WorkspaceMerge } from '../tjp/merge/types';
import type { PendingWrite, StoredConflict } from '../storage/store-types';
import type { Access, Location, StorageError, WorkspacePath } from '../storage/types';

export type {
	ConflictSubject,
	Files,
	MergeConflict,
	MergeContext,
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
	/**
	 * Something failed; the UI offers Export. `store`: the local store (autosave, quota): the text
	 * is only in memory. `provider`: a read or write that is not retried (contract notes, order).
	 */
	| {
			readonly kind: 'failed';
			readonly where: 'store' | 'provider';
			readonly error: StorageError;
	  };

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
	 * A merge was applied (one undo step) and its text schedules, and the base moved to the remote
	 * head (8.2): from `resolve` (8.3 "Apply and check"), or from `sync()` when the merge commit
	 * must wait for the user (contract, "History"). `commit`: the text differs from the remote
	 * head, so the next `save()` writes it ("Commit merge"; GitHub: the merge commit when the queue
	 * had commits, 18.10; blocking, 18.9). False: the text equals the remote head; nothing to send.
	 */
	| { readonly kind: 'merged'; readonly commit: boolean }
	/** The merge has conflicts: the conflict state is set and stored (8.3). Also `save()` meanwhile. */
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
	/**
	 * Of `files`, those the provider deleted and this write adds again (`SyncBase.kept`, contract
	 * "Files deleted on the provider"): the sheet names them, so nothing returns unannounced.
	 */
	readonly readded: readonly WorkspacePath[];
	/** The generated message (`CommitMessageFn`), which the user may edit. */
	readonly message: { readonly subject: string; readonly body: string };
	readonly ok: boolean;
	readonly errors: readonly TjpDiagnostic[];
	/**
	 * The text holds a merge not yet written: it cannot be committed unless `ok` (18.9, no
	 * "Commit anyway"); on GitHub it is the merge commit with both parents when the queue had
	 * commits (18.10).
	 */
	readonly merge: boolean;
}

/** A conflict waiting for the user, as the conflict view shows it (8.3). */
export interface ConflictState {
	/**
	 * The remote side as stored: its text (for "Download both versions") and the header data
	 * ("commit 3f2a91b by its author, 10 min ago").
	 */
	readonly theirs: StoredConflict['theirs'];
	/** The merge as last computed; `resolve` computes it again from the current text. */
	readonly merge: WorkspaceMerge;
	/** The choices made so far whose conflict is still in `merge` (`StoredConflict.choices`). */
	readonly choices: readonly Resolution[];
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
	 * Folder: writes the text as it is now, never waiting for a check (18.9). GitHub: waits for the
	 * runner's check of the current version (6.5), then commits that version's snapshot (queued
	 * when offline). Browser-only: no-op, says so (`browser-only`). `conflict` while one waits.
	 */
	save(o?: SaveOptions): Promise<SyncOutcome>;
	/**
	 * Pull, merge, then push the queue (8.2). Runs on open, on focus (at most once a minute), on
	 * `online`, and on a tap. Folder: on focus and `visibilitychange`, never by polling (7.2).
	 */
	sync(): Promise<SyncOutcome>;
	/**
	 * Adds `r` to the choices made so far (for one id, the last wins) and stores them; computes the
	 * merge again from the current text, keeping the choices whose conflict id still exists; when
	 * every conflict has a choice, applies the result as one undo step (contract, "Applying remote
	 * text") and waits for its check (8.3 "Apply and check"): `merged`, or `blocked`. `conflict`
	 * again while some remain, with nothing applied (8.1 #3).
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

/**
 * commit-message.ts (T7): `export const summarize: SummarizeFn`. Pure. `r` is a checked run's
 * result (`ScheduleCheck.record.result`) and `index` the index of **that** snapshot:
 * `index.isFor(check.snapshot)`, e.g. `buildIndex(check.snapshot, check.record.hints)` when the
 * runner's `ensureIndex()` is of a newer version. Never the published `RunnerState.index`, which
 * lags (ADR-0018). Today every summary field can come from `r` (ids, names, parents, dates,
 * bookings, the finish, the zone); whatever is read from `index` must describe the same version,
 * so a summary never mixes two versions.
 */
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
