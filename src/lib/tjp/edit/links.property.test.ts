// SPDX-License-Identifier: GPL-2.0-or-later
// Properties of the dependency and allocation intents on the golden plans and the T16 fixtures
// (phase-1.md 9.3, text only; links.engine.test.ts schedules the results): for random intents,
// - every change lies inside a declared target and the inverse restores the base byte for byte
//   (P1, P6);
// - the new text has no more error nodes than the old (P2);
// - the rebuilt index means what the intent asked (P3, links-testing.ts `meaningProblem`), and
//   the task and resource trees are unchanged;
// - refusals and no-ops change nothing (P5), and each intent type yields edits.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { syntaxIssues } from '../tree';
import { applyIntent } from './apply';
import {
	intentArb,
	LINK_TYPES,
	linkCorpora,
	meaningProblem,
	rebuilt,
	type LinkCorpus,
} from './links-testing';

const CORPUS: readonly LinkCorpus[] = linkCorpora();
const RUNS = Number(process.env['LINK_RUNS'] ?? 150);

function covered(targets: ReadonlyArray<{ from: number; to: number }>, from: number, to: number) {
	let pos = from;
	for (const t of [...targets].sort((a, b) => a.from - b.from)) {
		if (t.from <= pos && t.to >= pos) pos = Math.max(pos, t.to);
	}
	return pos >= to;
}

function errors(c: LinkCorpus): number {
	let n = 0;
	for (const f of c.snap.files.values()) n += syntaxIssues(f.tree, f.text).length;
	return n;
}

describe('dependency and allocation intents on the corpora', () => {
	for (const type of LINK_TYPES) {
		it(`${type}: local, invertible, still parses, means what it says`, () => {
			const counts = { edit: 0, noop: 0, refused: 0 };
			const reasons = new Map<string, number>();
			const arb = fc
				.integer({ min: 0, max: CORPUS.length - 1 })
				.chain((i) => fc.tuple(fc.constant(i), intentArb(CORPUS[i] as LinkCorpus, type)));
			fc.assert(
				fc.property(arb, ([i, intent]) => {
					const c = CORPUS[i] as LinkCorpus;
					const r = applyIntent(c.snap, c.index, intent);
					counts[r.status]++;
					const why = r.status === 'edit' ? 'edit' : r.reason;
					reasons.set(why, (reasons.get(why) ?? 0) + 1);
					if (r.status !== 'edit') return;
					for (const [p, cs] of Object.entries(r.edit.changes)) {
						const base = c.snap.files.get(p)?.text;
						const inv = r.edit.inverse[p];
						expect(base && inv?.apply(cs.apply(base)).toString()).toBe(base?.toString());
						// Adjacent changes merge into one range, so it must lie in the union of targets.
						const targets = r.edit.targets[p] ?? [];
						cs.iterChangedRanges((from, to) => {
							expect(covered(targets, from, to)).toBe(true);
						});
					}
					const after = rebuilt(c.snap, r);
					expect(errors(after)).toBeLessThanOrEqual(errors(c));
					expect(meaningProblem(c, after, intent)).toBeNull();
				}),
				{ numRuns: RUNS },
			);
			console.log(`${type}: ${JSON.stringify(Object.fromEntries(reasons))}`);
			expect(counts.edit).toBeGreaterThanOrEqual(5);
		}, 120_000);
	}
});
