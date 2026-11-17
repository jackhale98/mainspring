// SPDX-License-Identifier: GPL-2.0-or-later
// Week, month and day moves on the wasm engine (T12 review, 2026-11-17): each repro of the review
// is planned, applied and scheduled, and the load model of the new result (`buildLoad` at the
// drop's zoom) books the moved work inside the target bucket, never past it; a bucket with no
// working day is refused and nothing is written. The repro plan (`REPRO_TEXT`) is scheduled here,
// and its result is checked against the hand-made one the unit tests use (rebalance-shift.test.ts).
// Needs the built engine (npm run build:engine); skipped without it unless TJP_EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { NodeEngine } from '../../engine/runtime';
import { bucketAxis } from './axis';
import type { RebalanceAction } from './rebalance';
import { checkRebalance } from './rebalance-check';
import {
	filesAfter,
	loadOf,
	planFrom,
	REPRO_TEXT,
	reproPlan,
	ZONES,
	type Plan,
} from './rebalance-testing';
import type { BucketKind } from './types';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';
const DAY = 1440;
const WEEK = 7 * DAY;

let engine: NodeEngine;
let plan: Plan;
let revision = 300;

/** The repro plan as this engine schedules it. */
function scheduled(): Plan {
	const files = { 'plan.tjp': REPRO_TEXT };
	const r = engine.schedule({ files, entry: 'plan.tjp', revision: ++revision, options: {} });
	expect(r.ok).toBe(true);
	return planFrom(files, 'plan.tjp', r);
}

/** The buckets of the moved task's bookings at a zoom, after the drop: column indices. */
function apply(a: Extract<RebalanceAction, { type: 'shift' }>, kind: BucketKind) {
	const out = checkRebalance(a, plan.at(), plan.snap);
	if (out.status !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(out)}`);
	const files = filesAfter(plan.snap, out.edit.changes);
	const r = engine.schedule({ files, entry: 'plan.tjp', revision: ++revision, options: {} });
	expect(r.ok).toBe(true);
	expect(r.messages.filter((m) => m.level === 'error')).toEqual([]);
	const next = planFrom(files, 'plan.tjp', r);
	const m = loadOf(r, next.index, kind);
	const cols = new Set<number>();
	for (const b of r.bookings) {
		if (b.task !== a.task) continue;
		for (const [s, e] of b.intervals) for (let x = s; x < e; x += 60) cols.add(m.axis.indexOf(x));
	}
	const row = m.rows.findIndex((x) => x.id === r.bookings.find((b) => b.task === a.task)?.resource);
	return {
		intent: out.intent,
		cols: [...cols].sort((x, y) => x - y),
		m,
		row,
		target: m.axis.indexOf(a.toBucket),
	};
}

const shift = (task: string, from: number, to: number, end: number) =>
	({ type: 'shift', task, fromBucket: from, toBucket: to, toBucketEnd: end }) as const;

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))(
	'week moves land inside the target bucket, on the engine',
	{ timeout: 120_000 },
	() => {
		beforeAll(async () => {
			engine = await bootNodeEngine({ log: () => {} });
			plan = scheduled();
		}, 60_000);

		it('the hand-made result of the unit tests is the engine’s', () => {
			const hand = reproPlan().result;
			for (const t of hand.tasks) {
				const got = plan.result.tasks.find((x) => x.id === t.id)?.scenarios['plan'];
				expect([t.id, got?.start, got?.end]).toEqual([
					t.id,
					t.scenarios['plan']?.start,
					t.scenarios['plan']?.end,
				]);
			}
			expect(plan.result.project?.workingTime).toEqual(hand.project?.workingTime);
		});

		it('a Friday holiday in the target week: the task is booked in that week', () => {
			const { intent, cols, target } = apply(shift('fri', WEEK, 2 * WEEK, 3 * WEEK), 'week');
			expect(intent).toMatchObject({ attr: 'start', value: '2026-01-22' });
			expect(cols).toEqual([target]);
		});

		it('an ALAP move: the end, and here the whole task, are in the target week', () => {
			const { intent, cols, target } = apply(shift('alap', 3 * WEEK, 2 * WEEK, 3 * WEEK), 'week');
			expect(intent).toMatchObject({ attr: 'end', value: '2026-01-23' });
			expect(cols).toEqual([target]);
		});

		it('a target week that is all holiday is refused, and the week after it books there', () => {
			expect(
				checkRebalance(shift('off', 3 * WEEK, 4 * WEEK, 5 * WEEK), plan.at(), plan.snap),
			).toMatchObject({
				status: 'refused',
				reason: 'no-working-day',
			});
			const { cols, target } = apply(shift('off', 3 * WEEK, 5 * WEEK, 6 * WEEK), 'week');
			expect(cols).toEqual([target]);
		});

		it('month zoom: a late-January task dropped on February is booked in February', () => {
			const months = bucketAxis(plan.result.project!, ZONES, 'month').bounds;
			const b = (i: number) => months[i] as number;
			const { intent, cols, target } = apply(shift('jan29', b(0), b(1), b(2)), 'month');
			expect(intent).toMatchObject({ attr: 'start', value: '2026-02-27' });
			expect(cols).toEqual([target]);
		});

		it('day zoom: a Sunday drop is refused; a weekday drop books that day', () => {
			expect(
				checkRebalance(shift('mon', 7 * DAY, 6 * DAY, 7 * DAY), plan.at(), plan.snap),
			).toMatchObject({
				status: 'refused',
				reason: 'no-working-day',
				message: 'No working time on that day.',
			});
			const { cols, target } = apply(shift('mon', 7 * DAY, 4 * DAY, 5 * DAY), 'day');
			expect(cols).toEqual([target]);
		});

		it('a long task dragged by its second week moves by one week', () => {
			const before = loadOf(plan.result, plan.index, 'week');
			const row = before.rows.findIndex((x) => x.id === 'f');
			const { m, cols } = apply(shift('long', WEEK, 2 * WEEK, 3 * WEEK), 'week');
			// Booked in weeks 1 and 2 (the holiday on the 21st pushes one day into week 3).
			expect(cols[0]).toBe(1);
			expect(before.booked[row]?.[0]).toBeGreaterThan(0);
			expect(m.booked[row]?.[0]).toBe(0);
		});
	},
);
