// SPDX-License-Identifier: GPL-2.0-or-later
// The edit dispatcher (phase-2.md 6.8, 11.2) against a real workspace, history and schedule runner
// over the fake engine client: apply, settle (scheduled, not scheduled, failed, engine gone),
// toasts and Undo, the Android gate, the stale re-plan, confirmations and the pending
// bars. Interleavings are in edits.property.test.ts, Gantt actions in edits-actions.test.ts,
// coalesced gestures in edits-gestures.test.ts and the review's cases in edits-cases.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineFailureStrings, ganttActionStrings, refusalStrings, toastStrings } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import { message } from '../workspace/testing/fake-engine-client';
import { harness, type Harness } from './edits-testing';
import type { DispatchOutcome } from './edits.svelte';
import { TOAST_MS } from './toasts.svelte';

const effort = (task: string, value: string): EditIntent => ({
	type: 'setAttr',
	task,
	attr: 'effort',
	value,
});
const label = (text: string) => ({ label: { text, approx: false } });

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

function applied(o: DispatchOutcome): Extract<DispatchOutcome, { status: 'applied' }> {
	if (o.status !== 'applied') throw new Error(`expected applied, got ${o.status}`);
	return o;
}

describe('apply and settle', () => {
	it('applies one patch, one undo step named by the label, and a pending toast', async () => {
		const before = h.text();
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('Effort of B: 2d to 3d')));
		expect(h.text()).toBe(before.replace('effort 2d', 'effort 3d'));
		expect(h.history.top()).toMatchObject({ id: o.entry, label: 'Effort of B: 2d to 3d' });
		expect(o.version).toBe(h.ws.snapshot().version);
		expect(h.edits.toasts).toMatchObject([
			{ status: 'pending', text: 'Effort of B: 2d to 3d', entry: o.entry, canUndo: true },
		]);
		expect(h.edits.toasts[0]?.detail).toBe(toastStrings.rescheduling);
		// The runner posted the run at once ('intent'), with the patched text.
		expect(h.client.lastRequest.files['plan.tjp']).toBe(h.text());
		expect(h.edits.pending.count).toBe(1);
	});

	it('settles as scheduled on the result that includes it, and the toast closes 6 s later', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		await h.finish();
		await expect(o.settled).resolves.toEqual({ status: 'scheduled' });
		expect(h.edits.toasts[0]).toMatchObject({ status: 'scheduled', detail: null });
		expect(h.edits.pending.count).toBe(0);
		vi.advanceTimersByTime(TOAST_MS - 1);
		expect(h.edits.toasts).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(h.edits.toasts).toHaveLength(0);
	});

	it('says the plan no longer schedules, stays, and Show goes to the error in the text now', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('Effort of B')));
		await h.finish({ ok: false, messages: [message('error', 6, 'Task b is bad')] });
		const st = await o.settled;
		expect(st).toMatchObject({
			status: 'not-scheduled',
			message: toastStrings.noLongerSchedules('Task b is bad'),
		});
		const t = h.edits.toasts[0];
		expect(t).toMatchObject({ status: 'not-scheduled', detail: 'Effort of B', sticky: true });
		expect(t?.show).not.toBeNull();
		vi.advanceTimersByTime(TOAST_MS * 3);
		expect(h.edits.toasts).toHaveLength(1);
		// Typing above it moves the place: Show maps it to the text as it is now.
		const at = t?.show?.from ?? -1;
		h.type('# x\n');
		h.edits.showToast(t?.id ?? -1);
		expect(h.reveals).toEqual([expect.objectContaining({ file: 'plan.tjp', from: at + 4 })]);
		expect(
			h
				.text()
				.slice(at + 4)
				.startsWith('task b'),
		).toBe(true);
	});

	it('counts only errors the good run before did not have', async () => {
		const known = { messages: [message('error', 2, 'old')] };
		await h.edits.dispatch(effort('c', '2d'), label('one'));
		await h.finish(known);
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('two')));
		await h.finish(known);
		await expect(o.settled).resolves.toEqual({ status: 'scheduled' });
	});

	it('settles as failed when the run that included it failed', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		h.client.fail(h.client.open[0] ?? -1, { kind: 'timeout', message: 'slow' });
		await h.shown();
		await expect(o.settled).resolves.toEqual({
			status: 'failed',
			message: toastStrings.failed(engineFailureStrings.timeout),
		});
		expect(h.edits.toasts[0]).toMatchObject({ status: 'failed', sticky: true, detail: 'E' });
	});

	it('settles every pending edit as failed when the engine gives up', async () => {
		const a = applied(await h.edits.dispatch(effort('b', '3d'), label('a')));
		const b = applied(await h.edits.dispatch(effort('c', '3d'), label('b')));
		h.client.setState('failed');
		await expect(a.settled).resolves.toMatchObject({ status: 'failed' });
		await expect(b.settled).resolves.toMatchObject({ status: 'failed' });
	});

	it('settles a superseded edit on the newer run that includes it', async () => {
		const a = applied(await h.edits.dispatch(effort('b', '3d'), label('a')));
		const b = applied(await h.edits.dispatch(effort('c', '3d'), label('b')));
		const [first, second] = h.client.open;
		h.client.supersede(first ?? -1, second ?? -1);
		h.client.done(second ?? -1);
		await h.shown();
		await expect(a.settled).resolves.toEqual({ status: 'scheduled' });
		await expect(b.settled).resolves.toEqual({ status: 'scheduled' });
	});

	it('settles on a later typing run when a text edit follows it', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('a')));
		h.type('# typed\n');
		vi.advanceTimersByTime(300);
		await h.finish({ ok: false, messages: [message('error', 1, 'typo')] });
		await expect(o.settled).resolves.toMatchObject({ status: 'not-scheduled' });
	});

	it('drops pending edits when the plan closes', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('a')));
		h.edits.dispose();
		await expect(o.settled).resolves.toEqual({ status: 'dropped' });
		expect(h.edits.toasts).toEqual([]);
		await expect(h.edits.dispatch(effort('b', '4d'), label('x'))).resolves.toEqual({
			status: 'cancelled',
		});
	});
});

describe('undo from the toast', () => {
	it('undoes like Mod-Z while it is the top entry, and settles a pending edit as undone', async () => {
		const before = h.text();
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		h.edits.undoToast(o.toast);
		expect(h.text()).toBe(before);
		await expect(o.settled).resolves.toEqual({ status: 'undone' });
		expect(h.edits.toasts).toEqual([]);
		expect(h.history.redoTop()?.id).toBe(o.entry);
	});

	it('is disabled once another entry is on top, and enabled again when it is undone', async () => {
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		h.type('#');
		expect(h.edits.toasts[0]?.canUndo).toBe(false);
		h.edits.undoToast(o.toast);
		expect(h.text()).toContain('effort 3d');
		expect(h.text().startsWith('#')).toBe(true);
		h.history.undo();
		expect(h.edits.toasts[0]?.canUndo).toBe(true);
	});

	it('closes when Mod-Z undoes its entry after it settled', async () => {
		applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		await h.finish({ ok: false, messages: [message('error', 6, 'bad')] });
		expect(h.edits.toasts).toHaveLength(1);
		h.history.undo();
		expect(h.edits.toasts).toHaveLength(0);
	});

	it('waits for a held Android key before it undoes', async () => {
		const before = h.text();
		const o = applied(await h.edits.dispatch(effort('b', '3d'), label('E')));
		h.held = true;
		h.edits.undoToast(o.toast);
		expect(h.text()).not.toBe(before);
		h.held = false;
		vi.advanceTimersByTime(16);
		expect(h.text()).toBe(before);
	});
});

describe('the Android gate and the stale re-plan', () => {
	it('waits while the editor holds an Android key, then applies', async () => {
		h.held = true;
		const p = h.edits.dispatch(effort('b', '3d'), label('E'));
		await vi.advanceTimersByTimeAsync(16 * 5);
		expect(h.text()).toContain('effort 2d');
		h.held = false;
		await vi.advanceTimersByTimeAsync(16);
		expect((await p).status).toBe('applied');
		expect(h.text()).toContain('effort 3d');
	});

	it('goes ahead after about 500 ms when the key never clears', async () => {
		h.held = true;
		const p = h.edits.dispatch(effort('b', '3d'), label('E'));
		await vi.advanceTimersByTimeAsync(16 * 28);
		expect(h.text()).toContain('effort 2d');
		await vi.advanceTimersByTimeAsync(16 * 3);
		expect((await p).status).toBe('applied');
	});

	it('plans again when the text moved while it waited, and never applies the stale patch', async () => {
		h.held = true;
		const p = h.edits.dispatch(effort('b', '3d'), label('E'));
		await vi.advanceTimersByTimeAsync(16);
		// The held key lands: a newline typed above the task.
		h.type('\n', h.text().indexOf('task b'));
		const typed = h.ws.snapshot().files.get('plan.tjp')?.version;
		h.held = false;
		await vi.advanceTimersByTimeAsync(16);
		const o = applied(await p);
		expect(h.text()).toContain('}\n\ntask b "B" {\n  effort 3d\n}');
		// Planned on the text with the newline, not on the text it first saw.
		expect(o.edit.base['plan.tjp']).toBe(typed);
	});

	it('refuses as stale after three plans that the text kept moving under', async () => {
		h.dispose();
		// A key that never clears and a keystroke landing at every check: every plan goes stale.
		let checks = 0;
		h = harness(undefined, {
			keyHeld: () => {
				checks++;
				h.type('#');
				return true;
			},
		});
		await h.finish();
		const p = h.edits.dispatch(effort('b', '3d'), label('E'));
		await vi.advanceTimersByTimeAsync(16 * 31 * 3);
		await expect(p).resolves.toMatchObject({ status: 'refused', reason: 'stale' });
		expect(h.text()).toContain('effort 2d');
		expect(h.history.top()?.kind).toBe('typing');
		expect(checks).toBeGreaterThan(3);
		expect(h.edits.toasts[0]?.text).toBe(refusalStrings.stale);
	});
});

describe('refusals and confirmations', () => {
	it('toasts a refusal with its sentence and Show in text', async () => {
		const o = await h.edits.dispatch(effort('b', 'zz'), label('E'));
		expect(o).toMatchObject({ status: 'refused', reason: 'invalid-value' });
		expect(h.edits.toasts[0]).toMatchObject({
			status: 'refused',
			text: refusalStrings['invalid-value'],
			sticky: true,
		});
		h.edits.showToast(h.edits.toasts[0]?.id ?? -1);
		expect(h.reveals).toHaveLength(1);
		const r = h.reveals[0];
		expect(r && h.text().slice(r.from, r.to)).toBe('task b "B"');
		expect(h.history.top()).toBeNull();
	});

	it('toasts a no-op briefly', async () => {
		const o = await h.edits.dispatch(effort('b', '2d'), label('E'));
		expect(o).toMatchObject({ status: 'noop', reason: 'already-set' });
		expect(h.edits.toasts[0]).toMatchObject({ text: ganttActionStrings.noop['already-set'] });
		vi.advanceTimersByTime(TOAST_MS);
		expect(h.edits.toasts).toEqual([]);
	});

	it('refuses as unprepared when the index cannot be built', async () => {
		h.dispose();
		const errors: unknown[] = [];
		const onError = (e: unknown) => errors.push(e);
		process.on('uncaughtException', onError);
		h = harness(undefined, {
			runner: {
				ensureIndex: () => {
					throw new Error('index bug');
				},
				subscribe: () => () => undefined,
			},
		});
		const o = await h.edits.dispatch(effort('b', '3d'), label('E'));
		expect(o).toMatchObject({ status: 'refused', reason: 'unprepared' });
		expect(h.edits.toasts[0]?.text).toBe(toastStrings.unprepared);
		await new Promise((r) => setImmediate(r));
		process.off('uncaughtException', onError);
	});

	it('asks before editing text read in several places, then applies when confirmed', async () => {
		h.dispose();
		h = harness({
			entry: 'plan.tjp',
			files: {
				'plan.tjp':
					'project p "P" 2026-01-05 +1m\ntask g1 "G1"\ntask g2 "G2"\n' +
					'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
				't.tji': 'task t "T" {\n  effort 1d\n}\n',
			},
		});
		await h.finish();
		const ask = await h.edits.dispatch(effort('g1.t', '2d'), label('E'));
		expect(ask.status).toBe('confirm-shared');
		if (ask.status === 'confirm-shared') expect([...ask.affects].sort()).toEqual(['g1.t', 'g2.t']);
		expect(h.edits.toasts).toEqual([]);
		const o = await h.edits.dispatch(effort('g1.t', '2d'), { ...label('E'), confirmShared: true });
		expect(o.status).toBe('applied');
		expect(h.text('t.tji')).toContain('effort 2d');
	});
});

describe('pending bars and renames', () => {
	const mark = { task: 'b', start: 0, end: 600 };

	it('shows the preview at once, pending once applied, and drops it when scheduled', async () => {
		h.held = true;
		const p = h.edits.dispatch(effort('b', '3d'), label('E'), mark);
		expect(h.edits.pending.byTask.get('b')).toEqual({ mark, state: 'preview' });
		h.held = false;
		await vi.advanceTimersByTimeAsync(16);
		await p;
		expect(h.edits.pending.byTask.get('b')?.state).toBe('pending');
		await h.finish();
		expect(h.edits.pending.byTask.size).toBe(0);
	});

	it('drops the preview of a refused call', async () => {
		await h.edits.dispatch(effort('b', '2d'), label('E'), mark);
		expect(h.edits.pending.byTask.size).toBe(0);
	});

	it('marks the bar not scheduled until the plan schedules again', async () => {
		await h.edits.dispatch(effort('b', '3d'), label('E'), mark);
		await h.finish({ ok: false, messages: [message('error', 6, 'bad')] });
		expect(h.edits.pending.byTask.get('b')?.state).toBe('not-scheduled');
		h.type('#');
		vi.advanceTimersByTime(300);
		await h.finish();
		expect(h.edits.pending.byTask.size).toBe(0);
	});

	it('clears a not-scheduled mark when its toast is dismissed', async () => {
		await h.edits.dispatch(effort('b', '3d'), label('E'), mark);
		await h.finish({ ok: false, messages: [message('error', 6, 'bad')] });
		h.edits.dismissToast(h.edits.toasts[0]?.id ?? -1);
		expect(h.edits.pending.byTask.size).toBe(0);
	});

	it('maps a moved task to its new id while the move is pending', async () => {
		const o = await h.edits.dispatch(
			{ type: 'moveTask', task: 'c', parent: 'g', index: 0 },
			label('Moved C'),
		);
		expect(o.status).toBe('applied');
		expect(h.edits.pending.renames.get('c')).toBe('g.c');
		await h.finish();
		expect(h.edits.pending.renames.size).toBe(0);
	});
});
