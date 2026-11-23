// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the export says once it has run (phase-4.md 18.20, T18): fetched with the export code, on
 * the first use. The menu entries are in `strings.ts` (`gestureStrings.row`), which the Gantt
 * toolbar loads at the start.
 */
export const exportStrings = {
	pngCopied: 'Copied the Gantt as an image.',
	downloaded: (file: string) => `Downloaded ${file}.`,
	pngFailed: 'The Gantt could not be made into an image.',
	csvFailed: 'The tasks could not be exported.',
};
