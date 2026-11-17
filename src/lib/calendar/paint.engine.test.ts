// SPDX-License-Identifier: GPL-2.0-or-later
// Leave painting on the wasm engine (phase-3.md 6.6, 13.1; ADR-0014 #7), booted in Node by
// engine/golden/run-wasm.mjs. Each planned intent is applied to a workload fixture
// (tests/fixtures/workload) or to fedora-res and the edited plan is scheduled: it schedules with
// no new error, and the load model of the new result (`buildLoad`) shows the leave: the person's
// (or everyone's) available minutes in the painted days fall by their working time there and the
// leave minutes rise by as much, or the reverse for an erase. Then random strokes keep the plan
// scheduling with no new error. Needs the built engine (npm run build:engine); skipped without it
// unless TJP_EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import type { NodeEngine } from '../../engine/runtime';
import { goldenResult } from '../gantt/intents-testing';
import { applyIntent } from '../tjp/edit/apply';
import type { LeaveType } from '../tjp/edit/types';
import { golden } from '../tjp/index/testing';
import { bucketAxis } from '../workload/axis';
import {
	cell,
	filesAfter,
	loadOf,
	planFrom,
	workloadPlan,
	ZONES,
	type Plan,
} from '../workload/rebalance-testing';
import type { LoadModel } from '../workload/types';
import { planLeavePaint, type LeavePaint, type PaintScope } from './paint';
import { DAY, paint, person } from './paint-testing';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['PAINT_ENGINE_RUNS'] ?? 20);
const H8 = 8 * 60;

let engine: NodeEngine;
let revision = 200;

const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();

/** Schedules edited files of `p`; it must schedule with no new error. */
function schedule(p: Plan, files: Record<string, string>): ScheduleResult {
	const r = engine.schedule({ files, entry: p.snap.entry, revision: ++revision, options: {} });
	expect(r.ok).toBe(true);
	expect(errorIds(r)).toEqual(errorIds(p.result));
	return r;
}

/** The stroke planned, applied and scheduled; the load model before and after, by day. */
function apply(p: Plan, stroke: LeavePaint): { before: LoadModel; after: LoadModel; text: string } {
	const planned = planLeavePaint(stroke, { index: p.index, result: p.result, zones: ZONES });
	if (planned.status !== 'intent') throw new Error(`planned ${planned.status}`);
	const r = applyIntent(p.snap, p.index, planned.intent);
	if (r.status !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(r)}`);
	const files = filesAfter(p.snap, r.edit.changes);
	const result = engine.schedule({
		files,
		entry: p.snap.entry,
		revision: ++revision,
		options: {},
	});
	expect(result.ok).toBe(true);
	expect(errorIds(result)).toEqual(errorIds(p.result));
	const next = planFrom(files, p.snap.entry, result);
	return {
		before: loadOf(p.result, p.index, 'day'),
		after: loadOf(result, next.index, 'day'),
		text: files[p.snap.entry] as string,
	};
}

/** Change of a series over the day buckets [from, to) for a person. */
function delta(
	m: { before: LoadModel; after: LoadModel },
	who: string,
	from: number,
	to: number,
	series: 'available' | 'leave',
): number {
	let n = 0;
	for (let d = from; d < to; d += DAY) {
		n += cell(m.after, who, d + 1, series) - cell(m.before, who, d + 1, series);
	}
	return n;
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))(
	'leave painting on the engine',
	{ timeout: 120_000 },
	() => {
		beforeAll(async () => {
			engine = await bootNodeEngine({ log: () => {} });
		}, 60_000);

		// leave-types: 2026-01-05 (day 0) is a Monday; the 12th (day 7) is a global holiday.
		it('W3 add: a person loses the painted working days to leave', () => {
			const p = workloadPlan('leave-types');
			const m = apply(p, paint(person('p1'), 14 * DAY, 16 * DAY, 'sick'));
			expect(delta(m, 'p1', 14 * DAY, 16 * DAY, 'available')).toBe(-2 * H8);
			expect(delta(m, 'p1', 14 * DAY, 16 * DAY, 'leave')).toBe(2 * H8);
			expect(delta(m, 'p2', 14 * DAY, 16 * DAY, 'available')).toBe(0);
		});

		it('W3 merge: the leave grows by the new working days, the global holiday counted once', () => {
			const p = workloadPlan('leave-types');
			// `annual "Holiday" 2026-01-08 - 2026-01-10`, painted on from Saturday the 10th to the 14th.
			const m = apply(p, paint(person('p2'), 5 * DAY, 10 * DAY, 'annual', 'Holiday'));
			expect(m.text).toContain('annual "Holiday" 2026-01-08 - 2026-01-15');
			expect(delta(m, 'p2', 5 * DAY, 10 * DAY, 'available')).toBe(-2 * H8);
		});

		it('W4 erase: a trimmed leave gives the day back', () => {
			const p = workloadPlan('leave-types');
			const m = apply(p, { type: 'erase', scope: person('p3'), from: 9 * DAY, to: 10 * DAY });
			expect(delta(m, 'p3', 9 * DAY, 10 * DAY, 'available')).toBe(H8);
			expect(delta(m, 'p3', 9 * DAY, 10 * DAY, 'leave')).toBe(-H8);
			expect(delta(m, 'p3', 8 * DAY, 9 * DAY, 'leave')).toBe(0);
		});

		it('Everyone: a holiday takes the day from every person', () => {
			const p = workloadPlan('leave-types');
			const m = apply(p, paint({ kind: 'global' }, 14 * DAY, 15 * DAY, 'holiday', 'Retreat'));
			for (const who of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
				expect(delta(m, who, 14 * DAY, 15 * DAY, 'available')).toBe(-H8);
			}
		});

		it('vacation: a holiday of its name extends it, for everyone', () => {
			const p = workloadPlan('leave-types');
			const m = apply(
				p,
				paint({ kind: 'global' }, 22 * DAY, 23 * DAY, 'holiday', 'Company closure'),
			);
			expect(m.text).toContain('vacation "Company closure" 2026-01-26 - 2026-01-28');
			expect(delta(m, 'p1', 22 * DAY, 23 * DAY, 'available')).toBe(-H8);
			// P6 is already on unemployed leave on the 27th.
			expect(delta(m, 'p6', 22 * DAY, 23 * DAY, 'available')).toBe(0);
		});

		it('across the spring DST change, the local days are the ones on leave', () => {
			const p = workloadPlan('dst-weeks');
			const days = bucketAxis(p.result.project!, ZONES, 'day').bounds;
			// Local days 4 to 7: Friday 27 to Monday 30 March (the 29th has 23 hours).
			const from = days[4] as number;
			const to = days[8] as number;
			expect(to - from).toBe(4 * DAY - 60);
			const m = apply(p, paint(person('ada'), from, to, 'annual'));
			expect(m.text).toContain('leaves annual 2026-03-27 - 2026-03-31');
			expect(cell(m.after, 'ada', from + 1, 'leave')).toBe(H8);
			expect(cell(m.after, 'ada', (days[7] as number) + 1, 'leave')).toBe(H8);
			expect(cell(m.after, 'ada', (days[8] as number) + 1, 'leave')).toBe(0);
			expect(cell(m.after, 'ada', (days[8] as number) + 1, 'available')).toBe(H8);
		});

		// T12 review: what the planner refuses as covered changes nothing on the engine (shown by
		// forcing the same addLeave past the planner), and what it allows changes the leave type.
		it('a paint under the same or a stronger type is refused, and would have changed nothing', () => {
			const p = workloadPlan('leave-types');
			const cases: Array<[LeavePaint, string, string]> = [
				// p2's own annual "Holiday" on the 8th and 9th.
				[paint(person('p2'), 3 * DAY, 5 * DAY, 'annual'), 'p2', '2026-01-08'],
				// p4's sick "Flu" on the 15th and 16th, painted with a weaker type.
				[paint(person('p4'), 10 * DAY, 12 * DAY, 'special'), 'p4', '2026-01-15'],
				// The inherited global holiday on the 12th.
				[paint(person('p1'), 7 * DAY, 8 * DAY, 'unpaid'), 'p1', '2026-01-12'],
			];
			for (const [stroke, who, date] of cases) {
				const planned = planLeavePaint(stroke, { index: p.index, result: p.result, zones: ZONES });
				expect(planned).toMatchObject({ status: 'not-possible', reason: 'leave-covered' });
				if (stroke.type !== 'paint') throw new Error('paint');
				const forced = applyIntent(p.snap, p.index, {
					type: 'addLeave',
					scope: { kind: 'resource', resource: who },
					leave: { type: stroke.leave, start: date, end: `+${(stroke.to - stroke.from) / DAY}d` },
				});
				if (forced.status !== 'edit') throw new Error(forced.status);
				const r = schedule(p, filesAfter(p.snap, forced.edit.changes));
				const leavesOf = (x: ScheduleResult) =>
					x.resources.find((res) => res.id === who)?.scenarios['plan']?.leaves;
				expect(leavesOf(r)).toEqual(leavesOf(p.result));
			}
		});

		it('a global paint over another global leave is refused; forced, the day is off hours', () => {
			const p = workloadPlan('leave-types');
			const stroke = paint({ kind: 'global' }, 7 * DAY, 8 * DAY, 'holiday', 'Other');
			expect(
				planLeavePaint(stroke, { index: p.index, result: p.result, zones: ZONES }),
			).toMatchObject({
				reason: 'leave-covered',
				covering: 'holiday',
			});
			const forced = applyIntent(p.snap, p.index, {
				type: 'addLeave',
				scope: { kind: 'global' },
				leave: { type: 'holiday', name: 'Other', start: '2026-01-12', end: '2026-01-13' },
			});
			if (forced.status !== 'edit') throw new Error(forced.status);
			const r = schedule(p, filesAfter(p.snap, forced.edit.changes));
			const next = planFrom(filesAfter(p.snap, forced.edit.changes), p.snap.entry, r);
			const before = loadOf(p.result, p.index, 'day');
			const after = loadOf(r, next.index, 'day');
			// The day leaves the leave list without coming back as working time: off hours.
			const leave = (m: LoadModel) => cell(m, 'p2', 7 * DAY + 1, 'leave');
			expect(leave(before)).toBe(H8);
			expect(cell(after, 'p2', 7 * DAY + 1, 'available')).toBe(0);
			expect(
				r.resources
					.find((x) => x.id === 'p2')
					?.scenarios['plan']?.leaves.find((l) => l.type === 'holiday')
					?.intervals.some(([s, e]) => s < 8 * DAY && e > 7 * DAY),
			).toBe(false);
		});

		it('a stronger type over a weaker one is added, and the engine shows the stronger type', () => {
			const p = workloadPlan('leave-types');
			// sick over p2's annual "Holiday" on the 8th and 9th.
			const planned = planLeavePaint(paint(person('p2'), 3 * DAY, 5 * DAY, 'sick'), {
				index: p.index,
				result: p.result,
				zones: ZONES,
			});
			expect(planned).toMatchObject({ intent: { type: 'addLeave' } });
			if (planned.status !== 'intent') throw new Error('intent');
			const r0 = applyIntent(p.snap, p.index, planned.intent);
			if (r0.status !== 'edit') throw new Error(r0.status);
			const r = schedule(p, filesAfter(p.snap, r0.edit.changes));
			const typed = (x: ScheduleResult, t: string) =>
				x.resources
					.find((res) => res.id === 'p2')
					?.scenarios['plan']?.leaves.find((l) => l.type === t)
					?.intervals.filter(([s, e]) => s < 5 * DAY && e > 3 * DAY) ?? [];
			expect(typed(p.result, 'annual').length).toBe(2);
			expect(typed(r, 'annual')).toEqual([]);
			expect(typed(r, 'sick')).toEqual(typed(p.result, 'annual'));
		});

		it('fedora-res: a 3-day annual leave for the part-timer Quality 01', () => {
			const ws = golden('fedora-res').snapshot();
			const files: Record<string, string> = {};
			for (const [f, file] of ws.files) files[f] = file.text.toString();
			const p = planFrom(files, ws.entry, goldenResult('fedora-res'));
			const days = bucketAxis(p.result.project!, ZONES, 'day').bounds;
			// The first Monday of the frame with working time for qa01, then Mon to Wed.
			const mon = [...days].findIndex(
				(b, i) =>
					i > 7 && new Date(Date.parse(p.result.project!.start) + b * 60_000).getUTCDay() === 1,
			);
			const from = days[mon] as number;
			const to = days[mon + 3] as number;
			const m = apply(p, paint(person('qa01'), from, to, 'annual'));
			// qa01 works mon - fri 9:00 - 13:00: three days of 4 h.
			expect(delta(m, 'qa01', from, to, 'available')).toBe(-3 * 4 * 60);
			expect(delta(m, 'qa01', from, to, 'leave')).toBe(3 * 4 * 60);
		});

		it('random strokes keep the plan scheduling with no new error (property)', () => {
			const p = workloadPlan('leave-types');
			const people = [...p.index.resources.keys()];
			const types: LeaveType[] = ['holiday', 'annual', 'special', 'sick', 'unpaid', 'unemployed'];
			let edits = 0;
			fc.assert(
				fc.property(
					fc.option(fc.constantFrom(...people), { nil: null }),
					fc.integer({ min: 0, max: 30 }),
					fc.integer({ min: 1, max: 5 }),
					fc.option(fc.constantFrom(...types), { nil: null }),
					(who, d, n, type) => {
						const scope: PaintScope = who === null ? { kind: 'global' } : person(who);
						const from = d * DAY;
						const to = Math.min(32, d + n) * DAY;
						const stroke: LeavePaint =
							type === null ? { type: 'erase', scope, from, to } : paint(scope, from, to, type);
						const planned = planLeavePaint(stroke, {
							index: p.index,
							result: p.result,
							zones: ZONES,
						});
						if (planned.status !== 'intent') return true;
						const r = applyIntent(p.snap, p.index, planned.intent);
						if (r.status !== 'edit') return true;
						edits++;
						const result = engine.schedule({
							files: filesAfter(p.snap, r.edit.changes),
							entry: p.snap.entry,
							revision: ++revision,
							options: {},
						});
						return result.ok && errorIds(result).join() === errorIds(p.result).join();
					},
				),
				{ numRuns: RUNS, ...SEED },
			);
			expect(edits).toBeGreaterThan(RUNS / 4);
		});
	},
);
