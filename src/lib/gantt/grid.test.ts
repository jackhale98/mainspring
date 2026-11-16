// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { project } from '../schedule/testing';
import { gridCells, scenarioChain, sizingOf, spokenText, type GridRowInput } from './grid';
import type { RowLinkRef } from './row-links';
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

describe('sizingOf in scenarios, and when the last statement wins', () => {
	const SCENARIOS = `project p "P" 2026-01-05 +30d {
  scenario plan "Plan" {
    scenario delayed "Delayed"
  }
}
macro size [ 3d ]
task last "Last wins" { effort 2d
  length 3d }
task only "Delayed only" { delayed:effort 4d }
task over "Plan override" { effort 2d
  plan:effort 7d }
task spec "Specific wins" { delayed:effort 4d
  effort 2d }
task mac "Macro" { effort \${size} }
task none "None"
`;
	const index = buildIndex(inline({ 'plan.tjp': SCENARIOS }).snapshot());
	const scenarios = [
		{ id: 'plan', name: 'Plan', parent: null, active: true },
		{ id: 'delayed', name: 'Delayed', parent: 'plan', active: true },
	];
	const plan = scenarioChain({ scenarios }, 'plan');
	const delayed = scenarioChain({ scenarios }, 'delayed');
	const of = (id: string, chain: readonly string[]) => sizingOf(index.tasks.get(id), chain);

	it('builds the chain from the shown scenario up through its parents', () => {
		expect(plan).toEqual(['plan']);
		expect(delayed).toEqual(['delayed', 'plan']);
		expect(scenarioChain(null, null)).toEqual([]);
		expect(scenarioChain({ scenarios }, 'nope')).toEqual(['nope']);
	});

	it('takes the last of effort, length and duration, as TaskJuggler does', () => {
		expect(of('last', plan)).toBe('3d length');
	});

	it("does not show another scenario's size while the plan is shown", () => {
		expect(of('only', plan)).toBeNull();
		expect(of('only', delayed)).toBe('4d effort');
	});

	it('lets a statement for the plan override an earlier unscoped one', () => {
		expect(of('over', plan)).toBe('7d effort');
	});

	it('lets the shown scenario beat its parent, whatever the order', () => {
		expect(of('spec', plan)).toBe('2d effort');
		expect(of('spec', delayed)).toBe('4d effort');
	});

	it('says a macro wrote the size, rather than showing nothing', () => {
		expect(of('mac', plan)).toBe('From a macro');
		expect(of('none', plan)).toBeNull();
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
			'number',
			'name',
			'start',
			'end',
			'effort',
			'people',
			'float',
			'critical',
			'status',
			'predecessors',
			'successors',
		]);
	});

	it('writes a task with its first and last working day, its size and its people', () => {
		// Ends at the start of Thursday: the last day worked is Wednesday.
		expect(texts(0)).toEqual([
			'1',
			'Code',
			'Jan 5, 2026',
			'Jan 7, 2026',
			'5d effort',
			'Ana, Ben',
			'0',
			'Yes',
			'Scheduled',
			'–',
			'–',
		]);
	});

	it('labels the float in working days, and says No for a task off the critical path', () => {
		const c = gridCells(model.rows[1]!, input);
		expect(c.map((x) => x.text)).toEqual([
			'2',
			'Ship',
			'Jan 8, 2026',
			'Jan 8, 2026',
			'–',
			'–',
			'3 working days',
			'No',
			'Scheduled',
			'–',
			'–',
		]);
	});

	it('shows a dash for what it does not know, and a screen reader hears "none"', () => {
		const c = gridCells(model.rows[2]!, input);
		expect(c.slice(2, 8).every((x) => x.blank && x.text === '–')).toBe(true);
		expect(spokenText(c[2]!)).toBe('none');
		expect(spokenText(c[1]!)).toBe('Later');
		expect(c[8]?.text).toBe('Not scheduled');
	});

	it('does not claim a task is off the critical path before the estimate exists', () => {
		const c = texts(0, { analysis: null });
		expect(c.slice(6, 8)).toEqual(['–', '–']);
	});

	it('marks scheduled rows out of date while the newest run has failed', () => {
		const stale = { ...model, dimmed: true };
		const status = (i: number) =>
			gridCells(stale.rows[i]!, { ...input, model: stale }).find((c) => c.column === 'status')
				?.text;
		expect(status(0)).toBe('Out of date');
		expect(status(2)).toBe('Not scheduled');
		expect(status(3)).toBe('Text only');
	});

	it('puts text only above pending above scheduled in the status column', () => {
		expect(texts(3)[8]).toBe('Text only');
		expect(texts(0, { pending: new Set([model.rows[0]!.key]) })[8]).toBe('Pending');
	});
});

describe('the number and link cells', () => {
	const ref = (number: number, name: string, over: Partial<RowLinkRef> = {}): RowLinkRef => ({
		id: name.toLowerCase(),
		number,
		name,
		type: 'finish-start',
		gaps: [],
		state: 'declared',
		...over,
	});
	const rows = [row(0, 0, D), row(1, D, 2 * D), row(2, 2 * D, 3 * D)];
	const model = modelOf(rows, [], {
		rowInfo: new Map([
			[
				rows[0]!.key,
				{ number: 1, predecessors: [], successors: [ref(2, 'Sketch'), ref(3, 'Build')] },
			],
			[
				rows[1]!.key,
				{
					number: 2,
					predecessors: [ref(1, 'Research'), ref(4, 'Brief', { type: 'start-start' })],
					successors: [ref(3, 'Build', { gaps: [{ kind: 'gaplength', text: '+2d' }] })],
				},
			],
			[
				rows[2]!.key,
				{
					number: 3,
					predecessors: [
						ref(2, 'Sketch', {
							type: 'finish-finish',
							gaps: [
								{ kind: 'gaplength', text: '+4h' },
								{ kind: 'gapduration', text: '+1d' },
							],
						}),
						ref(1, 'Research', { state: 'pending' }),
					],
					successors: [],
				},
			],
		]),
	});
	const input: GridRowInput = { model, analysis: null, sizing: () => null };
	const cells = (i: number) => gridCells(model.rows[i]!, input);
	const of = (i: number, col: string) => cells(i).find((c) => c.column === col)!;

	it('numbers the row and lists the links by row number, with the kind and the gap', () => {
		expect(of(1, 'number').text).toBe('2');
		expect(of(0, 'successors').text).toBe('2, 3');
		expect(of(1, 'predecessors').text).toBe('1, 4SS');
		expect(of(1, 'successors').text).toBe('3 +2d');
		expect(of(2, 'predecessors').text).toBe('2FF +4h +1d, 1');
	});

	it('says the task names to a screen reader, not the numbers', () => {
		expect(spokenText(of(1, 'predecessors'))).toBe(
			'Predecessors: Research, Brief (start to start)',
		);
		expect(spokenText(of(1, 'successors'))).toBe('Successors: Build (plus 2 days)');
		expect(spokenText(of(2, 'predecessors'))).toBe(
			'Predecessors: Sketch (finish to finish, plus 4 hours, plus 1 day calendar time), Research (not scheduled yet)',
		);
	});

	it('gives the ids on hover, in the same words', () => {
		expect(of(1, 'predecessors').hint).toBe('Waits for: research, brief (start to start)');
		expect(of(0, 'successors').hint).toBe('Followed by: sketch, build');
	});

	it('is blank, a dash and "none", when a row has no link', () => {
		const c = of(2, 'successors');
		expect(c).toMatchObject({ text: '–', blank: true });
		expect(spokenText(c)).toBe('none');
		expect(c.hint).toBeUndefined();
		expect(of(0, 'predecessors').blank).toBe(true);
	});

	it('is blank for a row the model has no numbers for', () => {
		const bare = { ...model, rowInfo: new Map() };
		const c = gridCells(bare.rows[0]!, { ...input, model: bare });
		const picked = c.filter((x) => ['number', 'predecessors', 'successors'].includes(x.column));
		expect(picked).toHaveLength(3);
		expect(picked.every((x) => x.blank)).toBe(true);
	});
});
