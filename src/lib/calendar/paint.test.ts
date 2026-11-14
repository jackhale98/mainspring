// SPDX-License-Identifier: GPL-2.0-or-later
// Leave-paint planner types (phase-3.md 6.6): compile checks of the interface (`npm run typecheck`
// enforces them). The planner's tests come with T12's code.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Planned } from '../gantt/intents';
import type { LeaveType } from '../tjp/edit/types';
import type { LeavePaint, LeavePaintContext, PaintScope, PlanLeavePaintFn } from './paint';

describe('leave-paint types (6.6)', () => {
	it('fixes the signature T12 implements', () => {
		expectTypeOf<PlanLeavePaintFn>().parameters.toEqualTypeOf<[LeavePaint, LeavePaintContext]>();
		expectTypeOf<PlanLeavePaintFn>().returns.toEqualTypeOf<Planned>();
	});

	it("paints the edit API's leave types, in one scope type for both kinds", () => {
		expectTypeOf<LeavePaint['scope']>().toEqualTypeOf<PaintScope>();
		expectTypeOf<Extract<LeavePaint, { type: 'paint' }>['leave']>().toEqualTypeOf<LeaveType>();
	});

	it('takes a paint and an erase', () => {
		const strokes: LeavePaint[] = [
			{
				type: 'paint',
				scope: { kind: 'resource', resource: 'dev1' },
				from: 0,
				to: 2880,
				leave: 'annual',
			},
			{ type: 'erase', scope: { kind: 'global' }, from: 1440, to: 2880 },
		];
		expect(strokes.map((s) => s.type)).toEqual(['paint', 'erase']);
	});
});
