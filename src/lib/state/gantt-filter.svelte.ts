// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's filter state (phase-3.md "Amendments from T19"): which person and which flag the chart shows.
 * One per open plan, owned by `AppState` so that any view can set it ("Show in Gantt" in the
 * workload views, T18: `app.ganttFilter.showPerson(id)`, then switch the view to the Gantt). A view
 * state only: it never edits the text.
 *
 * - Session only: it resets when another plan is opened and is not stored. A filter hides work,
 *   so one that came back unasked on the next visit would look like lost tasks.
 * - `collapsed` is the closed containers while a filter is on. The filter opens everything it
 *   finds, and a twisty closes one for as long as the filter stays as it is; `AppState.collapsed`
 *   (the tree as the person left it) is not touched, so clearing the filter restores it exactly.
 */
import { NO_FILTER, isFiltering, type GanttFilter } from '../gantt/filter-model';

export class GanttFilterState {
	person = $state<string | null>(null);
	flag = $state<string | null>(null);
	/** Containers closed since the filter last changed (see the module comment). */
	collapsed = $state.raw<ReadonlySet<string>>(new Set());

	get value(): GanttFilter {
		return this.person === null && this.flag === null
			? NO_FILTER
			: { person: this.person, flag: this.flag };
	}
	get active(): boolean {
		return isFiltering(this.value);
	}

	/** Filters to one person's tasks (null: anyone); the flag, if any, stays. */
	setPerson(id: string | null): void {
		if (id === this.person) return;
		this.person = id;
		this.collapsed = new Set();
	}
	/** Filters to the tasks that carry a flag (null: any); the person, if any, stays. */
	setFlag(flag: string | null): void {
		if (flag === this.flag) return;
		this.flag = flag;
		this.collapsed = new Set();
	}
	/** What "Show in Gantt" does: only this person, whatever was set before. */
	showPerson(id: string): void {
		this.setFlag(null);
		this.setPerson(id);
	}
	clear(): void {
		this.person = null;
		this.flag = null;
		this.collapsed = new Set();
	}
	toggle(key: string): void {
		const next = new Set(this.collapsed);
		if (!next.delete(key)) next.add(key);
		this.collapsed = next;
	}
}
