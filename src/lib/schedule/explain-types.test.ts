// SPDX-License-Identifier: GPL-2.0-or-later
// Explainer and demand types (phase-3.md 6.3): compile checks of the interface (`npm run
// typecheck` enforces them). The behaviour tests come with T10's code.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TaskId } from '../tjp/index';
import type {
	Cause,
	CauseKind,
	DemandMarks,
	DemandOfFn,
	ExplainContext,
	ExplainTaskFn,
	Placement,
} from './explain-types';

describe('explainer types (6.3)', () => {
	it('has the causes of 6.3 and no others', () => {
		expectTypeOf<CauseKind>().toEqualTypeOf<
			'dependency' | 'frame' | 'constraint' | 'busy' | 'leave' | 'off-hours' | 'limit' | 'unknown'
		>();
	});

	it('fixes the signatures T10 implements', () => {
		expectTypeOf<ExplainTaskFn>().parameters.toEqualTypeOf<[TaskId, ExplainContext]>();
		expectTypeOf<ExplainTaskFn>().returns.toEqualTypeOf<Placement>();
		expectTypeOf<DemandOfFn>().parameters.toEqualTypeOf<[ExplainContext]>();
		expectTypeOf<DemandOfFn>().returns.toEqualTypeOf<DemandMarks>();
	});

	it('takes a held task: a busy person, then a leave, in time order', () => {
		const causes: Cause[] = [
			{
				kind: 'busy',
				resource: 'dev1',
				window: [540, 1980],
				on: [{ task: 'api', minutes: 960 }],
			},
			{ kind: 'leave', resource: 'dev1', type: 'annual', window: [1980, 2880] },
		];
		const placement: Placement = {
			task: 'login',
			anchor: 'start',
			bound: 540,
			at: 2880,
			causes,
			inside: [],
		};
		const demand: DemandMarks = {
			held: new Map([['dev1', [{ task: 'login', window: [540, 2880] }]]]),
			unmet: new Map(),
		};
		expect(placement.causes.map((c) => c.kind)).toEqual(['busy', 'leave']);
		expect(demand.held.get('dev1')?.[0]?.window).toEqual([placement.bound, placement.at]);
	});
});
