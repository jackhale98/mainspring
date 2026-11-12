// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { hasCycle, hasLoop, type LoopNode } from './dep-loops';

type Spec = Partial<Omit<LoopNode, 'id'>>;

function graph(spec: Record<string, Spec>): Map<string, LoopNode> {
	const out = new Map<string, LoopNode>();
	for (const [id, s] of Object.entries(spec)) {
		out.set(id, {
			id,
			parent: s.parent ?? null,
			children: s.children ?? [],
			forward: s.forward ?? true,
			milestone: s.milestone ?? false,
			startpreds: s.startpreds ?? [],
			endsuccs: s.endsuccs ?? [],
		});
	}
	return out;
}

describe('hasLoop', () => {
	it('finds an end-to-start loop between ASAP leaves', () => {
		// b depends a, a depends b (both on the other's end).
		const g = graph({
			a: { startpreds: [['b', true]], endsuccs: [['b', false]] },
			b: { startpreds: [['a', true]], endsuccs: [['a', false]] },
		});
		expect(hasLoop(g)).toBe(true);
	});

	it('finds the same loop between ALAP leaves in the backward pass', () => {
		const g = graph({
			a: { forward: false, startpreds: [['b', true]], endsuccs: [['b', false]] },
			b: { forward: false, startpreds: [['a', true]], endsuccs: [['a', false]] },
		});
		expect(hasLoop(g)).toBe(true);
	});

	it('misses a loop through an ALAP and an ASAP leaf, as TaskJuggler does', () => {
		const g = graph({
			a: { forward: false, startpreds: [['b', true]], endsuccs: [['b', false]] },
			b: { startpreds: [['a', true]], endsuccs: [['a', false]] },
		});
		expect(hasLoop(g)).toBe(false);
	});

	it('passes through containers and up to parents', () => {
		// x (in g) feeds c, and g depends on c.
		const g = graph({
			g: { children: ['x'], startpreds: [['c', true]] },
			x: { parent: 'g', endsuccs: [['c', false]] },
			c: { startpreds: [['x', true]], endsuccs: [['g', false]] },
		});
		expect(hasLoop(g)).toBe(true);
		const ok = graph({
			g: { children: ['x'] },
			x: { parent: 'g', endsuccs: [['c', false]] },
			c: { startpreds: [['x', true]] },
		});
		expect(hasLoop(ok)).toBe(false);
	});

	it('lets milestones walk both ways', () => {
		const g = graph({
			m: { milestone: true, startpreds: [['n', true]], endsuccs: [['n', false]] },
			n: { milestone: true, forward: false, startpreds: [['m', true]], endsuccs: [['m', false]] },
		});
		expect(hasLoop(g)).toBe(true);
		expect(hasLoop(graph({ a: {}, b: { startpreds: [['a', true]] } }))).toBe(false);
	});
});

describe('hasCycle', () => {
	it('finds every loop hasLoop finds, and the ones its walk misses', () => {
		const mixed = graph({
			a: { forward: false, startpreds: [['b', true]], endsuccs: [['b', false]] },
			b: { startpreds: [['a', true]], endsuccs: [['a', false]] },
		});
		expect(hasCycle(mixed)).toBe(true);
		// gui (in sw) after test; test.alpha after sw; test.beta has a successor (done).
		const nested = graph({
			sw: { children: ['gui'], endsuccs: [['alpha', false]] },
			gui: { parent: 'sw', startpreds: [['test', true]] },
			test: { children: ['alpha', 'beta'], endsuccs: [['gui', false]] },
			alpha: { parent: 'test', startpreds: [['sw', true]], endsuccs: [['beta', false]] },
			beta: { parent: 'test', startpreds: [['alpha', true]], endsuccs: [['done', false]] },
			done: { startpreds: [['beta', true]] },
		});
		expect(hasLoop(nested)).toBe(false);
		expect(hasCycle(nested)).toBe(true);
	});

	it('accepts chains, parallel links and containers', () => {
		const g = graph({
			p: { children: ['x', 'y'] },
			x: { parent: 'p', endsuccs: [['y', false]] },
			y: { parent: 'p', startpreds: [['x', true]], endsuccs: [['z', true]] },
			z: { startpreds: [['p', false]] },
		});
		expect(hasCycle(g)).toBe(false);
		expect(hasCycle(graph({ a: { startpreds: [['a', true]] } }))).toBe(true);
	});
});
