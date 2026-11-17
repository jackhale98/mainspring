// SPDX-License-Identifier: GPL-2.0-or-later
// The ARIA mirror's model (phase-3.md 8.1, 10): the window and its caps, the counts and indexes of
// the whole grid, the names and exact minutes of the cells, row levels, and the keys that move the
// focus.
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import type { GanttCalendar } from '../gantt/ticks';
import { at, plan, weekdays } from '../schedule/testing';
import { availabilityOf } from './availability';
import { axisLabels } from './heat-labels';
import {
	MIRROR_COLS,
	MIRROR_ROWS,
	buildMirror,
	mirrorRange,
	moveFocus,
	type NavDims,
} from './heat-mirror';
import { buildLoad } from './load';
import { booking, indexOf, resourceResult, withPeople } from './testing';
import { DEFAULT_THRESHOLDS } from './types';

const zones = createTimeZoneHost();
const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev1 "Dev 1"
  resource dev2 "Dev 2"
}
resource solo "Solo"
task a "A" { effort 5d allocate dev1 }
`;
const index = indexOf(TEXT);

function fixture(collapsed: string[] = []) {
	const r: ScheduleResult = withPeople(
		plan([['a', { start: at(0, 9), end: at(4, 17) }]]),
		[
			resourceResult('team', { group: true }),
			resourceResult('dev1', { parent: 'team' }),
			resourceResult('dev2', { parent: 'team' }),
			resourceResult('solo', { workingTime: weekdays(56) }),
		],
		[
			booking('dev1', 'a', [
				[at(0, 9), at(0, 17)],
				[at(1, 9), at(1, 13)],
			]),
		],
	);
	const model = buildLoad({
		result: r,
		index,
		zones,
		kind: 'week',
		collapsed: new Set(collapsed),
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

describe('mirror window', () => {
	it('keeps the visible cells when they fit the caps', () => {
		expect(mirrorRange({ r0: 2, r1: 10, c0: 1, c1: 9 }, null)).toEqual({
			r0: 2,
			r1: 10,
			c0: 1,
			c1: 9,
		});
	});

	it('cuts to the caps, around the focused cell when there is one', () => {
		const big = { r0: 0, r1: 100, c0: 0, c1: 80 };
		const start = mirrorRange(big, null);
		expect([start.r1 - start.r0, start.c1 - start.c0]).toEqual([MIRROR_ROWS, MIRROR_COLS]);
		expect([start.r0, start.c0]).toEqual([0, 0]);
		const around = mirrorRange(big, { row: 50, col: 40 });
		expect(around).toEqual({ r0: 35, r1: 65, c0: 30, c1: 50 });
		// Near an edge the window stays inside the visible block.
		expect(mirrorRange(big, { row: 99, col: 79 })).toEqual({ r0: 70, r1: 100, c0: 60, c1: 80 });
		expect(mirrorRange(big, { row: 0, col: 0 })).toEqual({ r0: 0, r1: 30, c0: 0, c1: 20 });
	});
});

describe('mirror model', () => {
	it('says how big the whole grid is and where the window stands in it', () => {
		const { model, labels } = fixture();
		const m = buildMirror({
			model,
			labels,
			thresholds: DEFAULT_THRESHOLDS,
			unit: 'hours',
			range: { r0: 1, r1: 3, c0: 2, c1: 4 },
		});
		expect(m.ariaRowCount).toBe(5);
		expect(m.ariaColCount).toBe(9);
		expect(m.columns.map((c) => [c.col, c.ariaColIndex])).toEqual([
			[2, 4],
			[3, 5],
		]);
		expect(m.rows.map((r) => [r.id, r.ariaRowIndex, r.level, r.parent])).toEqual([
			['dev1', 3, 2, 'Team'],
			['dev2', 4, 2, 'Team'],
		]);
		expect(m.rows[0]?.cells.map((c) => c.ariaColIndex)).toEqual([4, 5]);
	});

	it('carries the names and exact minutes of the cells', () => {
		const { model, labels } = fixture();
		const m = buildMirror({
			model,
			labels,
			thresholds: DEFAULT_THRESHOLDS,
			unit: 'hours',
			range: { r0: 0, r1: 4, c0: 0, c1: 1 },
		});
		const [team, dev1, , solo] = m.rows;
		expect(team).toMatchObject({ group: true, expanded: true, level: 1, parent: null });
		expect(dev1?.cells[0]).toMatchObject({
			name: 'Dev 1, week of 5 January: 12 of 40 hours, spare',
			face: '12h',
			band: 'spare',
			booked: 720,
			available: 2400,
		});
		// A group is the sum of its members.
		expect(team?.cells[0]).toMatchObject({ booked: 720, available: 4800 });
		expect(solo?.cells[0]).toMatchObject({ booked: 0, available: 2400 });
	});

	it('shows percent when asked, and leaves a collapsed group without its members', () => {
		const { model, labels } = fixture(['team']);
		expect(model.rows.map((r) => r.id)).toEqual(['team', 'solo']);
		const m = buildMirror({
			model,
			labels,
			thresholds: DEFAULT_THRESHOLDS,
			unit: 'percent',
			range: { r0: 0, r1: 2, c0: 0, c1: 1 },
		});
		expect(m.rows[0]).toMatchObject({ expanded: false });
		expect(m.rows[0]?.cells[0]?.face).toBe('15%');
		expect(m.ariaRowCount).toBe(3);
	});

	it('skips rows the model does not have', () => {
		const { model, labels } = fixture();
		const m = buildMirror({
			model,
			labels,
			thresholds: DEFAULT_THRESHOLDS,
			unit: 'hours',
			range: { r0: 3, r1: 9, c0: 0, c1: 1 },
		});
		expect(m.rows.map((r) => r.id)).toEqual(['solo']);
	});
});

describe('keyboard', () => {
	const d: NavDims = { rows: 6, cols: 10, page: 3, today: 4 };
	const from = { row: 2, col: 5 };
	const key = (k: string, o: Record<string, boolean> = {}) => moveFocus(from, { key: k, ...o }, d);

	it('moves by arrows and stops at the edges', () => {
		expect(key('ArrowUp')).toEqual({ row: 1, col: 5 });
		expect(key('ArrowDown')).toEqual({ row: 3, col: 5 });
		expect(key('ArrowLeft')).toEqual({ row: 2, col: 4 });
		expect(key('ArrowRight')).toEqual({ row: 2, col: 6 });
		expect(moveFocus({ row: 0, col: 0 }, { key: 'ArrowUp' }, d)).toBeNull();
		expect(moveFocus({ row: 5, col: 9 }, { key: 'ArrowRight' }, d)).toBeNull();
	});

	it('goes to the ends of the row, and with Ctrl to the corners', () => {
		expect(key('Home')).toEqual({ row: 2, col: 0 });
		expect(key('End')).toEqual({ row: 2, col: 9 });
		expect(key('Home', { ctrl: true })).toEqual({ row: 0, col: 0 });
		expect(key('End', { ctrl: true })).toEqual({ row: 5, col: 9 });
	});

	it('pages by rows and clamps', () => {
		expect(key('PageDown')).toEqual({ row: 5, col: 5 });
		expect(key('PageUp')).toEqual({ row: 0, col: 5 });
		expect(moveFocus({ row: 4, col: 1 }, { key: 'PageDown' }, d)).toEqual({ row: 5, col: 1 });
	});

	it('T goes to today in the same row, and only when today is in the frame', () => {
		expect(key('t')).toEqual({ row: 2, col: 4 });
		expect(key('T')).toEqual({ row: 2, col: 4 });
		expect(moveFocus(from, { key: 't' }, { ...d, today: null })).toBeNull();
		expect(moveFocus({ row: 2, col: 4 }, { key: 't' }, d)).toBeNull();
	});

	it('leaves Alt, Shift and other keys to others', () => {
		expect(key('ArrowUp', { alt: true })).toBeNull();
		expect(key('ArrowUp', { shift: true })).toBeNull();
		expect(key('Enter')).toBeNull();
		expect(key('x')).toBeNull();
		expect(moveFocus(from, { key: 'ArrowUp' }, { ...d, rows: 0 })).toBeNull();
	});
});

describe('mirror extra words', () => {
	it("adds a view's words after a cell's sentence, and nothing where it has none", () => {
		const { model, labels } = fixture();
		const m = buildMirror({
			model,
			labels,
			thresholds: DEFAULT_THRESHOLDS,
			unit: 'hours',
			range: { r0: 1, r1: 3, c0: 0, c1: 1 },
			extra: (row) => (row === 1 ? 'works on A 12 h' : ''),
		});
		const [dev1, dev2] = m.rows;
		expect(dev1?.cells[0]?.name).toBe(
			'Dev 1, week of 5 January: 12 of 40 hours, spare, works on A 12 h',
		);
		expect(dev2?.cells[0]?.name).not.toContain('works on');
	});
});
