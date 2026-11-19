// SPDX-License-Identifier: GPL-2.0-or-later
// The plan model's rule for ALAP effort leaves with a hard end (model-attrs.ts firstOfAll): their
// `end` or `precedes` must leave them room, so they get priority 1000 everywhere and a full-time
// resource. Without it the nightly found a generated plan that did not schedule (sched_runaway,
// regressions.json, seed 527909175). P4 checks that generated plans schedule; this checks the rule
// on many more plans without the engine.
import { describe, expect, it } from 'vitest';
import { genPlan, preOrder, type MPlan, type MRes, type MTask } from './model';
import { mixSeed, Rng } from './rng';

const flat = (rs: readonly MRes[]): MRes[] => rs.flatMap((r) => [r, ...flat(r.kids)]);
const ancestors = (t: MTask): MTask[] => (t.parent ? [t.parent, ...ancestors(t.parent)] : []);

/** The resources a task asks for: its own and inherited `allocate` items, macro calls included. */
function allocated(plan: MPlan, t: MTask): string[] {
	return [t, ...ancestors(t)].flatMap((x) => [
		...x.stmts
			.filter((s) => s.key === 'allocate' && s.scenario === null)
			.flatMap((s) => (s.items ?? []).map((i) => i.target)),
		...x.calls.flatMap((c) => {
			const body = plan.macros.find((m) => m.name === c.macro)?.body ?? '';
			const m = /^\s*allocate\s+(.*?)\s*$/.exec(body);
			return m?.[1] ? m[1].split(/\s*,\s*/) : [];
		}),
	]);
}

const hardEnd = (t: MTask): boolean =>
	t.kids.length === 0 &&
	t.stmts.some((s) => s.key === 'effort' && s.scenario === null) &&
	t.stmts.some((s) => (s.key === 'end' || s.key === 'precedes') && s.scenario === null);

describe('ALAP effort leaves with a hard end', () => {
	it('have priority 1000 in every site and a full-time resource', () => {
		let seen = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const plan = genPlan(new Rng(mixSeed(seed, 0)), seed % 3 === 0 ? { rich: true } : {});
			const partTime = new Set(
				flat(plan.resources)
					.filter((r) => r.stmts.some((s) => s.key === 'workinghours'))
					.map((r) => r.id),
			);
			for (const t of preOrder(plan.tasks).filter(hardEnd)) {
				seen++;
				const where = `seed ${seed} ${t.id}`;
				const prios = [...t.stmts, ...t.supp].filter((s) => s.key === 'priority');
				expect(
					prios.map((s) => s.value),
					where,
				).toEqual(prios.map(() => '1000'));
				expect(
					t.stmts.some((s) => s.key === 'priority' && s.scenario === null),
					where,
				).toBe(true);
				// The priority macro (priority 600) is never called on it.
				expect(
					t.calls.map((c) => c.macro),
					where,
				).not.toContain('PRIO');
				expect(
					allocated(plan, t).some((r) => !partTime.has(r)),
					where,
				).toBe(true);
				// The top scenario's priority comes before other scenarios' statements (15.20).
				const firstScenario = t.stmts.findIndex((s) => s.scenario !== null);
				const top = t.stmts.findIndex((s) => s.key === 'priority' && s.scenario === null);
				if (firstScenario >= 0) expect(top, where).toBeLessThan(firstScenario);
			}
		}
		expect(seen, 'the plans had no task with a hard end').toBeGreaterThan(100);
	});
});
