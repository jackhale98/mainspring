// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The buttons of the move question (src/components/gantt/MovePreferenceDialog.svelte), in a file of
 * its own beside strings.ts: only the dialog's lazy chunk reads it. The options and the warning are
 * `ganttActionStrings.movePreference`.
 */

export const moveQuestionStrings = {
	/** The dialog's buttons; the options and the warning are `ganttActionStrings.movePreference`. */
	confirm: 'Move',
	cancel: 'Cancel',
	remember: 'Mainspring asks this once. Project settings changes it later.',
} as const;
