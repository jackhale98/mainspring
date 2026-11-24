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
		/**
		 * Another tab took the plan before this one had stored its latest changes (T4 re-check N1):
		 * they are on screen, read-only, and nowhere else.
		 */
		refused:
			'Your latest changes in this tab were not kept: another tab took the plan. Copy the text to keep them.',
		/** Copies the open file's text to the clipboard (export arrives with T5). */
		copyText: 'Copy the text',
		copied: 'Copied',
		copyFailed: 'Could not copy',
		/** The last plan could not be opened (T4 review H2, M2): a sample is open instead. */
		unopened:
			'The plan you had open could not be opened from this browser. A sample is open instead.',
		retry: 'Try again',
		/** Try again failed: the page reloads, which opens the last plan again. */
		reload: 'Reload the page',
		/** The store is empty but the marker says plans were kept (9.4). */
		cleared:
			'This browser cleared the plans that Mainspring kept in it. Plans saved somewhere else are not affected.',
		dismiss: 'Dismiss',
	},
} as const;
