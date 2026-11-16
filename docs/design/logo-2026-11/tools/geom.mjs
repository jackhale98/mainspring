// SPDX-License-Identifier: GPL-2.0-or-later
// Logo exploration (docs/design/logo-2026-11): construction geometry. Pure functions, no deps.
// Every shape is a circular arc or a straight segment, drawn as a stroke of constant width.
// Design units are arbitrary; a Frame maps them into the SVG viewBox.

export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const f = (n) => String(Math.round(n * 100) / 100);

export class Frame {
	constructor(s, tx, ty) {
		this.s = s;
		this.tx = tx;
		this.ty = ty;
	}
	x(v) {
		return this.tx + this.s * v;
	}
	y(v) {
		return this.ty + this.s * v;
	}
	r(v) {
		return this.s * v;
	}
}

/** Path builder that writes absolute coordinates through a Frame. Angles are degrees, y down,
 * increasing angle = clockwise on screen. */
export class Path {
	constructor(fr) {
		this.fr = fr;
		this.d = '';
	}
	M(x, y) {
		this.d += `M${f(this.fr.x(x))} ${f(this.fr.y(y))}`;
		return this;
	}
	L(x, y) {
		this.d += `L${f(this.fr.x(x))} ${f(this.fr.y(y))}`;
		return this;
	}
	arc(cx, cy, r, a0, a1, move = false) {
		const pt = (a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
		if (move) this.M(...pt(a0));
		const span = Math.abs(a1 - a0);
		if (span > 179.9) {
			const mid = (a0 + a1) / 2;
			this.arc(cx, cy, r, a0, mid);
			this.arc(cx, cy, r, mid, a1);
			return this;
		}
		const p1 = pt(a1);
		const R = f(this.fr.r(r));
		this.d += `A${R} ${R} 0 0 ${a1 > a0 ? 1 : 0} ${f(this.fr.x(p1[0]))} ${f(this.fr.y(p1[1]))}`;
		return this;
	}
}

/** The S band: two hooks of radius Rh with centres Cl = (-cx, +cy) and Cr = (+cx, -cy), joined by
 * the internal common tangent through the origin. The band is point symmetric about the origin. */
export function sBand({ Rh, cx, cy, sweep }) {
	const Cl = [-cx, cy];
	const d = Math.hypot(cx, cy);
	if (d <= Rh) throw new Error('hooks overlap: no internal tangent');
	const beta = Math.atan2(-Cl[1], -Cl[0]);
	const off = Math.acos(Rh / d);
	let aA = null;
	for (const sgn of [1, -1]) {
		const a = beta + sgn * off;
		const A = [Cl[0] + Rh * Math.cos(a), Cl[1] + Rh * Math.sin(a)];
		const dir = [-Math.sin(a), Math.cos(a)];
		if (dir[0] * -A[0] + dir[1] * -A[1] > 0) aA = deg(a);
	}
	const A = [Cl[0] + Rh * Math.cos(rad(aA)), Cl[1] + Rh * Math.sin(rad(aA))];
	return {
		Rh,
		Cl,
		Cr: [cx, -cy],
		A,
		B: [-A[0], -A[1]],
		aA,
		phi: deg(Math.atan2(-A[1], -A[0])),
		sweep,
	};
}

/** Centreline of the band as path data. `ext` lengthens both ends by that arc length. */
export function bandPath(fr, S, ext = 0) {
	const e = deg(ext / S.Rh);
	const p = new Path(fr);
	p.arc(S.Cl[0], S.Cl[1], S.Rh, S.aA - S.sweep - e, S.aA, true);
	p.L(S.B[0], S.B[1]);
	const aB = S.aA + 180;
	p.arc(S.Cr[0], S.Cr[1], S.Rh, aB, aB - S.sweep - e);
	return p.d;
}

/** A single circular arc as path data (centre, radius, start and end angle in degrees). */
export function arcPath(fr, cx, cy, r, a0, a1) {
	return new Path(fr).arc(cx, cy, r, a0, a1, true).d;
}

/** Points on the outer edge of the band, for bounding boxes. */
export function bandOutline(S, w) {
	const pts = [];
	const r = S.Rh + w / 2;
	for (let t = 0; t <= 1.0001; t += 0.01) {
		const a = rad(S.aA - S.sweep + t * S.sweep);
		pts.push([S.Cl[0] + r * Math.cos(a), S.Cl[1] + r * Math.sin(a)]);
		pts.push([S.Cr[0] - r * Math.cos(a), S.Cr[1] - r * Math.sin(a)]);
	}
	return pts;
}

/** Points along an arc, for bounding boxes. */
export function ringOutline(R, a0, a1, cx = 0, cy = 0) {
	const pts = [];
	for (let t = 0; t <= 1.0001; t += 0.01) {
		const a = rad(a0 + t * (a1 - a0));
		pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
	}
	return pts;
}

/** The coil: n half-turn semicircles that wind inward from the S band's left end, one pitch p per
 * full turn (the classic semicircle construction of a clock spring). Returns arcs in drawing order,
 * from the inner tip out to the hook, each as {cx, cy, r, a0, a1} with a0 < a1. */
export function coil(S, p, n) {
	const aJ = S.aA - S.sweep;
	const u = [Math.cos(rad(aJ)), Math.sin(rad(aJ))];
	const arcs = [];
	let from = [S.Cl[0] + S.Rh * u[0], S.Cl[1] + S.Rh * u[1]];
	for (let k = 1; k <= n; k++) {
		const r = S.Rh - (k * p) / 2;
		const sgn = k % 2 === 1 ? -1 : 1;
		const c = [from[0] + sgn * r * u[0], from[1] + sgn * r * u[1]];
		arcs.push({ cx: c[0], cy: c[1], r, a0: aJ - k * 180, a1: aJ - (k - 1) * 180 });
		from = [c[0] + r * Math.cos(rad(aJ - k * 180)), c[1] + r * Math.sin(rad(aJ - k * 180))];
	}
	return arcs.reverse();
}

/** Band with a coil: path data from the coil's inner tip, out through the hook and the diagonal,
 * round the right hook. */
export function springPath(fr, S, arcs, ext = 0) {
	const p = new Path(fr);
	arcs.forEach((a, i) => p.arc(a.cx, a.cy, a.r, a.a0, a.a1, i === 0));
	p.arc(S.Cl[0], S.Cl[1], S.Rh, S.aA - S.sweep, S.aA);
	p.L(S.B[0], S.B[1]);
	const aB = S.aA + 180;
	p.arc(S.Cr[0], S.Cr[1], S.Rh, aB, aB - S.sweep - deg(ext / S.Rh));
	return p.d;
}

export function coilOutline(arcs, w) {
	const pts = [];
	for (const a of arcs) {
		for (let t = 0; t <= 1.0001; t += 0.02) {
			const an = rad(a.a0 + t * (a.a1 - a.a0));
			pts.push([a.cx + (a.r + w / 2) * Math.cos(an), a.cy + (a.r + w / 2) * Math.sin(an)]);
		}
	}
	return pts;
}

export function bbox(pts) {
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
