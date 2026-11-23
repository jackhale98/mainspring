// SPDX-License-Identifier: GPL-2.0-or-later
// Lines and the three-way line regions (lines.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diff3Merge } from 'node-diff3';
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
function apply(
	o: string[],
	a: string[],
	b: string[],
	limit?: number,
): { out: string[]; conflict: boolean } {
	const out: string[] = [];
	let conflict = false;
	for (const r of diff3Regions(o, a, b, limit)) {
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

/** An edit at base lines [from, to): its new lines, and the side(s) that make it. */
interface Op {
	readonly from: number;
	readonly to: number;
	readonly insert: readonly string[];
	readonly who: 'a' | 'b' | 'both';
}

const applyOps = (
	base: readonly string[],
	ops: readonly Op[],
	side: 'a' | 'b' | null,
): string[] => {
	const out = [...base];
	for (const op of [...ops].sort((x, y) => y.from - x.from)) {
		if (side === null || op.who === side || op.who === 'both') {
			out.splice(op.from, op.to - op.from, ...op.insert);
		}
	}
	return out;
};

/**
 * A base and edits at least two lines apart, as base-position operations; `repeated` draws base
 * lines with repeats (as a plan has `}` and blank lines), else every base line is unique.
 */
const caseArb = (repeated: boolean) =>
	fc
		.array(
			repeated
				? fc.oneof(
						fc.constantFrom('}', '{', '', '  effort 1d'),
						fc.integer({ min: 0, max: 40 }).map((n) => `u${n}`),
					)
				: fc.constant(''),
			{ minLength: 4, maxLength: repeated ? 50 : 120 },
		)
		.map((base) => (repeated ? base : base.map((_, i) => `line ${i}`)))
		.chain((base) =>
			fc
				.array(
					fc.record({
						at: fc.nat({ max: base.length }),
						len: fc.nat({ max: 3 }),
						n: fc.nat({ max: 3 }),
						who: fc.constantFrom<Op['who']>('a', 'b', 'both'),
					}),
					{ maxLength: 8 },
				)
				.map((raw) => {
					const ops: Op[] = [];
					let next = 0;
					let fresh = 0;
					for (const r of [...raw].sort((x, y) => x.at - y.at)) {
						const from = Math.max(r.at, next);
						const to = Math.min(base.length, from + r.len);
						if (from > base.length || (to === from && r.n === 0)) continue;
						const insert = Array.from({ length: r.n }, () => `new ${fresh++}`);
						ops.push({ from, to, insert, who: r.who });
						next = to + 2;
					}
					return { base, ops };
				}),
		);

const MODES = [
	['diffed whole', undefined],
	['split at anchors everywhere', 0],
] as const;

describe('diff3Regions against ground truth', () => {
	it('merges an edit both sides made alike once (review M1)', () => {
		const o = splitLines('}\ntask t21 {\n}\n}\n}\n');
		const a = splitLines('}\ntask t21 {\n}\n}\n');
		const b = splitLines('task t21 {\n}\n}\n');
		expect(apply(o, a, b)).toEqual({ out: b, conflict: false });
	});

	it.each(MODES)('merges unambiguous edits exactly, also a shared one once (%s)', (_, limit) => {
		fc.assert(
			fc.property(caseArb(false), ({ base, ops }) => {
				const expected = applyOps(base, ops, null);
				const mine = apply(base, applyOps(base, ops, 'a'), applyOps(base, ops, 'b'), limit);
				expect(mine).toEqual({ out: expected, conflict: false });
			}),
			{ ...SEED, numRuns: 1000 },
		);
	});

	it.each(MODES)(
		'among repeated lines, is clean and right wherever plain diff3Merge is (%s)',
		(_, limit) => {
			// With repeated lines a two-way diff may place an edit on other equal lines, so no line
			// merge can always give the edits' text; plain diff3Merge is the bar.
			let right = 0;
			fc.assert(
				fc.property(caseArb(true), ({ base, ops }) => {
					const a = applyOps(base, ops, 'a');
					const b = applyOps(base, ops, 'b');
					const expected = applyOps(base, ops, null);
					const mine = apply(base, a, b, limit);
					const plain = diff3Merge(a, base, b);
					const plainOut = plain.every((r) => r.ok) ? plain.flatMap((r) => r.ok ?? []) : null;
					if (limit === undefined && plainOut) {
						expect(mine).toEqual({ out: plainOut, conflict: false });
					}
					if (plainOut && JSON.stringify(plainOut) === JSON.stringify(expected)) {
						right++;
						expect(mine).toEqual({ out: expected, conflict: false });
					}
				}),
				{ ...SEED, numRuns: 2000 },
			);
			console.info(`repeated lines: plain diff3Merge and this merge right on ${right} of 2000`);
			expect(right).toBeGreaterThan(1000);
		},
	);
});
