// SPDX-License-Identifier: GPL-2.0-or-later
// The copy of the Gantt filter's lazy panel (src/components/gantt/FilterPanel.svelte), apart from
// strings.ts so that it loads with the panel and not with the first load (CLAUDE.md, user,
// 2026-11-17). What the pill, the chart and the row labels say stays in `strings.gantt.filter`.
export const filterPanelStrings = {
	/** The panel's name (a dialog). */
	panel: 'Filter tasks',
	done: 'Done',
	person: 'Person',
	personSearch: 'Find a person to filter by',
	/** In the person list: the person the chart is filtered to. */
	personOn: 'filtering by this person',
	flag: 'Flag',
	anyFlag: 'Any flag',
	noFlags: 'No task in this plan has a flag.',
	/** What a screen reader hears after a flag's name: how many tasks carry it. */
	taskCount: (n: number) => (n === 1 ? '1 task' : `${n} tasks`),
	/** A person the plan no longer has (a text edit removed it). */
	gone: (what: string) => `${what} is no longer in the plan.`,
} as const;
