// SPDX-License-Identifier: GPL-2.0-or-later
// The leave-paint planner's paint strokes (phase-3.md 6.6, 7.1 W3 and W5, 13.1, 18.5): each outcome
// of a paint, then the edit API's answer to the intent (a dry run with `applyIntent`): the exact
// text after an add or a merge, Everyone and a person, a vacation, and a paint across a DST change.
// Erase strokes (W4) and the refusals are in paint-erase.test.ts.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { project } from '../schedule/testing';
import { workloadPlan } from '../workload/rebalance-testing';
import type { LeavePaint, PaintPlanned, PaintScope, PlanLeavePaintFn } from './paint';
import { defaultLeaveType, leavePaintMessage, planLeavePaint } from './paint';
import { after, ctxOf, DAY, day, onePerson, paint, person } from './paint-testing';

describe('leave-paint types (6.6)', () => {
	it('fixes the signature', () => {
		expectTypeOf(planLeavePaint).toEqualTypeOf<PlanLeavePaintFn>();
		expectTypeOf<PlanLeavePaintFn>().returns.toEqualTypeOf<PaintPlanned>();
		expectTypeOf<LeavePaint['scope']>().toEqualTypeOf<PaintScope>();
	});

	it('defaults to annual for a person and holiday for Everyone (18.5)', () => {
		expect(defaultLeaveType(person('p1'))).toBe('annual');
		expect(defaultLeaveType({ kind: 'global' })).toBe('holiday');
	});
});

describe('paint (W3)', () => {
	const p = workloadPlan('leave-types');
	const text = p.text('plan.tjp');

	it('adds a leave to the person, in the 18.5 form', () => {
		const planned = planLeavePaint(paint(person('p1'), day(14), day(16), 'sick'), ctxOf(p));
		expect(planned).toMatchObject({
			status: 'intent',
			constraint: false,
			intent: {
				type: 'addLeave',
				scope: { kind: 'resource', resource: 'p1' },
				leave: { type: 'sick', start: '2026-01-19', end: '2026-01-21' },
			},
		});
		expect(planned.status === 'intent' && planned.label.text).toMatch(/^Sick leave for P1: /);
		expect(after(p, planned)).toBe(
			text.replace(
				'"Offsite" 2026-01-06 - 2026-01-08',
				'"Offsite" 2026-01-06 - 2026-01-08, sick 2026-01-19 - 2026-01-21',
			),
		);
	});

	it('adds a holiday for Everyone after the global leaves, with its name', () => {
		const planned = planLeavePaint(
			paint({ kind: 'global' }, day(14), day(15), 'holiday', 'Retreat'),
			ctxOf(p),
		);
		expect(planned).toMatchObject({
			intent: {
				type: 'addLeave',
				scope: { kind: 'global' },
				leave: { type: 'holiday', name: 'Retreat', start: '2026-01-19', end: '2026-01-20' },
			},
		});
		expect(planned.status === 'intent' && planned.label.text).toMatch(/^Holiday for Everyone: /);
		expect(after(p, planned)).toBe(
			text.replace(
				'"Founders day" 2026-01-12\n',
				'"Founders day" 2026-01-12, holiday "Retreat" 2026-01-19 - 2026-01-20\n',
			),
		);
	});

	it('merges with a leave of the same type and name it touches: the end moves', () => {
		// P2's `annual "Holiday" 2026-01-08 - 2026-01-10`, painted on from Saturday the 10th.
		const planned = planLeavePaint(
			paint(person('p2'), day(5), day(8), 'annual', 'Holiday'),
			ctxOf(p),
		);
		expect(planned).toMatchObject({
			intent: {
				type: 'updateLeave',
				// The merged item's range, with the version it was read in (ADR-0018).
				leave: { basedOn: p.index.version },
				to: { type: 'annual', name: 'Holiday', start: '2026-01-08', end: '2026-01-13' },
			},
		});
		expect(planned.status === 'intent' && planned.label.text).toMatch(/^Annual leave for P2 now /);
		expect(after(p, planned)).toBe(
			text.replace('"Holiday" 2026-01-08 - 2026-01-10', '"Holiday" 2026-01-08 - 2026-01-13'),
		);
	});

	it('merges with one it overlaps: the start moves', () => {
		const planned = planLeavePaint(
			paint(person('p2'), day(1), day(4), 'annual', 'Holiday'),
			ctxOf(p),
		);
		expect(after(p, planned)).toBe(
			text.replace('"Holiday" 2026-01-08 - 2026-01-10', '"Holiday" 2026-01-06 - 2026-01-10'),
		);
	});

	it('refuses a paint under a leave of its type: leave-covered (T12 review)', () => {
		const planned = planLeavePaint(
			paint(person('p2'), day(3), day(4), 'annual', 'Holiday'),
			ctxOf(p),
		);
		expect(planned).toMatchObject({
			status: 'not-possible',
			reason: 'leave-covered',
			covering: 'annual',
		});
		if (planned.status !== 'not-possible') throw new Error('refused');
		expect(p.text('plan.tjp').slice(planned.at[0]!.from, planned.at[0]!.to)).toBe(
			'annual "Holiday" 2026-01-08 - 2026-01-10',
		);
		expect(leavePaintMessage(planned)).toBe(
			'Annual leave already covers those days. Erase it first.',
		);
		// Any name is covered the same way.
		for (const name of [undefined, 'Other']) {
			expect(
				planLeavePaint(paint(person('p2'), day(3), day(5), 'annual', name), ctxOf(p)),
			).toMatchObject({ reason: 'leave-covered' });
		}
	});

	it('follows the precedence: a stronger type over a weaker one is added', () => {
		// P4's `sick "Flu" 2026-01-15 - 2026-01-17`: annual and special under it are covered.
		for (const t of ['annual', 'special', 'sick'] as const) {
			expect(planLeavePaint(paint(person('p4'), day(10), day(12), t), ctxOf(p))).toMatchObject({
				reason: 'leave-covered',
				covering: 'sick',
			});
		}
		for (const t of ['unpaid', 'holiday', 'unemployed'] as const) {
			expect(planLeavePaint(paint(person('p4'), day(10), day(12), t), ctxOf(p))).toMatchObject({
				intent: { type: 'addLeave' },
			});
		}
		// The global holiday (the 12th) is inherited: a person's annual there is covered.
		const under = planLeavePaint(paint(person('p1'), day(7), day(8), 'annual'), ctxOf(p));
		expect(under).toMatchObject({ reason: 'leave-covered', covering: 'holiday' });
		if (under.status !== 'not-possible') throw new Error('refused');
		expect(leavePaintMessage(under)).toBe('Holiday already covers those days. Erase it first.');
		// Partly covered: the rest of the days change, so the paint is added.
		expect(planLeavePaint(paint(person('p1'), day(7), day(9), 'annual'), ctxOf(p))).toMatchObject({
			intent: { type: 'addLeave' },
		});
	});

	it('refuses a global paint over another global leave (two make off hours)', () => {
		for (const stroke of [
			paint({ kind: 'global' }, day(7), day(8), 'holiday', 'Other'),
			paint({ kind: 'global' }, day(6), day(9), 'unemployed'),
			paint({ kind: 'global' }, day(20), day(22), 'holiday'),
		]) {
			expect(planLeavePaint(stroke, ctxOf(p))).toMatchObject({ reason: 'leave-covered' });
		}
		// The item it merges with is not another leave: one item is rewritten.
		expect(
			planLeavePaint(
				paint({ kind: 'global' }, day(20), day(22), 'holiday', 'Company closure'),
				ctxOf(p),
			),
		).toMatchObject({ intent: { type: 'updateLeave', to: { start: '2026-01-25' } } });
		// Touching is not overlapping: the vacation still merges.
		expect(
			planLeavePaint(
				paint({ kind: 'global' }, day(22), day(23), 'holiday', 'Company closure'),
				ctxOf(p),
			),
		).toMatchObject({ intent: { type: 'updateLeave' } });
	});

	it('snaps an off-midnight stroke out to whole local days (T12 review)', () => {
		const planned = planLeavePaint(
			paint(person('p1'), day(14) + 120, day(15) + 600, 'sick'),
			ctxOf(p),
		);
		expect(planned).toMatchObject({
			intent: { leave: { start: '2026-01-19', end: '2026-01-21' } },
		});
		expect(planLeavePaint(paint(person('p1'), day(14), day(15), 'sick'), ctxOf(p))).toMatchObject({
			intent: { leave: { start: '2026-01-19', end: '2026-01-20' } },
		});
	});

	it('does not merge across names or types: another item', () => {
		for (const stroke of [
			paint(person('p2'), day(5), day(8), 'annual'),
			paint(person('p2'), day(5), day(8), 'annual', 'Trip'),
			paint(person('p2'), day(3), day(8), 'sick', 'Holiday'),
		]) {
			expect(planLeavePaint(stroke, ctxOf(p))).toMatchObject({ intent: { type: 'addLeave' } });
		}
	});

	it('merges a holiday into the vacation of its name (edited as holiday)', () => {
		// `vacation "Company closure" 2026-01-26`, the one-day form; painted on to the 28th.
		const planned = planLeavePaint(
			paint({ kind: 'global' }, day(22), day(23), 'holiday', 'Company closure'),
			ctxOf(p),
		);
		expect(planned).toMatchObject({ intent: { type: 'updateLeave' } });
		expect(after(p, planned)).toBe(
			text.replace(
				'vacation "Company closure" 2026-01-26',
				'vacation "Company closure" 2026-01-26 - 2026-01-28',
			),
		);
		// Without the name it is another holiday.
		expect(
			planLeavePaint(paint({ kind: 'global' }, day(22), day(23), 'holiday'), ctxOf(p)),
		).toMatchObject({ intent: { type: 'addLeave' } });
	});

	it('keeps an end written as a duration unless the start moves under it', () => {
		const q = onePerson('leaves annual 2026-01-08 +2d');
		const later = planLeavePaint(paint(person('dev'), day(5), day(7), 'annual'), ctxOf(q));
		expect(after(q, later)).toBe(
			q.text('plan.tjp').replace('2026-01-08 +2d', '2026-01-08 - 2026-01-12'),
		);
		const earlier = planLeavePaint(paint(person('dev'), day(1), day(3), 'annual'), ctxOf(q));
		expect(after(q, earlier)).toBe(
			q.text('plan.tjp').replace('2026-01-08 +2d', '2026-01-06 - 2026-01-10'),
		);
		expect(planLeavePaint(paint(person('dev'), day(3), day(4), 'annual'), ctxOf(q))).toMatchObject({
			reason: 'leave-covered',
		});
	});
});

describe('days in the plan zone', () => {
	it('writes local dates across a DST change (Europe/Berlin)', () => {
		const p = workloadPlan('dst-weeks');
		const pr = p.result.project!;
		// TaskJuggler reads the header's date before the zone: the frame starts 01:00 local.
		expect(pr.start).toBe('2026-03-23T00:00:00Z');
		const m = (utc: string): number => (Date.parse(utc) - Date.parse(pr.start)) / 60_000;
		// Friday 27 March to Tuesday 31 March, local midnights: the 29th is 23 hours long.
		const from = m('2026-03-26T23:00:00Z');
		const to = m('2026-03-30T22:00:00Z');
		expect(to - from).toBe(4 * DAY - 60);
		const planned = planLeavePaint(paint(person('ada'), from, to, 'annual'), ctxOf(p));
		expect(planned).toMatchObject({
			intent: {
				type: 'addLeave',
				leave: { type: 'annual', start: '2026-03-27', end: '2026-03-31' },
			},
		});
		expect(after(p, planned)).toBe(
			p
				.text('plan.tjp')
				.replace(
					'resource ada "Ada"\n',
					'resource ada "Ada" {\n  leaves annual 2026-03-27 - 2026-03-31\n}\n',
				),
		);
		// The autumn change: Saturday 24 to Tuesday 27 October, the 25th 25 hours long.
		const sat = m('2026-10-23T22:00:00Z');
		const tue = m('2026-10-26T23:00:00Z');
		expect(planLeavePaint(paint(person('bo'), sat, tue, 'sick'), ctxOf(p))).toMatchObject({
			intent: { leave: { start: '2026-10-24', end: '2026-10-27' } },
		});
	});

	it('snaps raw minutes to local midnights in the zone, never a date with a time', () => {
		// The frame starts 01:00 local, so whole UTC days are off the local midnights.
		const p = workloadPlan('dst-weeks');
		const planned = planLeavePaint(paint(person('ada'), 4 * DAY, 8 * DAY, 'annual'), ctxOf(p));
		expect(planned).toMatchObject({
			intent: { leave: { start: '2026-03-27', end: '2026-04-01' } },
		});
		const erase = planLeavePaint(
			{ type: 'erase', scope: person('ada'), from: 4 * DAY + 30, to: 5 * DAY },
			ctxOf(p),
		);
		expect(erase).toMatchObject({ intent: { start: '2026-03-27', end: '2026-03-29' } });
	});

	it('labels the days with the last day painted', () => {
		const p = workloadPlan('leave-types');
		const planned = planLeavePaint(paint(person('p1'), day(14), day(15), 'unpaid'), {
			...ctxOf(p),
			result: { ...p.result, project: project({ timezone: null }) },
		});
		expect(planned.status === 'intent' && planned.label.text).toBe(
			`Unpaid leave for P1: ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 19)))}`,
		);
	});
});
