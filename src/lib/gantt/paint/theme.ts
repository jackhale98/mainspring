// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's look, as one object resolved from CSS custom properties (src/styles/tokens.css):
 * colours, fonts, bar and row sizes, radii, line weights, opacities. Painters and the layout read
 * nothing else, so a token change restyles the canvas with no code change. The component resolves
 * the theme again when the colour scheme, the pointer type (the coarse-pointer sizes are token
 * overrides under `(pointer: coarse)`) or the fonts change.
 *
 * What stays in code is not styling: the device pixel ratio cap, the minimum hit areas (WCAG 2.5.8
 * asks for 24 px, or 44 px for a coarse pointer), the overscan, and ratios derived from a token
 * (arrow half-width, dash gaps). `readTheme` takes a getter instead of a DOM element so that it
 * can be tested without one; the fallbacks are the light theme.
 */
export interface Theme {
	// Colours (`--color-*`, `--color-gantt-*`).
	readonly surface: string;
	readonly surfaceSunken: string;
	readonly text: string;
	readonly textMuted: string;
	readonly border: string;
	readonly gridMinor: string;
	readonly gridMajor: string;
	readonly accent: string;
	readonly accentText: string;
	readonly bar: string;
	readonly barOutline: string;
	readonly barProgress: string;
	readonly link: string;
	readonly rowLine: string;
	readonly criticalFill: string;
	readonly summary: string;
	readonly milestone: string;
	readonly critical: string;
	readonly float: string;
	readonly pending: string;
	readonly statusDate: string;
	readonly today: string;
	readonly textOnly: string;
	readonly done: string;
	readonly focus: string;
	readonly rowSelected: string;
	readonly rowHover: string;
	// Fonts.
	readonly fontSans: string;
	readonly fontMono: string;
	readonly fontWeightStrong: string;
	// Sizes in CSS pixels (`--gantt-*`).
	readonly rowHeight: number;
	readonly rowLineWidth: number;
	readonly barHeight: number;
	readonly summaryHeight: number;
	readonly summaryStem: number;
	readonly milestoneHalf: number;
	readonly minBarWidth: number;
	readonly barRadius: number;
	readonly barOutlineWidth: number;
	readonly headerRow: number;
	readonly fontSize: number;
	readonly labelSize: number;
	readonly headerFontSize: number;
	readonly headerMinorFontSize: number;
	readonly labelGap: number;
	readonly labelPad: number;
	readonly linkWidth: number;
	readonly linkWidthCritical: number;
	readonly linkWidthHover: number;
	readonly linkElbow: number;
	readonly arrowSize: number;
	readonly outlineWidth: number;
	readonly criticalOutline: number;
	readonly markerWidth: number;
	readonly markerSize: number;
	readonly ringWidth: number;
	readonly ringGap: number;
	readonly floatHeight: number;
	readonly dash: number;
	// Opacities, 0 to 1.
	readonly dimOpacity: number;
	readonly hoverOpacity: number;
	readonly textOnlyOpacity: number;
}

type ColourKey = {
	[K in keyof Theme]: Theme[K] extends string ? K : never;
}[keyof Theme];
type NumberKey = {
	[K in keyof Theme]: Theme[K] extends number ? K : never;
}[keyof Theme];

const COLOURS: Readonly<
	Record<Exclude<ColourKey, 'fontSans' | 'fontMono' | 'fontWeightStrong'>, string>
> = {
	surface: '--color-gantt-surface',
	surfaceSunken: '--color-gantt-surface-header',
	text: '--color-gantt-text',
	textMuted: '--color-gantt-text-muted',
	border: '--color-gantt-border',
	gridMinor: '--color-gantt-grid',
	gridMajor: '--color-gantt-grid-major',
	accent: '--color-gantt-accent',
	accentText: '--color-gantt-accent-text',
	bar: '--color-gantt-bar',
	barOutline: '--color-gantt-bar-outline',
	barProgress: '--color-gantt-bar-progress',
	link: '--color-gantt-link',
	rowLine: '--color-gantt-row-line',
	criticalFill: '--color-critical-fill',
	summary: '--color-gantt-summary',
	milestone: '--color-gantt-milestone',
	critical: '--color-critical',
	float: '--color-float',
	pending: '--color-pending',
	statusDate: '--color-status-date',
	today: '--color-today',
	textOnly: '--color-text-only',
	done: '--color-done',
	focus: '--color-gantt-accent',
	rowSelected: '--color-gantt-row-selected',
	rowHover: '--color-gantt-row-hover',
};

/** Token per number; a length is read in px, an opacity as a plain number. */
const NUMBERS: Readonly<Record<NumberKey, string>> = {
	rowHeight: '--gantt-row-height',
	rowLineWidth: '--gantt-row-line-width',
	barHeight: '--gantt-bar-height',
	summaryHeight: '--gantt-summary-height',
	summaryStem: '--gantt-summary-stem',
	milestoneHalf: '--gantt-milestone-half',
	minBarWidth: '--gantt-min-bar-width',
	barRadius: '--gantt-bar-radius',
	barOutlineWidth: '--gantt-bar-outline-width',
	headerRow: '--gantt-header-row-height',
	fontSize: '--gantt-font-size',
	labelSize: '--gantt-label-size',
	headerFontSize: '--gantt-header-font-size',
	headerMinorFontSize: '--gantt-header-minor-font-size',
	labelGap: '--gantt-label-gap',
	labelPad: '--gantt-label-pad',
	linkWidth: '--gantt-link-width',
	linkWidthCritical: '--gantt-link-width-critical',
	linkWidthHover: '--gantt-link-width-hover',
	linkElbow: '--gantt-link-elbow',
	arrowSize: '--gantt-arrow-size',
	outlineWidth: '--gantt-outline-width',
	criticalOutline: '--gantt-critical-outline',
	markerWidth: '--gantt-marker-width',
	markerSize: '--gantt-marker-size',
	ringWidth: '--gantt-ring-width',
	ringGap: '--gantt-ring-gap',
	floatHeight: '--gantt-float-height',
	dash: '--gantt-dash',
	dimOpacity: '--gantt-dim-opacity',
	hoverOpacity: '--gantt-hover-opacity',
	textOnlyOpacity: '--gantt-text-only-opacity',
};

/** What a missing token falls back to: the light (Paper) theme, fine pointer. */
export const FALLBACK_THEME: Theme = {
	surface: '#fffdf8',
	surfaceSunken: '#f3efe5',
	text: '#1c1a17',
	textMuted: '#625b4f',
	border: '#e6e0d2',
	gridMinor: '#eee9dd',
	gridMajor: '#e6e0d2',
	accent: '#2346a0',
	accentText: '#ffffff',
	bar: '#efe6d1',
	barOutline: '#b08d3c',
	barProgress: '#b08d3c',
	link: '#b08d3c',
	rowLine: '#e6e0d2',
	criticalFill: '#dce4f5',
	summary: '#2e2a24',
	milestone: '#b08d3c',
	critical: '#2346a0',
	float: '#b08d3c',
	pending: '#9a7424',
	statusDate: '#1c3a86',
	today: '#9a7424',
	textOnly: '#625b4f',
	done: '#2f7d4f',
	focus: '#2346a0',
	rowSelected: '#eef2fb',
	rowHover: '#f3efe5',
	fontSans: 'system-ui, sans-serif',
	fontMono: 'ui-monospace, monospace',
	fontWeightStrong: '600',
	rowHeight: 40,
	rowLineWidth: 0,
	barHeight: 18,
	summaryHeight: 10,
	summaryStem: 6,
	milestoneHalf: 6,
	minBarWidth: 4,
	barRadius: 9,
	barOutlineWidth: 1,
	headerRow: 24,
	fontSize: 12,
	labelSize: 11,
	headerFontSize: 12,
	headerMinorFontSize: 11,
	labelGap: 14,
	labelPad: 8,
	linkWidth: 1.2,
	linkWidthCritical: 1.6,
	linkWidthHover: 2.4,
	linkElbow: 8,
	arrowSize: 6,
	outlineWidth: 1.5,
	criticalOutline: 1.6,
	markerWidth: 2,
	markerSize: 5,
	ringWidth: 2,
	ringGap: 2,
	floatHeight: 3,
	dash: 4,
	dimOpacity: 0.5,
	hoverOpacity: 0.7,
	textOnlyOpacity: 0.25,
};

export function readTheme(get: (name: string) => string): Theme {
	const out: Record<string, string | number> = { ...FALLBACK_THEME };
	for (const [key, token] of Object.entries(COLOURS)) {
		const v = get(token).trim();
		if (v !== '') out[key] = v;
	}
	for (const [key, token] of Object.entries(NUMBERS)) {
		const v = Number.parseFloat(get(token));
		if (Number.isFinite(v)) out[key] = v;
	}
	const text = (key: string, token: string): void => {
		const v = get(token).trim();
		if (v !== '') out[key] = v;
	};
	text('fontSans', '--font-sans');
	text('fontMono', '--font-mono');
	text('fontWeightStrong', '--gantt-font-weight-strong');
	return out as unknown as Theme;
}

/** The theme of an element's computed style. */
export function themeOf(el: Element): Theme {
	const style = getComputedStyle(el);
	return readTheme((name) => style.getPropertyValue(name));
}
