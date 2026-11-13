// SPDX-License-Identifier: GPL-2.0-or-later
// Hand-computed fixtures for the driving path (phase-2.md 13.1): chain, fan-in, gaps, ALAP,
// containers, onstart, a resource-driven start, the status date, milestones, scenarios, cycles.
// Calendar: Mon-Fri 09:00-17:00 from Monday 2026-01-05 (day 0); `at(day, hour)`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { analyse, analyseResult, type DrivingAnalysis } from './critical';
import { at, dep, plan, weekdays } from './testing';
import { workingTimeOf } from './working-time';

function run(r: ScheduleResult, scenario = 'plan'): DrivingAnalysis {
	if (!r.project) throw new Error('no project');
	return analyse(r, scenario, workingTimeOf(r.project));
}
const sorted = (s: ReadonlySet<string>): string[] => [...s].sort();

function golden(id: string): ScheduleResult {
	const file = path.join(ROOT, 'engine/golden/expected', `${id}.json`);
	const r = (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result;
	return { ...r, revision: 1 };
}

describe('a chain', () => {
	const r = plan([
		['a', { start: at(0, 9), end: at(1, 17) }],
		['b', { start: at(2, 9), end: at(3, 17), depends: [dep('a')] }],
		// Friday and Monday: the bar spans a weekend.
		['c', { start: at(4, 9), end: at(7, 17), depends: [dep('b')] }],
		['d', { start: at(0, 9), end: at(0, 17) }],
	]);
	const a = run(r);

	it('is critical from the finish back to the start', () => {
		expect(a.finish).toBe(at(7, 17));
		expect(sorted(a.critical)).toEqual(['a', 'b', 'c']);
		expect(sorted(a.criticalLinks)).toEqual(['a>b', 'b>c']);
		expect(sorted(a.path)).toEqual(['a', 'b', 'c']);
	});

	it('gives zero float on the chain and working-time float off it', () => {
		expect(a.floatMin.get('a')).toBe(0);
		expect(a.floatMin.get('c')).toBe(0);
		// d ends Monday 17:00; it could end at the finish: Tue to Fri and the next Monday.
		expect(a.floatMin.get('d')).toBe(5 * 480);
		expect(a.lateEnd.get('d')).toBe(at(7, 17));
		expect(a.lateEnd.get('a')).toBe(at(1, 17));
	});

	it("names each task's driver", () => {
		expect(a.driver.get('a')).toEqual({ kind: 'frame' });
		expect(a.driver.get('b')).toEqual({ kind: 'dependency', pred: 'a', via: 'depends' });
		expect(a.driver.get('c')).toEqual({ kind: 'dependency', pred: 'b', via: 'depends' });
		expect(a.driver.get('d')).toEqual({ kind: 'frame' });
		expect(a.clamped).toBe(0);
	});
});

describe('a fan-in', () => {
	const a = run(
		plan([
			['a', { start: at(0, 9), end: at(0, 17) }],
			['b', { start: at(0, 9), end: at(2, 17) }],
			['c', { start: at(3, 9), end: at(3, 17), depends: [dep('a'), dep('b')] }],
		]),
	);

	it('follows the later predecessor only', () => {
		expect(sorted(a.critical)).toEqual(['b', 'c']);
		expect(sorted(a.criticalLinks)).toEqual(['b>c']);
		expect(a.driver.get('c')).toEqual({ kind: 'dependency', pred: 'b', via: 'depends' });
		expect(a.floatMin.get('a')).toBe(2 * 480);
		expect(a.lateEnd.get('a')).toBe(at(2, 17));
	});
});

describe('gaps', () => {
	const a = run(
		plan([
			['p', { start: at(0, 9), end: at(0, 17) }],
			// gaplength 1d after Monday 17:00 ends Tuesday 17:00: s starts Wednesday 09:00.
			['s', { start: at(2, 9), end: at(2, 17), depends: [dep('p', { gapLengthMin: 480 })] }],
			// gapduration 2d after Wednesday 17:00 is Friday 17:00: t starts Monday 09:00.
			['t', { start: at(7, 9), end: at(7, 17), depends: [dep('s', { gapDurationMin: 2880 })] }],
			// Both gaps: 2 working hours (Tuesday 11:00) or 1 calendar day (Tuesday 17:00).
			[
				'u',
				{
					start: at(9, 9),
					end: at(9, 17),
					depends: [dep('t', { gapLengthMin: 120, gapDurationMin: 1440 })],
				},
			],
		]),
	);

	it('drives through working and calendar gaps', () => {
		expect(a.driver.get('s')).toEqual({ kind: 'dependency', pred: 'p', via: 'depends' });
		expect(a.driver.get('t')).toEqual({ kind: 'dependency', pred: 's', via: 'depends' });
		expect(a.driver.get('u')).toEqual({ kind: 'dependency', pred: 't', via: 'depends' });
	});

	it('stops the critical path where a calendar gap ends in non-working time', () => {
		// s could end as late as Saturday 09:00 (Monday 09:00 less 2d) without moving t: Thursday
		// and Friday are float, so s and p are not critical although s drives t.
		expect(sorted(a.critical)).toEqual(['t', 'u']);
		expect(sorted(a.criticalLinks)).toEqual(['t>u']);
		expect(a.floatMin.get('s')).toBe(2 * 480);
		expect(a.floatMin.get('p')).toBe(2 * 480);
		expect(a.floatMin.get('t')).toBe(0);
	});

	it('keeps a calendar gap that ends in working time on the critical path', () => {
		const b = run(
			plan([
				['p', { start: at(0, 9), end: at(0, 17) }],
				// Monday 17:00 plus 2d is Wednesday 17:00: q starts Thursday 09:00.
				['q', { start: at(3, 9), end: at(3, 17), depends: [dep('p', { gapDurationMin: 2880 })] }],
			]),
		);
		expect(sorted(b.critical)).toEqual(['p', 'q']);
		expect(b.floatMin.get('p')).toBe(0);
	});
});

describe('a resource-driven start', () => {
	const a = run(
		plan([
			['p', { start: at(0, 9), end: at(0, 17) }],
			// The edge allows Tuesday; s starts Wednesday, waiting for its person.
			['s', { start: at(2, 9), end: at(2, 17), depends: [dep('p')] }],
		]),
	);

	it('ends the path at the task and leaves its driver unexplained', () => {
		expect(sorted(a.critical)).toEqual(['s']);
		expect(a.criticalLinks.size).toBe(0);
		expect(a.driver.get('s')).toEqual({ kind: 'unexplained' });
		// p could slip a day before s would have to move.
		expect(a.floatMin.get('p')).toBe(480);
	});
});

describe('ALAP tasks placed by precedes', () => {
	const frame = { end: '2026-01-10T00:00:00Z', workingTime: weekdays(5) };
	const a = run(
		plan(
			[
				['v', { start: at(0, 9), end: at(0, 17) }],
				[
					'w',
					{
						alap: true,
						start: at(1, 9),
						end: at(1, 17),
						precedes: [dep('x', { onEnd: false, gapLengthMin: 480 })],
					},
				],
				[
					'x',
					{ alap: true, start: at(3, 9), end: at(3, 17), precedes: [dep('y', { onEnd: false })] },
				],
				['y', { alap: true, start: at(4, 9), end: at(4, 17) }],
			],
			frame,
		),
	);

	it('walks back through the precedes chain', () => {
		expect(sorted(a.critical)).toEqual(['w', 'x', 'y']);
		expect(sorted(a.criticalLinks)).toEqual(['w>x', 'x>y']);
		expect(a.driver.get('y')).toEqual({ kind: 'frame' });
		expect(a.driver.get('x')).toEqual({ kind: 'dependency', pred: 'y', via: 'precedes' });
		expect(a.driver.get('w')).toEqual({ kind: 'dependency', pred: 'x', via: 'precedes' });
		expect(a.floatMin.get('w')).toBe(0);
		expect(a.floatMin.get('v')).toBe(4 * 480);
	});

	it("follows precedes onend into the successor's end (syn-07 h precedes g)", () => {
		const g = run(golden('syn-07-deps-onstart-onend'));
		expect(g.driver.get('chain.h')).toEqual({
			kind: 'dependency',
			pred: 'chain.g',
			via: 'precedes',
		});
		expect(sorted(g.path)).toEqual(['chain', 'chain.g', 'chain.h']);
	});
});

describe('containers', () => {
	const inherited = [dep('P')];
	const a = run(
		plan([
			['P', { start: at(0, 9), end: at(0, 17) }],
			['C', { start: at(1, 9), end: at(3, 17), depends: inherited }],
			['C.x', { parent: 'C', start: at(1, 9), end: at(1, 17), depends: inherited }],
			[
				'C.y',
				{ parent: 'C', start: at(2, 9), end: at(3, 17), depends: [...inherited, dep('C.x')] },
			],
			['z', { start: at(4, 9), end: at(4, 17), depends: [dep('C')] }],
			['w', { start: at(0, 9), end: at(1, 17) }],
			['D', { start: at(0, 9), end: at(0, 17) }],
			['D.a', { parent: 'D', start: at(0, 9), end: at(0, 17) }],
		]),
	);

	it('enters a container at the child that sets its end, and links inherited entries at the container', () => {
		expect(sorted(a.critical)).toEqual(['C', 'C.x', 'C.y', 'P', 'z']);
		expect(sorted(a.criticalLinks)).toEqual(['C.x>C.y', 'C>z', 'P>C']);
		expect(a.driver.get('C.x')).toEqual({ kind: 'dependency', pred: 'P', via: 'depends' });
	});

	it('gives a container the least float of its subtree, and bounds its children by it', () => {
		expect(a.floatMin.get('C')).toBe(0);
		expect(a.floatMin.get('w')).toBe(3 * 480);
		expect(a.floatMin.get('D')).toBe(4 * 480);
		expect(a.floatMin.get('D.a')).toBe(4 * 480);
		expect(a.lateEnd.get('D')).toBe(at(4, 17));
	});
});

describe('onstart', () => {
	const a = run(
		plan([
			['a', { start: at(0, 9), end: at(2, 17) }],
			['b', { start: at(0, 9), end: at(0, 17), depends: [dep('a', { onEnd: false })] }],
			['c', { start: at(1, 9), end: at(4, 17), depends: [dep('b')] }],
		]),
	);

	it('makes the predecessor critical through its start', () => {
		expect(sorted(a.critical)).toEqual(['a', 'b', 'c']);
		expect(sorted(a.criticalLinks)).toEqual(['a>b', 'b>c']);
		expect(a.floatMin.get('a')).toBe(0);
		expect(a.driver.get('b')).toEqual({ kind: 'dependency', pred: 'a', via: 'depends' });
	});
});

describe('onstart from a container', () => {
	const a = run(
		plan([
			['C', { start: at(0, 9), end: at(4, 17) }],
			['C.short', { parent: 'C', start: at(0, 9), end: at(1, 17) }],
			['C.long', { parent: 'C', start: at(0, 9), end: at(4, 17) }],
			['C.late', { parent: 'C', start: at(2, 9), end: at(2, 17) }],
			['z', { start: at(0, 9), end: at(7, 17), depends: [dep('C', { onEnd: false })] }],
		]),
	);

	it('enters the children that start the container, with zero float', () => {
		expect(sorted(a.critical)).toEqual(['C', 'C.long', 'C.short', 'z']);
		expect(sorted(a.criticalLinks)).toEqual(['C>z']);
		expect(a.floatMin.get('C.short')).toBe(0);
		expect(a.floatMin.get('C.late')).toBe(2 * 480);
	});
});

describe('the status date', () => {
	const tasks = [
		['a', { start: at(0, 9), end: at(1, 17) }],
		['b', { start: at(2, 9), end: at(3, 17), depends: [dep('a')] }],
		['c', { start: at(4, 9), end: at(7, 17), depends: [dep('b')] }],
	] as const;

	it('highlights only what ends after it, and keeps the rest on the path', () => {
		const a = run(plan(tasks, { now: '2026-01-07T12:00:00Z' }));
		expect(sorted(a.path)).toEqual(['a', 'b', 'c']);
		expect(sorted(a.critical)).toEqual(['b', 'c']);
		expect(sorted(a.criticalLinks)).toEqual(['b>c']);
		expect(a.status).toBe(at(2, 12));
	});

	it('highlights nothing when the status date is after the finish', () => {
		const a = run(plan(tasks, { now: '2026-02-20T12:00:00Z' }));
		expect(a.path.size).toBe(3);
		expect(a.critical.size).toBe(0);
		expect(a.criticalLinks.size).toBe(0);
	});
});

describe('milestones and tasks that are not scheduled', () => {
	const a = run(
		plan([
			['c', { start: at(0, 9), end: at(1, 17) }],
			['m', { milestone: true, start: at(1, 17), end: at(1, 17), depends: [dep('c')] }],
			['u', { start: null, end: null, depends: [dep('c')] }],
		]),
	);

	it("drives a milestone exactly at its predecessor's end, and skips unscheduled tasks", () => {
		expect(sorted(a.critical)).toEqual(['c', 'm']);
		expect(a.criticalLinks.has('c>m')).toBe(true);
		expect(a.floatMin.get('m')).toBe(0);
		expect(a.floatMin.has('u')).toBe(false);
		expect(a.driver.has('u')).toBe(false);
	});
});

describe('scenarios', () => {
	const r = plan(
		[
			['a', { start: at(0, 9), end: at(0, 17), scenarios: { delayed: { end: at(2, 17) } } }],
			[
				'b',
				{
					start: at(1, 9),
					end: at(3, 17),
					depends: [dep('a')],
					scenarios: { delayed: { start: at(3, 9), end: at(3, 17) } },
				},
			],
		],
		{
			scenarios: [
				{ id: 'plan', name: 'Plan', parent: null, active: true },
				{ id: 'delayed', name: 'Delayed', parent: 'plan', active: true },
			],
		},
	);

	it('analyses the scenario asked for, and the first active one by default', () => {
		expect(analyseResult(r)?.scenario).toBe('plan');
		expect(run(r, 'plan').floatMin.get('a')).toBe(0);
		expect(sorted(run(r, 'delayed').critical)).toEqual(['a', 'b']);
		const inactive = { ...r, project: r.project && { ...r.project, scenarios: [] } };
		expect(analyseResult(inactive)).toBeNull();
		expect(analyseResult({ ...r, project: null })).toBeNull();
	});
});

describe('a failed run with a cycle', () => {
	const r = plan(
		[
			['a', { start: at(0, 9), end: at(1, 17), depends: [dep('b')] }],
			['b', { start: at(2, 9), end: at(3, 17), depends: [dep('a')] }],
			['c', { start: at(0, 9), end: at(0, 17), precedes: [dep('a', { onEnd: false })] }],
		],
		{},
		false,
	);

	it('terminates and keeps float at least 0', () => {
		const a = run(r);
		expect(a.floatMin.size).toBe(3);
		for (const f of a.floatMin.values()) expect(f).toBeGreaterThanOrEqual(0);
		expect(a.critical.has('b')).toBe(true);
	});
});

describe('golden plans with known answers', () => {
	it('syn-08: the ALAP chain is the driving path; the gap line has float', () => {
		const a = run(golden('syn-08-deps-gaps-alap'));
		expect(sorted(a.critical)).toEqual(['alap', 'alap.alpha', 'alap.beta', 'alap.gamma']);
		expect(sorted(a.criticalLinks)).toEqual(['alap.alpha>alap.beta', 'alap.beta>alap.gamma']);
		expect(a.driver.get('line.build')).toEqual({
			kind: 'dependency',
			pred: 'line.design',
			via: 'depends',
		});
		expect(a.driver.get('line.test')?.kind).toBe('dependency');
		expect(a.driver.get('line.release')?.kind).toBe('dependency');
		expect(a.floatMin.get('line.release')).toBeGreaterThan(0);
		expect(a.clamped).toBe(0);
	});

	it('syn-07: onstart and onend drivers, and resource-placed tasks left unexplained', () => {
		const a = run(golden('syn-07-deps-onstart-onend'));
		expect(a.driver.get('chain.a')).toEqual({ kind: 'frame' });
		expect(a.driver.get('chain.b')).toEqual({
			kind: 'dependency',
			pred: 'chain.a',
			via: 'depends',
		});
		expect(a.driver.get('chain.c')).toEqual({
			kind: 'dependency',
			pred: 'chain.b',
			via: 'depends',
		});
		expect(a.driver.get('chain.d')).toEqual({
			kind: 'dependency',
			pred: 'chain.a',
			via: 'depends',
		});
		expect(a.driver.get('chain.e')).toEqual({
			kind: 'dependency',
			pred: 'chain.c',
			via: 'depends',
		});
		expect(a.driver.get('chain.f')).toEqual({ kind: 'unexplained' });
		expect(a.driver.get('chain.g')).toEqual({ kind: 'unexplained' });
		// Every task ends before the status date (2026-02-02): nothing is highlighted.
		expect(a.critical.size).toBe(0);
	});
});
