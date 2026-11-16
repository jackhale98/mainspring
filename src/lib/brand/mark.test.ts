// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	APP_ICON,
	APP_ICON_MASKABLE,
	FAVICON_DARK,
	FAVICON_LIGHT,
	MARK_ASPECT,
	VIEWBOX_H,
	VIEWBOX_W,
	markForm,
	markGeometry,
	markReach,
	markSpec,
	markSvg,
	type MarkForm,
} from './mark';

const FORMS: MarkForm[] = ['full', 'small', 'tiny'];

/** Every number in a path's data, in pairs, with arcs' radii and flags skipped. */
function points(d: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (const m of d.matchAll(/([MLA])([^MLA]*)/g)) {
		const n = m[2]!
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (m[1] === 'A') out.push([n[5]!, n[6]!]);
		else out.push([n[0]!, n[1]!]);
	}
	return out;
}

describe('brand mark', () => {
	it('picks the form by the height it is drawn at', () => {
		expect(markForm(14)).toBe('tiny');
		expect(markForm(16)).toBe('tiny');
		expect(markForm(17)).toBe('small');
		expect(markForm(32)).toBe('small');
		expect(markForm(33)).toBe('full');
		expect(markForm(44)).toBe('full');
	});

	it('draws the brass arcs only in the full form, and thickens the band as it shrinks', () => {
		const [full, small, tiny] = FORMS.map((f) => markGeometry(f));
		expect(full!.arcs).toHaveLength(2);
		expect(small!.arcs).toHaveLength(0);
		expect(tiny!.arcs).toHaveLength(0);
		expect(full!.bandWidth).toBeLessThan(small!.bandWidth);
		expect(small!.bandWidth).toBeLessThanOrEqual(tiny!.bandWidth + 0.5);
	});

	it('drops the coil innermost half turn at each smaller form', () => {
		const arcCount = (f: MarkForm): number => (markGeometry(f).band.match(/A/g) ?? []).length;
		// two hooks, then two arcs (split in two) per half turn... counted as path arcs
		expect(arcCount('full')).toBeGreaterThan(arcCount('small'));
		expect(arcCount('small')).toBeGreaterThan(arcCount('tiny'));
	});

	it('winds the coil at a pitch of one band plus one gap', () => {
		for (const f of FORMS) {
			const { w, gap, pitch } = markSpec(f);
			expect(pitch).toBe(w + gap);
		}
		// radii of the band's arcs: the hooks, then each coil half turn a half pitch smaller
		for (const f of FORMS) {
			const { pitch } = markSpec(f);
			const radii = [...markGeometry(f).band.matchAll(/A([\d.]+) /g)].map((m) => Number(m[1]));
			expect(radii.length).toBeGreaterThan(2);
			const scale = markGeometry(f).bandWidth / markSpec(f).w;
			// consecutive distinct radii after the hooks differ by half a pitch
			const distinct = radii.filter((r, i) => i === 0 || Math.abs(r - radii[i - 1]!) > 0.01);
			const coil = distinct.slice(1);
			for (let i = 1; i < coil.length; i++) {
				expect(coil[i - 1]! - coil[i]!).toBeCloseTo((pitch / 2) * scale, 1);
			}
		}
	});

	it('keeps every form inside the viewBox with a margin, at the slot aspect', () => {
		expect(VIEWBOX_W / VIEWBOX_H).toBeCloseTo(MARK_ASPECT, 2);
		expect(MARK_ASPECT * 26).toBeCloseTo(35, 0);
		for (const f of FORMS) {
			const g = markGeometry(f);
			const half = g.bandWidth / 2;
			for (const [x, y] of points(g.band)) {
				expect(x - half, f).toBeGreaterThanOrEqual(-0.5);
				expect(x + half, f).toBeLessThanOrEqual(VIEWBOX_W + 0.5);
				expect(y - half, f).toBeGreaterThanOrEqual(-0.5);
				expect(y + half, f).toBeLessThanOrEqual(VIEWBOX_H + 0.5);
			}
		}
	});

	it('is one source for the page and the icons: no masks, clips, filters or gradients', () => {
		for (const f of FORMS) {
			const svg = markSvg(f, FAVICON_LIGHT, FAVICON_DARK);
			for (const banned of ['<mask', '<clipPath', '<filter', 'Gradient', '<image', 'href']) {
				expect(svg, `${f} ${banned}`).not.toContain(banned);
			}
		}
	});

	it('keeps the maskable icon inside the 80% safe circle', () => {
		for (const tile of [APP_ICON_MASKABLE]) {
			expect(markReach('full') * tile.scale).toBeLessThanOrEqual(VIEWBOX_W * 0.4);
		}
		expect(APP_ICON.scale).toBeGreaterThan(APP_ICON_MASKABLE.scale);
	});

	it('keeps public/favicon.svg in step with the geometry (npm run gen:favicon)', () => {
		const onDisk = readFileSync(new URL('../../../public/favicon.svg', import.meta.url), 'utf8');
		expect(onDisk).toBe(markSvg('tiny', FAVICON_LIGHT, FAVICON_DARK));
		expect(onDisk).toContain('prefers-color-scheme:dark');
	});

	it('matches the mark tokens in both themes', () => {
		const read = (file: string): string =>
			readFileSync(new URL(`../../styles/${file}`, import.meta.url), 'utf8');
		const token = (css: string, name: string): string => {
			const m = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(css);
			if (!m) throw new Error(`no token ${name}`);
			const v = m[1]!.trim();
			const ref = /^var\(--color-([a-z-]+)\)$/.exec(v);
			return ref ? token(css, ref[1]!) : v;
		};
		for (const [file, c] of [
			['theme-light.css', FAVICON_LIGHT],
			['theme-dark.css', FAVICON_DARK],
		] as const) {
			const css = read(file);
			expect(token(css, 'mark-band')).toBe(c.band);
			expect(token(css, 'mark-arc')).toBe(c.arc);
		}
		// the light arcs are the brass-deep token, the dark arcs the brass token
		expect(token(read('theme-light.css'), 'brass-deep')).toBe(FAVICON_LIGHT.arc);
		expect(token(read('theme-dark.css'), 'brass')).toBe(FAVICON_DARK.arc);
	});
});
