// SPDX-License-Identifier: GPL-2.0-or-later
// What the task inspector reads (task.ts, field.ts, links.ts, project.ts), on the
// gantt-manipulation fixture with its golden result: sizes, inherited and text-only fields,
// people, the open-ended case (11.1), links with gaps, and the project header.
import { describe, expect, it } from 'vitest';
import { analyseResult } from '../schedule/critical';
import { fixtureFrom, manipulation } from '../gantt/intents-testing';
import { resolveLinks } from '../gantt/links';
import { finishScenario } from '../schedule/finish';
import { at, plan } from '../schedule/testing';
import { assignable, declaredFlags, taskDetails } from './task';
import { findLink, gapText, linksOfTask } from './links';
import { projectDetails } from './project';

const fx = manipulation();
const analysis = analyseResult(fx.result);
const details = (id: string) => {
	const d = taskDetails({ index: fx.index, result: fx.result, analysis }, id);
	if (!d) throw new Error(`no task ${id}`);
	return d;
};

describe('size', () => {
	it('reads the written kind and value', () => {
		expect(details('design.research').size).toMatchObject({
			kind: 'own',
			attr: 'effort',
			amount: 3,
			unit: 'd',
			text: '3d',
		});
		expect(details('design.sketch').size).toMatchObject({ attr: 'length', text: '4d' });
		expect(details('design.review').size).toMatchObject({ attr: 'duration', text: '2d' });
	});

	it('has none for a task with no size, and is blocked for a container and a milestone', () => {
		expect(details('spike').size.kind).toBe('none');
		expect(details('design').size).toMatchObject({ kind: 'blocked', why: 'container' });
		expect(details('design.gate').size).toMatchObject({ kind: 'blocked', why: 'milestone' });
	});

	it('takes the last statement for the shown scenario, whichever keyword', () => {
		const f = fixtureFrom(
			{
				'plan.tjp': 'project p "P" 2026-01-05 +8w\ntask a "A" {\n  effort 2d\n  length 3d\n}\n',
			},
			'plan.tjp',
			plan([['a', { start: at(0, 9), end: at(2, 17) }]]),
		);
		const d = taskDetails({ index: f.index, result: f.result, analysis: null }, 'a');
		expect(d?.size).toMatchObject({ attr: 'length', text: '3d' });
	});

	it('says text-only for a size written with a macro', () => {
		const f = fixtureFrom(
			{
				'plan.tjp':
					'project p "P" 2026-01-05 +8w\nmacro len [ 3d ]\ntask a "A" {\n  effort ${len}\n}\n',
			},
			'plan.tjp',
			plan([['a', { start: at(0, 9), end: at(2, 17) }]]),
		);
		const d = taskDetails({ index: f.index, result: f.result, analysis: null }, 'a');
		expect(d?.size).toMatchObject({ kind: 'text-only', reason: 'macro-call' });
	});
});

describe('fields', () => {
	it('reads own statements as the text writes them', () => {
		const d = details('design.research');
		expect(d.complete).toMatchObject({ kind: 'own', text: '40' });
		expect(details('design.docs').end).toMatchObject({ kind: 'own', text: '2026-03-27' });
		expect(details('design.docs').scheduling).toMatchObject({ kind: 'own', text: 'alap' });
		expect(details('launch').start).toMatchObject({ kind: 'own', text: '2026-05-04' });
		expect(d.start.kind).toBe('unset');
	});

	it('says where an inherited value comes from', () => {
		const f = fixtureFrom(
			{
				'plan.tjp':
					'project p "P" 2026-01-05 +8w\ntask g "Group" {\n  priority 800\n  task a "A" { effort 1d }\n  task b "B" {\n    priority 100\n    effort 1d\n  }\n}\n',
			},
			'plan.tjp',
			plan([
				['g.a', { start: at(0, 9), end: at(0, 17) }],
				['g.b', { start: at(1, 9), end: at(1, 17) }],
			]),
		);
		const read = (id: string) =>
			taskDetails({ index: f.index, result: f.result, analysis: null }, id);
		expect(read('g.a')?.priority).toMatchObject({
			kind: 'inherited',
			text: '800',
			from: 'g',
			fromName: 'Group',
		});
		expect(read('g.b')?.priority).toMatchObject({ kind: 'own', text: '100' });
		expect(read('g')?.priority).toMatchObject({ kind: 'own', text: '800' });
	});

	it('lists the people a task writes and the ones it inherits', () => {
		expect(details('design.research').people).toEqual([{ id: 'dev1', name: 'Dev 1', own: true }]);
		const hotfix = details('support.hotfix').people;
		expect(hotfix).toHaveLength(1);
		expect(hotfix[0]).toMatchObject({ id: 'ops1', own: false });
		expect(details('launch').responsible.own).toEqual(['dev1']);
	});

	it('offers leaf resources and the declared flags', () => {
		const ids = assignable(fx.index).map((r) => r.id);
		expect(ids).toContain('dev1');
		expect(Array.isArray(declaredFlags(fx.index))).toBe(true);
	});
});

describe('the open-ended case (11.1)', () => {
	it('flags a leaf with a person, no size and no end', () => {
		expect(details('spike')).toMatchObject({ openEnded: true, openEndedIfSolid: false });
		expect(details('design.research').openEnded).toBe(false);
		// A fixed end closes it; so does a size.
		expect(details('launch').openEnded).toBe(false);
	});

	it('knows when clearing a milestone would open the task', () => {
		const f = fixtureFrom(
			{
				'plan.tjp':
					'project p "P" 2026-01-05 +8w\nresource r "R"\ntask a "A" {\n  start 2026-01-06\n  milestone\n  allocate r\n}\n',
			},
			'plan.tjp',
			plan([['a', { start: at(1, 9), end: at(1, 9), milestone: true }]]),
		);
		const d = taskDetails({ index: f.index, result: f.result, analysis: null }, 'a');
		expect(d).toMatchObject({ milestone: true, openEnded: false, openEndedIfSolid: true });
	});
});

describe('the schedule block', () => {
	it('reads the engine dates and the display estimates', () => {
		const d = details('design.sketch');
		expect(d.engine.scheduled).toBe(true);
		expect(d.engine.start).toBeLessThan(d.engine.end ?? 0);
		expect(d.engine.driver).toMatchObject({ kind: 'dependency', pred: 'design.research' });
		expect(d.engine.driverName).toBe('Research');
		expect(typeof d.engine.critical).toBe('boolean');
	});

	it('has no estimates until the analysis is there', () => {
		const d = taskDetails({ index: fx.index, result: fx.result, analysis: null }, 'design.sketch');
		expect(d?.engine).toMatchObject({ critical: null, floatMin: null, driver: null });
	});
});

describe('links', () => {
	const links = resolveLinks({
		sites: fx.index.dependencies,
		result: fx.result,
		scenario: finishScenario(fx.result),
		current: true,
	});
	const project = fx.result.project;

	it('lists what a task waits for, with its gap, and what follows it', () => {
		const sketch = linksOfTask(links, 'design.sketch', fx.index, project);
		expect(sketch.waitsFor).toHaveLength(1);
		expect(sketch.waitsFor[0]).toMatchObject({
			pred: 'design.research',
			predName: 'Research',
			type: 'finish-start',
			editable: true,
			gap: { kind: 'gaplength', text: '2d', both: false },
		});
		const research = linksOfTask(links, 'design.research', fx.index, project);
		expect(research.followedBy.map((l) => l.succ)).toContain('design.sketch');
	});

	it('knows the start-to-start link and finds a link by its two tasks', () => {
		const l = findLink(links, 'design.sketch', 'design.review', fx.index, project);
		expect(l?.type).toBe('start-start');
		expect(findLink(links, 'nope', 'design.review', fx.index, project)).toBeNull();
	});

	it('writes a gap in whole days, then hours, then minutes', () => {
		expect(gapText(960, 'gaplength', project)).toBe('2d');
		expect(gapText(240, 'gaplength', project)).toBe('4h');
		expect(gapText(45, 'gaplength', project)).toBe('45min');
		expect(gapText(2880, 'gapduration', project)).toBe('2d');
	});
});

describe('project', () => {
	it('reads the header as written', () => {
		const p = projectDetails(fx.index, fx.snap);
		expect(p).toMatchObject({ name: 'Gantt manipulation', start: '2026-03-02', end: '2026-06-30' });
		expect(p?.now).toMatchObject({ kind: 'own', text: '2026-03-09-09:00' });
		expect(p?.timezone.kind).toBe('unset');
	});

	it('shows an end written as a duration as written', () => {
		const f = fixtureFrom(
			{ 'plan.tjp': 'project p "P" 2026-01-05 +17w {\n  timezone "Europe/Berlin"\n}\n' },
			'plan.tjp',
			plan([]),
		);
		const p = projectDetails(f.index, f.snap);
		expect(p).toMatchObject({ start: '2026-01-05', end: '+17w' });
		expect(p?.timezone).toMatchObject({ kind: 'own', text: 'Europe/Berlin' });
	});
});
