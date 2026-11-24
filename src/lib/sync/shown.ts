// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the sync status control shows, and where it comes from (phase-4.md 6.3, 11.1; T14).
 *
 * The control (components/sync/SyncStatus.svelte) shows a `Shown`: a `SyncStatus` (types.ts) plus the
 * two states that status has no kind for, because they are not a sync state at all:
 * - `sample`: a sample opened unstored; its first change keeps a copy in this browser (18.7). It has no
 *   controller (app-storage.ts `sync` is null), so there is no `SyncStatus` for it.
 * - `read-only`: another tab holds the plan (7.1), so this tab neither writes nor syncs it.
 *
 * `statusOf(app)` is the adapter and the only place that knows where the status comes from. Until T7
 * the controller is null and T4's keeping state decides (`keeping.keep`); once T7 gives a plan its
 * controller (`app.sync`), its `status` is shown, with nothing else changing here or in the component.
 * The order is phase-4.md 22's, layered:
 *
 *   1. changes this tab could not keep (T4's `failed`, or a controller's `failed` at `store`):
 *      the text is only in memory, so nothing outranks it;
 *   2. read-only: the controller is disposed and nothing is written, so there is nothing below it;
 *   3. the controller's own status, in its order: working, conflict, blocked, provider failure,
 *      queued (also when it waits for access), needs-access, changes, saved or browser-only;
 *   4. no controller: the plan is a sample, or stored in this browser.
 *
 * `strongest` (status-order.ts) is that order for T7 to derive the controller's status from.
 */
import type { StoredPlan } from '../storage/store-types';
import type { Location, WorkspaceId } from '../storage/types';
import type { KeepState } from '../state/keeping.svelte';
import type { SyncController, SyncStatus } from './types';

export type Shown = SyncStatus | { readonly kind: 'sample' } | { readonly kind: 'read-only' };

/** What `statusOf` reads of the app (`AppState` has it). */
export interface StatusSource {
	readonly keeping: {
		readonly keep: KeepState;
		readonly plans: readonly Pick<StoredPlan, 'id' | 'updatedAt'>[];
	};
	readonly readOnly: boolean;
	readonly storedId: WorkspaceId | null;
	/** T7's controller; null until then, and for a plan that is not stored. */
	readonly sync: Pick<SyncController, 'status' | 'location'> | null;
}

const BROWSER: Location = { kind: 'browser' };

export function statusOf(app: StatusSource): Shown {
	const keep = app.keeping.keep;
	if (keep.kind === 'failed') return { kind: 'failed', where: 'store', error: keep.error };
	const c = app.sync?.status;
	if (c?.kind === 'failed' && c.where === 'store') return c;
	if (app.readOnly) return { kind: 'read-only' };
	if (c) return c;
	if (keep.kind === 'sample') return { kind: 'sample' };
	// The plan was restored: its last save is when the store last wrote it, until this tab saves.
	const at = keep.at ?? app.keeping.plans.find((p) => p.id === app.storedId)?.updatedAt ?? null;
	return { kind: 'browser-only', savedAt: at };
}

/** Where the open plan lives: the controller's location, else this browser's store. */
export function locationOf(app: Pick<StatusSource, 'sync'>): Location {
	return app.sync?.location ?? BROWSER;
}
