// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the project sheet (src/components/inspector/ProjectSheet.svelte), in a file of its own
 * beside strings.ts: only the sheet's lazy chunk reads it, so a first load does not fetch it.
 */

export const projectSheetStrings = {
	title: 'Project',
	description:
		'The plan’s frame and the status date. Changes go to the text of the project header.',
	name: 'Name',
	start: 'Start',
	end: 'End',
	endHint: 'A date, or a length such as +17w.',
	now: 'Status date',
	nowHint: 'The date the plan is measured from. Leave empty to use the clock.',
	timezone: 'Time zone',
	timezoneHint: 'A name such as Europe/Berlin, or UTC.',
	noHeader: 'This plan has no project header.',
	clear: (what: string) => `Clear ${what}`,
	move: {
		title: 'When you move a task',
		description:
			'Moving a task in the chart changes the plan in one of two ways. The answer is remembered in this browser.',
		ask: 'Ask me next time',
		gap: 'Add a gap after the task it waits for',
		start: 'Give the task a fixed start date',
		note: 'A task scheduled as late as possible always gets a fixed end instead.',
	},
} as const;
