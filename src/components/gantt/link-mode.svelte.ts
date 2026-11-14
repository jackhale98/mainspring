// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Link mode (phase-2.md 7.1 R3): making a dependency by pointing at the task that comes after.
 * One state for the three ways in, so the chart draws one thing and says one thing:
 * - a **drag** from a selected bar's end dot onto another bar (mouse or pen; `link-start`,
 *   `link-hover`, `link-drop` of the gesture controller);
 * - **tap, then tap**: tap the dot (on touch it is the only way), then tap the target; a banner
 *   with Cancel says so;
 * - the **keyboard**: L on a row, Up and Down to choose, Enter to link, Escape to leave.
 *
 * The predecessor is where it started and the successor is where it ends: `addDepends(task =
 * target, target = source)` (`link` action). Hovering a target asks the dispatcher for a dry run,
 * once per target change in a task of its own (7.3), and says what a drop would write or why not:
 * `cycle` on itself or an ancestor, `already-linked`, `conflicting-attribute`. A drop on a target
 * that is not allowed still goes to the dispatcher, which refuses with its toast and the place in
 * the text. Nothing here changes the plan.
 */
import type { GanttModel } from '../../lib/gantt/model';
import type { GanttAction } from '../../lib/gantt/intents';
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import { gestureStrings } from '../../lib/strings';
import type { ActionOutcome } from '../../lib/gantt/intents';
import type { TaskId } from '../../lib/tjp/index';

export type LinkVia = 'drag' | 'tap' | 'key';

export interface LinkState {
	/** The predecessor: its row, id and name. */
	readonly from: number;
	readonly task: TaskId;
	readonly name: string;
	readonly via: LinkVia;
	/** The successor under the pointer or the cursor, and what a drop there would do. */
	readonly target: number | null;
	readonly ok: boolean | null;
	/** The sentence for the target: what it writes, or why not. */
	readonly message: string | null;
	/** The pointer in content coordinates, or null (the keyboard has none). */
	readonly x: number | null;
	readonly y: number | null;
}

export interface LinkEnv {
	model(): GanttModel;
	check(action: GanttAction): ActionOutcome | null;
	run(action: GanttAction): Promise<DispatchOutcome>;
	announce(text: string): void;
	/** Runs a task later, and returns a function that cancels it (the dry run's own task). */
	later?(task: () => void): () => void;
}

const soon = (task: () => void): (() => void) => {
	const id = setTimeout(task, 0);
	return () => clearTimeout(id);
};

export class LinkMode {
	state = $state.raw<LinkState | null>(null);
	readonly #env: LinkEnv;
	#cancel: (() => void) | null = null;

	constructor(env: LinkEnv) {
		this.#env = env;
	}

	get active(): boolean {
		return this.state !== null;
	}

	/** Begins from a row's dot. A row without an id (a macro-built task) cannot be linked. */
	begin(row: number, via: LinkVia, x: number | null = null, y: number | null = null): boolean {
		const r = this.#env.model().rows[row];
		if (!r?.id) return false;
		this.#drop();
		this.state = {
			from: row,
			task: r.id,
			name: r.name,
			via,
			target: null,
			ok: null,
			message: null,
			x,
			y,
		};
		this.#env.announce(
			via === 'key' ? gestureStrings.live.linkKeys(r.name) : gestureStrings.live.linkStart(r.name),
		);
		return true;
	}

	/** The pointer moved (the rubber band's end). */
	point(x: number, y: number): void {
		if (this.state) this.state = { ...this.state, x, y };
	}

	/** The target changed (a bar under the pointer, a row under the cursor), or none. */
	target(row: number | null): void {
		const s = this.state;
		if (!s || s.target === row) return;
		this.#drop();
		this.state = { ...s, target: row, ok: null, message: null };
		if (row === null) return;
		const later = this.#env.later ?? soon;
		// One dry run per target, in a task of its own: the pointer's frames are not waiting for it.
		this.#cancel = later(() => this.#judge(row));
	}

	#judge(row: number): void {
		this.#cancel = null;
		const s = this.state;
		const succ = this.#env.model().rows[row];
		if (!s || s.target !== row || !succ?.id) return;
		const o = this.#env.check({ type: 'link', pred: s.task, succ: succ.id });
		if (o === null) return;
		const ok = o.status === 'edit';
		const message = ok
			? gestureStrings.drag.linkOk(s.name, succ.name)
			: gestureStrings.drag.linkNo(o.status === 'ask-move-preference' ? '' : o.message);
		this.state = { ...s, ok, message };
		if (s.via === 'key') {
			this.#env.announce(
				gestureStrings.live.linkTarget(succ.name, ok ? gestureStrings.live.linkAllowed : message),
			);
		}
	}

	/** Links the predecessor to the row (the drop, the second tap, Enter). */
	async complete(row: number): Promise<DispatchOutcome> {
		const s = this.state;
		const succ = this.#env.model().rows[row];
		this.end();
		if (!s || !succ?.id) return { status: 'cancelled' };
		return this.#env.run({ type: 'link', pred: s.task, succ: succ.id });
	}

	/** Leaves the mode without linking (Escape, Cancel, a tap on nothing). */
	cancel(announce = true): void {
		if (!this.state) return;
		this.end();
		if (announce) this.#env.announce(gestureStrings.live.linkCancelled);
	}

	end(): void {
		this.#drop();
		this.state = null;
	}

	#drop(): void {
		this.#cancel?.();
		this.#cancel = null;
	}
}
