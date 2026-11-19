// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's way into the dispatcher (run.ts): a stroke planned and sent, a refusal of the
// planner shown with its place, a text-only leave in the day's own words, and the confirmation for
// a declaration read in several places.
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOptions, DispatchOutcome, PlanBase } from '../state/edits.svelte';
import type { EditIntent } from '../tjp/edit/types';
import { plan as resultOf } from '../schedule/testing';
import { planFrom, workloadPlan } from '../workload/rebalance-testing';
import { resourceResult, withPeople } from '../workload/testing';
import { ctxOf, day, onePerson, paint, person } from './paint-testing';
import { world } from '../state/rebase-testing';
import { refusalStrings } from '../strings';
import { planLeavePaint } from './paint';
import type { LeaveFields } from './leave-edit';
import {
	paintPlan,
	runIntent,
	runLeaveEdit,
	runLeaveRemove,
	runStroke,
	type LeaveEdits,
} from './run';

const applied = { status: 'applied' } as unknown as DispatchOutcome;

/**
 * A dispatcher that records what is sent. `dispatchPlan` runs the planner on `on` (the text as the
 * dispatcher would read it) and answers as the dispatcher does: an intent is sent, `not-possible`
 * is a refusal with reason `planner` and the planner's sentence.
 */
function edits(
	outcomes: DispatchOutcome[] = [applied],
	on?: PlanBase,
): LeaveEdits & { sent: Array<{ intent: EditIntent; o: Partial<DispatchOptions> }> } {
	const sent: Array<{ intent: EditIntent; o: Partial<DispatchOptions> }> = [];
	let n = 0;
	const next = (): DispatchOutcome =>
		outcomes[Math.min(n++, outcomes.length - 1)] as DispatchOutcome;
	return {
		sent,
		dispatch: async (intent, o) => {
			sent.push({ intent, o });
			return next();
		},
		dispatchPlan: async (plan, o = {}) => {
			if (!on) throw new Error('no base');
			const planned = plan(on);
			if (planned.status === 'intent') {
				sent.push({ intent: planned.intent, o: { ...o, label: planned.label } });
				return next();
			}
			if (planned.status === 'not-possible') {
				return {
					status: 'refused',
					reason: 'planner',
					at: planned.at,
					message: planned.message,
				};
			}
			return { status: 'noop', reason: 'already-set', message: planned.message ?? '' };
		},
	};
}

/** The text of a workload plan as a world, and its base at the text now. */
function baseOf(p: ReturnType<typeof workloadPlan>): PlanBase {
	const files: Record<string, string> = {};
	for (const [path, f] of p.snap.files) files[path] = f.text.toString();
	const w = world({ entry: p.snap.entry, files });
	return w.base(w.version());
}

describe('runStroke', () => {
	const p = workloadPlan('leave-types');
	const { result, zones } = ctxOf(p);

	it('plans a paint on the text now and sends its intent with its label', async () => {
		const e = edits([applied], baseOf(p));
		const r = await runStroke(
			e,
			paint(person('p1'), day(14), day(16), 'sick'),
			result,
			zones,
			() => true,
		);
		expect(r.status).toBe('sent');
		expect(e.sent).toHaveLength(1);
		expect(e.sent[0]?.intent).toMatchObject({ type: 'addLeave', leave: { type: 'sick' } });
		expect(e.sent[0]?.o.label?.text).toMatch(/^Sick leave for P1: /);
	});

	it('returns the planner’s refusal sentence for the note, and sends nothing', async () => {
		const e = edits([applied], baseOf(p));
		// P2 already has annual leave on the 8th and 9th: a paint of annual there is covered.
		const r = await runStroke(
			e,
			paint(person('p2'), day(3), day(5), 'annual'),
			result,
			zones,
			() => true,
		);
		expect(r.status).toBe('refused');
		expect(r.status === 'refused' && r.message).toMatch(/already covers those days/);
		expect(e.sent).toEqual([]);
	});

	it('says an erase of a macro or shift leave in the day’s own words', async () => {
		// `annual ${when}` is written with a macro: the engine has the leave, no text item names it.
		const base = onePerson('leaves annual ${when}', 'macro when [2026-01-08 - 2026-01-10]\n');
		const res = withPeople(
			resultOf([['t', { start: 540, end: 2460 }]]),
			[
				resourceResult('dev', {
					leaves: [{ type: 'annual', intervals: [[3 * 1440 + 540, 3 * 1440 + 1020]] }],
				}),
			],
			[],
		);
		const q = planFrom({ 'plan.tjp': base.text('plan.tjp') }, 'plan.tjp', res);
		const e = edits([applied], baseOf(q));
		const r = await runStroke(
			e,
			{ type: 'erase', scope: person('dev'), from: day(3), to: day(4) },
			res,
			zones,
			() => true,
		);
		expect(r).toEqual({ status: 'refused', message: 'From a shift or macro. Edit as text.' });
		expect(e.sent).toEqual([]);
	});

	it('sends an erase of a person’s own text leave', async () => {
		const e = edits([applied], baseOf(p));
		const r = await runStroke(
			e,
			{ type: 'erase', scope: person('p2'), from: day(3), to: day(4) },
			result,
			zones,
			() => true,
		);
		expect(r.status).toBe('sent');
		expect(e.sent[0]?.intent).toMatchObject({
			type: 'clearLeave',
			scope: { kind: 'resource', resource: 'p2' },
		});
	});

	it('asks for a shared declaration, then sends the same stroke again on the same text', async () => {
		const shared = { status: 'confirm-shared', affects: ['a.tji'], basedOn: 7 } as DispatchOutcome;
		const e = edits([shared, applied], baseOf(p));
		const r = await runStroke(
			e,
			paint(person('p1'), day(14), day(16), 'sick'),
			result,
			zones,
			() => true,
		);
		expect(r.status).toBe('sent');
		expect(e.sent.map((s) => [s.o.confirmShared, s.o.basedOn])).toEqual([
			[false, undefined],
			[true, 7],
		]);
	});

	it('is unavailable without a dispatcher or a result', async () => {
		const gone = { status: 'unavailable', message: '' };
		expect(
			await runStroke(null, paint(person('p1'), 0, 1440, 'sick'), result, zones, () => true),
		).toEqual(gone);
		expect(
			await runStroke(edits(), paint(person('p1'), 0, 1440, 'sick'), null, zones, () => true),
		).toEqual(gone);
	});
});

describe('runIntent', () => {
	const intent: EditIntent = {
		type: 'removeLeave',
		leave: { item: { file: 'a.tji', from: 1, to: 2 }, basedOn: 1 },
	};
	const label = { text: 'x', approx: false };
	const shared = {
		status: 'confirm-shared',
		affects: ['a.tjp', 'b.tjp'],
		basedOn: 1,
	} as DispatchOutcome;

	it('asks once for a shared declaration, then sends it again confirmed', async () => {
		const e = edits([shared, applied]);
		const confirm = vi.fn((_m: string) => true);
		const o = await runIntent(e, intent, label, confirm);
		expect(o.status).toBe('applied');
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]).toContain('a.tjp, b.tjp');
		expect(e.sent.map((s) => s.o.confirmShared)).toEqual([false, true]);
	});

	it('passes the view’s basedOn, and the first outcome’s when it asks again (ADR-0018)', async () => {
		const e = edits([shared, applied]);
		await runIntent(e, intent, label, () => true, 5);
		expect(e.sent.map((s) => s.o.basedOn)).toEqual([5, 1]);
		const plain = edits();
		await runIntent(plain, intent, label, () => true);
		expect(plain.sent[0]?.o).not.toHaveProperty('basedOn');
	});

	it('is cancelled when the user declines', async () => {
		const e = edits([shared, applied]);
		const o = await runIntent(e, intent, label, () => false);
		expect(o).toEqual({ status: 'cancelled' });
		expect(e.sent).toHaveLength(1);
	});

	it('gives the dispatcher’s own refusal back as it is', async () => {
		const refused = {
			status: 'refused',
			reason: 'text-only',
			at: [],
			message: 'm',
		} as DispatchOutcome;
		const o = await runIntent(edits([refused]), intent, label, () => true);
		expect(o).toBe(refused);
	});
});

describe('paintPlan (ADR-0018 decision 3)', () => {
	const p = workloadPlan('leave-types');
	const files = (): Record<string, string> => {
		const out: Record<string, string> = {};
		for (const [path, f] of p.snap.files) out[path] = f.text.toString();
		return out;
	};
	const { result, zones } = ctxOf(p);

	it('plans the stroke on the text now, as planLeavePaint does there', () => {
		const w = world({ entry: p.snap.entry, files: files() });
		const v0 = w.version();
		w.type(0, 0, '# note\n');
		const on = w.base(v0);
		const stroke = paint(person('p2'), day(5), day(7), 'annual', 'Holiday');
		const planned = paintPlan(stroke, result, zones)(on);
		const direct = planLeavePaint(stroke, { index: on.index, result, zones });
		if (direct.status !== 'intent') throw new Error(direct.status);
		expect(planned).toEqual({ status: 'intent', intent: direct.intent, label: direct.label });
		// A merge rewrites the item as the text has it now.
		expect(planned).toMatchObject({
			intent: { type: 'updateLeave', leave: { basedOn: w.version() } },
		});
	});

	it('keeps the planner’s sentences for its refusals', () => {
		const w = world({ entry: p.snap.entry, files: files() });
		const on = w.base(w.version());
		expect(
			paintPlan(paint(person('p2'), day(3), day(5), 'annual'), result, zones)(on),
		).toMatchObject({
			status: 'not-possible',
			message: expect.stringMatching(/already covers those days/),
		});
	});

	it('refuses a person whose id now names another declaration', () => {
		const w = world({ entry: p.snap.entry, files: files() });
		const v0 = w.version();
		const text = w.text();
		const p1 = text.indexOf('resource p1 ') + 'resource '.length;
		w.type(p1, p1 + 2, 'px');
		const p2 = w.text().indexOf('resource p2 ') + 'resource '.length;
		w.type(p2, p2 + 2, 'p1');
		expect(
			paintPlan(paint(person('p1'), day(14), day(16), 'sick'), result, zones)(w.base(v0)),
		).toEqual({
			status: 'not-possible',
			message: refusalStrings['target-changed'],
			at: [],
		});
	});
});

describe('runLeaveEdit and runLeaveRemove (ADR-0018 decision 5)', () => {
	const ref = { item: { file: 'a.tji', from: 10, to: 40 }, basedOn: 3 };
	const f: LeaveFields = { type: 'sick', name: '', start: '2026-01-08', end: '2026-01-09' };
	const ctx = { project: { start: '2026-01-05T00:00:00Z' } } as never;

	it('says why the fields cannot be written without sending anything', async () => {
		const e = edits();
		const dispatchPlan = vi.spyOn(e, 'dispatchPlan');
		expect(await runLeaveEdit(e, ref, { ...f, end: '2026-01-01' }, ctx, () => true)).toEqual({
			error: 'dates',
		});
		expect(dispatchPlan).not.toHaveBeenCalled();
	});

	it('answers an applied edit with the item as the edit wrote it, at the outcome’s version', async () => {
		const select = { file: 'a.tji', from: 10, to: 44 };
		const done = { status: 'applied', version: 9, edit: { select } } as unknown as DispatchOutcome;
		const e = { ...edits(), dispatchPlan: vi.fn(async () => done) };
		expect(await runLeaveEdit(e, ref, f, ctx, () => true)).toEqual({
			applied: true,
			ref: { item: select, basedOn: 9 },
		});
	});

	it('answers {} when nothing was applied, and when there is no dispatcher or context', async () => {
		const refused = { status: 'refused', reason: 'planner', at: [], message: 'm' };
		const e = { ...edits(), dispatchPlan: vi.fn(async () => refused as DispatchOutcome) };
		expect(await runLeaveEdit(e, ref, f, ctx, () => true)).toEqual({ refused: true });
		expect(await runLeaveEdit(null, ref, f, ctx, () => true)).toEqual({});
		expect(await runLeaveEdit(edits(), ref, f, null, () => true)).toEqual({});
	});

	it('sends a Remove as a planner, and nothing without a dispatcher', async () => {
		const e = { ...edits(), dispatchPlan: vi.fn(async () => applied) };
		await runLeaveRemove(e, ref, ctx, () => true);
		expect(e.dispatchPlan).toHaveBeenCalledTimes(1);
		await expect(runLeaveRemove(null, ref, ctx, () => true)).resolves.toBeUndefined();
	});
});
