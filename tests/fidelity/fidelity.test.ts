// SPDX-License-Identifier: GPL-2.0-or-later
// Patch fidelity, text-only properties (phase-1.md 9.3, gate criterion 2): P1 locality, P2 still
// parses, P3 semantics, P5 refusals and P6 inverse, for random plans and for golden plans, one
// intent each. They need no engine, so they also run in `npm run test:unit`. P4 is in
// schedule.property.test.ts. Failing seeds go to regressions.json and replay on every run.
import { afterAll, describe, expect, it } from 'vitest';
import { CONFIG, plannedCases, type PlannedCase } from './config';
import { CORPUS } from './cases';
import { ENFORCED, PENDING } from './families';
import { runCase, type Outcome } from './harness';
import { buildCase, describeFailure, guarded, REGRESSIONS, regressionProblem } from './shared';
import { deliberateCounts, percentile, tally, writePart, type TextPart } from './stats';

const outcomes: Outcome[] = [];
const failures: string[] = [];
const times: number[] = [];
let replayed = 0;
const started = performance.now();

/** A run of thousands of cases takes minutes; the suites set their own limit. */
const LONG = 3_600_000;

/** Builds and runs one case; a throw anywhere is a failure with its replay line. */
function run(p: PlannedCase): void {
	const r = guarded(p, () => {
		const c = buildCase(p);
		return { c, o: runCase(c) };
	});
	if ('failure' in r) return void failures.push(r.failure);
	outcomes.push(r.value.o);
	times.push(r.value.o.ms);
	if (r.value.o.failures.length > 0) failures.push(describeFailure(r.value.c, r.value.o));
}

const planned = plannedCases('all');

describe('patch fidelity (text only)', () => {
	it(
		'replays the recorded regressions',
		() => {
			const bad: string[] = [];
			for (const r of REGRESSIONS) {
				const g = guarded(r, () => {
					const c = buildCase(r);
					return { c, o: runCase(c) };
				});
				replayed++;
				if ('failure' in g) bad.push(g.failure);
				else {
					const wrong = regressionProblem(r, g.value.c, g.value.o);
					const failures = wrong ? [wrong, ...g.value.o.failures] : g.value.o.failures;
					if (failures.length > 0) bad.push(describeFailure(g.value.c, g.value.o, failures));
				}
			}
			expect(bad.join('\n')).toBe('');
		},
		LONG,
	);

	it(
		`generated plans: ${CONFIG.runs} cases`,
		() => {
			for (const p of planned.filter((x) => x.source === 'generated')) run(p);
			expect(failures.join('\n')).toBe('');
		},
		LONG,
	);

	it(
		`corpus plans: ${CONFIG.corpusRuns} cases`,
		() => {
			const before = failures.length;
			for (const p of planned.filter((x) => x.source === 'corpus')) run(p);
			expect(failures.slice(before).join('\n')).toBe('');
		},
		LONG,
	);

	it('enough intents aimed at text-only text were refused, as text-only and as macro-in-body', () => {
		const aimed = outcomes.filter((o) => o.deliberate !== null);
		// Like the edit counts, only a run big enough to cover them: 30 aimed cases or more.
		if (CONFIG.only || aimed.length < 30) return;
		const by = deliberateCounts(outcomes);
		const accepted = by['accepted'] ?? 0;
		expect(accepted, 'an intent aimed at text-only text was not refused').toBe(0);
		expect(by['text-only'] ?? 0, 'refused as text-only').toBeGreaterThanOrEqual(10);
		expect(by['macro-in-body'] ?? 0, 'refused as macro-in-body').toBeGreaterThanOrEqual(8);
	});

	it('every enforced intent type produced at least 5 edits', () => {
		const stats = tally(outcomes, ENFORCED);
		// Too few cases (a replay, a debugging run, a small shard) cannot cover every type; the merged
		// report of the shards is checked in CI (scripts/ci/fidelity-merge.mjs).
		if (CONFIG.only || outcomes.length < 8 * ENFORCED.length) return;
		const short = stats
			.filter((s) => s.edits < 5)
			.map((s) => `${s.type}: ${s.edits} edits in ${s.cases} cases`);
		expect(short).toEqual([]);
	});
});

afterAll(() => {
	if (outcomes.length === 0) return;
	const part: TextPart = {
		seed: CONFIG.seed,
		runs: CONFIG.runs,
		corpusRuns: CONFIG.corpusRuns,
		shard: `${CONFIG.shard.index}/${CONFIG.shard.count}`,
		corpusBasis: CORPUS.basis,
		corpusPlans: [
			...CORPUS.push,
			...(CONFIG.corpus === 'nightly' ? Object.keys(CORPUS.nightlyExtra) : []),
		],
		wallMs: performance.now() - started,
		p50Ms: percentile(times, 0.5),
		p95Ms: percentile(times, 0.95),
		maxMs: Math.max(0, ...times),
		perType: tally(outcomes, ENFORCED),
		deliberate: deliberateCounts(outcomes),
		pending: PENDING.map((p) => ({ type: p.type, task: p.task })),
		failures,
		regressions: { replayed },
	};
	writePart('text', part);
});
