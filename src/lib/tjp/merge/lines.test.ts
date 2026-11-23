// SPDX-License-Identifier: GPL-2.0-or-later
// Lines and the three-way line regions (lines.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diff3Regions, lineStarts, merge3, sameRange, splitLines, trueConflict } from './lines';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

describe('splitLines', () => {
	it('splits on \\n only, keeping \\r, a BOM and the last line without one', () => {
		expect(splitLines('﻿a\r\nb\rc\n\nd')).toEqual(['﻿a\r\n', 'b\rc\n', '\n', 'd']);
		expect(splitLines('')).toEqual([]);
		expect(lineStarts(['ab\n', 'c'])).toEqual([0, 3, 4]);
	});

	it('joins back to the text', () => {
		fc.assert(
			fc.property(fc.string({ unit: fc.constantFrom('a', '\n', '\r', '�', ' ') }), (t) => {
				expect(splitLines(t).join('')).toBe(t);
			}),
			SEED,
		);
	});
});

/** The merged lines of the regions, ours in a conflict; and whether there was one. */
function apply(o: string[], a: string[], b: string[]): { out: string[]; conflict: boolean } {
	const out: string[] = [];
	let conflict = false;
	for (const r of diff3Regions(o, a, b)) {
		const [side, ix] = r.kind === 'same' ? [o, r.o] : r.kind === 'theirs' ? [b, r.b] : [a, r.a];
		if (trueConflict(r, a, b)) conflict = true;
		out.push(...side.slice(ix[0], ix[1]));
	}
	return { out, conflict };
}

describe('diff3Regions', () => {
	it('partitions every side, each region with its range on every side', () => {
		const o = ['a', 'b', 'c', 'd'];
		const a = ['a', 'B', 'c', 'd'];
		const b = ['a', 'b', 'c', 'D', 'e'];
		const rs = diff3Regions(o, a, b);
		expect(rs.map((r) => [r.kind, r.o, r.a, r.b])).toEqual([
			['same', [0, 1], [0, 1], [0, 1]],
			['ours', [1, 2], [1, 2], [1, 2]],
			['same', [2, 3], [2, 3], [2, 3]],
			['theirs', [3, 4], [3, 4], [3, 5]],
		]);
		expect(apply(o, a, b)).toEqual({ out: ['a', 'B', 'c', 'D', 'e'], conflict: false });
	});

	it('makes changes on adjacent lines one conflict (refinement splits them)', () => {
		const rs = diff3Regions(['a', 'b', 'c'], ['A', 'b', 'c'], ['a', 'B', 'c']);
		expect(rs.map((r) => r.kind)).toEqual(['conflict', 'same']);
	});

	it('reports a false conflict (both made the same change) as a conflict with equal sides', () => {
		const [r] = diff3Regions(['a'], ['b'], ['b']);
		expect(r?.kind).toBe('conflict');
		expect(r && trueConflict(r, ['b'], ['b'])).toBe(false);
		expect(sameRange(['x', 'b'], [1, 2], ['b'], [0, 1])).toBe(true);
	});

	it('keeps the laws on random line lists, also large ones split at anchors', () => {
		const line = fc.constantFrom('}', '  effort 1d', 'task a', 'task b', '', 'x', 'y', 'z');
		const lines = fc.array(line, { maxLength: 120 });
		fc.assert(
			fc.property(lines, lines, (o, x) => {
				expect(apply(o, x, o)).toEqual({ out: x, conflict: false });
				expect(apply(o, o, x)).toEqual({ out: x, conflict: false });
				expect(apply(o, x, x)).toEqual({ out: x, conflict: false });
			}),
			{ ...SEED, numRuns: 200 },
		);
	});

	it('merges large files with many repeated lines quickly', () => {
		const base = Array.from({ length: 6000 }, (_, i) => (i % 3 === 2 ? '}' : `task t${i} {`));
		const a = [...base];
		const b = [...base];
		for (let i = 10; i < 6000; i += 300) a[i] = `${a[i]} # a`;
		for (let i = 160; i < 6000; i += 300) b[i] = `${b[i]} # b`;
		const t0 = performance.now();
		const { conflict, out } = apply(base, a, b);
		expect(conflict).toBe(false);
		expect(out.filter((l) => l.includes('#'))).toHaveLength(40);
		expect(performance.now() - t0).toBeLessThan(500);
	});
});

describe('merge3', () => {
	it('takes the one side that changed, equal changes, or nothing', () => {
		expect(merge3('o', 'a', 'o')).toBe('a');
		expect(merge3('o', 'o', 'b')).toBe('b');
		expect(merge3('o', 'x', 'x')).toBe('x');
		expect(merge3('o', 'a', 'b')).toBeNull();
	});
});
