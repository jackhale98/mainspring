// SPDX-License-Identifier: GPL-2.0-or-later
// Changing and removing one leave (leave-edit.ts, phase-3.md 7.1 W5): the fields of an item, the
// intent a change of them becomes and the exact text the edit API writes for it (a dry run with
// `applyIntent`), the form each bound keeps, the dates that cannot be written, and the types a
// scope offers.
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { applyIntent } from '../tjp/edit/apply';
import { textsAfter } from '../tjp/edit/testing';
import { workloadPlan, type Plan } from '../workload/rebalance-testing';
import {
	itemFields,
	planLeaveEdit,
	planLeaveRemove,
	typesFor,
	typesOfItem,
	type LeaveFields,
} from './leave-edit';
import { scopeItems, type PaintItem } from './paint-items';
import { onePerson } from './paint-testing';

const zones = createTimeZoneHost();
const EPOCH = Date.parse('2026-01-05T00:00:00Z') / 1000;

const ctxOf = (p: Plan) => {
	const project = p.result.project;
	if (!project) throw new Error('no project');
	return { index: p.index, project, zones };
};
const itemOf = (p: Plan, resource: string | null, name: string): PaintItem => {
	const items = scopeItems(
		p.index,
		resource === null ? { kind: 'global' } : { kind: 'resource', resource },
		EPOCH,
	);
	const item = items.find((i) => i.name === name);
	if (!item) throw new Error(`no leave ${name}`);
	return item;
};
const fieldsOf = (p: Plan, item: PaintItem): LeaveFields => {
	const f = itemFields(item, ctxOf(p).project, zones);
	if (!f) throw new Error('no fields');
	return f;
};
/** The entry's text after the intent, through the edit API. */
function after(p: Plan, intent: Parameters<typeof applyIntent>[2]): string {
	const r = applyIntent(p.snap, p.index, intent);
	if (r.status !== 'edit') throw new Error(`${r.status} ${'reason' in r ? r.reason : ''}`);
	return textsAfter(p.snap, r)[p.snap.entry] as string;
}

describe('itemFields', () => {
	const p = workloadPlan('leave-types');

	it('shows a leave as its first and last day, the end being exclusive in the text', () => {
		// P2: annual "Holiday" 2026-01-08 - 2026-01-10 is the 8th and the 9th.
		expect(fieldsOf(p, itemOf(p, 'p2', 'Holiday'))).toEqual({
			type: 'annual',
			name: 'Holiday',
			start: '2026-01-08',
			end: '2026-01-09',
		});
	});

	it('reads a one-day leave and a vacation as a named holiday', () => {
		expect(fieldsOf(p, itemOf(p, null, 'Founders day'))).toEqual({
			type: 'holiday',
			name: 'Founders day',
			start: '2026-01-12',
			end: '2026-01-12',
		});
		expect(fieldsOf(p, itemOf(p, null, 'Company closure')).type).toBe('holiday');
	});

	it('has none for a leave that does not run over whole days', () => {
		const q = onePerson('leaves annual 2026-01-08-09:00 - 2026-01-09-17:00');
		const items = scopeItems(q.index, { kind: 'resource', resource: 'dev' }, EPOCH);
		expect(items).toHaveLength(1);
		expect(itemFields(items[0] as PaintItem, ctxOf(q).project, zones)).toBeNull();
	});
});

describe('planLeaveEdit', () => {
	const p = workloadPlan('leave-types');
	const text = p.text('plan.tjp');
	const item = itemOf(p, 'p2', 'Holiday');
	const base = fieldsOf(p, item);

	it('changes the type and writes it in the 18.5 form, leaving the dates as written', () => {
		const plan = planLeaveEdit(item, { ...base, type: 'sick' }, ctxOf(p));
		expect(plan).toMatchObject({
			status: 'intent',
			intent: {
				type: 'updateLeave',
				// The ref carries the version its range was read in (ADR-0018).
				leave: { item: item.range, basedOn: p.index.version },
				to: { type: 'sick', name: 'Holiday', start: '2026-01-08', end: '2026-01-10' },
			},
		});
		if (plan.status !== 'intent') throw new Error('no intent');
		expect(plan.label.text).toMatch(/^Sick leave for P2 changed: .+ to .+/);
		expect(after(p, plan.intent)).toBe(
			text.replace(
				'annual "Holiday" 2026-01-08 - 2026-01-10',
				'sick "Holiday" 2026-01-08 - 2026-01-10',
			),
		);
	});

	it('renames a leave, or drops its name with an empty field', () => {
		const named = planLeaveEdit(item, { ...base, name: 'Ski trip' }, ctxOf(p));
		if (named.status !== 'intent') throw new Error('no intent');
		expect(after(p, named.intent)).toContain('annual "Ski trip" 2026-01-08 - 2026-01-10');
		const bare = planLeaveEdit(item, { ...base, name: '  ' }, ctxOf(p));
		if (bare.status !== 'intent') throw new Error('no intent');
		expect(bare.intent).toMatchObject({
			to: { type: 'annual', start: '2026-01-08', end: '2026-01-10' },
		});
		expect(after(p, bare.intent)).toContain('leaves annual 2026-01-08 - 2026-01-10');
	});

	it('moves the last day: the end is the next day, exclusive', () => {
		const plan = planLeaveEdit(item, { ...base, end: '2026-01-14' }, ctxOf(p));
		if (plan.status !== 'intent') throw new Error('no intent');
		expect(plan.intent).toMatchObject({ to: { start: '2026-01-08', end: '2026-01-15' } });
		expect(after(p, plan.intent)).toContain('annual "Holiday" 2026-01-08 - 2026-01-15');
	});

	it('moves the first day and keeps the end as written', () => {
		const plan = planLeaveEdit(item, { ...base, start: '2026-01-07' }, ctxOf(p));
		if (plan.status !== 'intent') throw new Error('no intent');
		expect(plan.intent).toMatchObject({ to: { start: '2026-01-07', end: '2026-01-10' } });
	});

	it('writes an end that counts from the start as the date it was when only the start moves', () => {
		const q = onePerson('leaves annual "Trip" 2026-01-08 +2d');
		const it2 = scopeItems(q.index, { kind: 'resource', resource: 'dev' }, EPOCH)[0] as PaintItem;
		const f = itemFields(it2, ctxOf(q).project, zones) as LeaveFields;
		expect(f).toMatchObject({ start: '2026-01-08', end: '2026-01-09' });
		// A new name only: the `+2d` stays.
		const renamed = planLeaveEdit(it2, { ...f, name: 'Beach' }, ctxOf(q));
		if (renamed.status !== 'intent') throw new Error('no intent');
		expect(renamed.intent).toMatchObject({
			to: { name: 'Beach', start: '2026-01-08', end: '+2d' },
		});
		// A new start: the end is the date it resolved to, not +2d from the new start.
		const moved = planLeaveEdit(it2, { ...f, start: '2026-01-07' }, ctxOf(q));
		if (moved.status !== 'intent') throw new Error('no intent');
		expect(moved.intent).toMatchObject({ to: { start: '2026-01-07', end: '2026-01-10' } });
	});

	it('does nothing when no field changed', () => {
		expect(planLeaveEdit(item, base, ctxOf(p))).toEqual({ status: 'unchanged' });
		expect(planLeaveEdit(item, { ...base, name: 'Holiday ' }, ctxOf(p))).toEqual({
			status: 'unchanged',
		});
	});

	it('refuses dates that cannot be written', () => {
		expect(planLeaveEdit(item, { ...base, end: '2026-01-07' }, ctxOf(p))).toEqual({
			status: 'invalid',
			reason: 'dates',
		});
		expect(planLeaveEdit(item, { ...base, start: '' }, ctxOf(p))).toEqual({
			status: 'invalid',
			reason: 'empty',
		});
		expect(planLeaveEdit(item, { ...base, end: '2026-02-30' }, ctxOf(p))).toEqual({
			status: 'invalid',
			reason: 'empty',
		});
		expect(planLeaveEdit(item, { ...base, start: '1969-12-31' }, ctxOf(p))).toEqual({
			status: 'invalid',
			reason: 'range',
		});
		expect(planLeaveEdit(item, { ...base, end: '2036-01-01' }, ctxOf(p))).toEqual({
			status: 'invalid',
			reason: 'range',
		});
	});

	it('edits a global holiday as Everyone', () => {
		const founders = itemOf(p, null, 'Founders day');
		const f = fieldsOf(p, founders);
		const plan = planLeaveEdit(founders, { ...f, end: '2026-01-13' }, ctxOf(p));
		if (plan.status !== 'intent') throw new Error('no intent');
		expect(plan.label.text).toMatch(/^Holiday for Everyone changed: /);
		expect(after(p, plan.intent)).toContain('holiday "Founders day" 2026-01-12 - 2026-01-14');
	});
});

describe('planLeaveRemove', () => {
	const p = workloadPlan('leave-types');

	it('removes the item, with the days in the label', () => {
		const item = itemOf(p, 'p2', 'Holiday');
		const plan = planLeaveRemove(item, ctxOf(p));
		expect(plan.intent).toEqual({
			type: 'removeLeave',
			leave: { item: item.range, basedOn: p.index.version },
		});
		expect(plan.label.text).toMatch(/^Annual leave for P2 removed: /);
		expect(after(p, plan.intent)).not.toContain('"Holiday"');
	});
});

describe('types', () => {
	it('offers a person five kinds and Everyone a holiday (9.5)', () => {
		expect(typesFor(false)).toEqual(['annual', 'special', 'sick', 'unpaid', 'unemployed']);
		expect(typesFor(true)).toEqual(['holiday']);
	});

	it("keeps an item's own kind in its list when the scope does not offer it", () => {
		const p = workloadPlan('leave-types');
		expect(typesOfItem(itemOf(p, 'p2', 'Holiday'))).toEqual(typesFor(false));
		expect(typesOfItem(itemOf(p, null, 'Founders day'))).toEqual(['holiday']);
		// P1's project leave is read, not written: it is not offered as a type.
		expect(typesOfItem(itemOf(p, 'p1', 'Offsite'))).toEqual(typesFor(false));
	});

	it('lets a person’s own holiday go to annual and back (T16 review)', () => {
		const q = onePerson('leaves holiday "Day" 2026-01-08');
		const item = itemOf(q, 'dev', 'Day');
		expect(typesOfItem(item)).toEqual([...typesFor(false), 'holiday']);
		// A global annual leave can be put back to annual in the same way.
		const g = onePerson('', 'leaves annual "Closure" 2026-01-12\n');
		expect(typesOfItem(itemOf(g, null, 'Closure'))).toEqual(['holiday', 'annual']);
	});
});
