// SPDX-License-Identifier: GPL-2.0-or-later
// The T10 review's truthfulness cases without the engine (explain.engine.test.ts runs them on it):
// the results are the engine's for these plans, written out by hand, so that `test:unit` guards
// them where the engine is not built. Each case has its control, the same result over text
// without the restriction, which gives the mark.
// - F1: task `shifts` (own or inherited) or an `allocate` body: the wait is `unknown`, nothing is
//   held; a wait the people's calendars fill alone is still explained;
// - F2: a macro-written size and start: no `constraint` bound, `unknown`;
// - F3: task `limits`, a task shift or a person's `limits`: no unmet work.
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { booking, resourceResult, withPeople } from '../workload/testing';
import { demandOf } from './demand';
import { explainTask } from './explain-task';
import { inlineContext } from './explain-testing';
import { at, plan } from './testing';

const H = 'project p "P" 2026-01-05 - 2026-01-30\n';
const SHIFT = 'shift aft "Afternoon" {\n  workinghours mon - fri 13:00 - 17:00\n}\n';
const day = (d: number, from = 9, to = 17): [number, number] => [at(d, from), at(d, to)];
const asks = { scenarios: { plan: { allocate: [{ candidates: ['r'] }] } } };

/** x books r Mon 09:00 to 13:00; a books r Mon 13:00 to 17:00 (the engine's result for F1). */
const f1 = (a: string): ScheduleResult =>
	withPeople(
		plan([
			['x', { start: at(0, 9), end: at(0, 13), ...asks }],
			[a, { start: at(0, 13), end: at(0, 17), ...asks }],
		]),
		[resourceResult('r')],
		[booking('r', 'x', [day(0, 9, 13)]), booking('r', a, [day(0, 13, 17)])],
	);
const X = 'task x "X" {\n  effort 4h\n  allocate r\n  priority 900\n}\n';
const kinds = (r: ScheduleResult, text: string, id: string) =>
	explainTask(id, inlineContext(r, text)).causes.map((c) => c.kind);
const held = (r: ScheduleResult, text: string) => [...demandOf(inlineContext(r, text)).held.keys()];

describe('F1: task shifts and allocation bodies', () => {
	const a = (extra: string, alloc = 'allocate r') =>
		`task a "A" {\n  effort 4h\n  ${alloc}\n${extra}}\n`;
	it('makes a wait with working time unknown and holds nobody', () => {
		const text = `${H}${SHIFT}resource r "R"\n${X}${a('  shifts aft\n')}`;
		expect(kinds(f1('a'), text, 'a')).toEqual(['frame', 'unknown']);
		expect(held(f1('a'), text)).toEqual([]);
		const body = `${H}${SHIFT}resource r "R"\n${X}${a('', 'allocate r { shifts aft }')}`;
		expect(kinds(f1('a'), body, 'a')).toEqual(['frame', 'unknown']);
		expect(held(f1('a'), body)).toEqual([]);
		// Control: without the shift, r's morning on x is the wait.
		const plain = `${H}resource r "R"\n${X}${a('')}`;
		expect(kinds(f1('a'), plain, 'a')).toEqual(['frame', 'off-hours', 'busy']);
		expect(held(f1('a'), plain)).toEqual(['r']);
	});

	it('sees a shift inherited from a container', () => {
		const r = withPeople(
			plan([
				['x', { start: at(0, 9), end: at(0, 13), ...asks }],
				['g', { start: at(0, 13), end: at(0, 17) }],
				['g.a', { start: at(0, 13), end: at(0, 17), parent: 'g', ...asks }],
			]),
			[resourceResult('r')],
			[booking('r', 'x', [day(0, 9, 13)]), booking('r', 'g.a', [day(0, 13, 17)])],
		);
		const text = `${H}${SHIFT}resource r "R"\n${X}task g "G" {\n  shifts aft\n  task a "A" {\n    effort 4h\n    allocate r\n  }\n}\n`;
		expect(kinds(r, text, 'g.a')).toEqual(['frame', 'unknown']);
		expect(held(r, text)).toEqual([]);
	});

	it('still explains a wait in which nobody had working time', () => {
		// a starts Mon 09:00 (r's first working hour); the night before is no one's working time.
		const r = withPeople(
			plan([['a', { start: at(0, 9), end: at(0, 13), ...asks }]]),
			[resourceResult('r')],
			[booking('r', 'a', [day(0, 9, 13)])],
		);
		const text = `${H}${SHIFT}resource r "R"\n${a('  shifts aft\n')}`;
		expect(explainTask('a', inlineContext(r, text)).causes).toEqual([
			{ kind: 'frame' },
			{ kind: 'off-hours', resource: null, window: [0, at(0, 9)] },
		]);
	});
});

describe('F2: a macro-written size and start', () => {
	// x takes r Mon and Tue; a books r Wed and Thu.
	const r = withPeople(
		plan([
			['x', { start: at(0, 9), end: at(1, 17), ...asks }],
			['a', { start: at(2, 9), end: at(3, 17), ...asks }],
		]),
		[resourceResult('r')],
		[booking('r', 'x', [day(0), day(1)]), booking('r', 'a', [day(2), day(3)])],
	);
	const X2 = 'task x "X" {\n  effort 2d\n  allocate r\n  priority 900\n}\n';
	it('gives no bound and says the schedule does not show why', () => {
		const text = `${H}macro e [effort 2d]\nmacro s [2026-01-05]\nresource r "R"\n${X2}task a "A" {\n  start \${s}\n  \${e}\n  allocate r\n}\n`;
		expect(explainTask('a', inlineContext(r, text))).toMatchObject({
			bound: null,
			at: at(2, 9),
			causes: [{ kind: 'constraint', attr: 'start', inherited: false }, { kind: 'unknown' }],
		});
		expect(held(r, text)).toEqual([]);
		// Control: written plainly, the bound is Mon 00:00 and r was on x until Tue 17:00.
		const plain = `${H}resource r "R"\n${X2}task a "A" {\n  start 2026-01-05\n  effort 2d\n  allocate r\n}\n`;
		expect(kinds(r, plain, 'a')).toEqual(['constraint', 'off-hours', 'busy', 'off-hours']);
		expect(held(r, plain)).toEqual(['r']);
	});
});

describe('F3: limits and shifts on a length task', () => {
	// x takes r Mon to Wed; o (length 5d, Mon 00:00 to Fri 17:00) gets r Thu and Fri 09:00-11:00.
	const r = withPeople(
		plan([
			['x', { start: at(0, 9), end: at(2, 17), ...asks }],
			['o', { start: 0, end: at(4, 17), ...asks }],
		]),
		[resourceResult('r')],
		[
			booking('r', 'x', [day(0), day(1), day(2)]),
			booking('r', 'o', [day(3, 9, 11), day(4, 9, 11)]),
		],
	);
	const X3 = 'task x "X" {\n  effort 3d\n  allocate r\n  priority 900\n}\n';
	const o = (extra: string) => `task o "O" {\n  length 5d\n  allocate r\n${extra}}\n`;
	const unmet = (text: string) => [...demandOf(inlineContext(r, text)).unmet.keys()];
	it('gives no unmet work under task limits, a task shift or the person’s limits', () => {
		expect(unmet(`${H}resource r "R"\n${X3}${o('  limits { dailymax 2h }\n')}`)).toEqual([]);
		expect(unmet(`${H}${SHIFT}resource r "R"\n${X3}${o('  shifts aft\n')}`)).toEqual([]);
		expect(unmet(`${H}resource r "R" {\n  limits { dailymax 2h }\n}\n${X3}${o('')}`)).toEqual([]);
		// Control: without them, r's three days on x are unmet.
		expect(unmet(`${H}resource r "R"\n${X3}${o('')}`)).toEqual(['r']);
	});
});
