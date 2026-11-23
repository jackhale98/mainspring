// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { csvText } from './csv';
import { scenarioChain } from '../gantt/grid';
import { at, plan } from '../schedule/testing';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { csvDate, effortWords, taskRows, TASK_COLUMNS } from './tasks-csv';

const PLAN = `project p "P" 2026-01-05 +30d
task a "A" { effort 2d }
task b "B, with a comma" { length 3d }
task c "C" { duration 1w }
task d "D" { task e "E" { effort 4h } }
task f "F"
`;
const index = buildIndex(inline({ 'plan.tjp': PLAN }).snapshot());
const chain = scenarioChain(plan([]).project, 'plan');

describe('csvDate', () => {
	const utc = { start: '2026-01-05T00:00:00Z', timezone: null };

	it('writes YYYY-MM-DD HH:mm in UTC when the plan has no zone', () => {
		expect(csvDate(0, utc)).toBe('2026-01-05 00:00');
		expect(csvDate(at(1, 9), utc)).toBe('2026-01-06 09:00');
		expect(csvDate(at(3, 17) + 30, utc)).toBe('2026-01-08 17:30');
	});

	it('writes midnight as 00:00, never 24:00', () => {
		expect(csvDate(at(2, 0), utc)).toBe('2026-01-07 00:00');
	});

	it("writes the plan's local time, with its offset in winter and in summer", () => {
		const berlin = { start: '2026-03-01T23:00:00Z', timezone: 'Europe/Berlin' };
		expect(csvDate(0, berlin)).toBe('2026-03-02 00:00');
		// The clocks went forward on 2026-03-29 02:00 local time.
		expect(csvDate(30 * 1440, berlin)).toBe('2026-04-01 01:00');
	});

	describe('across the daylight saving changes of Europe/Berlin', () => {
		const start = '2026-01-01T00:00:00Z';
		const berlin = { start, timezone: 'Europe/Berlin' };
		/** Minutes after the project start of a UTC instant. */
		const at = (iso: string): number => (Date.parse(iso) - Date.parse(start)) / 60_000;

		it('skips the hour that does not exist on 2026-03-29 (02:00 becomes 03:00)', () => {
			expect(csvDate(at('2026-03-29T00:59:00Z'), berlin)).toBe('2026-03-29 01:59');
			expect(csvDate(at('2026-03-29T01:00:00Z'), berlin)).toBe('2026-03-29 03:00');
			expect(csvDate(at('2026-03-29T01:30:00Z'), berlin)).toBe('2026-03-29 03:30');
		});

		it('writes the repeated hour of 2026-10-25 twice, an hour apart in time', () => {
			expect(csvDate(at('2026-10-24T23:59:00Z'), berlin)).toBe('2026-10-25 01:59');
			// 02:30 CEST, then 02:30 CET: the same text for two instants (the zone has no more to give).
			expect(csvDate(at('2026-10-25T00:30:00Z'), berlin)).toBe('2026-10-25 02:30');
			expect(csvDate(at('2026-10-25T01:30:00Z'), berlin)).toBe('2026-10-25 02:30');
			expect(csvDate(at('2026-10-25T02:00:00Z'), berlin)).toBe('2026-10-25 03:00');
		});

		it('is an hour ahead of UTC in winter and two in summer, at midnight too', () => {
			expect(csvDate(at('2026-01-15T23:00:00Z'), berlin)).toBe('2026-01-16 00:00');
			expect(csvDate(at('2026-07-15T22:00:00Z'), berlin)).toBe('2026-07-16 00:00');
		});
	});

	it('falls back to UTC for a zone Intl does not know', () => {
		expect(csvDate(60, { start: '2026-01-05T00:00:00Z', timezone: 'Not/AZone' })).toBe(
			'2026-01-05 01:00',
		);
	});
});

describe('effortWords', () => {
	const of = (id: string) => effortWords(index.tasks.get(id), chain);

	it('is the effort as the plan writes it', () => {
		expect(of('a')).toBe('2d');
		expect(of('d.e')).toBe('4h');
	});

	it('is empty for a length, a duration, a container, no statement and no task', () => {
		expect(of('b')).toBe('');
		expect(of('c')).toBe('');
		expect(of('d')).toBe('');
		expect(of('f')).toBe('');
		expect(effortWords(undefined, chain)).toBe('');
	});
});

describe('taskRows', () => {
	function result(): ScheduleResult {
		const r = plan(
			[
				['a', { start: at(0, 9), end: at(1, 17) }],
				['b', { start: at(2, 9), end: at(4, 17) }],
				['f', { start: null, end: null, scheduled: false }],
			],
			{ timezone: null },
		);
		const [a, b] = r.tasks;
		if (a && b) {
			a.name = 'A';
			b.name = 'B, with a comma';
			const sa = a.scenarios['plan'];
			if (sa) {
				sa.allocated = ['ana', 'ben'];
				sa.complete = 50;
			}
		}
		const f = r.tasks[2];
		if (f) f.name = 'F';
		return {
			...r,
			resources: [
				{ id: 'ana', name: 'Ana', parent: null, source: null, group: false, scenarios: {} },
				{ id: 'ben', name: 'Ben', parent: null, source: null, group: false, scenarios: {} },
			],
		};
	}
	const rows = () =>
		taskRows({
			result: result(),
			scenario: 'plan',
			chain,
			symbol: (id) => index.tasks.get(id),
		});

	it('has the header first, then a row per task in the result order', () => {
		const r = rows();
		expect(r[0]).toEqual([...TASK_COLUMNS]);
		expect(r.slice(1).map((x) => x[0])).toEqual(['a', 'b', 'f']);
	});

	it('reads the dates, effort, people and completion from the result and the index', () => {
		const [, a, b, f] = rows();
		expect(a).toEqual(['a', 'A', '2026-01-05 09:00', '2026-01-06 17:00', '2d', 'Ana; Ben', '50']);
		expect(b).toEqual(['b', 'B, with a comma', '2026-01-07 09:00', '2026-01-09 17:00', '', '', '']);
		expect(f).toEqual(['f', 'F', '', '', '', '', '']);
	});

	it('quotes what needs it in the file text', () => {
		const text = csvText(rows());
		expect(text.split('\r\n')[0]).toBe('id,name,start,end,effort,people,complete');
		expect(text).toContain('b,"B, with a comma",2026-01-07 09:00,');
	});

	it('writes the end of a task that ends at midnight as that midnight, not the day before', () => {
		const r = plan([['a', { start: at(0, 9), end: at(2, 0) }]]);
		const rows = taskRows({ result: r, scenario: 'plan', chain, symbol: () => undefined });
		// The Gantt's END column says Jan 6 (the last day worked); the file keeps the instant.
		expect(rows[1]?.slice(2, 4)).toEqual(['2026-01-05 09:00', '2026-01-07 00:00']);
	});

	it('writes no dates for a scenario the task has no result in', () => {
		const r = taskRows({
			result: result(),
			scenario: 'delayed',
			chain: ['delayed', 'plan'],
			symbol: () => undefined,
		});
		expect(r[1]?.slice(2)).toEqual(['', '', '', '', '']);
	});

	it('is just the header for a plan with no tasks', () => {
		const r = taskRows({
			result: plan([]),
			scenario: 'plan',
			chain,
			symbol: () => undefined,
		});
		expect(r).toEqual([[...TASK_COLUMNS]]);
	});
});
