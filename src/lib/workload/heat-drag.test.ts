// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance drag's rules (phase-3.md 7.1 W1 and W2, 7.2, 18.9): the axis lock and its release,
// the targets, what a drop asks for and the label, the movable tasks of a cell, and the keyboard's
// person steps.
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import type { GanttCalendar } from '../gantt/ticks';
import { at, plan } from '../schedule/testing';
import { availabilityOf } from './availability';
import { dragPlan, movableTasks, peopleRows, personAt, shiftOf, targetOf } from './heat-drag';
import { heatLayout } from './heat-layout';
import { axisLabels } from './heat-labels';
import { buildLoad } from './load';
import { booking, indexOf, resourceResult, withPeople } from './testing';

const zones = createTimeZoneHost();
const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev1 "Dev 1"
  resource dev2 "Dev 2"
}
resource solo "Solo"
task a "A" { effort 3d allocate dev1 }
task b "B" { effort 1d allocate dev1 }
task c "C" { effort 1d allocate dev2 }
`;

function fixture() {
	const r: ScheduleResult = withPeople(
		plan([
			['a', { start: at(0, 9), end: at(2, 17) }],
			['b', { start: at(0, 9), end: at(0, 17) }],
			['c', { start: at(0, 9), end: at(0, 17) }],
		]),
		[
			resourceResult('team', { group: true }),
			resourceResult('dev1', { parent: 'team' }),
			resourceResult('dev2', { parent: 'team' }),
			resourceResult('solo'),
		],
		[
			booking('dev1', 'a', [[at(0, 9), at(0, 17)]]),
			booking('dev1', 'b', [[at(0, 9), at(0, 10)]]),
			booking('dev2', 'c', [[at(0, 9), at(0, 17)]]),
		],
	);
	const model = buildLoad({
		result: r,
		index: indexOf(TEXT),
		zones,
		kind: 'week',
		collapsed: new Set(),
		availability: availabilityOf(r, 'plan'),
		demand: null,
	});
	const cal: GanttCalendar = {
		startEpoch: Date.parse('2026-01-05T00:00:00Z') / 1000,
		env: { zone: null, zones },
		locale: 'en-GB',
	};
	return { model, labels: axisLabels(cal, model.axis) };
}
const { model, labels } = fixture();
const ids = model.rows.map((r) => r.id);
const row = (id: string): number => ids.indexOf(id);
const layout = heatLayout(model.rows.length, model.axis.count, { rowHeight: 28, colWidth: 56 });

describe('targets', () => {
	const from = { row: row('dev1'), col: 1 };

	it('keeps the column for a person drag and the row for a period drag', () => {
		expect(targetOf('person', from, 999, 3 * 28 + 5, layout)).toEqual({ row: 3, col: 1 });
		expect(targetOf('week', from, 4 * 56 + 3, 0, layout)).toEqual({ row: from.row, col: 4 });
		expect(targetOf(null, from, 0, 0, layout)).toBeNull();
	});

	it('clamps to the grid', () => {
		expect(targetOf('person', from, 0, -50, layout)).toEqual({ row: 0, col: 1 });
		expect(targetOf('person', from, 0, 9999, layout)).toEqual({ row: ids.length - 1, col: 1 });
		expect(targetOf('week', from, -10, 0, layout)?.col).toBe(0);
		expect(targetOf('week', from, 99999, 0, layout)?.col).toBe(model.axis.count - 1);
	});
});

describe('what a drop asks for', () => {
	const from = { row: row('dev1'), col: 0 };

	it('reassigns the task to the person in the target row', () => {
		const p = dragPlan(model, labels, 'a', from, { row: row('solo'), col: 0 });
		expect(p).toEqual({
			ok: true,
			label: 'To Solo',
			action: { type: 'reassign', task: 'a', from: 'dev1', to: 'solo' },
		});
	});

	it('shifts the task by the two buckets starts for a period drag', () => {
		const p = dragPlan(model, labels, 'a', from, { row: from.row, col: 2 });
		expect(p.action).toEqual({
			type: 'shift',
			task: 'a',
			fromBucket: model.axis.bounds[0],
			toBucket: model.axis.bounds[2],
			toBucketEnd: model.axis.bounds[3],
		});
		expect(p.label).toBe('To week of 19 January');
	});

	it('refuses a group row and its own cell, with a label that says so', () => {
		expect(dragPlan(model, labels, 'a', from, { row: row('team'), col: 0 })).toEqual({
			action: null,
			ok: false,
			label: 'Drop on a person, not a group',
		});
		expect(dragPlan(model, labels, 'a', from, from)).toMatchObject({ ok: false, action: null });
		expect(dragPlan(model, labels, 'a', from, null)).toEqual({
			action: null,
			ok: false,
			label: '',
		});
	});

	it('labels a drag before the task is chosen, with no action yet', () => {
		const p = dragPlan(model, labels, null, from, { row: row('solo'), col: 0 });
		expect(p).toEqual({ action: null, ok: true, label: 'To Solo' });
	});
});

describe('the W2 ask', () => {
	it('carries the end of the target bucket, from the axis bounds', () => {
		expect(shiftOf(model, 'a', 0, 2)).toEqual({
			type: 'shift',
			task: 'a',
			fromBucket: model.axis.bounds[0],
			toBucket: model.axis.bounds[2],
			toBucketEnd: model.axis.bounds[3],
		});
		expect(shiftOf(model, 'a', 0, 99)).toBeNull();
	});
});

describe('movable tasks', () => {
	it('lists the booked tasks a drag may start from', () => {
		expect(movableTasks(model, { row: row('dev1'), col: 0 }).map((t) => t.task)).toEqual([
			'a',
			'b',
		]);
		expect(movableTasks(model, { row: row('dev2'), col: 0 }).map((t) => t.task)).toEqual(['c']);
	});

	it('lists none on a group row or an empty cell', () => {
		expect(movableTasks(model, { row: row('team'), col: 0 })).toEqual([]);
		expect(movableTasks(model, { row: row('solo'), col: 0 })).toEqual([]);
	});
});

describe('person steps (Alt+Up and Alt+Down)', () => {
	it('walks the people, skipping groups, and clamps at the ends', () => {
		expect(peopleRows(model).map((i) => ids[i])).toEqual(['dev1', 'dev2', 'solo']);
		expect(personAt(model, row('dev1'), 1)).toBe(row('dev2'));
		expect(personAt(model, row('dev1'), 2)).toBe(row('solo'));
		expect(personAt(model, row('dev1'), -1)).toBe(row('dev1'));
		expect(personAt(model, row('solo'), 5)).toBe(row('solo'));
		expect(personAt(model, row('team'), 1)).toBeNull();
	});
});
