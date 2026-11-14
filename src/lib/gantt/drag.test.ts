// SPDX-License-Identifier: GPL-2.0-or-later
// A bar drag as data (drag.ts) on the gantt-manipulation fixture with its golden schedule: what
// the ghost and the label say as the pointer moves, and what the drop dispatches. Dates are the
// fixture's: the project starts Monday 2026-03-02, working days are Monday to Friday 09:00-17:00.
import { describe, expect, it } from 'vitest';
import { dragSnapperFromWorkingDays } from '../gesture/snap';
import { buildOutline } from '../state/outline';
import { advance, beginSession, blockedBy, dropOf, probeFor, type DragEnv } from './drag';
import { manipulation } from './intents-testing';
import { createLayout } from './layout';
import { buildGanttModel } from './model';
import { createScale } from './scale';
import { metricsOf } from './testing';

const fx = manipulation();
const outline = buildOutline(
	fx.index,
	(r) => fx.snap.files.get(r.file)?.text.sliceString(r.from, r.to) ?? null,
);
const model = buildGanttModel({
	nodes: outline.tasks,
	collapsed: new Set(),
	result: fx.result,
	dimmed: false,
	links: fx.links,
	analysis: null,
	locale: 'en-US',
});
const ctx = fx.ctx();
const wt = ctx.wt!;
const env: DragEnv = {
	wt,
	model,
	layout: createLayout(model, createScale(48, model.originMin), metricsOf(false)),
	ctx,
};
const snapper = dragSnapperFromWorkingDays(wt);
const rowOf = (id: string): number => model.rowOf.get(`task:${id}`) as number;
const START = Date.UTC(2026, 2, 2);
const at = (date: string, hour: number): number =>
	(Date.parse(`${date}T00:00:00Z`) - START) / 60_000 + hour * 60;

describe('a resize', () => {
	const row = rowOf('design.research');
	const r = model.rows[row]!;

	it('says what the drop would write, and where the edge falls', () => {
		const s0 = beginSession(env, 'resize-end', row)!;
		const to = at('2026-03-06', 17);
		const edge = wt.snap(r.end!, 'end');
		const time = { ...snapper.resize(edge, to - edge), days: null };
		const s = advance(env, s0, { time, atOrigin: false, x: 0 });
		expect(s.ghost).toMatchObject({ row, start: r.start, end: to, state: 'preview' });
		expect(s.text).toBe('Effort of Research: 3d to about 5d, ends Fri, Mar 6, 2026');
		expect(dropOf(s, env)).toEqual({
			action: { type: 'resize', task: 'design.research', at: to },
			mark: { task: 'design.research', start: r.start, end: to },
		});
	});

	it('has nothing to drop where it began, and says nothing there', () => {
		const s0 = beginSession(env, 'resize-end', row)!;
		const s = advance(env, s0, { time: null, atOrigin: true, x: 0 });
		expect(s.text).toBe('');
		expect(dropOf(s, env)).toBeNull();
	});

	it('keeps the same session for the same snapped day (no new label per pixel)', () => {
		const s0 = beginSession(env, 'resize-end', row)!;
		const edge = wt.snap(r.end!, 'end');
		const time = { ...snapper.resize(edge, 2 * 1440), days: null };
		const a = advance(env, s0, { time, atOrigin: false, x: 1 });
		const b = advance(env, a, { time, atOrigin: false, x: 2 });
		expect(b).toBe(a);
	});

	it('holds an ALAP task at its end and moves its start (docs)', () => {
		const docs = rowOf('design.docs');
		const d = model.rows[docs]!;
		const s0 = beginSession(env, 'resize-end', docs)!;
		expect(s0.alap).toBe(true);
		const edge = wt.snap(d.start!, 'start');
		const to = wt.shiftDays(edge, -2, 'start');
		const s = advance(env, s0, {
			time: { deltaMin: to - edge, snappedMin: to, days: null },
			atOrigin: false,
			x: 0,
		});
		expect(s.ghost).toMatchObject({ start: to, end: d.end });
		expect(dropOf(s, env)?.action).toEqual({ type: 'resize', task: 'design.docs', at: to });
	});
});

describe('a resize past the anchor', () => {
	it('is clamped to one working day, for an ASAP task and for an ALAP one', () => {
		const research = rowOf('design.research');
		const r = model.rows[research]!;
		const s0 = beginSession(env, 'resize-end', research)!;
		const edge = wt.snap(r.end!, 'end');
		const before = r.start! - 5 * 1440;
		const asap = advance(env, s0, {
			time: { deltaMin: before - edge, snappedMin: wt.snap(before, 'end'), days: null },
			atOrigin: false,
			x: 0,
		});
		expect(dropOf(asap, env)?.action).toEqual({
			type: 'resize',
			task: 'design.research',
			at: wt.dayEnd(wt.snap(r.start!, 'start')),
		});
		const docs = rowOf('design.docs');
		const d = model.rows[docs]!;
		const a0 = beginSession(env, 'resize-end', docs)!;
		const after = d.end! + 5 * 1440;
		const alap = advance(env, a0, {
			time: { deltaMin: 0, snappedMin: wt.shiftDays(after, 0, 'start'), days: null },
			atOrigin: false,
			x: 0,
		});
		const drop = dropOf(alap, env)?.action;
		expect(drop).toMatchObject({ type: 'resize', task: 'design.docs' });
		expect((drop as { at: number }).at).toBeLessThan(d.end!);
	});
});

describe('a move', () => {
	it('shifts the bar by working days, keeping its working length', () => {
		const row = rowOf('design.research');
		const r = model.rows[row]!;
		const s = advance(env, beginSession(env, 'move', row)!, {
			time: { deltaMin: 0, snappedMin: 0, days: 5 },
			atOrigin: false,
			x: 0,
		});
		expect(s.days).toBe(5);
		expect(s.ghost.start).toBe(wt.shiftDays(wt.snap(r.start!, 'start'), 5, 'start'));
		expect(wt.workingBetween(s.ghost.start, s.ghost.end)).toBe(wt.workingBetween(r.start!, r.end!));
		expect(s.text).toBe('Later by 5 working days: starts Mon, Mar 9, 2026');
		expect(dropOf(s, env)?.action).toEqual({ type: 'move', task: 'design.research', days: 5 });
	});

	it('cannot go earlier than the dependencies allow, and says it stops there', () => {
		const row = rowOf('design.sketch');
		const s0 = beginSession(env, 'move', row)!;
		expect(s0.floor).not.toBeNull();
		const s = advance(env, s0, {
			time: { deltaMin: 0, snappedMin: 0, days: -30 },
			atOrigin: false,
			x: 0,
		});
		expect(s.days).toBe(0);
		expect(s.text).toBe('Stops here: other tasks hold it');
		expect(dropOf(s, env)).toBeNull();
	});
});

describe('progress', () => {
	it('snaps to 5 % along the bar and drops a complete', () => {
		const row = rowOf('design.research');
		const bar = env.layout.barRect(row)!;
		const s = advance(env, beginSession(env, 'progress', row)!, {
			time: null,
			atOrigin: false,
			x: bar.x + bar.w * 0.77,
		});
		expect(s.percent).toBe(75);
		expect(s.ghost.complete).toBe(75);
		expect(s.text).toBe('75% complete');
		expect(dropOf(s, env)).toEqual({
			action: { type: 'progress', task: 'design.research', percent: 75 },
			mark: { task: 'design.research', start: null, end: null, complete: 75 },
		});
	});

	it('is no change at the share the task has (research is 40 %)', () => {
		const row = rowOf('design.research');
		const bar = env.layout.barRect(row)!;
		const s = advance(env, beginSession(env, 'progress', row)!, {
			time: null,
			atOrigin: false,
			x: bar.x + bar.w * 0.4,
		});
		expect(dropOf(s, env)).toBeNull();
	});
});

describe('the dry run at the start', () => {
	it('probes the likely action of each kind', () => {
		const research = rowOf('design.research');
		expect(probeFor(beginSession(env, 'move', research)!, env)).toEqual({
			type: 'move',
			task: 'design.research',
			days: 1,
		});
		expect(probeFor(beginSession(env, 'resize-end', research)!, env)).toEqual({
			type: 'size-step',
			task: 'design.research',
			steps: 1,
		});
		expect(probeFor(beginSession(env, 'progress', research)!, env)).toEqual({
			type: 'progress',
			task: 'design.research',
			percent: 45,
		});
	});

	it('marks the ghost and says why when the drop would be refused', () => {
		const s = beginSession(env, 'move', rowOf('design.research'))!;
		const b = blockedBy(s, 'This task gets its dates from the tasks inside it.');
		expect(b.ghost.blocked).toBe(true);
		expect(b.text).toBe('Not possible: This task gets its dates from the tasks inside it.');
		expect(blockedBy(b, null).ghost.blocked).toBe(false);
	});

	it('has no session for a task with no dates', () => {
		expect(beginSession({ ...env, model: { ...model, rows: [] } }, 'move', 0)).toBeNull();
	});
});
