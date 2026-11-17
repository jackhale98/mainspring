// SPDX-License-Identifier: GPL-2.0-or-later
// The leave-paint planner's erase strokes and refusals (phase-3.md 6.6, 7.1 W4, 13.1, 18.5): erase
// becomes `clearLeave`, and the edit API removes, trims or splits each item it overlaps (the exact
// text after it), or refuses an inherited leave and a split vacation; leave the engine shows but no
// text names is text-only; and the planner's own refusals.
import { describe, expect, it } from 'vitest';
import { workloadPlan } from '../workload/rebalance-testing';
import { planLeavePaint } from './paint';
import { after, ctxOf, day, onePerson, paint, person } from './paint-testing';

describe('erase (W4)', () => {
	const p = workloadPlan('leave-types');
	const text = p.text('plan.tjp');

	it('becomes clearLeave over the range, for the person', () => {
		const planned = planLeavePaint(
			{ type: 'erase', scope: person('p3'), from: day(9), to: day(10) },
			ctxOf(p),
		);
		expect(planned).toMatchObject({
			status: 'intent',
			intent: {
				type: 'clearLeave',
				scope: { kind: 'resource', resource: 'p3' },
				start: '2026-01-14',
				end: '2026-01-15',
			},
		});
		expect(planned.status === 'intent' && planned.label.text).toMatch(/^Leave cleared for P3: /);
		// Trim: `special "Study leave" 2026-01-13 - 2026-01-15` loses its last day.
		expect(after(p, planned)).toBe(
			text.replace('2026-01-13 - 2026-01-15', '2026-01-13 - 2026-01-14'),
		);
	});

	it('removes a leave it covers, and splits one it falls inside', () => {
		const gone = planLeavePaint(
			{ type: 'erase', scope: person('p2'), from: day(3), to: day(5) },
			ctxOf(p),
		);
		expect(after(p, gone)).toBe(
			text.replace(
				'resource p2 "P2" {\n  leaves annual "Holiday" 2026-01-08 - 2026-01-10\n}',
				'resource p2 "P2" {\n}',
			),
		);
		const q = onePerson('leaves annual "Trip" 2026-01-05 - 2026-01-10');
		const split = planLeavePaint(
			{ type: 'erase', scope: person('dev'), from: day(2), to: day(3) },
			ctxOf(q),
		);
		expect(after(q, split)).toBe(
			q
				.text('plan.tjp')
				.replace(
					'"Trip" 2026-01-05 - 2026-01-10',
					'"Trip" 2026-01-05 - 2026-01-07, annual "Trip" 2026-01-08 - 2026-01-10',
				),
		);
	});

	it('clears the global holiday for Everyone, and refuses it for one person (inherited)', () => {
		const all = planLeavePaint(
			{ type: 'erase', scope: { kind: 'global' }, from: day(7), to: day(8) },
			ctxOf(p),
		);
		expect(after(p, all)).toBe(text.replace('leaves holiday "Founders day" 2026-01-12\n', ''));
		const one = planLeavePaint(
			{ type: 'erase', scope: person('p1'), from: day(7), to: day(8) },
			ctxOf(p),
		);
		expect(one).toMatchObject({ intent: { type: 'clearLeave' } });
		expect(after(p, one)).toEqual({ status: 'refused', reason: 'inherited' });
	});

	it('refuses to split a vacation (unsupported-form)', () => {
		const q = onePerson('vacation "Away" 2026-01-05 - 2026-01-10');
		const planned = planLeavePaint(
			{ type: 'erase', scope: person('dev'), from: day(2), to: day(3) },
			ctxOf(q),
		);
		expect(after(q, planned)).toEqual({ status: 'refused', reason: 'unsupported-form' });
	});

	it('says nothing to remove where there is no leave (noop not-present)', () => {
		const planned = planLeavePaint(
			{ type: 'erase', scope: person('p1'), from: day(14), to: day(16) },
			ctxOf(p),
		);
		expect(after(p, planned)).toEqual({ status: 'noop', reason: 'not-present' });
	});

	it('is text-only where the engine shows leave that no text item names', () => {
		// As a shift's leave would: p1 on leave on the 20th in the result only.
		const r = {
			...p.result,
			resources: p.result.resources.map((x) =>
				x.id !== 'p1'
					? x
					: {
							...x,
							scenarios: {
								plan: {
									...x.scenarios['plan']!,
									leaves: [
										{
											type: 'annual' as const,
											intervals: [[day(15) + 540, day(15) + 1020] as [number, number]],
										},
									],
								},
							},
						},
			),
		};
		const planned = planLeavePaint(
			{ type: 'erase', scope: person('p1'), from: day(15), to: day(16) },
			{ ...ctxOf(p), result: r },
		);
		expect(planned).toMatchObject({ status: 'not-possible', reason: 'text-only' });
		const global = planLeavePaint(
			{ type: 'erase', scope: { kind: 'global' }, from: day(15), to: day(16) },
			{
				...ctxOf(p),
				result: {
					...r,
					project: {
						...r.project!,
						leaves: [{ type: 'holiday', name: null, interval: [day(15), day(16)] }],
					},
				},
			},
		);
		expect(global).toMatchObject({ status: 'not-possible', reason: 'text-only' });
	});
});

describe('refusals', () => {
	const p = workloadPlan('leave-types');

	it('refuses a person the text does not declare (unknown-target)', () => {
		expect(planLeavePaint(paint(person('nobody'), day(1), day(2), 'annual'), ctxOf(p))).toEqual({
			status: 'not-possible',
			reason: 'unknown-target',
			at: [],
		});
	});

	it('refuses an empty range and dates it cannot write (at-limit)', () => {
		expect(planLeavePaint(paint(person('p1'), day(2), day(2), 'annual'), ctxOf(p))).toMatchObject({
			reason: 'at-limit',
		});
		expect(
			planLeavePaint(paint(person('p1'), day(-30000), day(-29999), 'annual'), ctxOf(p)),
		).toMatchObject({ reason: 'at-limit' });
	});

	it('refuses without the project frame (not-scheduled)', () => {
		const r = { ...p.result, project: null };
		expect(
			planLeavePaint(paint({ kind: 'global' }, day(1), day(2), 'holiday'), {
				...ctxOf(p),
				result: r,
			}),
		).toMatchObject({ reason: 'not-scheduled' });
	});

	it('passes a macro-written leave list to the edit API (text-only)', () => {
		const q = onePerson('leaves annual ${when}', 'macro when [2026-01-08 - 2026-01-10]\n');
		const planned = planLeavePaint(paint(person('dev'), day(14), day(15), 'annual'), ctxOf(q));
		expect(planned).toMatchObject({ intent: { type: 'addLeave' } });
		expect(after(q, planned)).toMatchObject({ status: 'refused', reason: 'text-only' });
		const erase = planLeavePaint(
			{ type: 'erase', scope: person('dev'), from: day(3), to: day(4) },
			ctxOf(q),
		);
		expect(after(q, erase)).toMatchObject({ status: 'refused', reason: 'text-only' });
	});
});
