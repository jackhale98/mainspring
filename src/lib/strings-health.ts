// SPDX-License-Identifier: GPL-2.0-or-later
// The few words the health checks themselves write (src/lib/health/spans.ts, constraints.ts): the
// label of a fix and the name of the waiting task "Convert gap to task" adds. The checks run in a
// first load, where the Health button's count is made (state/health.svelte.ts), so these are kept
// apart from the panel's copy (strings-health-panel.ts), which loads only with the panel.

export const healthCheckStrings = {
	fix: {
		/** "Remove start (5 Jan 2026)"; without a date when the plan writes it with a macro. */
		remove: (attr: string, date: string | null): string =>
			date === null ? `Remove ${attr}` : `Remove ${attr} (${date})`,
		gapToTask: 'Convert gap to task',
		editGap: 'Edit gap',
	},
	/** The waiting task "Convert gap to task" adds. */
	gapTaskName: (pred: string): string => `Wait after ${pred}`,
} as const;
