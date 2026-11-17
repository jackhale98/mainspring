// SPDX-License-Identifier: GPL-2.0-or-later
// H7, H8 and H9 (people.ts) on hand-made results over inline text. H7 and H8 take their marks
// from `DemandMarks` only: given marks the explainer did not make, nothing is found, and the marks
// it makes are the findings, one per task and person. H9: each message with its sentence's facts,
// priority_inversion's info lines, and "Replace person…" for allocate_no_assigned.
import { describe, expect, it } from 'vitest';
import type { EngineMessage } from '../../engine/protocol';
import type { DemandMarks } from '../schedule/explain-types';
import { at, plan, type TaskSpec } from '../schedule/testing';
import { booking, resourceResult, withPeople } from '../workload/testing';
import { checkPlan } from './report';
import { inlineInput, ofCheck, only } from './testing';
import type { CheckId } from './types';

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource team "Team" {
  resource dev "Dev"
  resource ann "Ann"
}
resource bo "Bo"
task a "A" {
  allocate dev
}
task b "B" {
  allocate dev
}
task c "C" {
  allocate team
}
`;

function withAllocate(spec: TaskSpec, candidates: string[]): TaskSpec {
	return { ...spec, scenarios: { plan: { allocate: [{ candidates }] } } };
}

const RESULT = withPeople(
	plan([
		['a', withAllocate({ start: at(0, 9), end: at(2, 17) }, ['dev'])],
		['b', withAllocate({ start: at(3, 9), end: at(4, 17) }, ['dev'])],
		['c', withAllocate({ start: at(3, 9), end: at(4, 17) }, ['team'])],
	]),
	[
		resourceResult('team', { group: true }),
		resourceResult('dev', { parent: 'team' }),
		resourceResult('ann', { parent: 'team' }),
		resourceResult('bo'),
	],
	[
		booking('dev', 'a', [
			[at(0, 9), at(0, 17)],
			[at(1, 9), at(1, 17)],
			[at(2, 9), at(2, 17)],
		]),
		booking('dev', 'b', [
			[at(3, 9), at(3, 17)],
			[at(4, 9), at(4, 17)],
		]),
		booking('ann', 'c', [[at(3, 9), at(4, 17)]]),
	],
);

function run<C extends CheckId>(check: C, demand: DemandMarks, messages: EngineMessage[] = []) {
	const input = inlineInput({ ...RESULT, messages }, TEXT, only(check));
	return ofCheck(checkPlan({ ...input, demand }).findings, check);
}

const marks = (held: DemandMarks['held'], unmet: DemandMarks['unmet'] = new Map()) => ({
	held,
	unmet,
});

describe('H7 held by people', () => {
	it('makes one finding per task and person, from the marks only', () => {
		const f = run(
			'held-by-people',
			marks(
				new Map([
					[
						'dev',
						[
							{ task: 'b', window: [0, at(1, 12)] as [number, number] },
							{ task: 'b', window: [at(2, 9), at(3, 9)] as [number, number] },
							{ task: 'c', window: [0, at(3, 9)] as [number, number] },
						],
					],
					['ann', [{ task: 'c', window: [0, at(3, 9)] as [number, number] }]],
				]),
			),
		);
		expect(f.map((x) => [x.subject, x.facts])).toEqual([
			// Mon all day and Tue 09:00-12:00, then Wed: 2.4 working days, booked on A throughout.
			[
				{ kind: 'task', id: 'b' },
				{ resource: 'dev', days: 2.4, on: 'a' },
			],
			[
				{ kind: 'task', id: 'c' },
				{ resource: 'dev', days: 3, on: 'a' },
			],
			// Ann has no booking in the wait: on leave or off.
			[
				{ kind: 'task', id: 'c' },
				{ resource: 'ann', days: 3, on: null },
			],
		]);
		expect(f[0]?.fixes).toEqual([
			{ kind: 'replace-person', task: 'b', from: 'dev', disabled: null },
			{ kind: 'open', view: 'workload', resource: 'dev', at: 0, disabled: null },
			{ kind: 'why', task: 'b', disabled: null },
		]);
		// C asks for the group: "Replace person…" replaces the group as written.
		expect(f[1]?.fixes[0]).toEqual({
			kind: 'replace-person',
			task: 'c',
			from: 'team',
			disabled: null,
		});
	});

	it('finds nothing without marks, whatever the bookings show', () => {
		expect(run('held-by-people', marks(new Map()))).toEqual([]);
	});
});

describe('H8 work without its people', () => {
	it('counts the windows inside the person’s working time', () => {
		const f = run(
			'work-without-people',
			marks(
				new Map(),
				new Map([['dev', [{ task: 'c', window: [at(3, 9), at(4, 17)] as [number, number] }]]]),
			),
		);
		// Thu and Fri, 8 hours each; the night between is not working time.
		expect(f.map((x) => [x.subject, x.facts])).toEqual([
			[
				{ kind: 'task', id: 'c' },
				{ resource: 'dev', minutes: 960 },
			],
		]);
		expect(f[0]?.fixes).toEqual([
			{ kind: 'replace-person', task: 'c', from: 'team', disabled: null },
			{ kind: 'open', view: 'workload', resource: 'dev', at: at(3, 9), disabled: null },
		]);
	});
});

const message = (id: string, text: string, level: EngineMessage['level'] = 'warning') => ({
	level,
	id,
	text,
	file: 'plan.tjp',
	line: 7,
	column: null,
	scenario: 'plan',
});

describe('H9 resource warnings', () => {
	it('gives each warning its facts and fixes, with priority_inversion’s info lines', () => {
		const f = run('resource-warning', marks(new Map()), [
			message(
				'allocate_no_assigned',
				"Task c has resource allocation requested, but did not get any resources assigned. Either use 'effort' to ensure allocations or use a higher 'priority'.",
			),
			message(
				'priority_inversion',
				'Due to a mix of ALAP and ASAP scheduled tasks or a dependency on a lower priority tasks the following tasks stole resources from b despite having a lower priority:',
			),
			message('priority_inversion_info', 'Task a', 'info'),
			message('priority_inversion_info', 'Task c', 'info'),
			message(
				'overbooked_effort',
				'The total effort (3.5d or 28.0h) of the provided bookings for task a exceeds the specified effort of 2.0d or 16.0h.',
			),
			message(
				'overbooked_length',
				'The total length (4d) of the provided bookings for task b exceeds the specified length of 3d.',
			),
			message(
				'overbooked_duration',
				'The total duration (4d) of the provided bookings for task b exceeds the specified duration of 3d.',
			),
			message('task_depend_unknown', 'Task a has unknown depends.'),
		]);
		expect(f.map((x) => [x.subject, x.facts.message, x.facts.task, x.facts.tasks])).toEqual([
			[{ kind: 'message', index: 0 }, 'allocate_no_assigned', 'c', []],
			[{ kind: 'message', index: 1 }, 'priority_inversion', 'b', ['a', 'c']],
			[{ kind: 'message', index: 4 }, 'overbooked_effort', 'a', []],
			[{ kind: 'message', index: 5 }, 'overbooked_length', 'b', []],
			[{ kind: 'message', index: 6 }, 'overbooked_duration', 'b', []],
		]);
		expect(f[0]?.fixes).toEqual([
			{ kind: 'show', disabled: null },
			{ kind: 'replace-person', task: 'c', from: 'team', disabled: null },
		]);
		expect(f[1]?.fixes).toEqual([{ kind: 'show', disabled: null }]);
		expect(f.every((x) => x.severity === 'warning' && x.at?.file === 'plan.tjp')).toBe(true);
	});

	it('disables "Replace person…" for an allocation written with a macro', () => {
		const text = TEXT.replace(
			'task c "C" {\n  allocate team',
			'macro t [team]\ntask c "C" {\n  allocate ${t}',
		);
		const input = inlineInput(
			{
				...RESULT,
				messages: [
					message(
						'allocate_no_assigned',
						'Task c has resource allocation requested, but did not get any.',
					),
				],
			},
			text,
			only('resource-warning'),
		);
		const [f] = checkPlan(input).findings;
		expect(f?.fixes[1]).toEqual({
			kind: 'replace-person',
			task: 'c',
			from: 'team',
			disabled: 'macro-call',
		});
	});
});
