// SPDX-License-Identifier: GPL-2.0-or-later
// Plan health types (phase-3.md 6.4, section 12): the default settings, and compile checks of the
// interface (`npm run typecheck` enforces them). The checks' tests come with T11's code.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	DEFAULT_HEALTH_SETTINGS,
	type CheckId,
	type CheckPlanFn,
	type Finding,
	type Fix,
	type HealthInput,
	type HealthReport,
	type Subject,
} from './types';

/** H1 to H9 in section 12's order. */
const CHECKS = [
	'no-predecessor',
	'no-successor',
	'hard-constraint',
	'constraint-warning',
	'long-gap',
	'long-task',
	'held-by-people',
	'work-without-people',
	'resource-warning',
] as const satisfies readonly CheckId[];

describe('health types (6.4)', () => {
	it('has the nine checks of section 12', () => {
		expectTypeOf<(typeof CHECKS)[number]>().toEqualTypeOf<CheckId>();
	});

	it('defaults to a 5-day long gap and a 20-day long task, every check on (18.8)', () => {
		const s = DEFAULT_HEALTH_SETTINGS;
		expect(s.longGapDays).toBe(5);
		expect(s.longTaskDays).toBe(20);
		expect(Object.keys(s.enabled).sort()).toEqual([...CHECKS].sort());
		expect(CHECKS.every((c) => s.enabled[c])).toBe(true);
		expect(Object.isFrozen(s) && Object.isFrozen(s.enabled)).toBe(true);
	});

	it('names the subjects and fixes of 6.4', () => {
		expectTypeOf<Subject['kind']>().toEqualTypeOf<'task' | 'link' | 'message'>();
		expectTypeOf<Fix['kind']>().toEqualTypeOf<
			'intent' | 'pick' | 'replace-person' | 'open' | 'why' | 'show'
		>();
		expectTypeOf<CheckPlanFn>().parameters.toEqualTypeOf<[HealthInput]>();
		expectTypeOf<CheckPlanFn>().returns.toEqualTypeOf<HealthReport>();
	});

	it('takes a finding with an edit fix', () => {
		const finding: Finding = {
			check: 'held-by-people',
			severity: 'warning',
			subject: { kind: 'task', id: 'login' },
			at: { file: 'plan.tjp', from: 10, to: 40 },
			fixes: [
				{ kind: 'replace-person', task: 'login', from: 'dev1' },
				{ kind: 'open', view: 'workload', resource: 'dev1', at: 540 },
				{ kind: 'why', task: 'login' },
				{
					kind: 'intent',
					label: 'Remove start',
					intent: { type: 'removeAttr', task: 'login', attr: 'start' },
				},
			],
		};
		expect(finding.fixes.map((f) => f.kind)).toEqual(['replace-person', 'open', 'why', 'intent']);
	});
});
