// SPDX-License-Identifier: GPL-2.0-or-later
// Statements typed into one block by both sides (typed-testing.ts; review round 3, N1 to N4), in
// every layout plans use: the merge decides from the keyword table, whatever the layout.
// - two values of one single-valued attribute conflict, unless they are equal (then one copy);
// - two `workinghours` for the same weekday conflict; for different weekdays both stay;
// - `purge allocate` against a new allocation conflicts;
// - anything else merges cleanly with both statements, and swapping the sides changes nothing
//   but the order.
// And for the block kinds of review round 4 (blocks-testing.ts; types.ts G1, G2): a declaration
// given a body by both sides follows the same rules; a `shift` or `account` body both changed is a
// conflict; at the top level a macro defined twice or `copyright` said twice is a conflict; a task
// and its supplement in one file are one block. FC_SEED fixes the seed; MERGE_RUNS sizes the runs.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeWorkspace } from '../../sync/merge';
import { parseTjp, syntaxIssues, textOf } from '../document';
import { contextOf, filesOf } from './testing';
import { typedSides, type TypedSides } from './typed-testing';
import { blockSides } from './blocks-testing';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['MERGE_RUNS'] ?? 60) * 2;

const keyword = (s: string): string => s.split(' ')[0] ?? '';

function expected(t: TypedSides): 'clean' | 'conflict' {
	const [[x = '', ...more], [y = '']] = t.typed;
	if (x === 'purge allocate' || more.length > 0) return 'conflict';
	if (keyword(x) !== keyword(y) || x === y) return 'clean';
	if (keyword(x) === 'workinghours')
		return x.split(' ')[1] === y.split(' ')[1] ? 'conflict' : 'clean';
	return 'conflict';
}

const count = (text: string, s: string): number => text.split(s).length - 1;

describe(
	'statements typed into one block by both sides (review round 3)',
	{ timeout: 300_000 },
	() => {
		it('merge as the keyword table says, in every layout', () => {
			const seen: Record<string, number> = {};
			fc.assert(
				fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
					const t = seed % 2 === 0 ? typedSides(seed) : blockSides(seed);
					fc.pre(t !== null);
					if (!t) return;
					const { p } = t;
					const file = Object.keys(p.files).find((f) => p.files[f] !== t.a.files[f]) ?? p.entry;
					const tops = contextOf(p.entry, p.files).includes.tops;
					const top = tops.get(file) ?? 'global';
					const before = syntaxIssues(
						parseTjp(p.files[file] ?? '', { top }),
						textOf(p.files[file] ?? ''),
					);
					fc.pre(before.length === 0);
					const run = (o: Record<string, string>, th: Record<string, string>) =>
						mergeWorkspace(filesOf(p.files), filesOf(o), filesOf(th), contextOf(p.entry, o));
					const ab = run(t.a.files, t.b.files);
					const ba = run(t.b.files, t.a.files);
					const want = 'expect' in t ? t.expect : expected(t);
					const why = `${p.name}: ${t.what}`;
					seen[`${t.layout}, ${want}`] = (seen[`${t.layout}, ${want}`] ?? 0) + 1;
					const got = ab.conflicts.length > 0 ? 'conflict' : 'clean';
					if (want !== 'either') expect(got, why).toBe(want);
					expect(ba.conflicts.length > 0, why).toBe(got === 'conflict');
					if (got === 'conflict') return;
					const text = ab.files.get(file) ?? '';
					for (const s of [...t.typed[0], ...t.typed[1]]) {
						expect(count(text, s), why).toBe(
							Math.max(count(t.a.files[file] ?? '', s), count(t.b.files[file] ?? '', s)),
						);
					}
					expect(syntaxIssues(parseTjp(text, { top }), textOf(text)), why).toEqual([]);
				}),
				{ ...SEED, numRuns: RUNS },
			);
			console.info(`typed into one block: ${JSON.stringify(seen)}`);
		});
	},
);
