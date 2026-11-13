// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { project } from '../schedule/testing';
import { gridCells, sizingOf, spokenText, type GridRowInput } from './grid';
import { D, modelOf, row } from './testing';

const calendar = { startEpoch: Date.UTC(2026, 0, 5) / 1000, env: { zone: null }, locale: 'en-US' };

const PLAN = `project p "P" 2026-01-05 +30d
task a "A" { effort 2d }
task b "B" { length 3d }
task c "C" { duration 1w }
task d "D" {
  scenario_dummy_not_used 1
}
task e "E" { effort 4h }
task f "F"
`;

describe('sizingOf', () => {
	const index = buildIndex(inline({ 'plan.tjp': PLAN }).snapshot());
	const of = (id: string) => sizingOf(index.tasks.get(id));

	it('reads effort, length and duration as written, with the attribute named', () => {
		expect(of('a')).toBe('2d effort');
		expect(of('b')).toBe('3d length');
		expect(of('c')).toBe('1w duration');
		expect(of('e')).toBe('4h effort');
	});

	it('is null for a task with none, and for no task', () => {
		expect(of('f')).toBeNull();
		expect(sizingOf(undefined)).toBeNull();
	});
});

describe('gridCells', () => {
	const analysis = {
		critical: new Set(['t0']),
		floatMin: new Map([
			['t0', 0],
			['t1', 3 * 480],
		]),
	};
	const model = modelOf(
		[
			row(0, 0, 3 * D, 'task', { name: 'Code', people: ['Ana', 'Ben'] }),
			row(1, 3 * D, 3 * D, 'milestone', { name: 'Ship' }),
			row(2, null, null, 'task', { name: 'Later' }),
			row(3, 0, D, 'task', { name: 'Doc', textOnly: 'macro-id' }),
		],
		[],
		{ calendar, project: project() },
	);
	const input: GridRowInput = {
		model,
		analysis,
		sizing: (id) => (id === 't0' ? '5d effort' : null),
	};
	const texts = (i: number, over: Partial<GridRowInput> = {}) =>
		gridCells(model.rows[i]!, { ...input, ...over }).map((c) => c.text);

	it('has one cell per column, in the order of the spec', () => {
		expect(gridCells(model.rows[0]!, input).map((c) => c.column)).toEqual([
			'name',
			'start',
			'end',
			'effort',
			'people',
			'float',
			'critical',
			'status',
		]);
	});

	it('writes a task with its first and last working day, its size and its people', () => {
		// Ends at the start of Thursday: the last day worked is Wednesday.
		expect(texts(0)).toEqual([
			'Code',
			'Jan 5, 2026',
			'Jan 7, 2026',
			'5d effort',
			'Ana, Ben',
			'0',
			'Yes',
			'Scheduled',
		]);
	});

	it('labels the float in working days, and says No for a task off the critical path', () => {
		const c = gridCells(model.rows[1]!, input);
		expect(c.map((x) => x.text)).toEqual([
			'Ship',
			'Jan 8, 2026',
			'Jan 8, 2026',
			'–',
			'–',
			'3 working days',
			'No',
			'Scheduled',
		]);
	});

	it('shows a dash for what it does not know, and a screen reader hears "none"', () => {
		const c = gridCells(model.rows[2]!, input);
		expect(c.slice(1, 7).every((x) => x.blank && x.text === '–')).toBe(true);
		expect(spokenText(c[1]!)).toBe('none');
		expect(spokenText(c[0]!)).toBe('Later');
		expect(c[7]?.text).toBe('Not scheduled');
	});

	it('does not claim a task is off the critical path before the estimate exists', () => {
		const c = texts(0, { analysis: null });
		expect(c.slice(5, 7)).toEqual(['–', '–']);
	});

	it('puts text only above pending above scheduled in the status column', () => {
		expect(texts(3)[7]).toBe('Text only');
		expect(texts(0, { pending: new Set([model.rows[0]!.key]) })[7]).toBe('Pending');
	});
});
