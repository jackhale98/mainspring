// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the Resources lanes (src/components/resources/Lanes*, src/lib/lanes; phase-3.md 9.4),
 * kept apart from strings.ts so that only the lazy lanes chunk fetches it (CLAUDE.md: one strings
 * module per lazily loaded view).
 */

/**
 * The Resources lanes (src/components/resources, phase-3.md 9.4, 10, 7.1 W1 and W2): one lane per
 * person with the booked tasks as bars, leave hatched by type and an "over" band under the lane.
 * The lane's picture is aria-hidden; its ARIA mirror says each person's tasks per period in words.
 * The controls, the cell details and the rebalance messages are the heatmap's (`workloadStrings`).
 */
export const lanesStrings = {
	region: 'Resources',
	/** The ARIA mirror of the canvas (a grid). */
	grid: 'Resource lanes by person and period',
	toolbar: 'Resource lane controls',
	/** The legend's entries. */
	legend: {
		label: 'Legend',
		bar: 'Booked task',
		textOnly: 'Text only: edit it in the text',
		over: 'Over',
		leave: 'Leave',
		group: 'Group roll-up',
	},
	/** The badge on a bar whose task the editor cannot move. */
	badge: 'T',
	/** "Login page 24 h" in a period's accessible name. */
	assigned: (tasks: string) => `works on ${tasks}`,
	more: (n: number) => ` and ${n} more`,
	task: (name: string, hours: string, textOnly: boolean) =>
		`${name} ${hours} h${textOnly ? ' (text only)' : ''}`,
	/** The lifted bar, announced when a long-press lifts it. */
	lifted: (task: string, who: string) =>
		`${task} lifted from ${who}. Drag to a person or a period.`,
	/** A press on a bar whose task cannot be moved. */
	textOnlyHint: (task: string) =>
		`${task} is declared where it cannot be edited. Edit it in the text.`,
} as const;
