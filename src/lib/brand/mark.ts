// SPDX-License-Identifier: GPL-2.0-or-later
// The Mainspring mark, "Spring" (ADR-0009, "Mark change, 2026-11-16"). One geometry for every use:
// the app top bar and loader (Mark.svelte), the landing page (Mark.astro), the favicon
// (public/favicon.svg, written by scripts/gen-favicon.mjs) and the app icons (scripts/gen-icons.mjs).
//
// A navy ribbon of one constant width flows in an S and winds into a coil at its left end, like the
// end of a mainspring strip. In the full form a brass arc stands beside each end. Everything is a
// circular arc or a straight segment, stroked at one width, so the gaps are equal by construction
// (a coil's pitch is the band width plus one gap) and no cut or mask is needed. The ribbon is one
// path that runs from its free end into the coil, which is what the loader draws along.
//
// Three forms, by the height the mark is drawn at:
//   full   (above 32 px): a slim band, a coil of 1.5 turns and the two brass arcs;
//   small  (17 to 32 px): no arcs, a thicker band, a coil of one turn;
//   tiny   (16 px and below, the favicon): the coil's innermost half turn is dropped as well.

/** The viewBox of the mark: 120 wide, as tall as the mark's slot (MARK_ASPECT). */
export const VIEWBOX_W = 120;
/** Width over height of the mark's slot: 35 x 26 px at the top bar's 26 px height. */
export const MARK_ASPECT = 35 / 26;
export const VIEWBOX_H = Math.round((VIEWBOX_W / MARK_ASPECT) * 100) / 100;

/** At or below this rendered height the small form is used. */
export const SMALL_MAX_PX = 32;
/** At or below this rendered height the tiny form is used. */
export const TINY_MAX_PX = 16;

export type MarkForm = 'full' | 'small' | 'tiny';

/** A form's construction, in design units (a stroke's width, a radius, degrees). */
interface Spec {
	/** The ribbon's width. */
	readonly w: number;
	/** The gap between two windings of the coil, and between the ribbon and an arc. */
	readonly gap: number;
	/** The brass arcs' width, or 0 for none. */
	readonly arcW: number;
	/** The hooks' radius (the centreline). */
	readonly rh: number;
	/** The hooks' centres are (-cx, +cy) and (+cx, -cy) about the origin. */
	readonly cx: number;
	readonly cy: number;
	/** The angle each hook sweeps, in degrees. */
	readonly sweep: number;
	/** Half turns of coil after the left hook. */
	readonly halfTurns: number;
}

const SPECS: Record<MarkForm, Spec> = {
	full: { w: 8, gap: 3, arcW: 4, rh: 28, cx: 32, cy: 6, sweep: 180, halfTurns: 3 },
	small: { w: 14, gap: 7, arcW: 0, rh: 31, cx: 33, cy: 7, sweep: 180, halfTurns: 2 },
	tiny: { w: 15, gap: 8, arcW: 0, rh: 30, cx: 33, cy: 7, sweep: 180, halfTurns: 1 },
};
/** Where the brass arc starts and ends either side of the hook's end cut, in degrees. */
const ARC_BEFORE = 45;
const ARC_AFTER = 55;
/** The ribbon is inset from the viewBox's edge by this much. */
const MARGIN = 2;

export function markForm(sizePx: number): MarkForm {
	return sizePx <= TINY_MAX_PX ? 'tiny' : sizePx <= SMALL_MAX_PX ? 'small' : 'full';
}

export interface MarkGeometry {
	/** The ribbon as one stroke, from its free end, along the S, into the coil's tip. */
	readonly band: string;
	readonly bandWidth: number;
	/** The brass arcs, one stroke each (none in the small and tiny forms). */
	readonly arcs: readonly string[];
	readonly arcWidth: number;
	/** The viewBox height this geometry was fitted to. */
	readonly height: number;
}

// ---- construction -------------------------------------------------------------------------------

/** A circular arc in design units: angles in degrees, y down, increasing is clockwise on screen.
 * `a1 < a0` runs the other way. */
interface Arc {
	readonly cx: number;
	readonly cy: number;
	readonly r: number;
	readonly a0: number;
	readonly a1: number;
}
interface Line {
	readonly from: readonly [number, number];
	readonly to: readonly [number, number];
}
type Piece = Arc | Line;

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const onArc = (a: Arc, angle: number, r = a.r): [number, number] => [
	a.cx + r * Math.cos(rad(angle)),
	a.cy + r * Math.sin(rad(angle)),
];
const isArc = (p: Piece): p is Arc => 'r' in p;

interface Design {
	/** In drawing order: right hook, diagonal, left hook, coil. */
	readonly band: readonly Piece[];
	readonly arcs: readonly Arc[];
}

/** The tangent angle on the left hook where the diagonal leaves it: the S's internal tangent. */
function hookExit(rh: number, cx: number, cy: number): number {
	const cl = [-cx, cy] as const;
	const d = Math.hypot(cx, cy);
	if (d <= rh) throw new Error('the hooks overlap: there is no internal tangent');
	const beta = Math.atan2(-cl[1], -cl[0]);
	const off = Math.acos(rh / d);
	for (const sign of [1, -1]) {
		const a = beta + sign * off;
		const px = cl[0] + rh * Math.cos(a);
		const py = cl[1] + rh * Math.sin(a);
		// clockwise motion at angle a heads (-sin, cos); it must head towards the origin
		if (-Math.sin(a) * -px + Math.cos(a) * -py > 0) return deg(a);
	}
	throw new Error('no tangent');
}

function design(s: Spec): Design {
	const cl: [number, number] = [-s.cx, s.cy];
	const cr: [number, number] = [s.cx, -s.cy];
	const aA = hookExit(s.rh, s.cx, s.cy);
	const aB = aA + 180;
	const aJ = aA - s.sweep;
	const left: Arc = { cx: cl[0], cy: cl[1], r: s.rh, a0: aA, a1: aJ };
	const right: Arc = { cx: cr[0], cy: cr[1], r: s.rh, a0: aB - s.sweep, a1: aB };
	const a = onArc({ ...left, a0: 0, a1: 0 }, aA);
	const band: Piece[] = [right, { from: [-a[0], -a[1]], to: a }, left];

	// The coil: half-turn semicircles, each a half pitch smaller, all tangent where they meet, so
	// the winding pitch is the band plus one gap everywhere.
	const pitch = s.w + s.gap;
	const u: [number, number] = [Math.cos(rad(aJ)), Math.sin(rad(aJ))];
	let from = onArc(left, aJ);
	for (let k = 1; k <= s.halfTurns; k++) {
		const r = s.rh - (k * pitch) / 2;
		const sign = k % 2 === 1 ? -1 : 1;
		const c: [number, number] = [from[0] + sign * r * u[0], from[1] + sign * r * u[1]];
		const arc: Arc = { cx: c[0], cy: c[1], r, a0: aJ - (k - 1) * 180, a1: aJ - k * 180 };
		band.push(arc);
		from = onArc(arc, arc.a1);
	}

	// The brass arcs sit one gap outside each hook, centred on where the hook ends; the second is
	// the first turned half a turn about the origin.
	const arcs: Arc[] = [];
	if (s.arcW > 0) {
		const r = s.rh + s.w / 2 + s.gap + s.arcW / 2;
		arcs.push({ cx: cl[0], cy: cl[1], r, a0: aJ - ARC_BEFORE, a1: aJ + ARC_AFTER });
		arcs.push({ cx: cr[0], cy: cr[1], r, a0: aJ - ARC_BEFORE + 180, a1: aJ + ARC_AFTER + 180 });
	}
	return { band, arcs };
}

/** Points along the outer edge of everything drawn, for the bounding box. */
function outline(d: Design, s: Spec): Array<[number, number]> {
	const pts: Array<[number, number]> = [];
	const sample = (a: Arc, width: number): void => {
		for (let i = 0; i <= 48; i++) {
			const angle = a.a0 + ((a.a1 - a.a0) * i) / 48;
			pts.push(onArc(a, angle, a.r + width / 2));
			pts.push(onArc(a, angle, a.r - width / 2));
		}
	};
	for (const p of d.band) {
		if (isArc(p)) sample(p, s.w);
		else pts.push([...p.from], [...p.to]);
	}
	for (const a of d.arcs) sample(a, s.arcW);
	return pts;
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

interface Fit {
	readonly scale: number;
	readonly tx: number;
	readonly ty: number;
}

function fit(pts: ReadonlyArray<readonly [number, number]>, height: number): Fit {
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	const scale = Math.min((VIEWBOX_W - 2 * MARGIN) / (x1 - x0), (height - 2 * MARGIN) / (y1 - y0));
	return {
		scale,
		tx: VIEWBOX_W / 2 - ((x0 + x1) / 2) * scale,
		ty: height / 2 - ((y0 + y1) / 2) * scale,
	};
}

/** Path data for the pieces, in viewBox units. Arcs of 180 degrees or more are split in two so
 * the large-arc flag is never ambiguous. */
function pathData(pieces: readonly Piece[], f: Fit): string {
	const x = (v: number): string => fmt(f.tx + f.scale * v);
	const y = (v: number): string => fmt(f.ty + f.scale * v);
	let d = '';
	const arc = (a: Arc, a0: number, a1: number, move: boolean): void => {
		const p0 = onArc(a, a0);
		const p1 = onArc(a, a1);
		if (move) d += `M${x(p0[0])} ${y(p0[1])}`;
		const r = fmt(a.r * f.scale);
		d += `A${r} ${r} 0 0 ${a1 > a0 ? 1 : 0} ${x(p1[0])} ${y(p1[1])}`;
	};
	pieces.forEach((p, i) => {
		if (!isArc(p)) {
			d += `${i === 0 ? `M${x(p.from[0])} ${y(p.from[1])}` : ''}L${x(p.to[0])} ${y(p.to[1])}`;
			return;
		}
		if (Math.abs(p.a1 - p.a0) >= 179.9) {
			const mid = (p.a0 + p.a1) / 2;
			arc(p, p.a0, mid, i === 0);
			arc(p, mid, p.a1, false);
		} else arc(p, p.a0, p.a1, i === 0);
	});
	return d;
}

/** The mark's geometry, fitted to a viewBox of VIEWBOX_W by `height` (VIEWBOX_H in the app, 120
 * for the square favicon and icon tiles). */
export function markGeometry(form: MarkForm, height: number = VIEWBOX_H): MarkGeometry {
	const spec = SPECS[form];
	const d = design(spec);
	const f = fit(outline(d, spec), height);
	return {
		band: pathData(d.band, f),
		bandWidth: Math.round(spec.w * f.scale * 100) / 100,
		arcs: d.arcs.map((a) => pathData([a], f)),
		arcWidth: Math.round(spec.arcW * f.scale * 100) / 100,
		height,
	};
}

/** The construction numbers of a form, for the tests: the band width, the gap, the coil pitch. */
export function markSpec(form: MarkForm): Readonly<{ w: number; gap: number; pitch: number }> {
	const s = SPECS[form];
	return { w: s.w, gap: s.gap, pitch: s.w + s.gap };
}

/** Every drawn point's distance from the centre of a 120 x 120 box, at most (for the icon safe zone). */
export function markReach(form: MarkForm): number {
	const spec = SPECS[form];
	const d = design(spec);
	const pts = outline(d, spec);
	const f = fit(pts, VIEWBOX_W);
	return Math.max(
		...pts.map((p) =>
			Math.hypot(f.tx + f.scale * p[0] - VIEWBOX_W / 2, f.ty + f.scale * p[1] - VIEWBOX_W / 2),
		),
	);
}

// ---- standalone SVG ------------------------------------------------------------------------------

export interface MarkColours {
	/** The ribbon: the mark band token (`--color-mark-band`). */
	readonly band: string;
	/** The brass arcs (`--color-mark-arc`). */
	readonly arc: string;
}

/** An app icon tile: the mark centred on a solid ground, scaled about the centre. */
export interface MarkTile {
	readonly background: string;
	readonly scale: number;
}

/**
 * The mark as a standalone SVG document, in a square 120 x 120 viewBox (the favicon and the icons).
 * A `dark` palette, when given, is applied under prefers-color-scheme: dark, so a tab icon follows
 * the browser. With a `tile` the mark sits on a solid ground.
 */
export function markSvg(
	form: MarkForm,
	light: MarkColours,
	dark?: MarkColours,
	tile?: MarkTile,
): string {
	const g = markGeometry(form, VIEWBOX_W);
	const css = (c: MarkColours): string =>
		`.b{stroke:${c.band}}${g.arcs.length > 0 ? `.a{stroke:${c.arc}}` : ''}`;
	const style = css(light) + (dark ? `@media (prefers-color-scheme:dark){${css(dark)}}` : '');
	const k = tile?.scale ?? 1;
	const c = VIEWBOX_W / 2;
	const open =
		k === 1
			? '<g fill="none">'
			: `<g fill="none" transform="translate(${c} ${c}) scale(${k}) translate(${-c} ${-c})">`;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_W}">`,
		`<style>${style}</style>`,
		tile ? `<rect width="${VIEWBOX_W}" height="${VIEWBOX_W}" fill="${tile.background}"/>` : '',
		open,
		...g.arcs.map((d) => `<path class="a" d="${d}" stroke-width="${g.arcWidth}"/>`),
		`<path class="b" d="${g.band}" stroke-width="${g.bandWidth}"/>`,
		'</g>',
		'</svg>',
		'',
	].join('');
}

/** The app icons in the web manifest (scripts/gen-icons.mjs): the full mark on the enamel ground. */
export const APP_ICON: MarkTile = { background: '#ece7dc', scale: 0.72 };
/** Maskable: inside the 80% safe circle a launcher may crop to. */
export const APP_ICON_MASKABLE: MarkTile = { background: '#ece7dc', scale: 0.6 };

/** The mark's palettes: the light and dark theme tokens (theme-light.css, theme-dark.css). */
export const FAVICON_LIGHT: MarkColours = { band: '#1c2a55', arc: '#9a7424' };
export const FAVICON_DARK: MarkColours = { band: '#b3c5f4', arc: '#d2ae5c' };
