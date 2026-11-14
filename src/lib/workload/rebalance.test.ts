// SPDX-License-Identifier: GPL-2.0-or-later
// Rebalance planner types (phase-3.md 6.6): compile checks of the interface (`npm run typecheck`
// enforces them). The planner's tests come with T12's code.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ActionContext } from '../gantt/intents';
import type {
	PlanRebalanceFn,
	RebalanceAction,
	RebalancePlan,
	RebalanceRefusal,
} from './rebalance';

describe('rebalance types (6.6)', () => {
	it('fixes the signature T12 implements', () => {
		expectTypeOf<PlanRebalanceFn>().parameters.toEqualTypeOf<[RebalanceAction, ActionContext]>();
		expectTypeOf<PlanRebalanceFn>().returns.toEqualTypeOf<RebalancePlan>();
		expectTypeOf<RebalancePlan['status']>().toEqualTypeOf<'intent' | 'action' | 'not-possible'>();
		expectTypeOf<RebalanceRefusal>().toEqualTypeOf<
			'via-group' | 'not-a-person' | 'not-booked' | 'same-place'
		>();
	});

	it('takes the three outcomes: a reassign intent, a shift move, a refusal', () => {
		const plans: RebalancePlan[] = [
			{
				status: 'intent',
				intent: { type: 'replaceAllocation', task: 'login', from: 'dev1', to: 'dev3' },
				label: { text: 'Login: Dev 1 to Dev 3', approx: false },
			},
			{ status: 'action', action: { type: 'move', task: 'login', days: 5 } },
			{ status: 'not-possible', reason: 'via-group', at: [] },
		];
		expect(plans.map((p) => p.status)).toEqual(['intent', 'action', 'not-possible']);
	});
});
