// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the Sync panel, which loads lazily with it (phase-4.md 11.2; T14): what the state
 * means in one plain sentence, and the panel's rows. The status control's labels and the location
 * line are first-load copy (strings.ts `sync`). T7 adds the controller's messages ("Merged changes
 * from GitHub", ...) and T14 part two the Commit, Sync and Save copy here.
 */
export const syncStrings = {
	title: 'Sync',
	where: 'Where it lives',
	lastKept: 'Last kept',
	/** Nothing has been kept yet. */
	notYet: 'Not yet',
	/** One plain sentence for each state (`lib/sync/panel.ts` picks it). */
	state: {
		sample:
			'This is a sample. Your first change keeps a copy in this browser; the sample itself never changes.',
		browserOnly: 'Your plan is kept in this browser as you make changes. It is not sent anywhere.',
		saved: 'Everything is saved.',
		changes: (n: number) =>
			`${n === 1 ? '1 file has' : `${n} files have`} changes that are not saved yet.`,
		working: {
			saving: 'Saving your changes.',
			committing: 'Committing your changes.',
			pulling: 'Getting the latest version.',
			checking: 'Checking that the plan still schedules.',
		},
		queued: {
			offline: (n: number) =>
				`You are offline. ${n === 1 ? '1 change is' : `${n} changes are`} waiting to be sent.`,
			'needs-access': 'Your changes are waiting. Sign in again to send them.',
			retrying: 'The last attempt did not go through. Trying again shortly.',
		},
		conflict: 'Your changes and the saved version changed the same things. Choose which to keep.',
		blocked: 'The plan does not schedule, so it cannot be committed. Fix the errors first.',
		access: {
			granted: 'This place can be used.',
			prompt: 'Allow access to the folder again to keep saving.',
			'signed-out': 'Sign in to keep syncing.',
			denied: 'This account cannot use this place.',
		},
		failedStore: {
			default:
				'Your latest changes could not be kept in this browser. They are only in this tab, and closing it loses them.',
			quota:
				'This browser has no room left to keep the plan. Your changes are only in this tab. Copy the text to keep them.',
			'not-owner':
				'Another tab took this plan before your latest changes were kept. They are only in this tab: copy the text to keep them.',
		},
		failedProvider: 'The last save did not go through. Your text is safe in this browser.',
		readOnly: 'This plan is open in another tab, so it is read-only here.',
	},
} as const;
