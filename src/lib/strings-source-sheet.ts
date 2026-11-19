// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the source sheet (src/components/inspector/SourceSheet.svelte), in a file of its own
 * beside strings.ts: only the sheet's lazy chunk reads it, so a first load does not fetch it.
 */

export const sourceSheetStrings = {
	title: (name: string) => `Source of ${name}`,
	file: (path: string) => `In ${path}`,
	openInText: 'Open in text',
	cut: (lines: number) =>
		`Showing the first part of ${lines} lines. Open it in the text to read the rest.`,
	none: 'The source of this task cannot be shown.',
	region: 'Plan text',
} as const;
