// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	ARC_GAP_DEG,
	ARC_SPANS_DEG,
	FAVICON_DARK,
	FAVICON_LIGHT,
	arcAngles,
	markForm,
	markGeometry,
	markSvg,
} from './mark';

describe('brand mark', () => {
	it('spaces the three task arcs at equal gaps that close the circle', () => {
		const angles = arcAngles();
		expect(angles).toHaveLength(3);
		const spans = ARC_SPANS_DEG.reduce((a, b) => a + b, 0);
		expect(spans + 3 * ARC_GAP_DEG).toBe(360);
		for (let i = 0; i < 3; i++) {
			const end = angles[i]![1];
			const nextStart = i === 2 ? angles[0]![0] + 360 : angles[i + 1]![0];
			expect(nextStart - end).toBe(ARC_GAP_DEG);
		}
	});

	it('uses the small form at 32 px and below: the mainspring coil, no fine parts', () => {
		expect(markForm(16)).toBe('small');
		expect(markForm(32)).toBe('small');
		expect(markForm(33)).toBe('full');
		const small = markGeometry('small');
		const full = markGeometry('full');
		expect(small.innerRing).toBeNull();
		expect(small.hairspring).toBeNull();
		expect(small.coil).not.toBeNull();
		expect(full.coil).toBeNull();
		expect(full.hairspring).not.toBeNull();

		expect(full.arcWidth).toBeLessThan(small.arcWidth);
	});

	it('gives every gradient stop class in the standalone SVG a colour rule', () => {
		const svg = markSvg('small', FAVICON_LIGHT, FAVICON_DARK);
		const used = new Set([...svg.matchAll(/<stop class="(\w+)"/g)].map((m) => m[1]!));
		expect(used.size).toBeGreaterThan(0);
		for (const cls of used) expect(svg, cls).toContain(`.${cls}{stop-color:`);
	});

	it('keeps public/favicon.svg in step with the geometry (npm run gen:favicon)', () => {
		const onDisk = readFileSync(new URL('../../../public/favicon.svg', import.meta.url), 'utf8');
		expect(onDisk).toBe(markSvg('small', FAVICON_LIGHT, FAVICON_DARK));
	});

	it('matches the mark tokens in both themes', () => {
		const tokens = (file: string): Record<string, string> => {
			const css = readFileSync(new URL(`../../styles/${file}`, import.meta.url), 'utf8');
			const out: Record<string, string> = {};
			for (const m of css.matchAll(/--color-mark-([a-z-]+):\s*(#[0-9a-f]{6})/g)) out[m[1]!] = m[2]!;
			return out;
		};
		for (const [file, c] of [
			['theme-light.css', FAVICON_LIGHT],
			['theme-dark.css', FAVICON_DARK],
		] as const) {
			expect(tokens(file)).toEqual({
				'brass-hi': c.brassHi,
				brass: c.brass,
				'brass-lo': c.brassLo,
				'ruby-hi': c.rubyHi,
				ruby: c.ruby,
				'ruby-lo': c.rubyLo,
				'steel-hi': c.steelHi,
				steel: c.steel,
				'steel-lo': c.steelLo,
				glint: '#ffffff',
			});
		}
	});
});
