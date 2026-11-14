// SPDX-License-Identifier: GPL-2.0-or-later
// Gantt actions through the dispatcher (phase-2.md 6.6, 6.8, 7.1; ADR-0008 #2) on the
// gantt-manipulation fixture with its golden result: the move question, the one-time constraint
// warning, the Gantt's own refusals as toasts, and a coalesced stepper making one undo step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleResult } from '../../engine/protocol';
import { FIXTURE, goldenResult, manipulation } from '../gantt/intents-testing';
import { MOVE_KEY, MOVE_WARNED_KEY } from '../gantt/prefs';
import { ganttActionStrings, toastStrings } from '../strings';
import { harness, type Harness } from './edits-testing';
import type { ActionSource } from './edits.svelte';

let h: Harness;
let golden: ScheduleResult;
let source: ActionSource;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const fx = manipulation();
	const files: Record<string, string> = {};
	for (const [p, f] of fx.snap.files) files[p] = f.text.toString();
	h = harness({ entry: fx.snap.entry, files });
	golden = goldenResult(FIXTURE);
	const { revision: _r, ...rest } = golden;
	await h.finish(rest);
	source = { result: golden, analysis: fx.ctx().analysis };
});

afterEach(() => {
	h.dispose();
	vi.useRealTimers();
});

describe('moves', () => {
	it('asks for the move preference once, then moves with it and warns once', async () => {
		const move = { type: 'move', task: 'spike', days: 1 } as const;
		const ask = await h.edits.dispatchAction(move, source);
		expect(ask).toEqual({ status: 'ask-move-preference', suggested: 'start' });
		expect(h.edits.toasts).toEqual([]);
		h.edits.setMovePreference('start');
		expect(h.storage.map.get(MOVE_KEY)).toBe('start');
		expect(h.edits.movePreference).toBe('start');
		// design.research has no start of its own: the move adds one, a constraint.
		const o = await h.edits.dispatchAction({ ...move, task: 'design.research' }, source);
		expect(o.status).toBe('applied');
		expect(h.text()).toMatch(/task research "Research" \{\n {4}start 2026-03-0\d/);
		expect(h.edits.toasts.at(-1)?.warning).toBe(toastStrings.constraint.start);
		expect(h.storage.map.get(MOVE_WARNED_KEY)).toBe('1');
		await h.finish();
		const again = await h.edits.dispatchAction({ ...move, task: 'design.sketch' }, source);
		expect(again.status).toBe('applied');
		expect(h.edits.toasts.at(-1)?.warning).toBeNull();
	});

	it('forgets the preference so that the next move asks again', async () => {
		h.edits.setMovePreference('gap');
		h.edits.setMovePreference(null);
		expect(h.edits.movePreference).toBeNull();
		const ask = await h.edits.dispatchAction({ type: 'move', task: 'spike', days: 1 }, source);
		expect(ask.status).toBe('ask-move-preference');
	});
});

describe("the Gantt's own refusals", () => {
	it('toasts why an action is not possible, with Show in text', async () => {
		const o = await h.edits.dispatchAction({ type: 'resize', task: 'design.gate', at: 0 }, source);
		expect(o).toMatchObject({ status: 'refused', reason: 'milestone' });
		expect(h.edits.toasts[0]).toMatchObject({
			status: 'refused',
			text: ganttActionStrings.notPossible.milestone,
		});
	});

	it('refuses a move without a schedule', async () => {
		h.edits.setMovePreference('start');
		const o = await h.edits.dispatchAction(
			{ type: 'move', task: 'design.research', days: 1 },
			{ result: null, analysis: null },
		);
		expect(o).toMatchObject({ status: 'refused', reason: 'not-scheduled' });
	});
});

describe('steppers', () => {
	it('coalesces cumulative size steps into one patch and one undo step', async () => {
		const before = h.text();
		const step = (steps: number) =>
			h.edits.dispatchAction({ type: 'size-step', task: 'design.research', steps }, source, {
				coalesceKey: 'size:design.research',
			});
		const a = step(1);
		const b = step(2);
		const c = step(3);
		await vi.advanceTimersByTimeAsync(300);
		expect(await a).toEqual({ status: 'cancelled' });
		expect(await b).toEqual({ status: 'cancelled' });
		const o = await c;
		expect(o.status).toBe('applied');
		expect(h.text()).toBe(before.replace('effort 3d', 'effort 6d'));
		expect(h.history.top()?.label).toBe('Effort of Research: 3d to 6d');
		h.history.undo();
		expect(h.text()).toBe(before);
	});
});

describe('check, the gestures’ dry run', () => {
	it('answers what a drop would do and applies nothing', () => {
		const before = h.text();
		const size = h.edits.check({ type: 'size-step', task: 'design.research', steps: 1 }, source);
		expect(size).toMatchObject({ status: 'edit', label: { text: 'Effort of Research: 3d to 4d' } });
		expect(h.text()).toBe(before);
		expect(h.edits.toasts).toEqual([]);
		expect(h.history.top()).toBeNull();
	});

	it('says why not, with the reason, for a cycle and a milestone', () => {
		const link = h.edits.check({ type: 'link', pred: 'design.gate', succ: 'design.gate' }, source);
		expect(link).toMatchObject({ status: 'refused', reason: 'cycle' });
		const ms = h.edits.check({ type: 'size-step', task: 'design.gate', steps: 1 }, source);
		expect(ms).toMatchObject({ status: 'refused', reason: 'milestone' });
	});
});
