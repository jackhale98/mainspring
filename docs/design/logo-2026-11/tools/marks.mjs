// SPDX-License-Identifier: GPL-2.0-or-later
// Logo exploration (docs/design/logo-2026-11): builds the SVG for Version A "Flow" and Version B
// "Spring" from the construction in geom.mjs. Colours come from the ADR-0009 palette.
import {
	Frame,
	arcPath,
	bandOutline,
	bandPath,
	bbox,
	coil,
	coilOutline,
	f,
	ringOutline,
	sBand,
	springPath,
} from './geom.mjs';

/** ADR-0009 palette, mapped to the roles a mark needs. */
export const PALETTE = {
	light: {
		band: '#1C2A55', // the active-mode pill navy: the nearest navy in the palette
		gold: '#B08D3C', // brass (the logo ring, milestones)
		ground: '#ECE7DC', // the canvas the top bar sits on
		paper: '#F8F5EE', // the bg token
		tile: '#ECE7DC', // app icon tile (the same as the shipped icons)
	},
	dark: {
		band: '#B3C5F4', // accentInk, dark theme: a light heat-blued steel
		gold: '#D2AE5C', // brass, dark theme
		ground: '#080B10', // the canvas the top bar sits on
		paper: '#0D1117', // the bg token
		tile: '#11151D', // app icon tile, dark
	},
};

const VB = 120;

// ---- design parameters (design units) -----------------------------------------------------------
// One stroke width W and one gap G for the whole mark; the gold strip is half a band.
export const FULL_A = { W: 12, G: 3, WG: 6, R0: 42, Rh: 26, cx: 30, cy: 4, sweep: 186 };
// Small form: one thick band, no gap, squarer proportions.
export const SMALL_A = { W: 19, Rh: 21, cx: 20, cy: 9, sweep: 215 };

/** Scales the points to the box width and centres them; `square` uses a 120 x 120 box, otherwise
 * the box is as tall as the mark plus the margin. */
function fit(pts, margin, square) {
	const b = bbox(pts);
	const s = (VB - 2 * margin) / (b.x1 - b.x0);
	const H = square ? VB : Math.round(((b.y1 - b.y0) * s + 2 * margin) * 100) / 100;
	return {
		s,
		H,
		fr: new Frame(s, VB / 2 - ((b.x0 + b.x1) / 2) * s, H / 2 - ((b.y0 + b.y1) / 2) * s),
	};
}

const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`;

/** Version A, full form. `square` centres the mark in a 120 x 120 box (for tiles). */
export function markAFull(c, { square = false, margin = 2, P = FULL_A } = {}) {
	const S = sBand(P);
	const pts = [...bandOutline(S, P.W), ...ringOutline(P.R0, -150, 30), ...ringOutline(P.R0, 30, 210)];
	const { s, fr, H } = fit(pts, margin, square);
	const sw = (v) => f(v * s);
	const halo = bandPath(fr, S, P.G);
	const gR = P.R0 - P.WG / 2;
	const nR = P.R0 - P.WG - P.G - P.W / 2;
	const phi = S.phi;
	const ring = (R, a0, a1) => arcPath(fr, 0, 0, R, a0, a1);
	// the rings run between the two crossings of the S band, then the band's halo carves them
	const body = [
		`<g mask="url(#cut)">`,
		`<path d="${ring(gR, phi - 180, phi)}" stroke="${c.gold}" stroke-width="${sw(P.WG)}"/>`,
		`<path d="${ring(gR, phi, phi + 180)}" stroke="${c.gold}" stroke-width="${sw(P.WG)}"/>`,
		`<path d="${ring(nR, phi - 180, 0)}" stroke="${c.band}" stroke-width="${sw(P.W)}"/>`,
		`<path d="${ring(nR, phi, 180)}" stroke="${c.band}" stroke-width="${sw(P.W)}"/>`,
		`</g>`,
		`<path d="${bandPath(fr, S)}" stroke="${c.band}" stroke-width="${sw(P.W)}"/>`,
	].join('');
	const mask = `<defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${VB}" height="${H}"><rect width="${VB}" height="${H}" fill="#fff"/><path d="${halo}" stroke="#000" stroke-width="${sw(P.W + 2 * P.G)}"/></mask></defs>`;
	return `${svgOpen(VB, H)}${mask}<g fill="none">${body}</g></svg>`;
}

// ---- Version B -----------------------------------------------------------------------------------
export const FULL_B = {
	W: 8,
	G: 3,
	WG: 4,
	Rh: 28,
	cx: 32,
	cy: 6,
	sweep: 180,
	turns: 3,
	goldBefore: 45,
	goldAfter: 55,
};

/** Version B, full form: the band's left end winds into a coil, a gold strip echoes it on the right. */
export function markBFull(c, { square = false, margin = 2, P = FULL_B, gold = true } = {}) {
	const S = sBand(P);
	const p = P.W + P.G;
	const arcs = coil(S, p, P.turns);
	const gR = P.Rh + p - (P.W - P.WG) / 2; // outside the hook, one gap clear of the band
	// the gold strip is centred on the cut where the hook ends; the other is its half turn about O
	const aJ = S.aA - S.sweep;
	const goldL = [aJ - P.goldBefore, aJ + P.goldAfter];
	const goldR = goldL.map((a) => a + 180);
	const gA = [S.Cl[0], S.Cl[1], gR, ...goldL];
	const gB = [S.Cr[0], S.Cr[1], gR, ...goldR];
	const pts = [
		...bandOutline(S, P.W),
		...coilOutline(arcs, P.W),
		...(gold ? ringOutline(gR + P.WG / 2, ...goldL, S.Cl[0], S.Cl[1]) : []),
		...(gold ? ringOutline(gR + P.WG / 2, ...goldR, S.Cr[0], S.Cr[1]) : []),
	];
	const { s, fr, H } = fit(pts, margin, square);
	const sw = (v) => f(v * s);
	const parts = [`<path d="${springPath(fr, S, arcs)}" stroke="${c.band}" stroke-width="${sw(P.W)}"/>`];
	if (gold) {
		parts.push(`<path d="${arcPath(fr, ...gA)}" stroke="${c.gold}" stroke-width="${sw(P.WG)}"/>`);
		parts.push(`<path d="${arcPath(fr, ...gB)}" stroke="${c.gold}" stroke-width="${sw(P.WG)}"/>`);
	}
	return `${svgOpen(VB, H)}<g fill="none">${parts.join('')}</g></svg>`;
}

// Small form: the band and its coil, thicker, no gold, a gap of half a band.
export const SMALL_B = { W: 15, G: 8, Rh: 30, cx: 33, cy: 7, sweep: 180, turns: 1 };

/** Version B, small form. */
export function markBSmall(c, { margin = 4, P = SMALL_B } = {}) {
	const S = sBand(P);
	const arcs = coil(S, P.W + P.G, P.turns);
	const { s, fr, H } = fit([...bandOutline(S, P.W), ...coilOutline(arcs, P.W)], margin, true);
	return `${svgOpen(VB, H)}<path d="${springPath(fr, S, arcs)}" fill="none" stroke="${c.band}" stroke-width="${f(P.W * s)}"/></svg>`;
}

/** Version A, small form: the band alone. */
export function markASmall(c, { margin = 4, P = SMALL_A } = {}) {
	const S = sBand(P);
	const { s, fr, H } = fit(bandOutline(S, P.W), margin, true);
	return `${svgOpen(VB, H)}<path d="${bandPath(fr, S)}" fill="none" stroke="${c.band}" stroke-width="${f(P.W * s)}"/></svg>`;
}
