// SPDX-License-Identifier: GPL-2.0-or-later
// Rebalance drops on the wasm engine (phase-3.md 6.6, 13.1; ADR-0014 #5), booted in Node by
// engine/golden/run-wasm.mjs. Each planned intent (or, for a week move, the `move` action planned
// with `planAction`) is applied to a workload fixture (tests/fixtures/workload) or to fedora-res,
// and the edited plan is scheduled. It schedules with no new error, and the load model of the new
// result (`buildLoad`) shows the move: the task is booked to the target person, or in the target
// week, and no longer where it was. Then random drops keep the plan scheduling with no new error.
// Needs the built engine (npm run build:engine); skipped without it unless TJP_EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import type { NodeEngine } from '../../engine/runtime';
import { checkAction } from '../gantt/intents';
import { goldenResult } from '../gantt/intents-testing';
import { golden } from '../tjp/index/testing';
import { bucketAxis } from './axis';
import { planRebalance, type RebalanceAction } from './rebalance';
import { checkRebalance } from './rebalance-check';
import {
	bookedTasks,
	cell,
	filesAfter,
	loadOf,
	planFrom,
	workloadPlan,
	ZONES,
	type Plan,
} from './rebalance-testing';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['REBALANCE_ENGINE_RUNS'] ?? 16);
const WEEK = 7 * 1440;

let engine: NodeEngine;
let revision = 100;

function schedule(p: Plan, files: Record<string, string>): ScheduleResult {
	return engine.schedule({ files, entry: p.snap.entry, revision: ++revision, options: {} });
}

const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();

/** The drop applied and scheduled: the edited plan, its result, and the load before and after. */
function apply(p: Plan, a: RebalanceAction) {
	const out = checkRebalance(a, p.at(), p.snap);
	if (out.status !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(out)}`);
	const files = filesAfter(p.snap, out.edit.changes);
	const result = schedule(p, files);
	expect(result.ok).toBe(true);
	expect(errorIds(result)).toEqual(errorIds(p.result));
	const next = planFrom(files, p.snap.entry, result);
	return {
		out,
		next,
		before: loadOf(p.result, p.index),
		after: loadOf(result, next.index),
	};
}

/** A fixture scheduled on this engine (for variants of a fixture's text). */
function fresh(files: Record<string, string>, entry = 'plan.tjp'): Plan {
	const r = engine.schedule({ files, entry, revision: ++revision, options: {} });
	expect(r.ok).toBe(true);
	return planFrom(files, entry, r);
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))(
	'rebalance on the engine',
	{ timeout: 120_000 },
	() => {
		beforeAll(async () => {
			engine = await bootNodeEngine({ log: () => {} });
		}, 60_000);

		it('W1: the task is booked to the other person, in the same week', () => {
			const p = workloadPlan('groups');
			const at = WEEK + 9 * 60; // the week of 2026-01-12, where Lead works on t4
			const { before, after } = apply(p, {
				type: 'reassign',
				task: 'work.t4',
				from: 'lead',
				to: 'm1',
			});
			expect(bookedTasks(before, 'lead', at)).toEqual(['work.t4']);
			expect(bookedTasks(before, 'm1', at)).toEqual([]);
			expect(bookedTasks(after, 'm1', at)).toEqual(['work.t4']);
			expect(cell(after, 'lead', at)).toBe(0);
			expect(cell(after, 'm1', at)).toBe(cell(before, 'lead', at));
			// The group rows are the sums: Team's week is unchanged.
			expect(cell(after, 'team', at)).toBe(cell(before, 'team', at));
		});

		it('W2: an ASAP task is booked in the target week (move preference start)', () => {
			const p = workloadPlan('groups');
			const { before, after, out } = apply(p, {
				type: 'shift',
				task: 'work.t1',
				fromBucket: 0,
				toBucket: WEEK,
			});
			expect(out.intent).toMatchObject({ type: 'setAttr', attr: 'start', value: '2026-01-12' });
			expect(bookedTasks(before, 'm1', 540)).toEqual(['work.t1']);
			expect(bookedTasks(after, 'm1', 540)).toEqual([]);
			expect(cell(after, 'm1', WEEK + 540)).toBe(cell(before, 'm1', 540));
		});

		it('W2: an ALAP task moves by its end, into the target week', () => {
			const base = workloadPlan('groups');
			const text = base.text('plan.tjp').replace('start 2026-01-12\n', 'end 2026-01-17\n');
			const p = fresh({ 'plan.tjp': text });
			const t4 = p.result.tasks.find((t) => t.id === 'work.t4')?.scenarios['plan'];
			expect(t4?.direction).toBe('alap');
			const { after, out } = apply(p, {
				type: 'shift',
				task: 'work.t4',
				fromBucket: WEEK,
				toBucket: 2 * WEEK,
			});
			expect(out.intent).toMatchObject({ type: 'setAttr', attr: 'end', value: '2026-01-24' });
			expect(bookedTasks(after, 'lead', WEEK + 540)).toEqual([]);
			expect(bookedTasks(after, 'lead', 2 * WEEK + 540)).toEqual(['work.t4']);
			// For a gap preference too, an ALAP task writes its end.
			expect(
				planRebalance(
					{ type: 'shift', task: 'work.t4', fromBucket: WEEK, toBucket: 2 * WEEK },
					p.at({ move: { kind: 'gap' } }),
				),
			).toMatchObject({ status: 'action' });
		});

		it('W2: across the spring DST change, the work lands in the next local week', () => {
			const p = workloadPlan('dst-weeks');
			const weeks = bucketAxis(p.result.project!, ZONES, 'week').bounds;
			const { before, after } = apply(p, {
				type: 'shift',
				task: 'spring',
				fromBucket: weeks[0] as number,
				toBucket: weeks[1] as number,
			});
			const first = (weeks[0] as number) + 3 * 1440;
			expect(cell(before, 'ada', first)).toBeGreaterThan(0);
			expect(cell(after, 'ada', first)).toBe(0);
			expect(cell(after, 'ada', (weeks[1] as number) + 3 * 1440)).toBe(5 * 8 * 60);
		});

		it('refuses work booked through a group and alternatives, so nothing is scheduled', () => {
			const g = workloadPlan('group-allocation');
			expect(
				checkRebalance(
					{ type: 'reassign', task: 'work.triage', from: 'm1', to: 'solo' },
					g.at(),
					g.snap,
				),
			).toMatchObject({ status: 'refused', reason: 'via-group' });
			const alt = workloadPlan('alternatives');
			expect(
				checkRebalance(
					{ type: 'reassign', task: 'work.fix', from: 'bo', to: 'cy' },
					alt.at(),
					alt.snap,
				),
			).toMatchObject({ status: 'refused', reason: 'unsupported-form' });
		});

		it('fedora-res: a task moves from Desktop 03 to Desktop 04', () => {
			const ws = golden('fedora-res').snapshot();
			const files: Record<string, string> = {};
			for (const [f, file] of ws.files) files[f] = file.text.toString();
			const p = planFrom(files, ws.entry, goldenResult('fedora-res'));
			const task = desk03Task(p);
			const before = loadOf(p.result, p.index);
			const { after, next } = apply(p, { type: 'reassign', task, from: 'desk03', to: 'desk04' });
			const on = (r: ScheduleResult, who: string) =>
				r.bookings.some((b) => b.task === task && b.resource === who && b.intervals.length > 0);
			expect(on(p.result, 'desk03')).toBe(true);
			expect(on(next.result, 'desk03')).toBe(false);
			expect(on(next.result, 'desk04')).toBe(true);
			// In every week the task had on Desktop 03, it is gone from there in the load model (the
			// engine may give Desktop 03 other work in its place: it levels as it schedules).
			const weeks = new Set<number>();
			for (const bk of p.result.bookings) {
				if (bk.task !== task || bk.resource !== 'desk03') continue;
				for (const [s] of bk.intervals) weeks.add(before.axis.indexOf(s));
			}
			expect(weeks.size).toBeGreaterThan(0);
			for (const col of weeks) {
				const at = before.axis.bounds[col] as number;
				const mid = Math.max(0, at) + 1;
				expect(bookedTasks(before, 'desk03', mid)).toContain(task);
				expect(bookedTasks(after, 'desk03', mid)).not.toContain(task);
			}
			expect(bookedMinutes(next.result, task, 'desk04')).toBeGreaterThan(0);
		});

		it('random drops keep the plan scheduling with no new error (property)', () => {
			const plans = ['groups', 'held-effort', 'unmet-length'].map(workloadPlan);
			let edits = 0;
			fc.assert(
				fc.property(
					fc.constantFrom(...plans),
					fc.nat(),
					fc.nat(),
					fc.nat(),
					fc.integer({ min: -2, max: 2 }),
					fc.boolean(),
					(p, ti, fi, ri, weeks, person) => {
						const tasks = [...p.index.tasks.keys()];
						const people = [...p.index.resources.keys()];
						const task = tasks[ti % tasks.length] as string;
						const a: RebalanceAction = person
							? {
									type: 'reassign',
									task,
									from: people[fi % people.length] as string,
									to: people[ri % people.length] as string,
								}
							: { type: 'shift', task, fromBucket: WEEK, toBucket: WEEK + weeks * WEEK };
						const out = checkRebalance(a, p.at(), p.snap);
						if (out.status !== 'edit') return true;
						edits++;
						const r = schedule(p, filesAfter(p.snap, out.edit.changes));
						return r.ok && errorIds(r).join() === errorIds(p.result).join();
					},
				),
				{ numRuns: RUNS, ...SEED },
			);
			expect(edits).toBeGreaterThan(0);
			// The Gantt's own check of the same move agrees with the planner's dry run.
			const p = plans[0] as Plan;
			const plan = planRebalance(
				{ type: 'shift', task: 'work.t2', fromBucket: 0, toBucket: WEEK },
				p.at(),
			);
			if (plan.status !== 'action') throw new Error('action');
			expect(checkAction(plan.action, p.at(), p.snap).status).toBe('edit');
		});
	},
);

/** A task booked to desk03 that its own text allocates to desk03 alone (`allocate desk03`). */
function desk03Task(p: Plan): string {
	for (const a of p.index.allocations) {
		if (a.resource !== 'desk03' || a.task === null) continue;
		const same = p.index.allocations.filter(
			(x) => x.statement.from === a.statement.from && x.statement.file === a.statement.file,
		);
		if (same.length !== 1) continue;
		if (bookedMinutes(p.result, a.task, 'desk03') > 0) return a.task;
	}
	throw new Error('fedora-res shape');
}

function bookedMinutes(r: ScheduleResult, task: string, who: string): number {
	let n = 0;
	for (const b of r.bookings) {
		if (b.task !== task || b.resource !== who) continue;
		for (const [s, e] of b.intervals) n += e - s;
	}
	return n;
}
