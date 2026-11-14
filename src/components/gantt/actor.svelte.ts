// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's way into the edit dispatcher (`app.edits`; state/edits.svelte.ts has the contract).
 * Every gesture and key ends in `run`: a GanttAction with the shown result as its source, an
 * optional preview mark (the bar stays drawn as pending until the engine answers), and the two
 * questions the dispatcher can ask back:
 * - `ask-move-preference` (ADR-0008 #2): the move question, answered by a dialog the Gantt shows
 *   (`ask`); the answer is stored through the dispatcher and the same action is sent again. One
 *   question at a time: calls made while it is open wait for the same answer.
 * - `confirm-shared`: text read in several places is edited; `confirm` asks, then it is sent again
 *   with `confirmShared`.
 * A refusal has already put its toast up; the outcome is returned for the caller to react to.
 *
 * Views never change the plan: this only dispatches what the user asked for.
 */
import type { ActionOutcome, GanttAction, MoveKind } from '../../lib/gantt/intents';
import type { AppState } from '../../lib/state/app.svelte';
import type {
	ActionDispatchOptions,
	ActionSource,
	DispatchOutcome,
	PendingMark,
} from '../../lib/state/edits.svelte';
import { inspectorStrings } from '../../lib/strings';

export interface ActorEnv {
	readonly app: Pick<AppState, 'edits'>;
	/** What the Gantt draws: the result and its driving analysis as one pair. */
	shown(): ActionSource;
	/** Defaults to `window.confirm`. */
	confirm?: (message: string) => boolean;
}

const CANCELLED: DispatchOutcome = { status: 'cancelled' };

export class GanttActor {
	/** The move question is open; its suggestion pre-selects an option. */
	ask = $state.raw<{ readonly suggested: MoveKind } | null>(null);
	readonly #env: ActorEnv;
	#asking: Promise<MoveKind | null> | null = null;
	#answer: ((kind: MoveKind | null) => void) | null = null;

	constructor(env: ActorEnv) {
		this.#env = env;
	}

	/** A dry run of an action on the current text, or null when there is no answer yet. */
	check(action: GanttAction): ActionOutcome | null {
		return this.#env.app.edits?.check(action, this.#env.shown()) ?? null;
	}

	/** Ends a coalesced gesture (Enter, blur): the held call is dispatched now. */
	flush(key?: string): void {
		this.#env.app.edits?.flush(key);
	}

	/** Dispatches an action; the outcome says what became of it (`applied`, `refused`, ...). */
	async run(
		action: GanttAction,
		opts: ActionDispatchOptions = {},
		preview?: PendingMark,
	): Promise<DispatchOutcome> {
		const edits = this.#env.app.edits;
		if (!edits) return CANCELLED;
		const source = this.#env.shown();
		let o = await edits.dispatchAction(action, source, opts, preview);
		// The dispatcher asks at most two things of one action: the move question, and shared text.
		for (let i = 0; i < 2; i++) {
			if (o.status === 'ask-move-preference') {
				const kind = await this.#question(o.suggested);
				if (kind === null) return CANCELLED;
				edits.setMovePreference(kind);
				o = await edits.dispatchAction(action, source, opts, preview);
			} else if (o.status === 'confirm-shared') {
				const ask = this.#env.confirm ?? ((m: string) => globalThis.confirm(m));
				if (!ask(inspectorStrings.confirmShared(o.affects.join(', ')))) return CANCELLED;
				o = await edits.dispatchAction(action, source, { ...opts, confirmShared: true }, preview);
			} else break;
		}
		return o;
	}

	/** The dialog's answer: a kind, or null for Cancel. */
	answer(kind: MoveKind | null): void {
		this.#answer?.(kind);
	}

	#question(suggested: MoveKind): Promise<MoveKind | null> {
		if (this.#asking) return this.#asking;
		this.ask = { suggested };
		const asking = new Promise<MoveKind | null>((resolve) => {
			this.#answer = (kind) => {
				this.#answer = null;
				this.#asking = null;
				this.ask = null;
				resolve(kind);
			};
		});
		this.#asking = asking;
		return asking;
	}
}
