// SPDX-License-Identifier: GPL-2.0-or-later
// Patch fidelity, text-only properties (phase-1.md 9.3, gate criterion 2): P1 locality, P2 still
// parses, P3 semantics, P5 refusals and P6 inverse, for random plans and for golden plans, one
// intent each. They need no engine, so they also run in `npm run test:unit`. P4 is in
// schedule.property.test.ts. Failing seeds go to regressions.json and replay on every run.
import { afterAll, describe, expect, it } from 'vitest';
import { CONFIG, plannedCases, type PlannedCase } from './config';
import { corpusPlans } from './cases';
import { ENFORCED, PENDING } from './families';
import { runCase, type Outcome } from './harness';
import { buildCase, describeFailure, REGRESSIONS } from './shared';
import { percentile, tally, writePart, type TextPart } from './stats';

const outcomes: Outcome[] = [];
const failures: string[] = [];
const times: number[] = [];
const known: TextPart['regressions']['known'] = [];
let replayed = 0;
const started = performance.now();

function run(p: PlannedCase): void {
	const c = buildCase(p);
	const o = runCase(c);
	outcomes.push(o);
	times.push(o.ms);
	if (o.failures.length > 0) failures.push(describeFailure(c, o));
}

/** A run of thousands of cases takes minutes; the suites set their own limit. */
const LONG = 3_600_000;

const planned = plannedCases('all');

describe('patch fidelity (text only)', () => {
	it(
		'replays the recorded regressions',
		() => {
			const bad: string[] = [];
			for (const r of REGRESSIONS) {
				const c = buildCase(r);
				const o = runCase(c);
				if (r.status === 'known-failure') {
					known.push({
						id: `${r.source}:${r.seed}:${r.type}`,
						reason: r.reason,
						stillFails: o.failures.length > 0,
					});
				} else {
					replayed++;
					if (o.failures.length > 0) bad.push(describeFailure(c, o));
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

	it('every enforced intent type produced at least 5 edits', () => {
		const stats = tally(outcomes, ENFORCED);
		// A replay of one case, or a debugging run, is too small to cover every type.
		if (CONFIG.only || CONFIG.runs < 100) return;
		const short = stats
			.filter((s) => s.edits < 5)
			.map((s) => `${s.type}: ${s.edits} edits in ${s.cases} cases`);
		expect(short).toEqual([]);
	});
});

afterAll(() => {
	if (outcomes.length === 0) return;
	const { plans, basis } = corpusPlans();
	const part: TextPart = {
		seed: CONFIG.seed,
		runs: CONFIG.runs,
		corpusRuns: CONFIG.corpusRuns,
		shard: `${CONFIG.shard.index}/${CONFIG.shard.count}`,
		corpusBasis: basis,
		corpusPlans: plans.map((p) => p.id),
		wallMs: performance.now() - started,
		p50Ms: percentile(times, 0.5),
		p95Ms: percentile(times, 0.95),
		maxMs: Math.max(0, ...times),
		perType: tally(outcomes, ENFORCED),
		pending: PENDING.map((p) => ({ type: p.type, task: p.task })),
		failures,
		regressions: { replayed, known },
	};
	writePart('text', part);
});
