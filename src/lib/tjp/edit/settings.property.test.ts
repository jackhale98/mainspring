// SPDX-License-Identifier: GPL-2.0-or-later
// Properties of the resource, project, working-hours and leave intents on the golden plans and
// the T16 fixtures (phase-1.md 9.3, text only; settings.engine.test.ts schedules the results):
// for random intents,
// - every change lies inside a declared target and the inverse restores the base byte for byte
//   (P1, P6);
// - the new text has no more error nodes than the old (P2);
// - the rebuilt index means what the intent asked (P3, settings-testing.ts `settingProblem`),
//   and the task tree is unchanged (and the resource tree, except for the tree intents);
// - each intent type yields edits.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { syntaxIssues } from '../tree';
import { applyIntent } from './apply';
import { linkCorpora, rebuilt, type LinkCorpus } from './links-testing';
import { SETTING_TYPES, settingArb, settingProblem, usable } from './settings-testing';

const CORPUS: readonly LinkCorpus[] = linkCorpora();
const RUNS = Number(process.env['SETTING_RUNS'] ?? 120);
const SEED = Number(process.env['SETTING_SEED'] ?? 1112);

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

describe('resource, project and calendar intents on the corpora', () => {
	for (const type of SETTING_TYPES) {
		it(`${type}: local, invertible, still parses, means what it says`, () => {
			const counts = { edit: 0, noop: 0, refused: 0 };
			const reasons = new Map<string, number>();
			const pool = CORPUS.map((_, i) => i).filter((i) => usable(CORPUS[i] as LinkCorpus, type));
			const arb = fc
				.constantFrom(...pool)
				.chain((i) => fc.tuple(fc.constant(i), settingArb(CORPUS[i] as LinkCorpus, type)));
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
						const targets = r.edit.targets[p] ?? [];
						cs.iterChangedRanges((from, to) => {
							expect(covered(targets, from, to)).toBe(true);
						});
					}
					const after = rebuilt(c.snap, r);
					expect(errors(after)).toBeLessThanOrEqual(errors(c));
					expect(
						settingProblem(c, after, intent),
						`${c.name} ${JSON.stringify(intent)}`,
					).toBeNull();
				}),
				{ numRuns: RUNS, seed: SEED },
			);
			console.log(`${type}: ${JSON.stringify(Object.fromEntries(reasons))}`);
			expect(counts.edit).toBeGreaterThanOrEqual(5);
		}, 180_000);
	}
});
