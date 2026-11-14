// SPDX-License-Identifier: GPL-2.0-or-later
// Result schema v3 types (phase-3.md 6.1): compile checks, which `npm run typecheck` enforces. The
// v3 fields are optional until T6 (bridge schema v3), so the v2 results the engine writes today
// still typecheck; T6 makes them required and updates these checks.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { LeaveType as EditLeaveType } from '../lib/tjp/edit/types';
import type { LeaveType as ValueLeaveType } from '../lib/tjp/values/leave';
import type {
	AllocateItem,
	EngineLeaveType,
	Minutes,
	ProjectInfo,
	ProjectLeave,
	ResourceLeaves,
	ResourceResult,
	ResourceScenarioResult,
	ScheduleResult,
	TaskScenarioResult,
} from './protocol';

const v2Project: ProjectInfo = {
	id: 'p',
	name: 'P',
	version: null,
	start: '2026-01-05T00:00:00Z',
	end: '2026-02-05T00:00:00Z',
	now: '2026-01-05T00:00:00Z',
	timezone: null,
	timingResolutionMin: 60,
	scenarios: [{ id: 'plan', name: 'Plan', parent: null, active: true }],
	dailyWorkingHours: 8,
	weeklyWorkingDays: 5,
	monthlyWorkingDays: 21,
	yearlyWorkingDays: 260.714,
	workingTime: [[540, 1020]],
};
const v2Task: TaskScenarioResult = {
	scheduled: true,
	start: 540,
	end: 1020,
	allocated: ['dev1'],
	criticalness: 0,
	pathCriticalness: 0,
	direction: 'asap',
	complete: null,
	depends: [],
	precedes: [],
};
const v2Result: ScheduleResult = {
	revision: 1,
	ok: true,
	project: v2Project,
	tasks: [
		{
			id: 't',
			name: 'T',
			parent: null,
			source: null,
			milestone: false,
			scenarios: { plan: v2Task },
		},
	],
	resources: [
		{
			id: 'dev1',
			name: 'Dev 1',
			parent: null,
			source: null,
			group: false,
			scenarios: { plan: { efficiency: 1 } },
		},
	],
	bookings: [{ scenario: 'plan', resource: 'dev1', task: 't', intervals: [[540, 1020]] }],
	messages: [],
	timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
};

describe('schema v3 types (6.1)', () => {
	it('still takes a v2 result: the v3 fields are optional until T6', () => {
		expect(v2Result.project?.weekStartsMonday).toBeUndefined();
		expectTypeOf<Pick<ProjectInfo, 'weekStartsMonday' | 'leaves'>>().toEqualTypeOf<{
			weekStartsMonday?: boolean;
			leaves?: ProjectLeave[];
		}>();
		expectTypeOf<Pick<ResourceScenarioResult, 'workingTime' | 'leaves'>>().toEqualTypeOf<{
			workingTime?: Array<[Minutes, Minutes]>;
			leaves?: ResourceLeaves[];
		}>();
		expectTypeOf<Pick<TaskScenarioResult, 'allocate'>>().toEqualTypeOf<{
			allocate?: AllocateItem[];
		}>();
	});

	it('takes a v3 result with every field', () => {
		const project: ProjectInfo = {
			...v2Project,
			weekStartsMonday: false,
			leaves: [
				{ type: 'holiday', name: 'New Year', interval: [-7200, -5760] },
				{ type: 'holiday', name: null, interval: [8640, 10080] },
			],
		};
		const task: TaskScenarioResult = {
			...v2Task,
			allocate: [{ candidates: ['dev1', 'dev2'] }, { candidates: ['team'] }],
		};
		const scenario: ResourceScenarioResult = {
			efficiency: 0.8,
			workingTime: [
				[540, 1020],
				[1980, 2460],
			],
			leaves: [{ type: 'annual', intervals: [[2880, 4320]] }],
		};
		const result: ScheduleResult = {
			...v2Result,
			project,
			tasks: v2Result.tasks.map((t) => ({ ...t, scenarios: { plan: task } })),
			resources: v2Result.resources.map((r) => ({ ...r, scenarios: { plan: scenario } })),
		};
		expect(result.resources[0]?.scenarios['plan']?.leaves?.[0]?.type).toBe('annual');
	});

	it("matches TaskJuggler's leave types, which the edit API writes without `project`", () => {
		expectTypeOf<EngineLeaveType>().toEqualTypeOf<ValueLeaveType>();
		expectTypeOf<EditLeaveType>().toEqualTypeOf<Exclude<EngineLeaveType, 'project'>>();
		expectTypeOf<ResourceResult['scenarios'][string]>().toEqualTypeOf<ResourceScenarioResult>();
	});
});
