// SPDX-License-Identifier: GPL-2.0-or-later
// Rebalance properties (phase-3.md 6.6, 13.1), text only (the engine half is in
// rebalance.engine.test.ts): random drops, to any row (people, groups, unknown ids) or any week
// bucket, for every task of the workload fixtures with people. For every drop:
// - the planner answers with one intent, one move action or one of its refusals, and the dry run
//   (`checkRebalance`) never throws;
// - a refusal of `via-group` names a group the task allocates; `not-a-person` points at a group;
// - an edit is local (every change in a declared target), its inverse restores the bytes, and a
//   fresh parse has no new syntax issues;
// - after a reassign edit, the task's own text no longer allocates `from` and allocates `to`.
// FC_SEED fixes the seed; REBALANCE_RUNS sets the number of drops per fixture.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { syntaxIssues } from '../tjp/tree';
import { buildIndex } from '../tjp/index';
import { createWorkspace } from '../workspace/workspace';
import { bucketAxis } from './axis';
import { isGroup, planRebalance, type RebalanceAction } from './rebalance';
import { checkRebalance } from './rebalance-check';
import { workloadPlan, ZONES, type Plan } from './rebalance-testing';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['REBALANCE_RUNS'] ?? 150);
const FIXTURES = ['groups', 'group-allocation', 'alternatives', 'held-effort', 'unmet-length'];

function dropArb(p: Plan): fc.Arbitrary<RebalanceAction> {
	const project = p.result.project;
	if (!project) throw new Error('no project');
	const weeks = [...bucketAxis(project, ZONES, 'week').bounds].slice(0, -1);
	const tasks = [...p.index.tasks.keys()];
	const rows = [...p.index.resources.keys(), 'nobody'];
	return fc.oneof(
		fc.record({
			type: fc.constant('reassign' as const),
			task: fc.constantFrom(...tasks),
			from: fc.constantFrom(...rows),
			to: fc.constantFrom(...rows),
		}),
		fc.record({
			type: fc.constant('shift' as const),
			task: fc.constantFrom(...tasks),
			fromBucket: fc.constantFrom(...weeks),
			toBucket: fc.constantFrom(...weeks),
		}),
	);
}

const counts = { edits: 0, refused: 0 };

function check(p: Plan, a: RebalanceAction): boolean {
	const ctx = p.at();
	const plan = planRebalance(a, ctx);
	if (plan.status === 'not-possible') {
		if (plan.reason === 'via-group') {
			expect(plan.group !== undefined && isGroup(ctx, plan.group)).toBe(true);
		}
		if (plan.reason === 'not-a-person' && a.type === 'reassign') {
			expect(isGroup(ctx, a.to) || isGroup(ctx, a.from)).toBe(true);
		}
	}
	if (plan.status === 'intent') expect(a.type).toBe('reassign');
	if (plan.status === 'action') expect(a.type).toBe('shift');
	const out = checkRebalance(a, ctx, p.snap);
	if (out.status !== 'edit') {
		counts.refused++;
		return true;
	}
	counts.edits++;
	const files: Record<string, string> = {};
	for (const [path, f] of p.snap.files) {
		const cs = out.edit.changes[path];
		const after = cs ? cs.apply(f.text) : f.text;
		files[path] = after.toString();
		if (!cs) continue;
		expect(out.edit.inverse[path]?.apply(after).toString()).toBe(f.text.toString());
		const targets = out.edit.targets[path] ?? [];
		cs.iterChangedRanges((x, y) => {
			expect(targets.some((t) => t.from <= x && y <= t.to)).toBe(true);
		});
	}
	const snap = createWorkspace({ entry: p.snap.entry, files }).snapshot();
	for (const [path, f] of snap.files) {
		const before = p.snap.files.get(path);
		if (before) {
			expect(syntaxIssues(f.tree, f.text).length).toBe(
				syntaxIssues(before.tree, before.text).length,
			);
		}
	}
	if (a.type !== 'reassign') return true;
	const index = buildIndex(snap, undefined, { cache: null });
	const own = index.allocations.filter((x) => x.task === a.task).map((x) => x.resource);
	return !own.includes(a.from) && own.includes(a.to);
}

describe.each(FIXTURES)('rebalance drops on %s (property)', (name) => {
	it('plan one intent or action, and edit locally', () => {
		const p = workloadPlan(name);
		counts.edits = 0;
		counts.refused = 0;
		fc.assert(
			fc.property(dropArb(p), (a) => check(p, a)),
			{ numRuns: RUNS, ...SEED },
		);
		expect(counts.edits).toBeGreaterThan(0);
	});
});
