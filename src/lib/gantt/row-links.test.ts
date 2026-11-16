// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { DependencyResult, ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { buildOutline } from '../state/outline';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { result, task } from '../workspace/testing/fake-engine-client';
import { resolveLinks } from './links';
import { buildGanttModel, type RawLink } from './model';
import { gapOf } from '../inspector/links';
import { rowInfoOf } from './row-links';

// Two files: `plan.tjp` includes `later.tji`, whose tasks depend on ones in the plan file and
// the other way round. `delayed:depends` applies to one scenario only.
const PLAN = `project p "P" 2026-01-05 +60d {
  scenario plan "Plan" { scenario delayed "Delayed" }
}
task app "App" {
  task ui "UI" { effort 2d }
  task api "API" { depends !ui effort 3d }
  task ship "Ship" { milestone depends !api }
}
include "later.tji"
task docs "Docs" { precedes app.ship }
`;
const LATER = `task qa "QA" {
  depends app.api
  delayed:depends app.ui
}
task launch "Launch" { depends qa, docs }
`;

function setup() {
	const index = buildIndex(inline({ 'plan.tjp': PLAN, 'later.tji': LATER }).snapshot());
	const outline = buildOutline(index);
	return { index, nodes: outline.tasks };
}

const dep = (id: string, over: Partial<DependencyResult> = {}): DependencyResult => ({
	task: id,
	onEnd: true,
	gapDurationMin: 0,
	gapLengthMin: 0,
	...over,
});

function raw(pred: string, succ: string, over: Partial<RawLink> = {}): RawLink {
	return {
		pred,
		succ,
		from: 'end',
		to: 'start',
		state: 'declared',
		sites: [],
		gapDurationMin: 0,
		gapLengthMin: 0,
		...over,
	};
}

/** Per task, "number: preds | succs" as the table lists the numbers. */
function brief(info: ReturnType<typeof rowInfoOf>, key: string): string {
	const i = info.get(key);
	if (!i) return 'missing';
	return `${i.number}: ${i.predecessors.map((r) => r.number).join(',')} | ${i.successors
		.map((r) => r.number)
		.join(',')}`;
}

const PROJECT = {
	start: '2026-01-05T00:00:00.000Z',
	dailyWorkingHours: 8,
	weeklyWorkingDays: 5,
	timingResolutionMin: 60,
} as unknown as ProjectInfo;

describe('rowInfoOf: row numbers', () => {
	const { index, nodes } = setup();
	const links = resolveLinks({
		sites: index.dependencies,
		result: null,
		scenario: 'plan',
		current: true,
	});
	const info = rowInfoOf(nodes, links, null);

	it('numbers every task in outline order from 1, the other file included', () => {
		expect(nodes.map((n) => n.id)).toEqual([
			'app',
			'app.ui',
			'app.api',
			'app.ship',
			'qa',
			'launch',
			'docs',
		]);
		expect(nodes.map((n) => info.get(n.key)?.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('counts the rows a collapsed group hides, so no number moves when it collapses', () => {
		const collapsed = buildGanttModel({
			nodes,
			collapsed: new Set(['task:app']),
			result: null,
			dimmed: false,
			links,
			analysis: null,
		});
		const open = buildGanttModel({
			nodes,
			collapsed: new Set(),
			result: null,
			dimmed: false,
			links,
			analysis: null,
		});
		// The group's children are not rows now, but qa is still 5, launch 6 and docs 7.
		expect(collapsed.rows.map((r) => r.id)).toEqual(['app', 'qa', 'launch', 'docs']);
		const numbers = (m: typeof open) =>
			m.rows.map((r) => [r.id, m.rowInfo.get(r.key)?.number] as const);
		expect(numbers(collapsed)).toEqual([
			['app', 1],
			['qa', 5],
			['launch', 6],
			['docs', 7],
		]);
		expect(numbers(open)[4]).toEqual(['qa', 5]);
		// The link lists of the rows that stay are the same, too.
		expect(collapsed.rowInfo).toEqual(open.rowInfo);
	});

	it('keeps a number with its task while the order is unchanged, and moves it when it changes', () => {
		const without = rowInfoOf(
			nodes.filter((n) => n.id !== 'app.ui'),
			[],
			null,
		);
		expect(without.get('task:app.api')?.number).toBe(2);
		expect(info.get('task:app.api')?.number).toBe(3);
		expect(rowInfoOf([], [], null).size).toBe(0);
	});
});

describe('rowInfoOf: the link lists', () => {
	const { index, nodes } = setup();
	const links = resolveLinks({
		sites: index.dependencies,
		result: null,
		scenario: 'plan',
		current: true,
	});
	const info = rowInfoOf(nodes, links, null);

	it('lists what a task waits for and what waits for it, by row number, in row order', () => {
		// 2 UI, 3 API, 4 Ship, 5 QA, 6 Launch, 7 Docs.
		expect(brief(info, 'task:app.ui')).toBe('2:  | 3');
		expect(brief(info, 'task:app.api')).toBe('3: 2 | 4,5');
		expect(brief(info, 'task:app.ship')).toBe('4: 3,7 | ');
		expect(brief(info, 'task:docs')).toBe('7:  | 4,6');
		expect(brief(info, 'task:launch')).toBe('6: 5,7 | ');
	});

	it('shows a link written in another file, the same as one written beside the task', () => {
		// QA and Launch are declared in later.tji; their links to the plan file's tasks show.
		const qa = info.get('task:qa');
		expect(qa?.predecessors.map((r) => [r.number, r.id, r.name])).toContainEqual([
			3,
			'app.api',
			'API',
		]);
		expect(qa?.successors.map((r) => r.id)).toEqual(['launch']);
	});

	it('shows a link of the shown scenario only when the engine says it applies there', () => {
		// QA also waits for UI in the delayed scenario only. Without a result both are text links;
		// with the engine's plan result, only what the plan scenario resolved stays.
		const text = resolveLinks({
			sites: index.dependencies,
			result: null,
			scenario: 'delayed',
			current: true,
		});
		expect(brief(rowInfoOf(nodes, text, null), 'task:qa').split(' | ')[0]).toBe('5: 2,3');
		const t = (id: string, depends: DependencyResult[]) => {
			const x = task(id, 1, 100);
			const s = x.scenarios['plan'];
			if (s) s.depends = depends;
			return x;
		};
		const r: ScheduleResult = result(1, {
			tasks: [t('app.api', []), t('qa', [dep('app.api')])],
		});
		const engine = resolveLinks({
			sites: index.dependencies,
			result: r,
			scenario: 'plan',
			current: true,
		});
		expect(brief(rowInfoOf(nodes, engine, null), 'task:qa').split(' | ')[0]).toBe('5: 3');
	});

	it('shows a link only the engine knows (a macro) and one the schedule lacks yet', () => {
		const engineOnly = raw('docs', 'app.api', { state: 'engine' });
		const pending = raw('app.ui', 'launch', { state: 'pending' });
		const i = rowInfoOf(nodes, [engineOnly, pending], null);
		expect(i.get('task:app.api')?.predecessors).toMatchObject([{ number: 7, state: 'engine' }]);
		expect(i.get('task:launch')?.predecessors).toMatchObject([{ number: 2, state: 'pending' }]);
	});

	it('lists each end of a pair once per kind of link, and leaves out links to no task', () => {
		const i = rowInfoOf(
			nodes,
			[
				raw('app.ui', 'app.api'),
				raw('app.ui', 'app.api', { from: 'start' }),
				raw('app.ui', 'missing'),
				raw('app.api', 'app.api'),
			],
			null,
		);
		expect(i.get('task:app.api')?.predecessors.map((r) => [r.number, r.type])).toEqual([
			[2, 'finish-start'],
			[2, 'start-start'],
		]);
		expect(i.get('task:app.api')?.successors).toEqual([]);
	});
});

describe('rowInfoOf: gaps and kinds', () => {
	const { nodes } = setup();
	const one = (over: Partial<RawLink>) =>
		rowInfoOf(nodes, [raw('app.ui', 'app.api', over)], PROJECT).get('task:app.api')
			?.predecessors[0];

	it('has no gap and the usual type for a plain dependency', () => {
		expect(one({})).toMatchObject({ gaps: [], type: 'finish-start' });
	});

	it('writes a working-time gap in whole days, else hours', () => {
		expect(one({ gapLengthMin: 2 * 480 })?.gaps).toEqual([{ kind: 'gaplength', text: '+2d' }]);
		expect(one({ gapLengthMin: 240 })?.gaps).toEqual([{ kind: 'gaplength', text: '+4h' }]);
	});

	it('writes a calendar gap as its own kind', () => {
		expect(one({ gapDurationMin: 2 * 1440 })?.gaps).toEqual([{ kind: 'gapduration', text: '+2d' }]);
	});

	it('lists both gaps of a link that has both, as the details do, working time first', () => {
		expect(one({ gapLengthMin: 480, gapDurationMin: 2 * 1440 })?.gaps).toEqual([
			{ kind: 'gaplength', text: '+1d' },
			{ kind: 'gapduration', text: '+2d' },
		]);
	});

	it('writes the gap the way the details do, through the same function', () => {
		const rel = rowInfoOf(nodes, [raw('app.ui', 'app.api', { gapLengthMin: 90 })], PROJECT);
		expect(rel.get('task:app.api')?.predecessors[0]?.gaps).toEqual([
			{
				kind: 'gaplength',
				text: `+${gapOf({ gapLengthMin: 90, gapDurationMin: 0 }, PROJECT)?.text}`,
			},
		]);
	});

	it('shows no gap before a schedule exists: without the working day "960min" says nothing', () => {
		const before = rowInfoOf(nodes, [raw('app.ui', 'app.api', { gapLengthMin: 960 })], null);
		expect(before.get('task:app.api')?.predecessors[0]).toMatchObject({ gaps: [], number: 2 });
	});

	it('reads the link type from where it leaves and where it enters', () => {
		expect(one({ from: 'start' })?.type).toBe('start-start');
		expect(one({ to: 'end' })?.type).toBe('finish-finish');
		expect(one({ from: 'start', to: 'end' })?.type).toBe('start-finish');
	});
});
