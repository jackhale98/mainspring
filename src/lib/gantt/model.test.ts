// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { ScheduleResult, TaskResult } from '../../engine/protocol';
import { buildOutline } from '../state/outline';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { result } from '../workspace/testing/fake-engine-client';
import { resolveLinks } from './links';
import { EMPTY_MODEL, buildGanttModel, type GanttAnalysis, type ModelInput } from './model';
import { MIN_PER_DAY } from './scale';

const PLAN = `project p "P" 2026-01-05 +30d
task app "App" {
  task ui "UI" { effort 2d }
  task api "API" { depends !ui effort 3d }
  task ship "Ship" { milestone depends !api }
}
task docs "Docs" { precedes app.ship }
`;

function scheduled(
	id: string,
	start: number | null,
	end: number | null,
	over: Partial<TaskResult> = {},
	scheduledFlag = true,
): TaskResult {
	return {
		id,
		name: id,
		parent: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
		source: null,
		milestone: false,
		scenarios: {
			plan: {
				scheduled: scheduledFlag,
				start,
				end,
				allocated: ['dev'],
				criticalness: 0,
				pathCriticalness: 0,
				direction: 'asap',
				complete: null,
				depends: [],
				precedes: [],
			},
		},
		...over,
	};
}

const D = MIN_PER_DAY;
const TASKS: TaskResult[] = [
	scheduled('app', 0, 6 * D),
	scheduled('app.ui', 0, 2 * D),
	scheduled('app.api', 2 * D, 5 * D),
	scheduled('app.ship', 5 * D, 5 * D, { milestone: true }),
	scheduled('docs', 0, D),
];

function input(over: Partial<ModelInput> = {}, res: ScheduleResult | null = null) {
	const ws = inline({ 'plan.tjp': PLAN });
	const snap = ws.snapshot();
	const index = buildIndex(snap);
	const outline = buildOutline(index);
	const r = res ?? result(1, { tasks: TASKS });
	const base: ModelInput = {
		nodes: outline.tasks,
		collapsed: new Set(),
		result: r,
		dimmed: false,
		links: resolveLinks({
			sites: index.dependencies,
			result: null,
			scenario: 'plan',
			current: true,
		}),
		analysis: null,
		nowMs: null,
	};
	return { ...base, ...over };
}

describe('buildGanttModel', () => {
	it('joins the outline rows with the engine dates by id', () => {
		const m = buildGanttModel(input());
		expect(m.rows.map((r) => [r.id, r.depth, r.kind, r.start, r.end])).toEqual([
			['app', 0, 'container', 0, 6 * D],
			['app.ui', 1, 'task', 0, 2 * D],
			['app.api', 1, 'task', 2 * D, 5 * D],
			['app.ship', 1, 'milestone', 5 * D, 5 * D],
			['docs', 0, 'task', 0, D],
		]);
		expect(m.rows[0]).toMatchObject({ expanded: true, scheduled: true, allocated: ['dev'] });
		expect(m.rows[1]).toMatchObject({ expanded: null });
		expect(m.scenario).toBe('plan');
		expect(m.scheduled).toBe(true);
		expect(m.revision).toBe(1);
		expect(m.rowOf.get('task:app.api')).toBe(2);
	});

	it('shows rows without bars before the first schedule', () => {
		const m = buildGanttModel(input({ result: null }));
		expect(m.rows).toHaveLength(5);
		expect(m.rows.every((r) => !r.scheduled && r.start === null && r.end === null)).toBe(true);
		expect(m.scheduled).toBe(false);
		expect(m.calendar).toBeNull();
		expect(m.endMin).toBeGreaterThan(m.originMin);
	});

	it('gives a new task a row with no bar, and drops a deleted one at once', () => {
		const partial = result(1, { tasks: TASKS.filter((t) => t.id !== 'app.api') });
		const m = buildGanttModel(input({ result: partial }));
		const api = m.rows.find((r) => r.id === 'app.api');
		expect(api).toMatchObject({ scheduled: false, start: null, end: null });
		const outline = buildOutline(
			buildIndex(inline({ 'plan.tjp': PLAN.replace('docs', 'x') }).snapshot()),
		);
		const fewer = buildGanttModel(input({ nodes: outline.tasks.slice(0, 2) }));
		expect(fewer.rows.map((r) => r.id)).toEqual(['app', 'app.ui']);
	});

	it('does not give a task an end when the engine left it unscheduled', () => {
		const res = result(1, { tasks: [scheduled('docs', 0, D, {}, false)] });
		const m = buildGanttModel(input({}, res));
		expect(m.rows.find((r) => r.id === 'docs')).toMatchObject({
			scheduled: false,
			start: null,
			end: null,
		});
	});

	it('hides the children of a collapsed container', () => {
		const m = buildGanttModel(input({ collapsed: new Set(['task:app']) }));
		expect(m.rows.map((r) => r.id)).toEqual(['app', 'docs']);
		expect(m.rows[0]).toMatchObject({ kind: 'container', expanded: false });
	});

	it('draws the links the text declares, normalising precedes', () => {
		const m = buildGanttModel(input());
		expect(m.links.map((l) => [l.pred, l.succ, l.predRow, l.succRow])).toEqual([
			['app.ui', 'app.api', 1, 2],
			['app.api', 'app.ship', 2, 3],
			['docs', 'app.ship', 4, 3],
		]);
		expect(
			m.links.every((l) => l.state === 'declared' && l.sites.length === 1 && !l.critical),
		).toBe(true);
	});

	it('attaches the links of hidden children to the collapsed container', () => {
		const m = buildGanttModel(input({ collapsed: new Set(['task:app']) }));
		// ui>api and api>ship are inside app and vanish; docs>ship ends on app's own row.
		expect(m.links.map((l) => [l.pred, l.predRow, l.succRow])).toEqual([['docs', 1, 0]]);
	});

	it('keeps every site, the surest state and the critical mark when collapsed rows merge', () => {
		const first = { id: 1 } as never;
		const second = { id: 2 } as never;
		const nodes = input().nodes;
		const links = [
			{
				pred: 'docs',
				succ: 'app.ui',
				from: 'end',
				to: 'start',
				state: 'pending',
				sites: [first],
				gapDurationMin: 0,
				gapLengthMin: 0,
			},
			{
				pred: 'docs',
				succ: 'app.api',
				from: 'end',
				to: 'start',
				state: 'declared',
				sites: [second, first],
				gapDurationMin: 0,
				gapLengthMin: 0,
			},
		] as const;
		const m = buildGanttModel({
			...input({ nodes, links, collapsed: new Set(['task:app']) }),
			analysis: {
				critical: new Set(),
				criticalLinks: new Set(['docs>app.api']),
				floatMin: new Map(),
				lateEnd: new Map(),
			},
		});
		expect(m.links).toHaveLength(1);
		expect(m.links[0]).toMatchObject({ predRow: 1, succRow: 0, state: 'declared', critical: true });
		expect(m.links[0]?.sites).toEqual([first, second]);
	});

	it('keeps links of different types between the same rows apart', () => {
		const links = [
			{
				pred: 'app.ui',
				succ: 'app.api',
				from: 'end',
				to: 'start',
				state: 'declared',
				sites: [],
				gapDurationMin: 0,
				gapLengthMin: 0,
			},
			{
				pred: 'app.ui',
				succ: 'app.api',
				from: 'start',
				to: 'start',
				state: 'declared',
				sites: [],
				gapDurationMin: 0,
				gapLengthMin: 0,
			},
		] as const;
		expect(buildGanttModel(input({ links })).links.map((l) => [l.from, l.to])).toEqual([
			['end', 'start'],
			['start', 'start'],
		]);
	});

	it('marks critical rows and links from an analysis, when there is one', () => {
		const analysis: GanttAnalysis = {
			critical: new Set(['app.ui', 'app.api']),
			criticalLinks: new Set(['app.ui>app.api']),
			floatMin: new Map([['docs', 2 * D]]),
			lateEnd: new Map([['docs', 3 * D]]),
		};
		const m = buildGanttModel(input({ analysis }));
		expect(m.rows.filter((r) => r.critical).map((r) => r.id)).toEqual(['app.ui', 'app.api']);
		expect(m.rows[4]).toMatchObject({ floatMin: 2 * D, lateEnd: 3 * D, critical: false });
		expect(m.links.filter((l) => l.critical).map((l) => l.pred)).toEqual(['app.ui']);
	});

	it('keeps the dimmed flag and reads the status date and today in minutes', () => {
		const res = result(2, { tasks: TASKS });
		if (res.project) {
			res.project.now = '2026-01-07T12:00:00Z';
		}
		const nowMs = Date.parse('2026-01-06T00:00:00Z');
		const m = buildGanttModel(input({ dimmed: true, nowMs }, res));
		expect(m.dimmed).toBe(true);
		expect(m.statusMin).toBe(2 * D + 720);
		expect(m.todayMin).toBe(D);
		expect(m.calendar?.startEpoch).toBe(Date.parse('2026-01-05T00:00:00Z') / 1000);
	});

	it('frames the schedule with some air, inside the project frame', () => {
		const m = buildGanttModel(input());
		expect(m.originMin).toBe(0);
		expect(m.endMin).toBe(6 * D + 7 * D);
		const tight = result(1, { tasks: TASKS });
		if (tight.project) tight.project.end = '2026-01-12T00:00:00Z';
		expect(buildGanttModel(input({}, tight)).endMin).toBe(7 * D);
	});

	it('has an empty model for no plan', () => {
		expect(EMPTY_MODEL.rows).toEqual([]);
	});
});
