// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's look, as one object resolved from CSS custom properties (src/styles/tokens.css):
 * colours, fonts, bar and row sizes, radii, line weights, opacities. Painters and the layout read
 * nothing else, so a token change restyles the canvas with no code change. The component resolves
 * the theme again when the colour scheme, the pointer type or the fonts change.
 *
 * What stays in code is not styling: the device pixel ratio cap, the minimum hit areas (WCAG 2.5.8
 * asks for 24 px, or 44 px for a coarse pointer), the overscan, and ratios derived from a token
 * (arrow half-width, dash gaps). `readTheme` takes a getter instead of a DOM element so that it
 * can be tested without one. The fallbacks below are the light theme; they only matter while a
 * token is missing.
 */

/** Token and fallback of every colour. */
const COLOURS = {
	surface: ['--color-gantt-surface', '#fffdf8'],
	surfaceHeader: ['--color-gantt-surface-header', '#fffdf8'],
	inset: ['--color-gantt-inset', '#f4efe5'],
	text: ['--color-gantt-text', '#1c1a17'],
	textMuted: ['--color-gantt-text-muted', '#625b4f'],
	textFaint: ['--color-gantt-text-faint', '#766e5f'],
	border: ['--color-gantt-border', '#eee8dc'],
	borderStrong: ['--color-gantt-border-strong', '#e2dbcb'],
	gridMinor: ['--color-gantt-grid', '#f1ece1'],
	gridMajor: ['--color-gantt-grid-major', '#eee8dc'],
	rowLine: ['--color-gantt-row-line', '#eee8dc'],
	accent: ['--color-gantt-accent', '#2346a0'],
	accentText: ['--color-gantt-accent-text', '#ffffff'],
	rowSelected: ['--color-gantt-row-selected', '#f6eeda'],
	barTop: ['--color-gantt-bar-top', '#f7efdc'],
	barBottom: ['--color-gantt-bar-bottom', '#eaddbd'],
	barInk: ['--color-gantt-bar-ink', '#4a3912'],
	barProgress: ['--color-gantt-bar-progress', 'rgb(176 141 60 / 0.28)'],
	barOutline: ['--color-gantt-bar-outline', '#9a7424'],
	barHighlight: ['--color-gantt-bar-highlight', 'rgb(255 255 255 / 0.7)'],
	barLowlight: ['--color-gantt-bar-lowlight', 'rgb(120 90 20 / 0.18)'],
	barShadow: ['--color-gantt-bar-shadow', 'rgb(80 60 10 / 0.12)'],
	criticalTop: ['--color-gantt-critical-top', '#c0264f'],
	criticalBottom: ['--color-gantt-critical-bottom', '#a3123a'],
	criticalInk: ['--color-gantt-critical-ink', '#ffffff'],
	criticalProgress: ['--color-gantt-critical-progress', 'rgb(255 255 255 / 0.18)'],
	criticalHighlight: ['--color-gantt-critical-highlight', 'rgb(255 255 255 / 0.25)'],
	criticalShadow: ['--color-gantt-critical-shadow', 'rgb(163 18 58 / 0.3)'],
	summary: ['--color-gantt-summary', '#7a7262'],
	milestone: ['--color-gantt-milestone', '#b08d3c'],
	jewelHigh: ['--color-gantt-jewel-high', '#f1d99a'],
	jewelDeep: ['--color-gantt-jewel-deep', '#9a7424'],
	jewelGlow: ['--color-gantt-jewel-glow', 'rgb(154 116 36 / 0.35)'],
	link: ['--color-gantt-link', '#9a7424'],
	crownTop: ['--color-gantt-crown-top', '#e3c47e'],
	crownEdge: ['--color-gantt-crown-edge', 'rgb(80 60 10 / 0.35)'],
	critical: ['--color-critical', '#a3123a'],
	float: ['--color-float', '#9a7424'],
	pending: ['--color-pending', '#8a5a00'],
	statusDate: ['--color-status-date', '#2b2620'],
	today: ['--color-today', '#9a7424'],
	textOnly: ['--color-text-only', '#625b4f'],
	focus: ['--color-gantt-accent', '#2346a0'],
} as const;

/** Token and fallback of every size (px), opacity or factor. */
const NUMBERS = {
	rowHeight: ['--gantt-row-height', 40],
	rowLineWidth: ['--gantt-row-line-width', 0],
	barHeight: ['--gantt-bar-height', 22],
	barRadius: ['--gantt-bar-radius', 11],
	barOutlineWidth: ['--gantt-bar-outline-width', 1],
	// The second, non-colour cue of the critical path (WCAG 1.4.1): a heavier edge round the bar,
	// and a post at its finish edge that stands this far above and below it.
	criticalEdgeWidth: ['--gantt-critical-edge-width', 2],
	criticalPostWidth: ['--gantt-critical-post-width', 2],
	criticalPostReach: ['--gantt-critical-post-reach', 4],
	barShadowBlur: ['--gantt-bar-shadow-blur', 2],
	barShadowY: ['--gantt-bar-shadow-y', 1],
	criticalShadowBlur: ['--gantt-critical-shadow-blur', 6],
	criticalShadowY: ['--gantt-critical-shadow-y', 2],
	summaryHeight: ['--gantt-summary-height', 9],
	summaryStem: ['--gantt-summary-stem', 3],
	summaryCap: ['--gantt-summary-cap', 2],
	milestoneHalf: ['--gantt-milestone-half', 10],
	milestoneRadius: ['--gantt-milestone-radius', 3],
	jewelBlur: ['--gantt-jewel-blur', 6],
	jewelY: ['--gantt-jewel-y', 2],
	minBarWidth: ['--gantt-min-bar-width', 6],
	originGap: ['--gantt-origin-gap', 8],
	headerRow: ['--gantt-header-row-height', 32],
	fontSize: ['--gantt-font-size', 11.5],
	labelSize: ['--gantt-label-size', 11],
	displaySize: ['--gantt-display-size', 15],
	headerFontSize: ['--gantt-header-font-size', 19],
	headerMinorFontSize: ['--gantt-header-minor-font-size', 11],
	headerLetterSpacing: ['--gantt-header-letter-spacing', 0.22],
	labelGap: ['--gantt-label-gap', 14],
	labelPad: ['--gantt-label-pad', 10],
	avatarSize: ['--gantt-avatar-size', 20],
	avatarGap: ['--gantt-avatar-gap', 4],
	avatarFontSize: ['--gantt-avatar-font-size', 9.5],
	linkWidth: ['--gantt-link-width', 1.2],
	linkWidthCritical: ['--gantt-link-width-critical', 2.2],
	linkWidthHover: ['--gantt-link-width-hover', 2.4],
	linkElbow: ['--gantt-link-elbow', 8],
	linkRadius: ['--gantt-link-radius', 4],
	linkGap: ['--gantt-link-gap', 2],
	arrowSize: ['--gantt-arrow-size', 5],
	outlineWidth: ['--gantt-outline-width', 1.5],
	markerWidth: ['--gantt-marker-width', 1.5],
	markerSize: ['--gantt-marker-size', 5],
	crownWidth: ['--gantt-crown-width', 12],
	crownHeight: ['--gantt-crown-height', 9],
	ringWidth: ['--gantt-ring-width', 2],
	ringGap: ['--gantt-ring-gap', 3],
	hoverRingWidth: ['--gantt-hover-ring-width', 1.5],
	floatHeight: ['--gantt-float-height', 3],
	dash: ['--gantt-dash', 4],
	dimOpacity: ['--gantt-dim-opacity', 0.5],
	textOnlyOpacity: ['--gantt-text-only-opacity', 0.25],
} as const;

/** The people's colours: a background and an initial each, picked by the person's number. */
const AVATARS: ReadonlyArray<readonly [string, string, string, string]> = [
	['--color-gantt-avatar-1-bg', '#e3e9f7', '--color-gantt-avatar-1-ink', '#22408f'],
	['--color-gantt-avatar-2-bg', '#f3ead6', '--color-gantt-avatar-2-ink', '#6e5316'],
	['--color-gantt-avatar-3-bg', '#f6e3e8', '--color-gantt-avatar-3-ink', '#8e1b3a'],
	['--color-gantt-avatar-4-bg', '#e2f1e7', '--color-gantt-avatar-4-ink', '#1f5c3a'],
	['--color-gantt-avatar-5-bg', '#eee5f6', '--color-gantt-avatar-5-ink', '#5a2e8c'],
	['--color-gantt-avatar-6-bg', '#dff0ef', '--color-gantt-avatar-6-ink', '#14615a'],
];

export interface Avatar {
	readonly bg: string;
	readonly ink: string;
}

export type Theme = { readonly [K in keyof typeof COLOURS]: string } & {
	readonly [K in keyof typeof NUMBERS]: number;
} & {
	readonly fontSans: string;
	readonly fontMono: string;
	readonly fontDisplay: string;
	readonly fontWeightStrong: string;
	readonly fontWeightBar: string;
	readonly avatars: readonly Avatar[];
};

function build(get: (name: string) => string): Theme {
	const colour = (token: string, fallback: string): string => get(token).trim() || fallback;
	const number = (token: string, fallback: number): number => {
		const v = Number.parseFloat(get(token));
		return Number.isFinite(v) ? v : fallback;
	};
	const out: Record<string, unknown> = {};
	for (const [key, [token, fallback]] of Object.entries(COLOURS))
		out[key] = colour(token, fallback);
	for (const [key, [token, fallback]] of Object.entries(NUMBERS))
		out[key] = number(token, fallback);
	out['fontSans'] = colour('--font-sans', 'system-ui, sans-serif');
	out['fontMono'] = colour('--font-mono', 'ui-monospace, monospace');
	out['fontDisplay'] = colour('--font-display', 'Georgia, serif');
	out['fontWeightStrong'] = colour('--gantt-font-weight-strong', '600');
	out['fontWeightBar'] = colour('--gantt-font-weight-bar', '600');
	out['avatars'] = AVATARS.map(([bg, bgFallback, ink, inkFallback]) => ({
		bg: colour(bg, bgFallback),
		ink: colour(ink, inkFallback),
	}));
	return out as unknown as Theme;
}

/** What a missing token falls back to: the light theme, fine pointer. */
export const FALLBACK_THEME: Theme = build(() => '');

export function readTheme(get: (name: string) => string): Theme {
	return build(get);
}

/** The theme of an element's computed style. */
export function themeOf(el: Element): Theme {
	const style = getComputedStyle(el);
	return readTheme((name) => style.getPropertyValue(name));
}
