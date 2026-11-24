// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { large, pairwise, SMALL, type Hunk } from './hunks';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

/** `o` with the hunks' ranges replaced by `x`'s. */
function patched(o: readonly string[], x: readonly string[], hs: readonly Hunk[]): string[] {
	const out: string[] = [];
	let at = 0;
	for (const h of hs) {
		expect(h.oS).toBeGreaterThanOrEqual(at);
		out.push(...o.slice(at, h.oS), ...x.slice(h.xS, h.xE));
		at = h.oE;
	}
	return [...out, ...o.slice(at)];
}

const lines = (min: number, max: number) =>
	fc.array(fc.constantFrom('}\n', '{\n', 'a\n', 'b\n'), { minLength: min, maxLength: max });

describe('two-way hunks', () => {
	it('pairwise and large (Myers beyond SMALL cells) both turn o into x', () => {
		fc.assert(
			fc.property(lines(0, 120), lines(0, 120), (o, x) => {
				const p: Hunk[] = [];
				pairwise(o, x, [0, o.length, 0, x.length], true, p);
				expect(patched(o, x, p)).toEqual(x);
				expect(patched(o, x, large(o, x, [0, o.length, 0, x.length], true))).toEqual(x);
			}),
			{ ...SEED, numRuns: 200 },
		);
	});

	it('Myers finds the few edits in thousands of repeated lines', () => {
		const o = Array.from({ length: 3000 }, (_, i) => (i % 2 ? '}\n' : '{\n'));
		const x = [...o.slice(0, 1500), 'new\n', ...o.slice(1500, 2999)];
		expect(o.length * x.length).toBeGreaterThan(SMALL);
		const t0 = performance.now();
		const hs = large(o, x, [0, o.length, 0, x.length], true);
		expect(performance.now() - t0).toBeLessThan(300);
		expect(patched(o, x, hs)).toEqual(x);
		expect(hs.reduce((n, h) => n + (h.oE - h.oS) + (h.xE - h.xS), 0)).toBeLessThanOrEqual(2);
	});
});
