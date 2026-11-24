// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What `AppState` (app.svelte.ts) adds in Phase 4 to open, keep and save plans (phase-4.md 6.7,
 * 7.1, 7.2, 18.7; ADR-0019, ADR-0008 #3 amended). Types and contracts only (T3): T4 makes
 * `AppState implements AppStorageState` (T5, T8 and T15 fill in their parts first, behind it).
 *
 * ## Contract
 *
 * - **Stored plans.** Every opened plan is stored (7.1), except a sample, which opens unstored and
 *   stores a copy ("Tutorial (copy)") on its first edit; the sample never changes (18.7). A new
 *   plan is stored at once. On start, the last plan opens (its id is a preference, `localStorage`).
 * - **One owner** (7.1, 8.1 #7). Opening a stored plan takes its lock (store-types.ts
 *   `AcquirePlanFn`). When another tab holds it, the open returns false and sets `heldElsewhere`;
 *   "Open here instead" calls `openStored(id, { steal: true })`, and the other tab's `readOnly`
 *   becomes true.
 * - **Files only grow** (21, "New file"). A file added in the app (`Workspace.addFile`, T27a) is
 *   stored at once and saved like a changed one; `openStored` restores every stored file, those
 *   outside the include graph ("Not included") too. Nothing deletes or renames a file.
 * - **`dirty`** now means "has changes the provider does not have". Switching plans no longer asks,
 *   because nothing is lost: the plan stays stored.
 * - **Preferences** move from per-sample keys to per-plan keys: the plan part of a key is
 *   `planKey(id)` (`ws:<id>`) instead of the sample id; a sample's old keys are read once as
 *   defaults (ADR-0008 #3 amended). The move preference stays once per browser.
 * - **The opens return whether a plan opened**, as `openSample` does: false when the user
 *   cancelled a picker, no plan file was given, the plan is held elsewhere, or reading failed (the
 *   status says which). A folder or repository folder with several `.tjp` files asks which plan,
 *   and remembers the choice for that location (18.22; the chooser, T15).
 * - **Offline.** `openStored`, `openFiles` and `saveTo` a browser location work offline;
 *   `openFolder` too. `openGitHub` needs the network for a location never opened here.
 *
 * Contract notes (T3):
 * - This is a module of its own rather than more lines in app.svelte.ts: the class cannot declare
 *   members it does not implement yet, and the interface lets T4 add `implements` once they are.
 * - `openStored` takes `{ steal }`, and `heldElsewhere` and `readOnly` are added: 7.1's "Open
 *   here instead" and the read-only tab have no member in 6.7.
 * - `sync` is null while the open plan is not stored (a sample before its first edit).
 *
 * Contract notes (T4, accepted in its review; app.svelte.ts and keeping.svelte.ts implement them):
 * - `openStored` of a plan another tab holds opens it read-only: it returns false and sets
 *   `heldElsewhere`, as above, and `readOnly` is true too (the tab cannot edit it either).
 * - `sync` is null for every plan until T7's controller; `openFolder`, `openFiles` and `openGitHub`
 *   resolve false and `saveTo` resolves `failed` (`unsupported`) until T5, T8 and T15; `pwa` is
 *   `INITIAL_PWA_STATE` until T11.
 * - `dirty` means "changes only in this tab" (the store refused them or cannot be used) until T7
 *   widens it to what the provider does not have; switching plans or reloading asks only then, and
 *   `flush()` stores what autosave holds before any reload the app starts itself.
 * - Changes the store refused because another tab took the plan first (`not-owner`; T4 re-check
 *   N1): the tab is `readOnly` and `dirty`, the text stays on screen, `keeping.keep` is `failed`
 *   with `not-owner` (the notice offers to copy the text), and "Open here instead" asks first.
 * - AppState's own members: `planKey` (the plan part of preference keys), `openSerial` (grows when a
 *   plan opens, not when only the key changes), `fresh`, `storedId`, `keeping` (what the line says,
 *   the plans kept here, the cleared and could-not-open notices), `keepLine`, `flush`, `reloadPage`.
 *   `sampleId`, `newPlanName` and `newPlanSerial` are gone.
 * - The last-plan pointer (`mainspring.last-plan`) holds a plan key: `ws:<id>`, or a sample's id
 *   when a sample was opened last. A plan that could not be opened leaves it as it was.
 * - After a plan is reopened its history is empty, and an empty undo or redo says so (the history
 *   outcome has no direction); a read-only tab says nothing.
 * - The cleared notice does not point to GitHub or Export yet (T5, T14); the landing copy is T25's.
 *
 * Contract notes (T5; state/plan-files.ts implements them):
 * - `openFolder` and `openFiles` take `{ choose }`, which asks which plan when there are several
 *   (18.22); without it `AppState.planQuestion` holds the question until it is answered. A folder
 *   kept here already (the same location) opens as it was kept, which is how the choice is
 *   remembered. Their failures are said in the edit toasts' line (`say`), with no status member.
 * - `saveTo` a folder (T5 review): only into a folder without plan files, in any case (`exists`,
 *   naming them, nothing written). The plan's own files with its bytes, or empty, left there by a
 *   Save to… that did not finish, are taken, so doing it again finishes it. `needs-access` without
 *   permission; `cancelled` when the person refused to write files that had bytes that are not
 *   UTF-8 (18.11; a `confirm`, as Export asks), or when the plan's paths differ only by case (said
 *   in the toasts' line); `synced` with the revision written. A `failed` may come after some files
 *   were written (plan-files.ts `saveToSentence` says so). The store has no way to move a plan
 *   (`LocalStore`; store-types.ts proposes `relocate`), so the plan is stored anew at the folder (a
 *   new id, the views' preferences copied) and the browser copy is removed; the workspace and its
 *   history stay open. GitHub stays `failed` (`unsupported`) until T8.
 * - AppState's own members: `pickFolder` (the picker for T15's Save to… flow), `exportPlan`,
 *   `planLocation` and `planQuestion`. There are no controls for them until T15; end-to-end tests
 *   reach them through `?hooks=files` (files-hook.ts).
 */
import type { ChoosePlan } from './plan-files';
import type { PwaState } from '../../pwa/messages';
import type { GitHubLocation, Location, WorkspaceId } from '../storage/types';
import type { SyncController, SyncOutcome } from '../sync/types';

export interface AppStorageState {
	/** Opens a stored plan with its text, base, queue and conflict (7.1); the undo history is empty. */
	openStored(id: WorkspaceId, o?: { readonly steal?: boolean }): Promise<boolean>;
	/**
	 * Chromium only (`showDirectoryPicker`); needs a user gesture. `choose` asks which plan when the
	 * folder holds several (18.22; contract notes T5).
	 */
	openFolder(o?: { readonly choose?: ChoosePlan }): Promise<boolean>;
	/**
	 * Every browser: files from `<input type=file multiple>` or a folder import (`webkitdirectory`,
	 * paths from `webkitRelativePath` without the top folder). Makes a browser-only plan of the
	 * plan files among them.
	 */
	openFiles(files: readonly File[], o?: { readonly choose?: ChoosePlan }): Promise<boolean>;
	openGitHub(loc: GitHubLocation): Promise<boolean>;
	/**
	 * A browser-only plan, a sample's copy or a new plan to a folder or a GitHub folder: writes
	 * every file once (section 2, "Save to…"), never overwriting (`exists`), then the plan lives
	 * there.
	 */
	saveTo(target: Location): Promise<SyncOutcome>;
	readonly sync: SyncController | null;
	readonly pwa: PwaState;
	/** The stored plan the last open found held by another tab, until another open. */
	readonly heldElsewhere: WorkspaceId | null;
	/** True once another tab took this tab's plan: views do not edit, and a note says why. */
	readonly readOnly: boolean;
}

/** The plan part of a preference key for a stored plan (`mainspring.mode.ws:<id>`). */
export function planKey(id: WorkspaceId): string {
	return `ws:${id}`;
}
