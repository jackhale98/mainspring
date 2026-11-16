// SPDX-License-Identifier: GPL-2.0-or-later
// What a heatmap cell says (phase-3.md 9.3, 10): header labels of an axis, the face drawn in a
// cell, its accessible name for each band, and the details (booked, available, effective effort,
// the why, the tasks). Hand-made result on the load tests' plan: Monday 2026-01-05, eight weeks.
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import type { GanttCalendar } from '../gantt/ticks';
import type { DemandMarks } from '../schedule/explain-types';
import { at, plan, weekdays } from '../schedule/testing';
import { availabilityOf } from './availability';
import { cellDetails, cellFace, cellInfo, cellName, hoursNumber } from './heat-cell';
import { axisLabels } from './heat-labels';
import { buildLoad } from './load';
import { booking, indexOf, resourceResult, withPeople } from './testing';
import { DEFAULT_THRESHOLDS, type BucketKind, type LoadModel } from './types';

const zones = createTimeZoneHost();
const T = DEFAULT_THRESHOLDS;

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev1 "Dev 1"
  resource dev3 "Dev 3"
}
resource solo "Solo"
task a "Build API" { effort 5d allocate dev1 }
task c "Login" { effort 1d allocate dev3 }
task b "Docs" { effort 1d allocate dev1 }
`;
const index = indexOf(TEXT);

function result(): ScheduleResult {
	const base = plan([
		['a', { start: at(0, 9), end: at(4, 17) }],
		['b', { start: at(7, 9), end: at(7, 17) }],
		['c', { start: at(0, 9), end: at(0, 17) }],
	]);
	const leave: Array<[number, number]> = [[at(14, 9), at(14, 17)]];
	return withPeople(
		base,
		[
			resourceResult('team', { group: true }),
			resourceResult('dev1', { parent: 'team' }),
			resourceResult('dev3', { parent: 'team', efficiency: 0.5 }),
			resourceResult('solo', {
				workingTime: weekdays(56).filter(([s]) => s !== at(14, 9)),
				leaves: [{ type: 'annual', intervals: leave }],
			}),
		],
		[
			booking(
				'dev1',
				'a',
				[0, 1, 2, 3, 4].map((d): [number, number] => [at(d, 9), at(d, 17)]),
			),
			// 9 hours in one week: over 100 % of 8 working hours... a user booking with overtime.
			booking('dev1', 'b', [[at(7, 9), at(7, 17)]]),
			booking('dev3', 'c', [[at(0, 9), at(0, 15)]]),
		],
	);
}

const DEMAND: DemandMarks = {
	held: new Map([['dev3', [{ task: 'b', window: [at(7, 9), at(7, 17)] }]]]),
	unmet: new Map(),
};

function build(kind: BucketKind = 'week', demand: DemandMarks | null = DEMAND) {
	const r = result();
	const availability = availabilityOf(r, 'plan');
	const model: LoadModel = buildLoad({
		result: r,
		index,
		zones,
		kind,
		collapsed: new Set(),
		availability,
		demand,
	});
	const cal: GanttCalendar = {
		startEpoch: Date.parse('2026-01-05T00:00:00Z') / 1000,
		env: { zone: null, zones },
		locale: 'en-GB',
	};
	return { model, availability, labels: axisLabels(cal, model.axis) };
}
const rowOf = (m: LoadModel, id: string): number => m.rows.findIndex((r) => r.id === id);

describe('axis labels', () => {
	it('labels weeks by the day they start, with months above and the period in words', () => {
		const { model, labels } = build('week');
		expect(model.axis.count).toBe(8);
		expect(labels.minor).toEqual(['5', '12', '19', '26', '2', '9', '16', '23']);
		expect(labels.major.map((g) => [g.c0, g.c1, g.name, g.year])).toEqual([
			[0, 4, 'January', '2026'],
			[4, 8, 'February', '2026'],
		]);
		expect(labels.period[0]).toBe('week of 5 January');
		expect(labels.period[4]).toBe('week of 2 February');
	});

	it('labels days and months', () => {
		const days = build('day').labels;
		expect(days.minor.slice(0, 3)).toEqual(['5', '6', '7']);
		expect(days.period[0]).toMatch(/^Monday,? 5 January$/);
		expect(days.major[0]).toMatchObject({ c0: 0, name: 'January' });
		const months = build('month').labels;
		expect(months.minor).toEqual(['Jan', 'Feb', 'Mar']);
		expect(months.period).toEqual(['January 2026', 'February 2026', 'March 2026']);
		expect(months.major.map((g) => g.name)).toEqual(['2026']);
	});

	it('keeps one set of labels per axis', () => {
		const { model, labels } = build('week');
		const cal: GanttCalendar = { startEpoch: 0, env: { zone: null, zones }, locale: 'en-GB' };
		expect(axisLabels(cal, model.axis)).toBe(labels);
	});
});

describe('cell face and name', () => {
	it('writes hours without a trailing zero', () => {
		expect(hoursNumber(2280)).toBe('38');
		expect(hoursNumber(2265)).toBe('37.75');
		expect(hoursNumber(0)).toBe('0');
		expect(hoursNumber(100)).toBe('1.67');
	});

	it('draws hours or percent, and a dash where there is no working time', () => {
		const { model, labels } = build();
		const dev1 = rowOf(model, 'dev1');
		const w0 = cellInfo(model, labels, dev1, 0, T);
		expect(cellFace(w0, 'hours')).toBe('40h');
		expect(cellFace(w0, 'percent')).toBe('100%');
		const solo = rowOf(model, 'solo');
		const leaveWeek = cellInfo(model, labels, solo, 2, T);
		expect(leaveWeek.leave).toBe(8 * 60);
		expect(cellFace(leaveWeek, 'hours')).toBe('0h');
		// A person with no working time at all in the bucket: a dash.
		const off = cellInfo(model, labels, rowOf(model, 'dev1'), 7, T);
		expect(off.band === 'off' ? cellFace(off, 'hours') : '–').toBe('–');
	});

	it('names a cell with its hours and band', () => {
		const { model, labels } = build();
		const dev1 = rowOf(model, 'dev1');
		expect(cellName(cellInfo(model, labels, dev1, 0, T), 'hours', T)).toBe(
			'Dev 1, week of 5 January: 40 of 40 hours, full',
		);
		const spare = cellInfo(model, labels, rowOf(model, 'dev3'), 0, T);
		expect(cellName(spare, 'hours', T)).toBe('Dev 3, week of 5 January: 6 of 40 hours, spare');
		expect(cellName(spare, 'percent', T)).toBe(
			'Dev 3, week of 5 January: 6 of 40 hours, spare, 15% of available time',
		);
	});

	it('says what leave and waiting work do to a cell', () => {
		const { model, labels } = build();
		const week1 = cellInfo(model, labels, rowOf(model, 'dev3'), 1, T);
		expect(week1.band).toBe('over');
		expect(cellName(week1, 'hours', T)).toBe(
			'Dev 3, week of 12 January: 0 of 40 hours, over, 1 task waits',
		);
		const solo = cellInfo(model, labels, rowOf(model, 'solo'), 2, T);
		expect(cellName(solo, 'hours', T)).toContain('8 hours of leave');
	});

	it('says over by the threshold when the minutes exceed it', () => {
		const { model, labels } = build('week', null);
		// 100 % is not over at the default; at 90 % a full week is.
		const strict = { spareBelow: 50, overAbove: 90 };
		const cell = cellInfo(model, labels, rowOf(model, 'dev1'), 0, strict);
		expect(cell.band).toBe('over');
		expect(cellName(cell, 'hours', strict)).toBe(
			'Dev 1, week of 5 January: 40 of 40 hours, over, 100% is above 90%',
		);
	});
});

describe('cell details', () => {
	it('lists the booked tasks with hours and effective effort, and the held ones', () => {
		const { model, labels, availability } = build();
		const d = cellDetails({
			model,
			labels,
			availability,
			thresholds: T,
			row: rowOf(model, 'dev3'),
			col: 0,
			taskName: (id) => index.tasks.get(id)?.name ?? id,
		});
		expect(d.effective).toBe(180);
		expect(d.tasks).toEqual([
			{ task: 'c', name: 'Login', kind: 'booked', minutes: 360, effective: 180, movable: true },
		]);
		const waiting = cellDetails({
			model,
			labels,
			availability,
			thresholds: T,
			row: rowOf(model, 'dev3'),
			col: 1,
			taskName: (id) => index.tasks.get(id)?.name ?? id,
		});
		expect(waiting.info.band).toBe('over');
		expect(waiting.why).toEqual(['1 task waits for Dev 3.']);
		expect(waiting.tasks.map((t) => [t.name, t.kind, t.effective, t.movable])).toEqual([
			['Docs', 'held', null, false],
		]);
	});

	it('gives a group the sums of its members and moves none of their tasks', () => {
		const { model, labels, availability } = build();
		const d = cellDetails({
			model,
			labels,
			availability,
			thresholds: T,
			row: rowOf(model, 'team'),
			col: 0,
			taskName: (id) => id,
		});
		expect(d.group).toBe(true);
		expect(d.info.booked).toBe(46 * 60);
		expect(d.effective).toBe(40 * 60 + 180);
		expect(d.tasks.every((t) => !t.movable)).toBe(true);
	});

	it('explains the other bands in one sentence', () => {
		const { model, labels, availability } = build('week', null);
		const input = { model, labels, availability, thresholds: T, taskName: (id: string) => id };
		expect(cellDetails({ ...input, row: rowOf(model, 'dev3'), col: 0 }).why).toEqual([
			'15% of available time, below 80%.',
		]);
		expect(cellDetails({ ...input, row: rowOf(model, 'dev1'), col: 0 }).why).toEqual([
			'100% of available time.',
		]);
	});
});
