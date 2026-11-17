// SPDX-License-Identifier: GPL-2.0-or-later
// The rebalance planner's person moves (phase-3.md 6.6, 7.1 W1, 13.1, 18.7, 18.9): every outcome
// and refusal of a `reassign`, on the workload fixtures with their golden results and on an inline
// plan with a hand-made result, then the dry run (`checkRebalance`) for the edit API's refusals,
// which come through unchanged. Week moves (W2) are in rebalance-shift.test.ts.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ActionContext } from '../gantt/intents';
import type {
	PlanRebalanceFn,
	RebalanceAction,
	RebalancePlan,
	RebalanceRefusal,
} from './rebalance';
import { planRebalance } from './rebalance';
import { checkRebalance } from './rebalance-check';
import {
	INLINE_TEXT,
	inlinePlan,
	planFrom,
	textAfter,
	workloadPlan,
	type Plan,
} from './rebalance-testing';

describe('rebalance types (6.6)', () => {
	it('fixes the signature', () => {
		expectTypeOf(planRebalance).toEqualTypeOf<PlanRebalanceFn>();
		expectTypeOf<PlanRebalanceFn>().parameters.toEqualTypeOf<[RebalanceAction, ActionContext]>();
		expectTypeOf<PlanRebalanceFn>().returns.toEqualTypeOf<RebalancePlan>();
		expectTypeOf<RebalanceRefusal>().toEqualTypeOf<
			'via-group' | 'not-a-person' | 'not-booked' | 'same-place' | 'no-working-day'
		>();
	});
});

const refusal = (p: RebalancePlan) => (p.status === 'not-possible' ? p.reason : p.status);

/** The text at a range of the plan's entry. */
const textAt = (p: Plan, r: { from: number; to: number }): string =>
	p.text(p.snap.entry).slice(r.from, r.to);

describe('reassign (W1)', () => {
	it('becomes replaceAllocation, one id token', () => {
		const p = workloadPlan('groups');
		const a: RebalanceAction = { type: 'reassign', task: 'work.t4', from: 'lead', to: 'm1' };
		const plan = planRebalance(a, p.at());
		expect(plan).toEqual({
			status: 'intent',
			intent: { type: 'replaceAllocation', task: 'work.t4', from: 'lead', to: 'm1' },
			label: { text: 'Moved Lead work from Lead to M1', approx: false },
		});
		const out = checkRebalance(a, p.at(), p.snap);
		if (out.status !== 'edit') throw new Error(out.status);
		expect(out.label.text).toBe('Moved Lead work from Lead to M1');
		const after = textAfter(p.snap, out.edit.changes, 'plan.tjp');
		const before = p.text('plan.tjp');
		expect(after).toBe(
			before.replace('effort 2d\n    allocate lead', 'effort 2d\n    allocate m1'),
		);
	});

	it('says so when the person already works on the task, and the edit drops the item', () => {
		const p = inlinePlan();
		const a: RebalanceAction = { type: 'reassign', task: 'pair', from: 'a', to: 'c' };
		const plan = planRebalance(a, p.at());
		expect(plan.status === 'intent' && plan.label.text).toBe(
			'Cy already works on Pair; Ann removed',
		);
		const out = checkRebalance(a, p.at(), p.snap);
		if (out.status !== 'edit') throw new Error(out.status);
		expect(textAfter(p.snap, out.edit.changes, 'plan.tjp')).toBe(
			INLINE_TEXT.replace('allocate a, c', 'allocate c'),
		);
	});

	it('moves held and unmet work: asked for, not booked in the cell', () => {
		const held = workloadPlan('held-effort');
		// `review` waits for dev; it is asked for dev whether or not it is booked in a cell.
		const plan = planRebalance(
			{ type: 'reassign', task: 'review', from: 'dev', to: 'ann' },
			held.at(),
		);
		expect(plan.status).toBe('intent');
		const unmet = workloadPlan('unmet-length');
		const task = [...unmet.index.allocations].find((x) => x.task !== null)!;
		const other = [...unmet.index.resources.keys()].find((r) => r !== task.resource)!;
		const p2 = planRebalance(
			{ type: 'reassign', task: task.task!, from: task.resource!, to: other },
			unmet.at(),
		);
		expect(p2.status).toBe('intent');
	});

	it('refuses a drop on its own row: same-place', () => {
		const p = workloadPlan('groups');
		const plan = planRebalance({ type: 'reassign', task: 'work.t1', from: 'm1', to: 'm1' }, p.at());
		expect(plan).toEqual({ status: 'not-possible', reason: 'same-place', at: [] });
	});

	it('refuses a drop on a group row: not-a-person, at the group', () => {
		const p = workloadPlan('groups');
		for (const to of ['team', 'leads']) {
			const plan = planRebalance({ type: 'reassign', task: 'work.t1', from: 'm1', to }, p.at());
			expect(refusal(plan)).toBe('not-a-person');
			if (plan.status !== 'not-possible') throw new Error('refused');
			expect(textAt(p, plan.at[0]!)).toMatch(new RegExp(`^resource ${to} `));
		}
	});

	it('refuses work booked through a group: via-group, at the group allocation', () => {
		const p = workloadPlan('group-allocation');
		// TaskJuggler booked m1 and m2 on triage through `allocate team`.
		expect(
			p.result.bookings.filter((b) => b.task === 'work.triage').map((b) => b.resource),
		).toEqual(['m1', 'm2']);
		for (const from of ['m1', 'm2', 'team']) {
			const a: RebalanceAction = { type: 'reassign', task: 'work.triage', from, to: 'solo' };
			const plan = planRebalance(a, p.at());
			expect(plan).toMatchObject({ status: 'not-possible', reason: 'via-group', group: 'team' });
			if (plan.status !== 'not-possible') throw new Error('refused');
			expect(plan.at.map((r) => textAt(p, r))).toEqual(['team']);
			const out = checkRebalance(a, p.at(), p.snap);
			expect(out).toMatchObject({
				status: 'refused',
				reason: 'via-group',
				message: "Booked through Team. Change the task's people in its details.",
			});
		}
	});

	it('refuses a group as the source when the task does not allocate it: not-a-person', () => {
		const p = workloadPlan('group-allocation');
		const plan = planRebalance(
			{ type: 'reassign', task: 'work.other', from: 'team', to: 'm1' },
			p.at(),
		);
		expect(refusal(plan)).toBe('not-a-person');
	});

	it('refuses a person who has nothing to do with the task: not-booked, at the task', () => {
		const p = workloadPlan('group-allocation');
		const plan = planRebalance(
			{ type: 'reassign', task: 'work.other', from: 'm1', to: 'm2' },
			p.at(),
		);
		expect(refusal(plan)).toBe('not-booked');
		if (plan.status !== 'not-possible') throw new Error('refused');
		expect(textAt(p, plan.at[0]!)).toMatch(/^task other /);
		expect(
			checkRebalance(
				{ type: 'reassign', task: 'work.other', from: 'm1', to: 'm2' },
				p.at(),
				p.snap,
			),
		).toMatchObject({ status: 'refused', message: 'This person does not work on this task.' });
	});

	it('passes alternatives to the edit API, which refuses them: unsupported-form', () => {
		const p = workloadPlan('alternatives');
		// bo is the booked alternative of `allocate ann { alternative bo, cy }`.
		for (const from of ['bo', 'ann']) {
			const a: RebalanceAction = { type: 'reassign', task: 'work.fix', from, to: 'cy' };
			expect(planRebalance(a, p.at()).status).toBe('intent');
			const out = checkRebalance(a, p.at(), p.snap);
			expect(out).toMatchObject({
				status: 'refused',
				reason: 'unsupported-form',
				message: 'The plan uses a form of this setting that cannot be edited here.',
			});
		}
	});

	it('passes inherited people to the edit API, which refuses them: inherited', () => {
		const p = inlinePlan();
		const a: RebalanceAction = { type: 'reassign', task: 'parent.child', from: 'a', to: 'c' };
		expect(planRebalance(a, p.at()).status).toBe('intent');
		expect(checkRebalance(a, p.at(), p.snap)).toMatchObject({
			status: 'refused',
			reason: 'inherited',
		});
	});

	it('passes text-only declarations to the edit API: text-only', () => {
		// `late` declared by a macro call: the engine names it (hints), the text cannot edit it.
		const body = INLINE_TEXT.slice(INLINE_TEXT.indexOf('task late'));
		const text = `${INLINE_TEXT.replace(body, '')}macro mk [\n${body}]\n\${mk}\n`;
		const line = text.split('\n').indexOf('${mk}') + 1;
		const base = inlinePlan();
		const r = {
			...base.result,
			tasks: base.result.tasks.map((t) =>
				t.id === 'late' ? { ...t, source: { file: 'plan.tjp', line, column: null } } : t,
			),
		};
		const p = planFrom({ 'plan.tjp': text }, 'plan.tjp', r);
		expect(p.index.tasks.get('late')?.expandedOnly).toBe(true);
		const a: RebalanceAction = { type: 'reassign', task: 'late', from: 'c', to: 'a' };
		expect(planRebalance(a, p.at()).status).toBe('intent');
		expect(checkRebalance(a, p.at(), p.snap)).toMatchObject({
			status: 'refused',
			reason: 'text-only',
			textOnly: 'expanded-only',
		});
	});

	it('refuses a person named only through a macro-written allocation: text-only', () => {
		// The engine booked c through `allocate ${who}`: the edit cannot see c in the text.
		const text = INLINE_TEXT.replace(
			'task late "Late" {',
			'macro who [c]\ntask late "Late" {',
		).replace('  allocate c\n}', '  allocate ${who}\n}');
		const p = planFrom({ 'plan.tjp': text }, 'plan.tjp', inlinePlan().result);
		const a: RebalanceAction = { type: 'reassign', task: 'late', from: 'c', to: 'a' };
		expect(planRebalance(a, p.at()).status).toBe('intent');
		expect(checkRebalance(a, p.at(), p.snap)).toMatchObject({
			status: 'refused',
			reason: 'text-only',
			textOnly: 'macro-call',
		});
	});

	it('reads the text when there is no result yet', () => {
		const p = inlinePlan();
		const plan = planRebalance(
			{ type: 'reassign', task: 'pair', from: 'c', to: 'b' },
			p.at({ result: null, wt: null, analysis: null }),
		);
		expect(plan.status === 'intent' && plan.label.text).toBe('Moved Pair from Cy to Bo');
	});
});
