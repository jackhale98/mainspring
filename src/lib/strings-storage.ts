// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the storage views that load lazily (phase-4.md 11.2): for now the notice under the
 * top bar (components/app/PlanNotice.svelte, T4). The chooser, Save to… and Settings (T15, T17) add
 * theirs here. What a first load shows is in strings.ts (`keep`).
 */
export const storageStrings = {
	notice: {
		/** This tab opened the plan while another tab had it (7.1). */
		elsewhere: 'This plan is open in another tab. You can read it here; changes are made there.',
		/** Another tab took the plan over with "Open here instead" (7.1). */
		taken: 'This plan is now open in another tab, so it is read-only here.',
		openHere: 'Open here instead',
		/** The store is empty but the marker says plans were kept (9.4). */
		cleared:
			'This browser cleared the plans that Mainspring kept in it. Plans saved somewhere else are not affected.',
		/** A phone has no footer line: changes the store refused (8.1 #8). */
		failed:
			'Your latest changes could not be kept in this browser. They are only in this tab, and closing it loses them.',
		dismiss: 'Dismiss',
	},
} as const;
