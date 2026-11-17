// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Assign mode and the recently used people (polish item 17). Picking a person in the toolbar's
 * list (a click, not a drag) starts the mode: while it lasts each click on a bar books that
 * person on the bar's task, with the same edit as a drop from the list (`assign`, one text patch,
 * one undo step), and the toolbar says who is being assigned. Escape or Done ends it. The state
 * is only the person's id and the last few ids used; the people themselves come from the plan,
 * so one that leaves the plan drops out of both. Nothing here changes the plan.
 */

/** How many recent people sit beside the Assign button. */
export const RECENT_MAX = 3;

export class AssignMode {
	/** The person being assigned, by id, or null when the mode is off. */
	person = $state<string | null>(null);
	/** The last people used, newest first. */
	recent = $state.raw<readonly string[]>([]);

	get active(): boolean {
		return this.person !== null;
	}

	begin(id: string): void {
		this.person = id;
		this.use(id);
	}

	/** Ends the mode; says whether it was on. */
	end(): boolean {
		const was = this.person !== null;
		this.person = null;
		return was;
	}

	/** Notes a person as used (an assign by drag, by click or by key). */
	use(id: string): void {
		this.recent = [id, ...this.recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
	}
}
