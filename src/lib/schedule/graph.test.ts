// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { at, dep, plan } from './testing';

describe('buildGraph', () => {
	it('keeps the scheduled tasks of the scenario in pre-order, with the finish and frame', () => {
		const r = plan(
			[
				['a', { start: at(0, 9), end: at(0, 17) }],
				['b', { start: null, end: null }],
				['c', { start: at(1, 9), end: at(2, 17) }],
			],
			{ now: '2026-01-06T09:00:00Z' },
		);
		const g = buildGraph(r, 'plan');
		expect(g.ids).toEqual(['a', 'c']);
		expect(g.finish).toBe(at(2, 17));
		expect(g.status).toBe(at(1, 9));
		expect(g.frameEnd).toBe(56 * 1440);
		expect(buildGraph(r, 'other').n).toBe(0);
		expect(buildGraph(r, 'other').finish).toBeNull();
	});

	it('makes depends edges into the start and precedes edges from the end', () => {
		const r = plan([
			['p', { start: at(0, 9), end: at(0, 17) }],
			['s', { start: at(1, 9), end: at(1, 17), depends: [dep('p', { gapLengthMin: 60 })] }],
			['t', { start: at(2, 9), end: at(2, 17), precedes: [dep('s', { onEnd: true })] }],
			['u', { start: at(2, 9), end: at(2, 17), depends: [dep('p', { onEnd: false })] }],
		]);
		const g = buildGraph(r, 'plan');
		expect(g.edges).toEqual([
			expect.objectContaining({ pred: 0, predEnd: true, succ: 1, succEnd: false, gapLength: 60 }),
			expect.objectContaining({ pred: 2, predEnd: true, succ: 1, succEnd: true, via: 'precedes' }),
			expect.objectContaining({ pred: 0, predEnd: false, succ: 3, succEnd: false, via: 'depends' }),
		]);
		expect(g.edges.map((e) => e.link)).toEqual(['p>s', 't>s', 'p>u']);
		expect(g.into[1]).toEqual([0, 1]);
		expect(g.out[0]).toEqual([0, 2]);
	});

	it('links an inherited entry to the top-most ancestor that declares it, as the Gantt draws it', () => {
		const inherited = [dep('p')];
		const r = plan([
			['p', { start: at(0, 9), end: at(0, 17) }],
			['c', { start: at(1, 9), end: at(2, 17), depends: inherited }],
			['c.x', { parent: 'c', start: at(1, 9), end: at(1, 17), depends: inherited }],
			['c.x.y', { parent: 'c.x', start: at(1, 9), end: at(1, 17), depends: inherited }],
			[
				'c.z',
				{ parent: 'c', start: at(2, 9), end: at(2, 17), depends: [...inherited, dep('c.x')] },
			],
		]);
		const g = buildGraph(r, 'plan');
		expect(g.edges.map((e) => e.link)).toEqual(['p>c', 'p>c', 'p>c', 'p>c', 'c.x>c.z']);
		expect(Array.from(g.container)).toEqual([0, 1, 1, 0, 0]);
		expect(Array.from(g.parent)).toEqual([-1, -1, 1, 2, 1]);
		expect(g.children[1]).toEqual([2, 4]);
	});

	it('skips edges to tasks that are not scheduled, unknown or itself, and an unscheduled parent', () => {
		const r = plan([
			['box', { start: null, end: null }],
			['box.a', { parent: 'box', start: at(0, 9), end: at(0, 17) }],
			[
				'b',
				{
					start: at(1, 9),
					end: at(1, 17),
					depends: [dep('box'), dep('ghost'), dep('b'), dep('box.a')],
				},
			],
		]);
		const g = buildGraph(r, 'plan');
		expect(g.ids).toEqual(['box.a', 'b']);
		expect(Array.from(g.parent)).toEqual([-1, -1]);
		expect(g.edges.map((e) => e.link)).toEqual(['box.a>b']);
	});

	it('reads a result without the v2 dependency lists as having no edges', () => {
		const r = plan([['a', { start: at(0, 9), end: at(0, 17) }]]);
		const s = r.tasks[0]?.scenarios['plan'] as unknown as Record<string, unknown>;
		delete s['depends'];
		delete s['precedes'];
		expect(buildGraph(r, 'plan').edges).toEqual([]);
	});
});
