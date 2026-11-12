// SPDX-License-Identifier: GPL-2.0-or-later
// Timing checks of the task attribute intents (task-attrs-timing.ts). Every case was run through
// native tj3 3.8.4: a refused intent's text (the statement inserted where the edit would put it)
// gives the error named in the case, an allowed intent's result schedules without it.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const P = 'project p "P" 2026-01-05 +2m\n';

function run(src: string, intent: EditIntent): EditResult {
	const s = setup(src);
	return applyIntent(s.snap, s.index, intent);
}

const set = (task: string, attr: string, value: string | boolean): EditIntent =>
	({ type: 'setAttr', task, attr, value }) as EditIntent;

function expectText(src: string, intent: EditIntent, want: string): void {
	const s = setup(src);
	expect(textsAfter(s.snap, applyIntent(s.snap, s.index, intent))['plan.tjp']).toBe(want);
}

describe('direction is positional', () => {
	const e = (body: string): string =>
		P +
		'resource r "R"\ntask a "A" { start 2026-01-06 effort 1d allocate r }\n' +
		`task d "D" {\n  scheduling alap\n  task e "E" {\n${body}    effort 1d\n    allocate r\n  }\n}\n`;

	it('refuses an end before the own depends of a child of an ALAP parent', () => {
		// end; depends a; effort: depends is read last, so d.e is ASAP (task_overspecified).
		expect(run(e('    depends a\n'), set('d.e', 'end', '2026-01-20'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		// depends a; end …: end is read last, so d.e stays ALAP.
		const src = e('    depends a\n    end 2026-01-20\n');
		expectText(src, set('d.e', 'end', '2026-01-21'), src.replace('-20', '-21'));
	});

	it('refuses a start on a task whose precedes makes it ALAP', () => {
		const src = P + 'task b "B" { start 2026-01-20 length 1d }\n';
		const a = 'task a "A" {\n  length 2d\n  precedes b\n}\n';
		expect(run(src + a, set('a', 'start', '2026-01-06'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('allows a criterion after an end that follows the depends', () => {
		const src = P + 'task b "B" { start 2026-01-06 length 1d }\n';
		const a = 'task a "A" {\n  depends b\n  end 2026-01-20\n}\n';
		expectText(src + a, set('a', 'length', '2d'), src + a.replace('-20\n', '-20\n  length 2d\n'));
		// end; depends b: depends is read last, so the task is ASAP with an end.
		const late = 'task a "A" {\n  end 2026-01-20\n  depends b\n}\n';
		expect(run(src + late, set('a', 'length', '2d'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('lets a task marked scheduled have start, end and a criterion', () => {
		const src = P + 'task a "A" {\n  start 2026-01-06\n  end 2026-01-20\n  scheduled\n}\n';
		expectText(src, set('a', 'length', '2d'), src.replace('-20\n', '-20\n  length 2d\n'));
	});

	it('reads the depends a child inherits and the scheduling it writes', () => {
		const src =
			P +
			'task b "B" { start 2026-01-06 length 1d }\n' +
			'task par "Par" {\n  depends b\n  task a "A" {\n    end 2026-01-20\n    length 2d\n  }\n}\n';
		expect(run(src, set('par.a', 'scheduling', 'asap'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses removing the scheduling that keeps a task ALAP', () => {
		const src =
			P +
			'task b "B" { start 2026-01-06 length 1d }\n' +
			'task a "A" {\n  end 2026-01-20\n  depends b\n  scheduling alap\n  length 2d\n}\n';
		expect(run(src, { type: 'removeAttr', task: 'a', attr: 'scheduling' })).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});
});

describe('milestones and bookings', () => {
	it('refuses alap for a child milestone with only a start', () => {
		const child =
			P + 'task par "Par" {\n  task m "M" {\n    start 2026-01-06\n    milestone\n  }\n}\n';
		expect(run(child, set('par.m', 'scheduling', 'alap'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		// A top-level one has no parent end to take.
		const top = P + 'task m "M" {\n  start 2026-01-06\n  milestone\n}\n';
		expectText(top, set('m', 'scheduling', 'alap'), top.replace('06\n', '06\n  scheduling alap\n'));
	});

	it('refuses asap for a milestone with only an end and no start dependency', () => {
		const src = P + 'task par "Par" {\n  task m "M" {\n    end 2026-01-20\n    milestone\n  }\n}\n';
		expect(run(src, set('par.m', 'scheduling', 'asap'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses an end that makes a booked task ALAP', () => {
		const src =
			P +
			'resource r "R"\ntask a "A" {\n  start 2026-01-05\n  allocate r\n' +
			'  booking r 2026-01-05-09:00 +2h\n}\n';
		const r = run(src, set('a', 'end', '2026-01-20'));
		expect(r).toMatchObject({ reason: 'conflicting-attribute' });
		expect(r.status === 'refused' && r.at).toHaveLength(1);
	});
});
