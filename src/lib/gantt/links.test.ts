// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { DependencyResult, ScheduleResult, TaskResult } from '../../engine/protocol';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { result, task } from '../workspace/testing/fake-engine-client';
import { resolveLinks, scenarioChain } from './links';

const PLAN = `project p "P" 2026-01-05 +30d
task a "A"
task b "B" { depends !a }
task c "C" { precedes !b }
task app "App" {
  depends a
  task x "X"
  task y "Y"
}
`;
const sites = buildIndex(inline({ 'plan.tjp': PLAN }).snapshot()).dependencies;
const siteOf = (form: string, pred: string, succ: string) =>
	sites.filter((s) => s.form === form && s.pred === pred && s.succ === succ);

const dep = (id: string, over: Partial<DependencyResult> = {}): DependencyResult => ({
	task: id,
	onEnd: true,
	gapDurationMin: 0,
	gapLengthMin: 0,
	...over,
});

function withDeps(
	id: string,
	depends: DependencyResult[],
	precedes: DependencyResult[] = [],
	scenario = 'plan',
): TaskResult {
	const t = task(id, 1, 100);
	const s = t.scenarios['plan'];
	if (s) {
		s.depends = depends;
		s.precedes = precedes;
	}
	if (scenario !== 'plan' && s) {
		t.scenarios = { [scenario]: s };
	}
	return t;
}

const engineResult = (tasks: TaskResult[]): ScheduleResult => result(1, { tasks });
const resolve = (r: ScheduleResult | null, current = true, scenario: string | null = 'plan') =>
	resolveLinks({ sites, result: r, scenario, current });
const brief = (l: ReturnType<typeof resolve>) =>
	l.map((x) => `${x.pred}>${x.succ} ${x.from}-${x.to} ${x.state} ${x.sites.length}`);

describe('resolveLinks with a current engine result', () => {
	const tasks = [
		withDeps('a', []),
		withDeps('b', [dep('a')]),
		withDeps('c', [], [dep('b', { onEnd: false })]),
		withDeps('app', [dep('a')]),
		withDeps('app.x', [dep('a')]),
		withDeps('app.y', [dep('a')]),
	];

	it('draws the engine links and attaches the sites by pred, succ and form', () => {
		const links = resolve(engineResult(tasks));
		expect(brief(links)).toEqual([
			'a>b end-start declared 1',
			'c>b end-start declared 1',
			'a>app end-start declared 1',
		]);
		expect(links[0]?.sites[0]).toBe(siteOf('depends', 'a', 'b')[0]);
		// The precedes site is not the depends site of the same pair, and vice versa.
		expect(links[1]?.sites[0]).toBe(siteOf('precedes', 'c', 'b')[0]);
	});

	it('skips what a child only inherits from its parent', () => {
		const links = resolve(engineResult(tasks));
		expect(links.some((l) => l.succ === 'app.x' || l.succ === 'app.y')).toBe(false);
	});

	it('reads onstart and onend: start to start, end to end, and the gaps', () => {
		const r = engineResult([
			withDeps('b', [dep('a', { onEnd: false, gapLengthMin: 480, gapDurationMin: 60 })]),
			withDeps('c', [], [dep('b', { onEnd: true })]),
		]);
		const links = resolve(r);
		expect(brief(links)).toEqual(['a>b start-start declared 1', 'c>b end-end declared 1']);
		expect(links[0]).toMatchObject({ gapLengthMin: 480, gapDurationMin: 60 });
	});

	it('draws a link only the engine knows, as engine-only', () => {
		const r = engineResult([withDeps('x1', []), withDeps('x2', [dep('x1')])]);
		expect(brief(resolve(r))).toEqual(['x1>x2 end-start engine 0']);
	});

	it('drops a declared link the engine did not resolve: the engine is the truth', () => {
		expect(brief(resolve(engineResult([withDeps('a', []), withDeps('b', [])])))).toEqual([]);
	});

	it('keeps every site of one link', () => {
		const twice = [...sites.filter((s) => s.form === 'depends' && s.succ === 'b')];
		const copy = { ...(twice[0] as (typeof sites)[number]) };
		const links = resolveLinks({
			sites: [...sites, copy],
			result: engineResult(tasks),
			scenario: 'plan',
			current: true,
		});
		expect(links[0]?.sites).toHaveLength(2);
	});
});

describe('resolveLinks when the text is newer than the result', () => {
	it('draws a declared link the schedule lacks as pending, and keeps the ones it has', () => {
		const r = engineResult([withDeps('a', []), withDeps('b', [dep('a')])]);
		const links = resolve(r, false);
		expect(brief(links)).toEqual([
			'a>b end-start declared 1',
			'c>b end-start pending 1',
			'a>app end-start pending 1',
		]);
	});

	it('drops an engine-only link the text no longer declares', () => {
		const r = engineResult([withDeps('a', []), withDeps('b', [dep('a'), dep('gone')])]);
		expect(brief(resolve(r, false))).not.toContain('gone>b end-start engine 0');
		expect(resolve(r, true).some((l) => l.pred === 'gone')).toBe(true);
	});
});

describe('resolveLinks without engine data', () => {
	it('draws the text links, all declared, for no result or for an engine without v2 fields', () => {
		const text = [
			'a>b end-start declared 1',
			'c>b end-start declared 1',
			'a>app end-start declared 1',
		];
		expect(brief(resolve(null))).toEqual(text);
		const old = engineResult([task('a', 1, 10)]);
		const s = old.tasks[0]?.scenarios['plan'] as Record<string, unknown> | undefined;
		if (s) {
			delete s['depends'];
			delete s['precedes'];
		}
		expect(brief(resolve(old))).toEqual(text);
		expect(brief(resolve(old, false))).toEqual(text);
	});

	it('skips sites that name no task', () => {
		const missing = sites.map((s) => ({ ...s, pred: null }));
		expect(resolveLinks({ sites: missing, result: null, scenario: 'plan', current: true })).toEqual(
			[],
		);
	});
});

describe('scenarios', () => {
	const scenarios = [
		{ id: 'plan', name: 'Plan', parent: null, active: true },
		{ id: 'delayed', name: 'Delayed', parent: 'plan', active: true },
		{ id: 'other', name: 'Other', parent: null, active: true },
	];

	it('lists a scenario and its parents', () => {
		const r = result(1);
		if (r.project) r.project.scenarios = scenarios;
		expect(scenarioChain(r, 'delayed')).toEqual(['delayed', 'plan']);
		expect(scenarioChain(r, 'plan')).toEqual(['plan']);
		expect(scenarioChain(r, null)).toEqual([]);
		expect(scenarioChain(null, 'plan')).toEqual(['plan']);
	});

	it('attaches a parent scenario site to an active child scenario, and not a sibling one', () => {
		const prefixed = sites.map((s) => ({ ...s, scenario: s.succ === 'b' ? 'plan' : 'other' }));
		const r = result(1, { tasks: [withDeps('b', [dep('a')], [], 'delayed')] });
		if (r.project) r.project.scenarios = scenarios;
		const links = resolveLinks({ sites: prefixed, result: r, scenario: 'delayed', current: true });
		expect(brief(links)).toEqual(['a>b end-start declared 1']);
		// A site of an unrelated scenario does not attach: the engine's link stands alone.
		const sibling = sites.map((s) => ({ ...s, scenario: 'other' }));
		const alone = resolveLinks({ sites: sibling, result: r, scenario: 'delayed', current: true });
		expect(brief(alone)).toEqual(['a>b end-start engine 0']);
	});
});

describe('cycles (a failed run may contain them)', () => {
	it('draws a link each way between two tasks that wait on each other, and none on a task itself', () => {
		const r = engineResult([withDeps('a', [dep('b'), dep('a')]), withDeps('b', [dep('a')])]);
		const links = resolveLinks({ sites: [], result: r, scenario: 'plan', current: true });
		expect(brief(links).sort()).toEqual([
			'a>a end-start engine 0',
			'a>b end-start engine 0',
			'b>a end-start engine 0',
		]);
	});
});
