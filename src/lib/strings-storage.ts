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
		/** A phone has no footer line: changes the store refused (8.1 #8). */
		failed:
			'Your latest changes could not be kept in this browser. They are only in this tab, and closing it loses them.',
		dismiss: 'Dismiss',
		/** A folder or the opened files hold several plans (18.22): which one opens. */
		which: (where: string, n: number) =>
			where === ''
				? `These files hold ${n} plans. Which one do you want to open?`
				: `“${where}” holds ${n} plans. Which one do you want to open?`,
		cancel: 'Cancel',
	},
	/**
	 * What opening files or a folder, Save to… and Export say (state/plan-files.ts, T5): the edit
	 * toasts' line, or the phone's strip. T15's chooser and T14's panel reuse them.
	 */
	files: {
		noPlan: 'No TaskJuggler plan (a .tjp file) was among them, so nothing was opened.',
		tooLarge:
			'That plan is too large to open here: at most 200 files, 2 MB per file and 8 MB in all.',
		unreadable: 'The files could not be read, so nothing was opened.',
		permission: 'Mainspring was not allowed to use that folder.',
		gone: 'That folder is no longer there.',
		unsupported: 'This browser cannot open a folder in place. Open the files instead.',
		quota: 'This browser has no room left to keep the plan.',
		/** Files that had bytes that are not UTF-8 are written with replacement characters (18.11). */
		lossy: (names: readonly string[]) =>
			names.length === 1
				? `${names[0]} will be saved with replacement characters where it had bytes that are not UTF-8. Save it anyway?`
				: `${names.join(', ')} will be saved with replacement characters where they had bytes that are not UTF-8. Save them anyway?`,
		downloaded: (name: string) => `Downloaded ${name}`,
		exportFailed: 'The plan could not be exported.',
		/** Save to… never overwrites (7.3). */
		exists: (names: readonly string[]) =>
			`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already in that folder, so nothing was saved there.`,
		savedTo: (folder: string) => `Saved to the folder “${folder}”. The plan is kept there now.`,
		saveFailed: 'The plan could not be saved to that folder.',
		readOnly: 'This plan is open in another tab, so it is not saved from here.',
		already: 'This plan is already saved in a folder or on GitHub.',
	},
} as const;
