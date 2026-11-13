// SPDX-License-Identifier: GPL-2.0-or-later
// The Mainspring mark, option C1 "Tick, refined, all brass" (ADR-0009, mark note). One geometry
// for every use: the app top bar (Mark.svelte), the landing page (Mark.astro), the favicon
// (public/favicon.svg, written by scripts/gen-favicon.mjs) and the loader in the status pills.
//
// A watch seen from above, in a 120 x 120 box: three brass task arcs on the dial at equal gaps, a
// hairline inner dial ring, a blued-steel hairspring, and a ruby cap jewel in a brass setting. The
// small form (32 px and below) drops the inner ring and the hairspring and thickens the arcs, so it
// stays crisp at favicon size.

export const VIEWBOX = 120;
const C = VIEWBOX / 2;

/** Degrees between neighbouring arcs. Equal for all three. */
export const ARC_GAP_DEG = 12;
/** The three task arcs, in degrees, clockwise from the top. With the gaps they close the circle. */
export const ARC_SPANS_DEG: readonly [number, number, number] = [120, 96, 108];
const ARC_RADIUS = 45;

/** At or below this rendered size the small form is used. */
export const SMALL_MAX_PX = 32;

export type MarkForm = 'full' | 'small';

export interface MarkGeometry {
	/** SVG path data, one per task arc. */
	readonly arcs: readonly string[];
	readonly arcWidth: number;
	/** The inner dial ring radius, or null in the small form. */
	readonly innerRing: number | null;
	/** The hairspring path data, or null in the small form. */
	readonly hairspring: string | null;
	readonly hairspringWidth: number;
	/** The ruby jewel radius; its brass setting is drawn 1.6 units outside it. */
	readonly jewel: number;
	/** The ruby's radial gradient, lit from the top left. */
	readonly jewelLight: { readonly cx: number; readonly cy: number; readonly r: number };
	/** The highlight on the jewel: centre and radii. */
	readonly highlight: {
		readonly cx: number;
		readonly cy: number;
		readonly rx: number;
		readonly ry: number;
	};
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/** A point at radius r and angle a (degrees, 0 at the top, clockwise). */
function at(r: number, a: number): [number, number] {
	const t = (a * Math.PI) / 180;
	return [C + r * Math.sin(t), C - r * Math.cos(t)];
}

/** The start and end angles of each arc, centred so the gaps sit symmetrically. */
export function arcAngles(): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let a = ARC_GAP_DEG / 2;
	for (const span of ARC_SPANS_DEG) {
		out.push([a, a + span]);
		a += span + ARC_GAP_DEG;
	}
	return out;
}

function arcPath(r: number, a0: number, a1: number): string {
	const [x0, y0] = at(r, a0);
	const [x1, y1] = at(r, a1);
	const large = a1 - a0 > 180 ? 1 : 0;
	return `M${fmt(x0)} ${fmt(y0)} A${r} ${r} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)}`;
}

/** An Archimedean spiral from r0 to r1 over the given turns, as a polyline. */
function spiralPath(r0: number, r1: number, turns: number, a0: number): string {
	const n = Math.round(turns * 72);
	const pts: string[] = [];
	for (let i = 0; i <= n; i++) {
		const u = i / n;
		const [x, y] = at(r0 + (r1 - r0) * u, a0 + 360 * turns * u);
		pts.push(`${fmt(x)} ${fmt(y)}`);
	}
	return `M${pts.join(' L')}`;
}

let markIds = 0;
/** A gradient id prefix unique within a page, deterministic across builds (Mark.astro). */
export function nextMarkId(): string {
	markIds += 1;
	return `mk${markIds}`;
}

export function markForm(sizePx: number): MarkForm {
	return sizePx <= SMALL_MAX_PX ? 'small' : 'full';
}

export function markGeometry(form: MarkForm): MarkGeometry {
	const small = form === 'small';
	const jewel = small ? 12 : 5.2;
	return {
		arcs: arcAngles().map(([a0, a1]) => arcPath(ARC_RADIUS, a0, a1)),
		arcWidth: small ? 11 : 3.6,
		innerRing: small ? null : 38.5,
		hairspring: small ? null : spiralPath(9, 26, 2.5, 90),
		hairspringWidth: 1.15,
		jewel,
		jewelLight: { cx: C - jewel * 0.58, cy: C - jewel * 0.58, r: jewel * 1.55 },
		highlight: {
			cx: C - jewel * 0.35,
			cy: C - jewel * 0.38,
			rx: jewel * 0.34,
			ry: jewel * 0.22,
		},
	};
}

export interface MarkColours {
	readonly brassHi: string;
	readonly brass: string;
	readonly brassLo: string;
	readonly steel: string;
	readonly rubyHi: string;
	readonly ruby: string;
	readonly rubyLo: string;
}

/**
 * The mark as a standalone SVG document (the favicon). `id` prefixes the gradient ids. A `dark`
 * palette, when given, is applied under prefers-color-scheme: dark, so the tab icon follows the
 * browser.
 */
export function markSvg(form: MarkForm, light: MarkColours, dark?: MarkColours): string {
	const g = markGeometry(form);
	const css = (c: MarkColours): string =>
		`.bh{stop-color:${c.brassHi}}.bm{stop-color:${c.brass}}.bl{stop-color:${c.brassLo}}` +
		`.rh{stop-color:${c.rubyHi}}.rm{stop-color:${c.ruby}}.rl{stop-color:${c.rubyLo}}` +
		`.hs{stroke:${c.steel}}.ir{stroke:${c.brass}}`;
	const style = css(light) + (dark ? `@media (prefers-color-scheme:dark){${css(dark)}}` : '');
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
		`<style>${style}</style>`,
		'<defs>',
		`<linearGradient id="b" x1="0" y1="0" x2="0" y2="${VIEWBOX}" gradientUnits="userSpaceOnUse">`,
		'<stop class="bh" offset="0"/><stop class="bm" offset=".45"/><stop class="bl" offset="1"/>',
		'</linearGradient>',
		`<radialGradient id="r" cx="${fmt(g.jewelLight.cx)}" cy="${fmt(g.jewelLight.cy)}" r="${fmt(g.jewelLight.r)}" gradientUnits="userSpaceOnUse">`,
		'<stop class="rh" offset="0"/><stop class="rm" offset=".55"/><stop class="rl" offset="1"/>',
		'</radialGradient>',
		'</defs>',
		...g.arcs.map(
			(d) => `<path d="${d}" fill="none" stroke="url(#b)" stroke-width="${g.arcWidth}"/>`,
		),
		g.innerRing === null
			? ''
			: `<circle class="ir" cx="${C}" cy="${C}" r="${g.innerRing}" fill="none" stroke-width=".6" opacity=".55"/>`,
		g.hairspring === null
			? ''
			: `<path class="hs" d="${g.hairspring}" fill="none" stroke-width="${g.hairspringWidth}" stroke-linecap="round"/>`,
		`<circle cx="${C}" cy="${C}" r="${fmt(g.jewel + 1.6)}" fill="none" stroke="url(#b)" stroke-width="1.4"/>`,
		`<circle cx="${C}" cy="${C}" r="${fmt(g.jewel)}" fill="url(#r)"/>`,
		`<ellipse cx="${fmt(g.highlight.cx)}" cy="${fmt(g.highlight.cy)}" rx="${fmt(g.highlight.rx)}" ry="${fmt(g.highlight.ry)}" fill="#fff" opacity=".55" transform="rotate(-35 ${fmt(g.highlight.cx)} ${fmt(g.highlight.cy)})"/>`,
		'</svg>',
		'',
	].join('');
}

/** The favicon palettes: the light and dark theme tokens of the mark (theme-light.css, theme-dark.css). */
export const FAVICON_LIGHT: MarkColours = {
	brassHi: '#ddbb6e',
	brass: '#b08d3c',
	brassLo: '#7e5f22',
	steel: '#2346a0',
	rubyHi: '#e0577a',
	ruby: '#a3123a',
	rubyLo: '#5e0820',
};
export const FAVICON_DARK: MarkColours = {
	brassHi: '#f6e3ae',
	brass: '#d2ae5c',
	brassLo: '#9c7a34',
	steel: '#7d9be8',
	rubyHi: '#ff8fa6',
	ruby: '#e0456a',
	rubyLo: '#8a1534',
};
