// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's look as one object resolved from CSS custom properties (src/styles/tokens.css and
 * the two theme files): the band colours (`--load-*`, ADR-0009), the leave stripes and the sizes.
 * What the heatmap shares with the Gantt (surface, grid, text, today and status lines, the focus
 * colour, the fonts) is the Gantt's `Theme` (gantt/paint/theme.ts), passed beside this. Painters
 * read nothing else, so a token change restyles the canvas with no code change. `readHeatTheme`
 * takes a getter instead of an element so that it can be tested without a DOM.
 */
import type { BucketKind } from './types';

const COLOURS = {
	spare: ['--load-spare', '#f6eeda'],
	spareInk: ['--load-spare-ink', '#1c1a17'],
	full: ['--load-full', '#e2c070'],
	fullInk: ['--load-full-ink', '#1c1a17'],
	over: ['--load-over', '#b3224a'],
	overInk: ['--load-over-ink', '#ffffff'],
	overHatch: ['--load-over-hatch', 'rgb(255 255 255 / 0.16)'],
	off: ['--load-off', '#ece6d8'],
	offInk: ['--load-off-ink', '#5b5447'],
	leaveHatch: ['--leave-hatch', '#7a7262'],
	held: ['--held', '#8a5a00'],
} as const;

const NUMBERS = {
	rowHeight: ['--load-row-height', 28],
	headerRow: ['--load-header-row', 28],
	colDay: ['--load-col-day', 32],
	colWeek: ['--load-col-week', 56],
	colMonth: ['--load-col-month', 72],
	fontSize: ['--load-font-size', 12],
} as const;

export type HeatTheme = { readonly [K in keyof typeof COLOURS]: string } & {
	readonly [K in keyof typeof NUMBERS]: number;
};

function build(get: (name: string) => string): HeatTheme {
	const out: Record<string, unknown> = {};
	for (const [key, [token, fallback]] of Object.entries(COLOURS)) {
		out[key] = get(token).trim() || fallback;
	}
	for (const [key, [token, fallback]] of Object.entries(NUMBERS)) {
		const v = Number.parseFloat(get(token));
		out[key] = Number.isFinite(v) ? v : fallback;
	}
	return out as unknown as HeatTheme;
}

export const FALLBACK_HEAT_THEME: HeatTheme = build(() => '');

export function readHeatTheme(get: (name: string) => string): HeatTheme {
	return build(get);
}

export function heatThemeOf(el: Element): HeatTheme {
	const style = getComputedStyle(el);
	return build((name) => style.getPropertyValue(name));
}

/** The width of a cell at a zoom. */
export const colWidthOf = (t: HeatTheme, kind: BucketKind): number =>
	kind === 'day' ? t.colDay : kind === 'week' ? t.colWeek : t.colMonth;

/** Cell text is drawn only where a cell is at least this wide (phase-3.md 8.1). */
export const MIN_TEXT_WIDTH = 32;
