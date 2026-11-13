// SPDX-License-Identifier: GPL-2.0-or-later
// The typed-array loop walks (dep-loops.ts) answer as the string-keyed ones they replaced
// (dep-loops-testing.ts) on random task trees with random dependencies, directions and
// milestones, including names the graph does not hold.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hasCycle, hasLoop, type LoopNode } from './dep-loops';
import { referenceHasCycle, referenceHasLoop } from './dep-loops-testing';

const RUNS = Number(process.env['DEP_LOOP_RUNS'] ?? 500);
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const graph: fc.Arbitrary<Map<string, LoopNode>> = fc.integer({ min: 1, max: 14 }).chain((n) => {
	const ids = Array.from({ length: n }, (_, i) => `t${i}`);
	// Missing names on purpose: references to tasks the graph leaves out.
	const name = fc.constantFrom(...ids, 'gone');
	const pair = fc.tuple(name, fc.boolean());
	return fc
		.record({
			// A parent earlier in the list keeps the tree acyclic, as the index's is.
			parents: fc.tuple(
				...ids.map((_, i) => (i === 0 ? fc.constant(-1) : fc.integer({ min: -1, max: i - 1 }))),
			),
			forward: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
			milestone: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
			startpreds: fc.array(fc.array(pair, { maxLength: 3 }), { minLength: n, maxLength: n }),
			endsuccs: fc.array(fc.array(pair, { maxLength: 2 }), { minLength: n, maxLength: n }),
		})
		.map((g) => {
			const out = new Map<string, LoopNode>();
			ids.forEach((id, i) => {
				const p = g.parents[i] ?? -1;
				out.set(id, {
					id,
					parent: p < 0 ? null : (ids[p] as string),
					children: ids.filter((_, j) => g.parents[j] === i),
					forward: g.forward[i] ?? true,
					milestone: g.milestone[i] ?? false,
					startpreds: g.startpreds[i] ?? [],
					endsuccs: g.endsuccs[i] ?? [],
				});
			});
			return out;
		});
});

describe('dependency loop walks', () => {
	it('answer as the string-keyed reference does', () => {
		let loops = 0;
		let cycles = 0;
		fc.assert(
			fc.property(graph, (g) => {
				const loop = hasLoop(g);
				const cycle = hasCycle(g);
				expect(loop).toBe(referenceHasLoop(g));
				expect(cycle).toBe(referenceHasCycle(g));
				loops += loop ? 1 : 0;
				cycles += cycle ? 1 : 0;
			}),
			{ numRuns: RUNS, ...SEED },
		);
		// Both answers occur for both walks, so the comparison means something.
		expect(loops).toBeGreaterThan(0);
		expect(loops).toBeLessThan(RUNS);
		expect(cycles).toBeGreaterThan(0);
		expect(cycles).toBeLessThan(RUNS);
	});
});
