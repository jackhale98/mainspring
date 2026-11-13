// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The inspector's way into the edit dispatcher (`app.edits`, state/edits.svelte.ts has the
 * contract). Every field calls `edit` or `action` and gets the outcome back; the dispatcher has
 * already put up the toast for a refusal or a no-op, so the field only has to show the text as it
 * stands (its draft goes back to the plan's value when the outcome is not `applied`).
 *
 * - `confirm-shared` (the change edits text that several tasks read) asks, then dispatches again
 *   with `confirmShared`. The asking is `confirm`, so a test can answer it.
 * - `coalesceKey` names a stepper or typing gesture: every call sends the cumulative total, and
 *   `flush(key)` ends the gesture on blur or Enter (one undo step for the burst).
 * - The source of a Gantt action is the pair the Gantt shows (`GanttView`), as a gesture would send.
 */
import { inspectorStrings as S } from '../strings';
import type { GanttAction } from '../gantt/intents';
import type { ActionSource, DispatchOutcome, EditDispatcher } from '../state/edits.svelte';
import type { GanttView } from '../state/inspector.svelte';
import type { Edit } from './edit';

export interface ActionsEnv {
	edits(): EditDispatcher | null;
	view(): GanttView | null;
	/** Defaults to `window.confirm`. */
	confirm?: (message: string) => boolean;
}

const NOTHING: DispatchOutcome = { status: 'cancelled' };

export class InspectorActions {
	readonly #env: ActionsEnv;

	constructor(env: ActionsEnv) {
		this.#env = env;
	}

	#ask(message: string): boolean {
		return (this.#env.confirm ?? ((m) => globalThis.confirm(m)))(message);
	}

	/** Dispatches an inspector edit; `key` names a gesture whose calls are coalesced. */
	async edit(e: Edit, key?: string): Promise<DispatchOutcome> {
		const edits = this.#env.edits();
		if (!edits) return NOTHING;
		const o = {
			label: e.label,
			...(key === undefined ? {} : { coalesceKey: key }),
			...(e.constraint ? { constraint: true } : {}),
		};
		const first = await edits.dispatch(e.intent, o);
		if (first.status !== 'confirm-shared') return first;
		if (!this.#ask(S.confirmShared(first.affects.join(', ')))) return NOTHING;
		return edits.dispatch(e.intent, { ...o, confirmShared: true });
	}

	/** Dispatches a Gantt action (rename, assign, size steps, unlink), as a gesture would. */
	async action(a: GanttAction, key?: string): Promise<DispatchOutcome> {
		const edits = this.#env.edits();
		if (!edits) return NOTHING;
		const v = this.#env.view();
		const source: ActionSource = { result: v?.result ?? null, analysis: v?.analysis ?? null };
		const o = key === undefined ? {} : { coalesceKey: key };
		const first = await edits.dispatchAction(a, source, o);
		if (first.status !== 'confirm-shared') return first;
		if (!this.#ask(S.confirmShared(first.affects.join(', ')))) return NOTHING;
		return edits.dispatchAction(a, source, { ...o, confirmShared: true });
	}

	/** Ends a coalesced gesture: dispatches the held call now (blur, Enter, a pause). */
	flush(key: string): void {
		this.#env.edits()?.flush(key);
	}
}
