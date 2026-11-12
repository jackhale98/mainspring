// SPDX-License-Identifier: GPL-2.0-or-later
// Manager loops (manager-loops.ts). TaskJuggler recurses through a loop of managers until the
// stack overflows (native `stack level too deep`, a dead wasm worker), so every intent that adds
// an edge leading to a loop is `cycle`. Cases from the T11d review, checked natively.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { applyIntent } from './apply';
import { managerLoop, ownManagers } from './manager-loops';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';
import { createWorkspace } from '../../workspace/workspace';

const H = 'project p "P" 2026-01-05 - 2026-03-27 {\n  now 2026-02-02\n}\n';

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

function run(text: string, intent: EditIntent): EditResult {
	const s = setup(text);
	return applyIntent(s.snap, s.index, intent);
}

describe('manager loops', () => {
	it('refuses a managers value that closes a loop (case loop)', () => {
		const plan =
			H +
			'resource a "A" { managers b }\nresource b "B"\nresource c "C" { managers a }\n' +
			'task t "T" { effort 3d allocate c }\n';
		const r = run(plan, { type: 'setResourceAttr', resource: 'b', attr: 'managers', value: ['a'] });
		expect(status(r)).toBe('refused:cycle');
		// A longer loop through c (c -> a -> b -> c).
		expect(
			status(run(plan, { type: 'setResourceAttr', resource: 'b', attr: 'managers', value: 'c' })),
		).toBe('refused:cycle');
		// Without the loop the same kind of edit is fine.
		expect(
			status(run(plan, { type: 'setResourceAttr', resource: 'c', attr: 'managers', value: 'b' })),
		).toBe('edit');
	});

	it('refuses a new resource that reports into an existing loop (case addresloop)', () => {
		const plan =
			H +
			'resource a "A" { managers b }\nresource b "B" { managers a }\n' +
			'task t "T" { effort 3d allocate a }\n';
		const add = (x: Partial<EditIntent & { type: 'addResource' }>): string =>
			status(run(plan, { type: 'addResource', parent: null, index: 2, name: 'C', ...x }));
		expect(add({ attrs: [['managers', 'a']] })).toBe('refused:cycle');
		// One with no managers adds no edge.
		expect(add({})).toBe('edit');
	});

	it('counts managers inherited from a new parent (case mvloop)', () => {
		const plan =
			H +
			'resource a "A" { managers b }\nresource g "G" {\n  managers a\n  resource x "X"\n}\n' +
			'resource b "B"\ntask t "T" { effort 3d allocate x }\n';
		const r = run(plan, { type: 'moveResource', resource: 'b', parent: 'g', index: 1 });
		expect(status(r)).toBe('refused:cycle');
		expect(status(run(plan, { type: 'addResource', parent: 'g', index: 1, name: 'Y' }))).toBe(
			'edit',
		);
		// A group whose managers reach a loop: a new child would report into it.
		const looped = plan.replace('resource b "B"', 'resource b "B" { managers a }');
		expect(status(run(looped, { type: 'addResource', parent: 'g', index: 1, name: 'Y' }))).toBe(
			'refused:cycle',
		);
	});

	it('counts only inherited managers read before the child as there already (mgreorder, mgcross, mgsupp)', () => {
		// b is declared before g's `managers a`, so b does not inherit a; moved after it, it would.
		const reorder =
			H +
			'resource g "G" {\n  resource b "B"\n  managers a\n  resource c "C"\n}\n' +
			'resource a "A" { managers b }\ntask t "T" { effort 3d allocate c }\n';
		expect(
			status(run(reorder, { type: 'moveResource', resource: 'b', parent: 'g', index: 1 })),
		).toBe('refused:cycle');
		const cross =
			H +
			'resource g1 "G1" {\n  resource b "B"\n  managers a\n}\n' +
			'resource g2 "G2" {\n  managers a\n  resource c "C"\n}\n' +
			'resource a "A" { managers b }\ntask t "T" { effort 3d allocate c }\n';
		expect(
			status(run(cross, { type: 'moveResource', resource: 'b', parent: 'g2', index: 1 })),
		).toBe('refused:cycle');
		const supp =
			H +
			'resource g "G" {\n  resource b "B"\n  resource c "C"\n}\n' +
			'supplement resource g { managers a }\nresource a "A" { managers b }\n' +
			'resource h "H" {\n  managers a\n  resource d "D"\n}\ntask t "T" { effort 3d allocate c }\n';
		expect(status(run(supp, { type: 'moveResource', resource: 'b', parent: 'h', index: 1 }))).toBe(
			'refused:cycle',
		);
		// d already reports to a (h says so before d): moving it adds no edge. (Moving c would be
		// refused: the upper bound counts g's supplement for b, a loop TaskJuggler does not see.)
		expect(status(run(supp, { type: 'moveResource', resource: 'd', parent: 'g', index: 2 }))).toBe(
			'edit',
		);
	});

	it('names the loop members', () => {
		const plan = H + 'resource a "A" { managers b }\nresource b "B"\n';
		const s = setup(plan);
		const r = managerLoop(s.ctx, { own: new Map([['b', ['a']]]) });
		const text = s.file().text;
		expect(r?.at.map((x) => text.sliceString(x.from, x.to)).sort()).toEqual([
			'resource a "A"',
			'resource b "B"',
		]);
		expect(managerLoop(s.ctx, { own: new Map([['b', []]]) })).toBeNull();
	});
});

/** Whether the managers graph of a plan (own and inherited ids) has a loop. */
function hasLoop(text: string): boolean {
	const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': text } });
	const index = buildIndex(ws.snapshot(), undefined, { cache: null });
	const own = ownManagers(index);
	const of = (id: string): string[] => {
		const out: string[] = [];
		for (let r: string | null = id; r; r = index.resources.get(r)?.parent ?? null)
			out.push(...(own.get(r) ?? []));
		return out;
	};
	const state = new Map<string, number>();
	const visit = (id: string): boolean => {
		if (state.get(id) === 2) return false;
		if (state.get(id) === 1) return true;
		state.set(id, 1);
		const found = of(id).some(visit);
		state.set(id, 2);
		return found;
	};
	return [...index.resources.keys()].some(visit);
}

describe('manager loops (property)', () => {
	const LEAVES = ['a', 'b', 'c', 'd', 'e'];
	const base =
		H +
		'resource g "G" {\n  resource a "A"\n  resource b "B"\n}\n' +
		'resource c "C"\nresource d "D"\nresource e "E"\n' +
		'task t "T" { effort 3d allocate a }\n';
	const intentArb: fc.Arbitrary<EditIntent> = fc.oneof(
		fc.record({
			type: fc.constant('setResourceAttr' as const),
			resource: fc.constantFrom('g', ...LEAVES),
			attr: fc.constant('managers' as const),
			value: fc.uniqueArray(fc.constantFrom(...LEAVES), { minLength: 1, maxLength: 2 }),
		}),
		fc.record({
			type: fc.constant('moveResource' as const),
			resource: fc.constantFrom('c', 'd', 'e'),
			parent: fc.constantFrom(null, 'g'),
			index: fc.nat({ max: 3 }),
		}),
	);

	it('never leaves a loop of managers', () => {
		fc.assert(
			fc.property(fc.array(intentArb, { maxLength: 6 }), (intents) => {
				let text = base;
				for (const intent of intents) {
					const s = setup(text);
					const r = applyIntent(s.snap, s.index, intent);
					if (r.status !== 'edit') continue;
					text = textsAfter(s.snap, r)['plan.tjp'] ?? text;
					expect(hasLoop(text)).toBe(false);
				}
			}),
			{ numRuns: 60, seed: 1112 },
		);
	});
});
