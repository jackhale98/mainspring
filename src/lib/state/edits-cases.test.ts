// SPDX-License-Identifier: GPL-2.0-or-later
// The T13 review's probes as tests (edit dispatcher, phase-2.md 6.8, 11.2): needs-schedule (M1),
// an edit made while the engine is down, an ok result with a new error (L3), undo then redo while
// pending (L5), undoing a "not scheduled" edit, closing the plan at the Android gate, pending
// toasts past the cap (L4), and two edits of one task.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineFailureStrings, refusalStrings, toastStrings } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import { message } from '../workspace/testing/fake-engine-client';
import { harness, type Harness } from './edits-testing';
import type { DispatchOutcome } from './edits.svelte';
import { MAX_TOASTS } from './toasts.svelte';

const effort = (task: string, value: string): EditIntent => ({
	type: 'setAttr',
	task,
	attr: 'effort',
	value,
});
const label = (text: string) => ({ label: { text, approx: false } });
const mark = { task: 'b', start: 0, end: 600 };

function applied(o: DispatchOutcome): Extract<DispatchOutcome, { status: 'applied' }> {
	if (o.status !== 'applied') throw new Error(`expected applied, got ${o.status}`);
	return o;
}

let h: Harness;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	h = harness();
	await h.finish();
});

afterEach(() => {
	h.dispose();
	vi.useRealTimers();
});

describe('M1: needs-schedule', () => {
	it('is refused at once with its own sentence and Show in text, never planned again', async () => {
		// A root task with a macro id: a new root task's id needs the engine's names.
		let indexes = 0;
		h.dispose();
		const inner = harness();
		await inner.finish();
		h = harness(undefined, {
			runner: {
				ensureIndex: () => {
					indexes++;
					return inner.runner.ensureIndex();
				},
				subscribe: (l) => inner.runner.subscribe(l),
			},
			workspace: inner.ws,
			history: inner.history,
		});
		const o = await h.edits.dispatch(
			{ type: 'addTask', parent: null, index: 0, name: 'New' },
			label('add'),
		);
		expect(o).toMatchObject({
			status: 'refused',
			reason: 'needs-schedule',
			message: refusalStrings['needs-schedule'],
		});
		expect(indexes).toBe(1);
		expect(o.status === 'refused' && o.at.length).toBeGreaterThan(0);
		const t = h.edits.toasts[0];
		expect(t).toMatchObject({ status: 'refused', text: refusalStrings['needs-schedule'] });
		expect(t?.show).not.toBeNull();
		h.edits.showToast(t?.id ?? -1);
		const r = h.reveals[0];
		expect(r && inner.text().slice(r.from, r.to)).toMatch(/^task \$\{tid\}/);
		inner.dispose();
	});

	it('says the same for the Gantt action', async () => {
		const o = await h.edits.dispatchAction(
			{ type: 'add', parent: null, index: 0, name: 'New' },
			{ result: h.runner.state.lastGood?.result ?? null, analysis: null },
		);
		expect(o).toMatchObject({ status: 'refused', reason: 'needs-schedule' });
	});
});

describe('settling', () => {
	it('fails at once an edit made while the engine is down', async () => {
		h.client.setState('failed');
		await h.shown();
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		await expect(o.settled).resolves.toEqual({
			status: 'failed',
			message: toastStrings.failed(engineFailureStrings.crash),
		});
		expect(h.edits.toasts.map((t) => t.status)).toEqual(['failed']);
		expect(h.edits.pending.count).toBe(0);
	});

	it('L3: an ok result with a new error schedules: the bar follows it, the toast says so', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('Effort of B'), mark));
		await h.finish({ ok: true, messages: [message('error', 6, 'new')] });
		await expect(o.settled).resolves.toMatchObject({
			status: 'new-error',
			message: toastStrings.newError('new'),
		});
		expect(h.edits.pending.byTask.size).toBe(0);
		expect(h.edits.toasts[0]).toMatchObject({
			status: 'new-error',
			detail: 'Effort of B',
			sticky: true,
		});
		expect(h.edits.toasts[0]?.show).not.toBeNull();
	});

	it('L5: undo then redo before the result settles it as undone, with nothing left over', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E'), mark));
		h.edits.undoToast(o.toast);
		h.history.redo();
		expect(h.text()).toContain('effort 3d');
		for (const r of h.client.open) h.client.done(r);
		await h.shown();
		await expect(o.settled).resolves.toEqual({ status: 'undone' });
		expect(h.edits.pending).toMatchObject({ count: 0 });
		expect(h.edits.pending.byTask.size).toBe(0);
		expect(h.edits.toasts).toEqual([]);
	});

	it('undoing a "not scheduled" edit clears its bar and its toast', async () => {
		applied(await h.edits.dispatch(effort('b', '3d'), label('E'), mark));
		await h.finish({ ok: false, messages: [message('error', 6, 'bad')] });
		expect(h.edits.pending.byTask.get('b')?.state).toBe('not-scheduled');
		h.history.undo();
		expect(h.edits.pending.byTask.size).toBe(0);
		expect(h.edits.toasts).toEqual([]);
	});

	it('gives the bar to the newer of two edits of one task, whatever the older one says', async () => {
		const a = applied(
			await h.edits.dispatch(effort('b', '3d'), label('a'), { task: 'b', start: 0, end: 100 }),
		);
		const b = applied(
			await h.edits.dispatch(effort('b', '4d'), label('b'), { task: 'b', start: 0, end: 200 }),
		);
		const [r1, r2] = h.client.open;
		h.client.done(r1 ?? -1, { ok: false, messages: [message('error', 6, 'bad')] }, true);
		await h.shown();
		await expect(a.settled).resolves.toMatchObject({ status: 'not-scheduled' });
		expect(h.edits.pending.byTask.get('b')).toMatchObject({ state: 'pending', mark: { end: 200 } });
		h.client.done(r2 ?? -1);
		await h.shown();
		await expect(b.settled).resolves.toEqual({ status: 'scheduled' });
		expect(h.edits.pending.byTask.size).toBe(0);
	});
});

describe('closing and many toasts', () => {
	it('closing the plan at the Android gate cancels the call and leaves the text alone', async () => {
		h.held = true;
		const p = h.edits.dispatch(effort('b', '3d'), label('E'), mark);
		await vi.advanceTimersByTimeAsync(32);
		h.edits.dispose();
		await vi.advanceTimersByTimeAsync(600);
		await expect(p).resolves.toEqual({ status: 'cancelled' });
		expect(h.text()).toContain('effort 2d');
	});

	it(`L4: keeps every pending toast past ${MAX_TOASTS}, and drops settled ones first`, async () => {
		const edits = [
			['b', '3d'],
			['c', '3d'],
			['b', '4d'],
			['c', '4d'],
		] as const;
		for (const [t, v] of edits) applied(await h.edits.dispatch(effort(t, v), label(t + v)));
		expect(h.edits.toasts.map((t) => t.text)).toEqual(['b3d', 'c3d', 'b4d', 'c4d']);
		await h.finish();
		expect(h.edits.pending.count).toBe(0);
		expect(h.edits.toasts.every((t) => t.status === 'scheduled')).toBe(true);
		await h.edits.dispatch(effort('b', '9d'), label('b9d'));
		expect(h.edits.toasts.map((t) => t.text)).toEqual(['b4d', 'c4d', 'b9d']);
	});
});
