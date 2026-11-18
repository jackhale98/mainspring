// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The three icons of the Calendar's mode switch on a phone (Select, Paint, Erase), kept out of
 * `icons.ts` so that the first load does not carry them: only the lazy Calendar chunk imports this
 * module (keep it out of the bundler groups in astro.config.mjs). They are passed to the Icon
 * component as its `paths`. The glyphs follow Lucide (https://lucide.dev), ISC licensed; the notice
 * is in the header of `icons.ts` and in THIRD_PARTY_NOTICES.md. Decorative: the mode's radio has the
 * accessible name.
 */
export const MODE_ICONS = {
	/** Select: a pointer. */
	pointer: ['m4 4 7.07 17 2.51-7.39L21 11.07z'],
	/** Paint: a brush. */
	brush: [
		'm9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08',
		'M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z',
	],
	/** Erase: an eraser. */
	eraser: [
		'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21',
		'M22 21H7',
		'm5 11 9 9',
	],
} as const satisfies Record<string, readonly string[]>;

export type ModeIconName = keyof typeof MODE_ICONS;
