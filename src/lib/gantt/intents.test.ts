// SPDX-License-Identifier: GPL-2.0-or-later
// planAction and checkAction on small hand-made plans and results (no engine): the date-text
// rule, sizes for unsized tasks, effort rounding, the gap kinds, the ALAP clamp, labels and the
// refusal sentences. Day 0 is Monday 2026-01-05; working time Mon-Fri 09:00-17:00 (schedule/testing.ts).
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { at, dep, plan, type TaskSpec } from '../schedule/testing';
import { refusalStrings } from '../strings';
import type { RefusalReason } from '../tjp/edit/types';
import {
	checkAction,
	earliestStart,
	latestEnd,
	planAction,
	refusalMessage,
	suggestedMoveKind,
	type GanttAction,
	type NotPossibleReason,
} from './intents';
import { fixtureFrom, type Fixture } from './intents-testing';

const HEAD = 'project p "P" 2026-01-05 +8w\nresource r "R"\nresource q "Q"\n';

function fx(
	body: string,
	tasks: ReadonlyArray<readonly [string, TaskSpec]>,
	alloc: Record<string, string[]> = {},
): Fixture {
	const r: ScheduleResult = plan(tasks);
	for (const t of r.tasks) {
		const s = t.scenarios['plan'];
		if (s) s.allocated = alloc[t.id] ?? [];
	}
	return fixtureFrom({ 'plan.tjp': HEAD + body }, 'plan.tjp', r);
}

function intentOf(f: Fixture, a: GanttAction, move: 'start' | 'gap' | null = 'start'): unknown {
	const p = planAction(a, f.ctx({ move: move === null ? null : { kind: move } }));
	return p.status === 'intent' ? p.intent : p;
}

describe('dates written by moves and resizes', () => {
	const f = fx(
		'task a "A" {\n  effort 2d\n  allocate r\n}\ntask m "M" {\n  milestone\n}\ntask d "D" {\n  duration 2d\n}\n',
		[
			['a', { start: at(0, 9), end: at(1, 17) }],
			['m', { start: at(2, 12), end: at(2, 12), milestone: true }],
			['d', { start: at(0, 13), end: at(2, 13) }],
		],
		{ a: ['r'] },
	);

	it('a plain date when its midnight means the same working time', () => {
		expect(intentOf(f, { type: 'move', task: 'a', days: 2 })).toMatchObject({
			attr: 'start',
			value: '2026-01-07',
		});
		// Over the weekend: Friday + 1 working day is Monday.
		expect(intentOf(f, { type: 'move', task: 'a', days: 5 })).toMatchObject({
			value: '2026-01-12',
		});
	});

	it('the full instant for a mid-day start, a milestone or a duration task', () => {
		expect(intentOf(f, { type: 'move', task: 'm', days: 1 })).toMatchObject({
			attr: 'start',
			value: '2026-01-08-09:00',
		});
		// d starts at 13:00: the shifted day keeps the working-day start (09:00), written exactly.
		expect(intentOf(f, { type: 'move', task: 'd', days: 1 })).toMatchObject({
			value: '2026-01-06-09:00',
		});
	});

	it('an end at a day’s last working minute is written as the next midnight', () => {
		const g = fx('task e "E" {\n  start 2026-01-05\n  end 2026-01-07\n}\n', [
			['e', { start: at(0, 0), end: at(2, 0) }],
		]);
		expect(intentOf(g, { type: 'resize', task: 'e', end: at(3, 17) })).toMatchObject({
			attr: 'end',
			value: '2026-01-09',
		});
		expect(intentOf(g, { type: 'resize', task: 'e', end: at(3, 12) })).toMatchObject({
			value: '2026-01-08-12:00',
		});
	});
});

describe('resize sizes (18.13)', () => {
	it('an unsized leaf without people gets a length; with two people the effort doubles', () => {
		const g = fx(
			'task u "U" {\n  start 2026-01-05\n}\ntask v "V" {\n  start 2026-01-05\n  allocate r, q\n}\n',
			[
				['u', { start: at(0, 0), end: at(55, 0) }],
				['v', { start: at(0, 0), end: at(55, 0) }],
			],
			{ v: ['q', 'r'] },
		);
		expect(intentOf(g, { type: 'resize', task: 'u', end: at(2, 17) })).toEqual({
			type: 'setAttr',
			task: 'u',
			attr: 'length',
			value: '3d',
		});
		expect(intentOf(g, { type: 'resize', task: 'v', end: at(2, 17) })).toEqual({
			type: 'setAttr',
			task: 'v',
			attr: 'effort',
			value: '6d',
		});
	});

	it('rounds an effort to whole written units, at least 1, and says "about"', () => {
		const g = fx(
			'task a "A" {\n  effort 4h\n  allocate r\n}\n',
			[['a', { start: at(0, 9), end: at(0, 13) }]],
			{ a: ['r'] },
		);
		const p = planAction({ type: 'resize', task: 'a', end: at(0, 10) }, g.ctx());
		expect(p).toMatchObject({
			status: 'intent',
			intent: { value: '1h' },
			label: { approx: true, text: 'Effort of A: 4h to about 1h' },
		});
		expect(intentOf(g, { type: 'resize', task: 'a', end: at(1, 13) })).toMatchObject({
			value: '12h',
		});
	});

	it('the end must stay after the start', () => {
		const g = fx('task a "A" {\n  length 2d\n}\n', [['a', { start: at(0, 9), end: at(1, 17) }]]);
		expect(intentOf(g, { type: 'resize', task: 'a', end: at(0, 9) })).toMatchObject({
			reason: 'at-limit',
		});
	});

	it('a size step on a start-and-end task moves its end by working days', () => {
		const g = fx('task e "E" {\n  start 2026-01-05\n  end 2026-01-07\n}\n', [
			['e', { start: at(0, 0), end: at(2, 0) }],
		]);
		// The end (Wed 00:00) is the end of Tuesday's work; one working day later ends Wednesday.
		expect(intentOf(g, { type: 'size-step', task: 'e', steps: 1 })).toMatchObject({
			attr: 'end',
			value: '2026-01-08',
		});
		expect(intentOf(g, { type: 'size-step', task: 'e', steps: 0 })).toMatchObject({
			reason: 'at-limit',
		});
	});
});

describe('moves', () => {
	const body =
		'task p "P" {\n  length 1d\n}\ntask s "S" {\n  length 1d\n  depends !p { gapduration 2d }\n}\ntask t "T" {\n  length 1d\n  depends !p\n}\n';
	const g = fx(body, [
		['p', { start: at(0, 9), end: at(0, 17) }],
		['s', { start: at(2, 17), end: at(3, 17), depends: [dep('p', { gapDurationMin: 2880 })] }],
		['t', { start: at(1, 9), end: at(1, 17), depends: [dep('p')] }],
	]);

	it('keeps a calendar gap a calendar gap, grown by the calendar days between working days', () => {
		// s starts on Wednesday: one working day later is Thursday, one calendar day (2d to 3d);
		// three working days later is Monday, five calendar days (2d to 7d).
		expect(intentOf(g, { type: 'move', task: 's', days: 1 }, 'gap')).toMatchObject({
			type: 'setDependsGap',
			gap: { kind: 'gapduration', value: '3d' },
		});
		expect(intentOf(g, { type: 'move', task: 's', days: 3 }, 'gap')).toMatchObject({
			gap: { kind: 'gapduration', value: '7d' },
		});
	});

	it('pre-selects gap only for a written driving dependency', () => {
		expect(suggestedMoveKind('t', g.ctx())).toBe('gap');
		expect(suggestedMoveKind('p', g.ctx())).toBe('start');
		expect(planAction({ type: 'move', task: 't', days: 1 }, g.ctx({ move: null }))).toEqual({
			status: 'ask-move-preference',
			suggested: 'gap',
		});
	});

	it('clamps a start at what the dependencies allow', () => {
		expect(earliestStart('t', g.ctx())).toBe(at(0, 17));
		// t starts Tue 09:00, the first working minute after p's end: no earlier start is possible.
		expect(intentOf(g, { type: 'move', task: 't', days: -1 })).toMatchObject({
			reason: 'at-limit',
		});
		expect(intentOf(g, { type: 'move', task: 't', days: 0 })).toMatchObject({ reason: 'at-limit' });
	});

	it('clamps an ALAP end at what its precedes allow', () => {
		const h = fx(
			'task a "A" {\n  length 1d\n  scheduling alap\n  precedes !b\n}\ntask b "B" {\n  start 2026-01-09\n  length 1d\n}\n',
			[
				[
					'a',
					{ start: at(2, 9), end: at(2, 17), alap: true, precedes: [dep('b', { onEnd: false })] },
				],
				['b', { start: at(4, 0), end: at(4, 17) }],
			],
		);
		expect(latestEnd('a', h.ctx())).toBe(at(4, 0));
		// One day later ends Thursday 17:00, before b's start (Friday 00:00).
		expect(intentOf(h, { type: 'move', task: 'a', days: 1 })).toMatchObject({
			attr: 'end',
			value: '2026-01-09',
		});
		// Three days later would pass b's start; it stops at the ceiling, Thursday's end.
		expect(intentOf(h, { type: 'move', task: 'a', days: 3 })).toMatchObject({
			attr: 'end',
			value: '2026-01-09',
		});
	});

	it('needs a schedule', () => {
		const ctx = { ...g.ctx(), result: null, wt: null };
		expect(planAction({ type: 'move', task: 't', days: 1 }, ctx)).toMatchObject({
			reason: 'not-scheduled',
		});
		expect(planAction({ type: 'resize', task: 't', end: 99 }, ctx)).toMatchObject({
			reason: 'not-scheduled',
		});
		expect(planAction({ type: 'move', task: 'nope', days: 1 }, ctx)).toMatchObject({
			reason: 'unknown-target',
		});
		// The structural actions need only the index.
		expect(planAction({ type: 'rename', task: 't', name: 'X' }, ctx)).toMatchObject({
			status: 'intent',
		});
	});
});

describe('checkAction and the refusal sentences', () => {
	it('has one sentence for every reason from either side', () => {
		const gantt: NotPossibleReason[] = [
			'milestone',
			'container',
			'text-only',
			'no-driver',
			'start-and-end',
			'engine-only',
			'not-scheduled',
			'at-limit',
		];
		for (const r of gantt) expect(refusalMessage(r).length).toBeGreaterThan(10);
		for (const r of Object.keys(refusalStrings) as RefusalReason[])
			expect(refusalMessage(r)).toBe(refusalStrings[r]);
	});

	it('maps edits, no-ops and refusals with their intent', () => {
		const g = fx('task a "A" {\n  length 1d\n  complete 50\n}\n', [
			['a', { start: at(0, 9), end: at(0, 17) }],
		]);
		expect(
			checkAction({ type: 'progress', task: 'a', percent: 51 }, g.ctx(), g.snap),
		).toMatchObject({ status: 'noop', reason: 'already-set' });
		expect(checkAction({ type: 'rename', task: 'a', name: 'B\nC' }, g.ctx(), g.snap)).toMatchObject(
			{
				status: 'refused',
				reason: 'unsafe-text',
				intent: { type: 'renameTask' },
				message: refusalStrings['unsafe-text'],
			},
		);
		expect(
			checkAction({ type: 'progress', task: 'a', percent: 100 }, g.ctx(), g.snap),
		).toMatchObject({
			status: 'edit',
			label: { text: 'A is 100% complete' },
		});
		expect(
			checkAction(
				{ type: 'unlink', link: { pred: 'x', succ: 'a', state: 'engine', sites: [] } },
				g.ctx(),
				g.snap,
			),
		).toMatchObject({
			status: 'refused',
			reason: 'engine-only',
			intent: null,
		});
	});

	it('labels name the tasks and people', () => {
		const g = fx(
			'task a "Alpha" {\n  length 1d\n  allocate r\n}\n',
			[['a', { start: at(0, 9), end: at(0, 17) }]],
			{ a: ['r'] },
		);
		const label = (a: GanttAction): string => {
			const p = planAction(a, g.ctx());
			return p.status === 'intent' ? p.label.text : '';
		};
		expect(label({ type: 'replace-person', task: 'a', from: 'r', to: 'q' })).toBe(
			'Q replaces R on Alpha',
		);
		expect(label({ type: 'resize', task: 'a', end: at(1, 17) })).toBe('Length of Alpha: 1d to 2d');
		expect(label({ type: 'add', parent: null, index: 1, name: 'Beta' })).toBe('Added Beta');
	});
});
