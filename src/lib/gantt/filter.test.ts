// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { BookingResult, ScheduleResult } from '../../engine/protocol';
import { buildOutline } from '../state/outline';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { result, task } from '../workspace/testing/fake-engine-client';
import { applyFilter, flagChoices, taskFlags, tasksOfPerson, type FilterFacts } from './filter';
import { NO_FILTER, isFiltering, type GanttFilter } from './filter-model';

// `ui` is on app and so inherited by every task under it; `key` is on build (api and web inherit
// it); `later` is on web alone. `docs` has a resource of the same id with a flag of its own, which
// must not become the task's. `ghost` is written but never declared.
const PLAN = `project p "P" 2026-01-05 +60d
flags ui, key, later
resource ana "Ana"
resource ben "Ben"
resource docs "Docs team" { flags later }
task app "App" {
  flags ui
  task design "Design" { effort 2d allocate ana }
  task build "Build" {
    flags key
    task api "API" { effort 3d allocate ben }
    task web "Web" { flags later effort 3d allocate ana allocate ben }
  }
  task ship "Ship" { milestone }
}
task docs "Docs" { effort 1d allocate ana { alternative ben } }
task misc "Misc" { flags ghost }
`;

function setup() {
	const index = buildIndex(inline({ 'plan.tjp': PLAN }).snapshot());
	const nodes = buildOutline(index).tasks;
	const flags = taskFlags(index);
	return { index, nodes, flags };
}

const booking = (resource: string, taskId: string, scenario = 'plan'): BookingResult => ({
	scenario,
	resource,
	task: taskId,
	intervals: [[0, 60]],
});

/** A result in which `allocated` and the first candidates are as the plan says (docs: Ben unused). */
function resultOf(bookings: BookingResult[] = []): ScheduleResult {
	const tasks = (
		[
			['app', null],
			['app.design', 'app'],
			['app.build', 'app'],
			['app.build.api', 'app.build'],
			['app.build.web', 'app.build'],
			['app.ship', 'app'],
			['docs', null],
			['misc', null],
		] as const
	).map(([id, parent], line) => task(id, line + 1, 100, { parent }));
	const set = (id: string, allocated: string[], candidates: string[][]): void => {
		const s = tasks.find((t) => t.id === id)?.scenarios['plan'];
		if (!s) throw new Error(id);
		s.allocated = allocated;
		s.allocate = candidates.map((candidates) => ({ candidates }));
	};
	set('app.design', ['ana'], [['ana']]);
	set('app.build.api', ['ben'], [['ben']]);
	// Ben is asked for by name but nothing was booked on him: still the task's person.
	set('app.build.web', ['ana'], [['ana'], ['ben']]);
	// Ben is only an alternative here, and was not used.
	set('docs', ['ana'], [['ana', 'ben']]);
	return result(1, { tasks, bookings });
}

const keys = (ids: readonly string[]): string[] => ids.map((i) => `task:${i}`);
const facts = (f: GanttFilter, bookings: BookingResult[] = []): FilterFacts => ({
	flags: setup().flags,
	ofPerson: f.person === null ? new Set() : tasksOfPerson(resultOf(bookings), f.person),
});
const view = (f: GanttFilter, bookings: BookingResult[] = []) =>
	applyFilter(setup().nodes, f, facts(f, bookings));

describe('taskFlags', () => {
	const { flags } = setup();
	const of = (id: string): string[] => [...(flags.get(id) ?? [])].sort();

	it('gives each task its own flags and its ancestors', () => {
		expect(of('app')).toEqual(['ui']);
		expect(of('app.design')).toEqual(['ui']);
		expect(of('app.build')).toEqual(['key', 'ui']);
		expect(of('app.build.api')).toEqual(['key', 'ui']);
		expect(of('app.build.web')).toEqual(['key', 'later', 'ui']);
		expect(of('app.ship')).toEqual(['ui']);
	});
	it('keeps a flag as written when it is not declared', () => {
		expect(of('misc')).toEqual(['ghost']);
	});
	it('does not take the flags of a resource that shares the task id', () => {
		expect(of('docs')).toEqual([]);
	});
});

describe('tasksOfPerson', () => {
	const of = (person: string, bookings: BookingResult[] = []): string[] =>
		[...tasksOfPerson(resultOf(bookings), person)].sort();

	it('counts a booked task, and one that asks for the person by name', () => {
		expect(of('ana')).toEqual(['app.build.web', 'app.design', 'docs']);
		expect(of('ben')).toEqual(['app.build.api', 'app.build.web']);
	});
	it('does not count an alternative that was not used', () => {
		expect(of('ben')).not.toContain('docs');
	});
	it('counts a task the person has a booking on, even when the task does not list them', () => {
		expect(of('ben', [booking('ben', 'docs')])).toContain('docs');
	});
	it('ignores another scenario, and a missing result', () => {
		expect(of('ben', [booking('ben', 'docs', 'delayed')])).not.toContain('docs');
		expect(tasksOfPerson(null, 'ben').size).toBe(0);
	});
});

describe('applyFilter', () => {
	it('is null without a filter', () => {
		expect(isFiltering(NO_FILTER)).toBe(false);
		expect(view(NO_FILTER)).toBeNull();
	});

	it('by person: the matching tasks, with their ancestors as context', () => {
		const v = view({ person: 'ana', flag: null });
		expect([...(v?.matched ?? [])]).toEqual(keys(['app.design', 'app.build.web', 'docs']));
		expect(v?.nodes.map((n) => n.key)).toEqual(
			keys(['app', 'app.design', 'app.build', 'app.build.web', 'docs']),
		);
	});

	it('leaves out the siblings that do not match, in children, posinset and setsize', () => {
		const v = view({ person: 'ana', flag: null });
		const byKey = new Map(v?.nodes.map((n) => [n.key, n]));
		expect(byKey.get('task:app')?.children).toEqual(keys(['app.design', 'app.build']));
		expect(byKey.get('task:app.build')?.children).toEqual(keys(['app.build.web']));
		expect(byKey.get('task:app.build.web')?.children).toEqual([]);
		const web = byKey.get('task:app.build.web');
		expect([web?.posinset, web?.setsize]).toEqual([1, 1]);
		const build = byKey.get('task:app.build');
		expect([build?.posinset, build?.setsize]).toEqual([2, 2]);
		const docs = byKey.get('task:docs');
		expect([docs?.posinset, docs?.setsize]).toEqual([2, 2]);
	});

	it('marks only the ancestors as not matched', () => {
		const v = view({ person: 'ben', flag: null });
		expect(v?.keep.has('task:app')).toBe(true);
		expect(v?.matched.has('task:app')).toBe(false);
		expect(v?.matched.has('task:app.build')).toBe(false);
	});

	it('by flag: tasks that carry it, inherited ones included', () => {
		const v = view({ person: null, flag: 'key' });
		expect([...(v?.matched ?? [])]).toEqual(keys(['app.build.api', 'app.build.web']));
		const ui = view({ person: null, flag: 'ui' });
		expect([...(ui?.matched ?? [])]).toEqual(
			keys(['app.design', 'app.build.api', 'app.build.web', 'app.ship']),
		);
	});

	it('a milestone carries flags too', () => {
		const v = view({ person: null, flag: 'ui' });
		expect(v?.matched.has('task:app.ship')).toBe(true);
	});

	it('by person and flag: both must hold', () => {
		const v = view({ person: 'ana', flag: 'key' });
		expect([...(v?.matched ?? [])]).toEqual(keys(['app.build.web']));
		expect(v?.nodes.map((n) => n.key)).toEqual(keys(['app', 'app.build', 'app.build.web']));
		expect([...(view({ person: 'ben', flag: 'later' })?.matched ?? [])]).toEqual(
			keys(['app.build.web']),
		);
	});

	it('an empty result has no rows', () => {
		const none = view({ person: null, flag: 'nope' });
		expect(none).not.toBeNull();
		expect(none?.nodes).toEqual([]);
		expect(none?.keep.size).toBe(0);
		expect(view({ person: 'nobody', flag: null })?.nodes).toEqual([]);
	});

	it('leaves the outline it was given alone', () => {
		const { nodes } = setup();
		const before = JSON.stringify(nodes);
		applyFilter(nodes, { person: 'ana', flag: null }, facts({ person: 'ana', flag: null }));
		expect(JSON.stringify(nodes)).toBe(before);
	});
});

describe('flagChoices', () => {
	it('lists the flags some leaf task carries, sorted, with their leaf counts', () => {
		const { nodes, flags } = setup();
		expect(flagChoices(nodes, flags)).toEqual([
			{ flag: 'ghost', count: 1 },
			{ flag: 'key', count: 2 },
			{ flag: 'later', count: 1 },
			{ flag: 'ui', count: 4 },
		]);
	});
});
