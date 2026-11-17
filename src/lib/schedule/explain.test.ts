// SPDX-License-Identifier: GPL-2.0-or-later
// "Why is this here?" (explain.ts, phase-3.md 6.3, 13.1) on hand-computed fixtures. The golden
// cases are real engine results; every expected window and minute below is worked out from the
// plan text and the recorded bookings (comments give the dates; day 0 is Monday 2026-01-05 in the
// synthetic and workload plans, Mon-Fri 09:00-17:00 unless the plan says otherwise).
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { booking, resourceResult, withPeople } from '../workload/testing';
import { explainTask } from './explain-task';
import { goldenContext, inlineContext } from './explain-testing';
import type { Cause, ExplainContext } from './explain-types';
import { at, dep, plan } from './testing';

/** The resource whose declaration holds a `limit` cause's statement, and the statement's keyword. */
const limitOf = (c: Cause | undefined, ctx: ExplainContext): [string | null, string] => {
	if (c?.kind !== 'limit') return [null, ''];
	const { file, from, to } = c.site;
	for (const [id, r] of ctx.index.resources) {
		const b = r.decl.block;
		if (b.file === file && b.from <= from && to <= b.to) {
			const attr = r.attrs.find((a) => a.statement.from === from);
			return [id, attr?.keyword ?? ''];
		}
	}
	return [null, ''];
};
const offNull = (a: number, b: number): Cause => ({
	kind: 'off-hours',
	resource: null,
	window: [a, b],
});

describe('the bound and what gives it (rule 1)', () => {
	const held = goldenContext('workload-held-effort');

	it('frame: a milestone at the project start', () => {
		expect(explainTask('kick', held)).toEqual({
			task: 'kick',
			anchor: 'start',
			bound: 0,
			at: 0,
			causes: [{ kind: 'frame' }],
			inside: [],
		});
	});

	it('dependency: on its bound, then the night before the first working hour', () => {
		// build depends on kick (00:00) and starts at the first slot, Mon 09:00.
		expect(explainTask('build', held).causes).toEqual([
			{ kind: 'dependency', pred: 'kick', via: 'depends', gap: false },
			offNull(0, 540),
		]);
	});

	it('dependency with gaps (syn-08): gapduration, gaplength, and the ALAP `precedes` mirror', () => {
		const ctx = goldenContext('syn-08-deps-gaps-alap');
		// design ends Fri 9 Jan 17:00 (6780); 7 calendar days later is Fri 16 Jan 17:00 (16860).
		const build = explainTask('line.build', ctx);
		expect(build.bound).toBe(16860);
		expect(build.causes).toEqual([
			{ kind: 'dependency', pred: 'line.design', via: 'depends', gap: true },
			offNull(16860, 20700),
		]);
		// beta (ALAP) must end 1 working day before gamma starts (Mon 13 Apr 09:00): Fri 10 Apr 09:00.
		const beta = explainTask('alap.beta', ctx);
		expect(beta).toMatchObject({ anchor: 'end', bound: 137340, at: 136380 });
		expect(beta.causes).toEqual([
			offNull(136380, 137340),
			{ kind: 'dependency', pred: 'alap.gamma', via: 'precedes', gap: true },
		]);
		// gamma inherits the container's `end 2026-04-15` (day 100).
		expect(explainTask('alap.gamma', ctx).causes).toEqual([
			offNull(143580, 144000),
			{ kind: 'constraint', attr: 'end', inherited: true },
		]);
	});

	it('constraint: a `start` written on the task, and one inherited from a container', () => {
		const alt = goldenContext('workload-alternatives');
		expect(explainTask('work.lead', alt).causes).toEqual([
			{ kind: 'constraint', attr: 'start', inherited: false },
			offNull(0, 540),
		]);
		// Fedora's root writes `start ${start_work}` (a macro): read from the root's own start,
		// 2013-05-01 00:00 New York (EDT), 28 h after the frame's 2013-04-30 00:00 UTC.
		const fedora = goldenContext('fedora-res');
		expect(explainTask('f20', fedora)).toMatchObject({
			bound: 1680,
			at: 1680,
			causes: [{ kind: 'constraint', attr: 'start', inherited: false }],
		});
		expect(explainTask('f20.PlanningPhase.start_features_cal', fedora)).toMatchObject({
			bound: 1680,
			at: 1680,
			causes: [{ kind: 'constraint', attr: 'start', inherited: true }],
		});
		// file_ticket writes its own `start 2013-05-15`, read from the text.
		expect(explainTask('f20.PlanningPhase.file_ticket', fedora)).toMatchObject({
			bound: 21840,
			at: 21840,
			causes: [{ kind: 'constraint', attr: 'start', inherited: false }],
		});
	});
});

describe('the wait (rule 2)', () => {
	it('busy: priority contention on one person (syn-17)', () => {
		const ctx = goldenContext('syn-17-priority-efficiency');
		// normal waits for fox, booked on urgent (Mon 5 to Fri 16 Jan) and slow (Mon 19 Jan to Tue 3
		// Feb, after urgent): one stretch over the weekend between, 10 + 12 days of 8 h.
		expect(explainTask('contend.normal', ctx)).toMatchObject({ bound: 0, at: 43740 });
		expect(explainTask('contend.normal', ctx).causes).toEqual([
			{ kind: 'frame' },
			offNull(0, 540),
			{
				kind: 'busy',
				resource: 'fox',
				window: [540, 42780],
				on: [
					{ task: 'contend.urgent', minutes: 4800 },
					{ task: 'contend.slow', minutes: 5760 },
				],
			},
			offNull(42780, 43740),
		]);
		// Efficiency: gil (1.5) is on double until Thu 11:00, 3 days and 2 h of booked time.
		expect(explainTask('contend.fast', ctx).causes).toEqual([
			{ kind: 'frame' },
			offNull(0, 540),
			{
				kind: 'busy',
				resource: 'gil',
				window: [540, 4980],
				on: [{ task: 'contend.double', minutes: 1560 }],
			},
		]);
	});

	it('busy, then a part-timer’s own off hours, then the weekend (part-time-hours)', () => {
		const ctx = goldenContext('workload-part-time-hours');
		// p2 may start Mon 12 Jan; part works 9-13 and is on p1 until Fri 16 Jan 13:00.
		expect(explainTask('part_work.p2', ctx).causes).toEqual([
			{ kind: 'constraint', attr: 'start', inherited: false },
			offNull(10080, 10620),
			{
				kind: 'busy',
				resource: 'part',
				window: [10620, 16620],
				on: [{ task: 'part_work.p1', minutes: 1200 }],
			},
			{ kind: 'off-hours', resource: 'part', window: [16620, 16860] },
			offNull(16860, 20700),
		]);
	});

	it('a global holiday for everyone is the project calendar (syn-13 late)', () => {
		const ctx = goldenContext('syn-13-calendars-leaves');
		// late: `start 2026-02-09` (Founders day, a global holiday) for yui and zed; starts Tue.
		expect(explainTask('calendar.late', ctx).causes).toEqual([
			{ kind: 'constraint', attr: 'start', inherited: false },
			offNull(50400, 50940),
			{ kind: 'leave', resource: null, type: 'holiday', window: [50940, 51420] },
			offNull(51420, 52380),
		]);
	});

	it('not held when another candidate is free (alternatives, group allocation)', () => {
		const alt = goldenContext('workload-alternatives');
		expect(explainTask('work.fix', alt).causes).toEqual([
			{ kind: 'constraint', attr: 'start', inherited: false },
			offNull(0, 540),
		]);
		const group = goldenContext('workload-group-allocation');
		expect(explainTask('work.triage', group).causes).toEqual([
			{ kind: 'constraint', attr: 'start', inherited: false },
			offNull(0, 540),
		]);
	});

	it('a container off its bound: the project night, or unknown', () => {
		expect(explainTask('work', goldenContext('workload-alternatives')).causes).toEqual([
			{ kind: 'frame' },
			offNull(0, 540),
		]);
		const fedora = goldenContext('fedora-res');
		expect(explainTask('f20.LaunchPhase', fedora).causes).toEqual([
			{ kind: 'constraint', attr: 'start', inherited: true },
			{ kind: 'unknown' },
		]);
	});
});

describe('inside the bar (rule 4)', () => {
	it('leave: personal and global, without the nights and weekends (syn-13)', () => {
		const ctx = goldenContext('syn-13-calendars-leaves');
		// mid: xan's annual leave Mon 19 to Thu 22 Jan; build: sick Wed 4 Feb, Founders day Mon 9 Feb.
		expect(explainTask('calendar.mid', ctx).inside).toEqual([
			{ kind: 'leave', resource: 'xan', type: 'annual', window: [20700, 25500] },
		]);
		expect(explainTask('calendar.build', ctx).inside).toEqual([
			{ kind: 'leave', resource: 'xan', type: 'sick', window: [43740, 44220] },
			{ kind: 'leave', resource: null, type: 'holiday', window: [50940, 51420] },
		]);
		expect(explainTask('calendar.closeout', ctx).inside).toEqual([
			{ kind: 'leave', resource: 'yui', type: 'special', window: [81180, 83100] },
		]);
		// kick ran with xan and yui while zed was unemployed: no gap in the bar.
		expect(explainTask('calendar.kick', ctx).inside).toEqual([]);
	});

	it('overlapping global leaves read as the later leave (overlapping-global-leaves)', () => {
		const ctx = goldenContext('workload-overlapping-global-leaves');
		// Easter Fri 3 Apr (engine leave), the overlap Mon 6 Apr (off on the scoreboard) and the
		// special leave Tue 7 Apr: Mon 6 reads as special, the later leave.
		expect(explainTask('run', ctx).inside).toEqual([
			{ kind: 'leave', resource: null, type: 'holiday', window: [6300, 6780] },
			{ kind: 'leave', resource: null, type: 'special', window: [10080, 12540] },
		]);
	});

	it('limits "may" hold it, once, at the statement (syn-03)', () => {
		const ctx = goldenContext('syn-03-limits-resource-max');
		const alpha = explainTask('deliver.alpha', ctx).inside;
		const delta = explainTask('deliver.delta', ctx).inside;
		expect(alpha.map((c) => c.kind)).toEqual(['limit']);
		expect(delta.map((c) => c.kind)).toEqual(['limit']);
		// eve's (dailymax 4h, weeklymax 14h) and fay's (dailymax 6h) own `limits` statements.
		expect(limitOf(alpha[0], ctx)).toEqual(['eve', 'limits']);
		expect(limitOf(delta[0], ctx)).toEqual(['fay', 'limits']);
		// gamma runs on gus every working day: no gap.
		expect(explainTask('deliver.gamma', ctx).inside).toEqual([]);
	});

	it('a part-timer’s afternoons, and user bookings the schedule does not explain', () => {
		const part = goldenContext('workload-part-time-hours');
		const p1 = explainTask('part_work.p1', part).inside;
		expect(p1[0]).toEqual({ kind: 'off-hours', resource: 'part', window: [780, 1020] });
		expect(p1.every((c) => c.kind === 'off-hours' && c.resource === 'part')).toBe(true);
		expect(p1.length).toBe(9);
		// contend.booked's user bookings leave hana's lunch hours free: unknown, once.
		const syn17 = goldenContext('syn-17-priority-efficiency');
		expect(explainTask('contend.booked', syn17).inside).toEqual([{ kind: 'unknown' }]);
	});

	it('only effort leaves have an inside', () => {
		const ctx = goldenContext('workload-unmet-length');
		expect(explainTask('watch', ctx)).toMatchObject({
			bound: 0,
			at: 0,
			causes: [{ kind: 'dependency', pred: 'kick', via: 'depends', gap: false }],
			inside: [],
		});
	});
});

const TEXT = `project p "P" 2026-01-05 - 2026-03-02
macro d [2026-01-07]
resource dev "Dev"
task p "P" {
  milestone
}
task q "Q" {
  milestone
}
task a "A" {
  effort 1d
  allocate dev
}
task e "E" {
  start \${d}
  effort 1d
  allocate dev
}
task l "L" {
  start \${d}
  length 1d
}
task t "T" {
  effort 1d
  allocate dev
  limits { dailymax 2h }
}
task n "N" {
  length 2d
}
task z "Z" {
  scheduling alap
  effort 1d
  allocate dev
  precedes q
}
`;

describe('hand-made results', () => {
	// The tasks that allocate dev in the text ask for dev in the result too (v3 `allocate`).
	const ASKS = new Set(['a', 'e', 't', 'z']);
	const r = (over: Record<string, Parameters<typeof plan>[0][number][1]>): ScheduleResult =>
		withPeople(
			plan(
				['p', 'q', 'a', 'e', 'l', 't', 'n', 'z'].map((id) => {
					const spec = over[id] ?? { start: null, end: null };
					const allocate = ASKS.has(id) ? [{ candidates: ['dev'] }] : [];
					return [id, { ...spec, scenarios: { plan: { allocate } } }];
				}),
			),
			[resourceResult('dev')],
			[booking('dev', 'a', [[at(3, 9), at(3, 17)]])],
		);

	it('an unreadable start on an effort leaf is unknown; on a length leaf, the anchor', () => {
		const ctx = inlineContext(
			r({ e: { start: at(2, 9), end: at(2, 17) }, l: { start: at(2, 0), end: at(2, 17) } }),
			TEXT,
		);
		expect(explainTask('e', ctx)).toMatchObject({
			bound: null,
			causes: [{ kind: 'constraint', attr: 'start', inherited: false }, { kind: 'unknown' }],
		});
		expect(explainTask('l', ctx)).toMatchObject({
			bound: at(2, 0),
			causes: [{ kind: 'constraint', attr: 'start', inherited: false }],
		});
	});

	it('within a slot below the bound is on it; a slot or more is unknown', () => {
		const tasks = (start: number) =>
			r({
				p: { start: at(0, 10), end: at(0, 10), milestone: true },
				t: { start, end: start + 60, depends: [dep('p', { gapDurationMin: 30 })] },
			});
		const on = explainTask('t', inlineContext(tasks(at(0, 10)), TEXT));
		expect(on).toMatchObject({ bound: at(0, 10) + 30, at: at(0, 10) });
		expect(on.causes).toEqual([{ kind: 'dependency', pred: 'p', via: 'depends', gap: true }]);
		expect(explainTask('t', inlineContext(tasks(at(0, 9)), TEXT)).causes).toEqual([
			{ kind: 'unknown' },
		]);
	});

	it('a free person and a `limits` statement on the task: "may hold it"', () => {
		const ctx = inlineContext(r({ t: { start: at(1, 9), end: at(1, 11) } }), TEXT);
		const causes = explainTask('t', ctx).causes;
		expect(causes.map((c) => c.kind)).toEqual(['frame', 'limit']);
	});

	it('a task without people: off hours when the project does not work, else unknown', () => {
		const night = inlineContext(
			r({
				p: { start: at(0, 17), end: at(0, 17) },
				n: { start: at(1, 9), end: at(2, 17), depends: [dep('p')] },
			}),
			TEXT,
		);
		expect(explainTask('n', night).causes).toEqual([
			{ kind: 'dependency', pred: 'p', via: 'depends', gap: false },
			offNull(at(0, 17), at(1, 9)),
		]);
		const day = inlineContext(r({ n: { start: at(1, 9), end: at(2, 17) } }), TEXT);
		expect(explainTask('n', day).causes).toEqual([{ kind: 'frame' }, { kind: 'unknown' }]);
	});

	it('ALAP: the wait after the end, then what bounds it', () => {
		// z must end before q (Fri 09:00); dev is on a all Thursday, so z ends Wed 17:00.
		const ctx = inlineContext(
			r({
				q: { start: at(4, 9), end: at(4, 9), milestone: true },
				z: { start: at(2, 9), end: at(2, 17), alap: true, precedes: [dep('q', { onEnd: false })] },
			}),
			TEXT,
		);
		expect(explainTask('z', ctx)).toMatchObject({ anchor: 'end', bound: at(4, 9), at: at(2, 17) });
		expect(explainTask('z', ctx).causes).toEqual([
			offNull(at(2, 17), at(3, 9)),
			{
				kind: 'busy',
				resource: 'dev',
				window: [at(3, 9), at(3, 17)],
				on: [{ task: 'a', minutes: 480 }],
			},
			offNull(at(3, 17), at(4, 9)),
			{ kind: 'dependency', pred: 'q', via: 'precedes', gap: false },
		]);
	});

	it('an unscheduled task has nothing to explain', () => {
		const ctx = inlineContext(r({}), TEXT);
		expect(explainTask('t', ctx)).toEqual({
			task: 't',
			anchor: 'start',
			bound: null,
			at: null,
			causes: [],
			inside: [],
		});
		expect(explainTask('nope', ctx).at).toBeNull();
	});
});
