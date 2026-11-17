// SPDX-License-Identifier: GPL-2.0-or-later
// H3 and H4 (constraints.ts) on hand-made results over inline text: own and inherited
// constraints, the nearest site, scenarios, `maxstart` not being a hard constraint, macro dates;
// H4's message filter, days, and a message whose task the result lacks.
import { describe, expect, it } from 'vitest';
import type { EngineMessage } from '../../engine/protocol';
import { contextOf, zones } from '../schedule/explain-testing';
import { displayDate } from '../schedule/date-text';
import { at, dep, plan, project, type TaskSpec } from '../schedule/testing';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { checkPlan } from './report';
import { inlineInput, inputOf, ofCheck, only } from './testing';

const HEAD = 'project p "P" 2026-01-05 - 2026-03-02 {\n}\n';
const A: [string, TaskSpec] = ['a', { start: at(0, 9), end: at(1, 17) }];

function h3(text: string, tasks: Array<[string, TaskSpec]> = [A]) {
	const r = checkPlan(inlineInput(plan(tasks), HEAD + text, only('hard-constraint')));
	return ofCheck(r.findings, 'hard-constraint');
}

describe('H3 hard constraint', () => {
	it('reports each of start, end, minstart and maxend written on the task, with its date', () => {
		const f = h3(
			'task a "A" {\n  start 2026-01-05\n  end 2026-01-07\n  minstart 2026-01-05\n  maxend 2026-01-09\n  maxstart 2026-01-06\n}\n',
		);
		expect(f.map((x) => [x.facts.attr, x.facts.date, x.facts.applies, x.severity])).toEqual([
			['start', 0, 1, 'info'],
			['end', 2 * 1440, 1, 'info'],
			['minstart', 0, 1, 'info'],
			['maxend', 4 * 1440, 1, 'info'],
		]);
		const p = project();
		expect(f[0]?.fixes).toEqual([
			{
				kind: 'intent',
				label: `Remove start (${displayDate(0, p)})`,
				intent: { type: 'removeAttr', task: 'a', attr: 'start' },
				disabled: null,
			},
			{ kind: 'why', task: 'a', disabled: null },
		]);
		// An end date is shown as the last day it allows (the minute before it).
		expect(f[1]?.fixes[0]).toMatchObject({
			label: `Remove end (${displayDate(2 * 1440, p, { end: true })})`,
		});
	});

	it('reports a site once, on the task that writes it, with the tasks it binds', () => {
		const tasks: Array<[string, TaskSpec]> = [
			['g', { start: at(0, 9), end: at(1, 17) }],
			['g.a', { start: at(0, 9), end: at(1, 17), parent: 'g' }],
			['g.b', { start: at(0, 9), end: at(1, 17), parent: 'g' }],
			['g.b.c', { start: at(0, 9), end: at(1, 17), parent: 'g.b' }],
			['h', { start: at(0, 9), end: at(1, 17) }],
		];
		const f = h3(
			'task g "G" {\n  start 2026-01-05\n  minstart 2026-01-05\n  task a "A" {\n  }\n  task b "B" {\n    minstart 2026-01-06\n    task c "C" {\n    }\n  }\n}\ntask h "H" {\n}\n',
			tasks,
		);
		expect(
			f.map((x) => [
				x.subject.kind === 'task' && x.subject.id,
				x.facts,
				x.fixes.map((y) => (y.kind === 'intent' ? y.intent : y.kind === 'why' ? y.task : null)),
			]),
		).toEqual([
			// G, A, B and C: B's own minstart overrides G's for B and C.
			[
				'g',
				{ attr: 'start', date: 0, applies: 4 },
				[{ type: 'removeAttr', task: 'g', attr: 'start' }, 'g'],
			],
			[
				'g',
				{ attr: 'minstart', date: 0, applies: 2 },
				[{ type: 'removeAttr', task: 'g', attr: 'minstart' }, 'g'],
			],
			[
				'g.b',
				{ attr: 'minstart', date: 1440, applies: 2 },
				[{ type: 'removeAttr', task: 'g.b', attr: 'minstart' }, 'g.b'],
			],
		]);
		// At the statement that writes it.
		expect(f[0]?.at?.file).toBe('plan.tjp');
	});

	it('reads a scenario-prefixed constraint in its scenario only', () => {
		const text = `project p "P" 2026-01-05 - 2026-03-02 {\n  scenario plan "Plan" {\n    scenario alt "Alt"\n  }\n}\ntask a "A" {\n  alt:start 2026-01-06\n}\n`;
		const scenarios = [
			{ id: 'plan', name: 'Plan', parent: null, active: true },
			{ id: 'alt', name: 'Alt', parent: 'plan', active: true },
		];
		const r = plan([['a', { start: at(0, 9), end: at(1, 17), scenarios: { alt: {} } }]], {
			scenarios,
		});
		const index = buildIndex(inline({ 'plan.tjp': text }).snapshot(), undefined, {
			cache: null,
			zones,
		});
		const run = (s: string) =>
			checkPlan(inputOf(contextOf(r, index, s), only('hard-constraint'))).findings.map(
				(f) => f.facts,
			);
		expect(run('plan')).toEqual([]);
		expect(run('alt')).toEqual([{ attr: 'start', date: 1440, applies: 1 }]);
	});

	it('shows no date for a macro-written one, and disables "Remove" as text-only', () => {
		const f = h3('macro d [2026-01-05]\ntask a "A" {\n  start ${d}\n}\n');
		expect(f.map((x) => [x.facts, x.fixes.map((y) => y.disabled)])).toEqual([
			[{ attr: 'start', date: null, applies: 1 }, ['macro-call', null]],
		]);
		expect(f[0]?.fixes[0]).toMatchObject({ label: 'Remove start' });
	});

	it('reports a container’s own site, and nothing on its children', () => {
		const tasks: Array<[string, TaskSpec]> = [
			['g', { start: at(0, 9), end: at(1, 17) }],
			['g.a', { start: at(0, 9), end: at(1, 17), parent: 'g', depends: [dep('x')] }],
		];
		const f = h3('task g "G" {\n  start 2026-01-05\n  task a "A" {\n  }\n}\n', tasks);
		expect(f.map((x) => [x.subject, x.facts.applies])).toEqual([[{ kind: 'task', id: 'g' }, 2]]);
	});
});

const warn = (id: string, text: string, scenario: string | null = 'plan'): EngineMessage => ({
	level: 'warning',
	id,
	text,
	file: 'plan.tjp',
	line: 3,
	column: null,
	scenario,
});

function h4(messages: EngineMessage[]) {
	const r = { ...plan([A]), messages };
	const report = checkPlan(inlineInput(r, `${HEAD}task a "A" {\n}\n`, only('constraint-warning')));
	return { findings: ofCheck(report.findings, 'constraint-warning') };
}

describe('H4 constraint warning', () => {
	it('reads the limit and the working days between it and the date, pinned to the task', () => {
		const r = h4([
			warn(
				'maxstart',
				'The start time (2026-01-08-09:00-+0000) of task a is too late. Must be before 2026-01-06-00:00-+0000.',
			),
			warn(
				'minend',
				'The end time (2026-01-06-17:00-+0000) of task a is too early. Must be after 2026-01-09-12:00-+0000.',
			),
		]);
		expect(r.findings.map((f) => [f.subject, f.facts.limit, f.facts.days, f.facts.task])).toEqual([
			[{ kind: 'message', index: 0 }, 'maxstart', 2, 'a'],
			// Wed, Thu and Fri 09:00-12:00: 19 hours, 2.4 days of 8 hours.
			[{ kind: 'message', index: 1 }, 'minend', 2.4, 'a'],
		]);
		expect(r.findings[0]?.fixes).toEqual([
			{ kind: 'show', disabled: null },
			{ kind: 'why', task: 'a', disabled: null },
		]);
		expect(r.findings[0]?.at?.file).toBe('plan.tjp');
	});

	it('keeps the shown scenario’s messages and warnings only', () => {
		const t =
			'The start time (2026-01-05-09:00-+0000) of task a is too early. Must be after 2026-01-06-00:00-+0000.';
		const r = h4([
			warn('minstart', t, 'other'),
			{ ...warn('minstart', t), level: 'info' },
			warn('minstart', t, null),
			warn('task_start_range', t),
		]);
		expect(r.findings.map((f) => f.subject)).toEqual([{ kind: 'message', index: 2 }]);
	});

	it('names no task, and gives no "Why here?", for a task the result does not have', () => {
		const r = h4([warn('maxend', 'The end time of task gone is too late. Must be before then.')]);
		expect(r.findings.map((f) => [f.facts.task, f.facts.days, f.at, f.fixes])).toEqual([
			[null, 0, null, [{ kind: 'show', disabled: null }]],
		]);
	});
});
