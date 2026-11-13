// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { analyse } from './critical';
import { latePass, latestUnder } from './float';
import { buildGraph, type Edge } from './graph';
import { at, dep, plan } from './testing';
import { workingTimeOf } from './working-time';

function pass(r: ScheduleResult) {
	if (!r.project) throw new Error('no project');
	const wt = workingTimeOf(r.project);
	const g = buildGraph(r, 'plan');
	const late = latePass(g, wt);
	const by = (id: string) => g.index.get(id) as number;
	return {
		g,
		late,
		float: (id: string) => late.float[by(id)],
		lateEnd: (id: string) => late.lateEnd[by(id)],
		lateStart: (id: string) => late.lateStart[by(id)],
	};
}

describe('latestUnder', () => {
	const wt = workingTimeOf(plan([]).project as NonNullable<ScheduleResult['project']>);
	const edge = (over: Partial<Edge>): Edge => ({
		pred: 0,
		predEnd: true,
		succ: 1,
		succEnd: false,
		gapLength: 0,
		gapDuration: 0,
		via: 'depends',
		link: 'a>b',
		...over,
	});

	it('walks a gaplength back over working time and a gapduration over calendar time', () => {
		expect(latestUnder(edge({}), at(7, 9), wt)).toBe(at(7, 9));
		expect(latestUnder(edge({ gapLength: 480 }), at(7, 9), wt)).toBe(at(4, 9));
		expect(latestUnder(edge({ gapDuration: 1440 }), at(7, 9), wt)).toBe(at(6, 9));
		// Both: the earlier of the two.
		expect(latestUnder(edge({ gapLength: 60, gapDuration: 1440 }), at(7, 12), wt)).toBe(at(6, 12));
		expect(latestUnder(edge({ gapLength: 600, gapDuration: 60 }), at(7, 12), wt)).toBe(at(4, 10));
	});
});

describe('latePass', () => {
	it("bounds by the finish, and a successor's late start less its working span", () => {
		const p = pass(
			plan([
				['a', { start: at(0, 9), end: at(0, 17) }],
				['b', { start: at(0, 9), end: at(1, 17) }],
				['c', { start: at(2, 9), end: at(3, 17), depends: [dep('a')] }],
				['d', { start: at(4, 9), end: at(4, 17), depends: [dep('b')] }],
			]),
		);
		// c can end at the finish (Fri 17:00): it starts 2 working days earlier, Thu 09:00.
		expect(p.lateEnd('c')).toBe(at(4, 17));
		expect(p.lateStart('c')).toBe(at(3, 9));
		expect(p.float('a')).toBe(2 * 480);
		expect(p.float('b')).toBe(2 * 480);
		expect(p.late.clamped).toBe(0);
		expect(p.late.cyclic).toBe(0);
	});

	it('bounds the children that start a container by an edge from its start (onstart)', () => {
		const p = pass(
			plan([
				['C', { start: at(0, 9), end: at(4, 17) }],
				['C.short', { parent: 'C', start: at(0, 9), end: at(1, 17) }],
				['C.long', { parent: 'C', start: at(0, 9), end: at(4, 17) }],
				['C.late', { parent: 'C', start: at(2, 9), end: at(2, 17) }],
				['z', { start: at(0, 9), end: at(7, 17), depends: [dep('C', { onEnd: false })] }],
			]),
		);
		expect(p.float('C.short')).toBe(0);
		expect(p.float('C.long')).toBe(0);
		// It does not start the container: it keeps its float to the container's late end.
		expect(p.float('C.late')).toBe(2 * 480);
		expect(p.float('C')).toBe(0);
	});

	it('raises a late end that falls before the end, and counts it', () => {
		// The engine dates break the edge (s starts before p ends), as only a bad result could.
		const p = pass(
			plan([
				['p', { start: at(0, 9), end: at(2, 17) }],
				['s', { start: at(1, 9), end: at(2, 17), depends: [dep('p')] }],
			]),
		);
		expect(p.float('p')).toBe(0);
		expect(p.lateEnd('p')).toBe(at(2, 17));
		expect(p.late.clamped).toBe(1);
	});

	it('processes the nodes of a cycle once each, after the rest', () => {
		const p = pass(
			plan(
				[
					['a', { start: at(0, 9), end: at(0, 17), depends: [dep('b')] }],
					['b', { start: at(1, 9), end: at(1, 17), depends: [dep('a')] }],
					['c', { start: at(2, 9), end: at(2, 17) }],
				],
				{},
				false,
			),
		);
		expect(p.late.cyclic).toBe(2);
		expect(p.float('c')).toBe(0);
		for (const id of ['a', 'b']) expect(p.float(id)).toBeGreaterThanOrEqual(0);
	});

	it('gives an ALAP task with no successor float to the finish (its own end is ignored)', () => {
		const a = analyse(
			plan([
				['x', { alap: true, start: at(1, 9), end: at(1, 17) }],
				['y', { start: at(0, 9), end: at(4, 17) }],
			]),
			'plan',
			workingTimeOf(plan([]).project as NonNullable<ScheduleResult['project']>),
		);
		expect(a.floatMin.get('x')).toBe(3 * 480);
		expect(a.driver.get('x')).toEqual({ kind: 'unexplained' });
	});
});
