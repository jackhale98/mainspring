// SPDX-License-Identifier: GPL-2.0-or-later
// Coalesced gestures (phase-2.md 6.8 step 6, 19.7; coalesce.ts): every call sends the cumulative
// total since the gesture began, and the gesture is one undo step whatever the timing. Size steps
// of design.research (effort 3d) on the gantt-manipulation fixture, and plain intents.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refusalStrings } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import { harness, manipulationHarness, type Harness } from './edits-testing';
import { COALESCE_MS, type ActionSource, type DispatchOutcome } from './edits.svelte';

const KEY = 'size:design.research';
let h: Harness;
let source: ActionSource;

const step = (steps: number, key = KEY): Promise<DispatchOutcome> =>
	h.edits.dispatchAction({ type: 'size-step', task: 'design.research', steps }, source, {
		coalesceKey: key,
	});
const effort = (): string | undefined =>
	/task research "Research" \{\n {4}effort (\S+)/.exec(h.text())?.[1];

function applied(o: DispatchOutcome): Extract<DispatchOutcome, { status: 'applied' }> {
	if (o.status !== 'applied') throw new Error(`expected applied, got ${o.status}`);
	return o;
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	({ h, source } = await manipulationHarness());
});

afterEach(() => {
	h.dispose();
	vi.useRealTimers();
});

describe('a gesture is one undo step whatever the timing', () => {
	it('keeps the newest total of a burst and dispatches it after 300 ms of quiet', async () => {
		const [a, b] = [step(1), step(2)];
		const c = step(3);
		await expect(a).resolves.toEqual({ status: 'cancelled' });
		await expect(b).resolves.toEqual({ status: 'cancelled' });
		await vi.advanceTimersByTimeAsync(COALESCE_MS - 1);
		expect(effort()).toBe('3d');
		await vi.advanceTimersByTimeAsync(1);
		expect((await c).status).toBe('applied');
		expect(effort()).toBe('6d');
	});

	it('replaces its applied edit with a later total: +3 then +4 is +4 (the review case, gate held)', async () => {
		h.held = true;
		const a = step(3);
		// Quiet: +3 is taken from the hold and waits for the held Android key.
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		const b = step(4);
		h.held = false;
		await vi.advanceTimersByTimeAsync(16);
		const first = applied(await a);
		expect(effort()).toBe('6d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await b).status).toBe('applied');
		expect(effort()).toBe('7d');
		await expect(first.settled).resolves.toEqual({ status: 'replaced' });
		// One toast, one undo step, back to the text before the gesture.
		expect(h.edits.toasts.map((t) => t.text)).toEqual(['Effort of Research: 3d to 7d']);
		h.history.undo();
		expect(effort()).toBe('3d');
		expect(h.history.canUndo).toBe(false);
	});

	it('replaces it after the result too, and the toast of the replaced edit goes', async () => {
		const a = step(1);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		const first = applied(await a);
		await h.finish();
		await expect(first.settled).resolves.toEqual({ status: 'scheduled' });
		const b = step(2);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await b).status).toBe('applied');
		expect(effort()).toBe('5d');
		expect(h.edits.toasts.map((t) => t.text)).toEqual(['Effort of Research: 3d to 5d']);
		h.history.undo();
		expect(effort()).toBe('3d');
	});

	it('takes its edit out on a total of zero, with no toast', async () => {
		const a = step(2);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await a).status).toBe('applied');
		const b = step(0);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await b).toMatchObject({ status: 'noop' });
		expect(effort()).toBe('3d');
		expect(h.edits.toasts).toEqual([]);
		expect(h.history.canUndo).toBe(false);
		// And a zero total with nothing applied is quiet as well.
		const c = step(0, 'other');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await c).toMatchObject({ status: 'noop' });
		expect(h.edits.toasts).toEqual([]);
	});
});

describe('the end of a gesture', () => {
	it('flush dispatches at once and ends it: the next call begins a new total', async () => {
		const a = step(2);
		h.edits.flush(KEY);
		expect((await a).status).toBe('applied');
		expect(effort()).toBe('5d');
		const b = step(1);
		h.edits.flush(KEY);
		expect((await b).status).toBe('applied');
		expect(effort()).toBe('6d');
		h.history.undo();
		expect(effort()).toBe('5d');
	});

	it('is broken by another undo step: stale once, then cancelled until flush', async () => {
		const a = step(1);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await a).status).toBe('applied');
		h.type('# typed\n');
		const b = step(2);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await b).toMatchObject({ status: 'refused', reason: 'stale' });
		expect(h.edits.toasts.at(-1)?.text).toBe(refusalStrings.stale);
		const c = step(3);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await c).toEqual({ status: 'cancelled' });
		expect(effort()).toBe('4d');
		h.edits.flush(KEY);
		const d = step(1);
		h.edits.flush(KEY);
		expect((await d).status).toBe('applied');
		expect(effort()).toBe('5d');
	});

	it('is broken when Mod-Z undoes its edit', async () => {
		const a = step(1);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		const first = applied(await a);
		h.history.undo();
		await expect(first.settled).resolves.toEqual({ status: 'undone' });
		const b = step(2);
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await b).toMatchObject({ status: 'refused', reason: 'stale' });
		expect(effort()).toBe('3d');
	});
});

describe('plain intents in a gesture', () => {
	let p: Harness;
	beforeEach(async () => {
		p = harness();
		await p.finish();
	});
	afterEach(() => p.dispose());

	const set = (value: string): Promise<DispatchOutcome> =>
		p.edits.dispatch({ type: 'setAttr', task: 'b', attr: 'effort', value } satisfies EditIntent, {
			label: { text: value, approx: false },
			coalesceKey: 'b',
		});

	it('a later value replaces the applied one: one undo step back to the start', async () => {
		const a = set('3d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await a).status).toBe('applied');
		const b = set('4d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await b).status).toBe('applied');
		expect(p.text()).toContain('effort 4d');
		p.history.undo();
		expect(p.text()).toContain('effort 2d');
		expect(p.history.canUndo).toBe(false);
	});

	it('keeps its edit when the newer value is refused', async () => {
		const a = set('3d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		const first = await a;
		expect(first.status).toBe('applied');
		const b = set('zz');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await b).toMatchObject({ status: 'refused', reason: 'invalid-value' });
		expect(p.text()).toContain('effort 3d');
		expect(p.history.top()?.id).toBe(first.status === 'applied' ? first.entry : null);
		const c = set('5d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await c).status).toBe('applied');
		expect(p.text()).toContain('effort 5d');
		p.history.undo();
		expect(p.text()).toContain('effort 2d');
	});

	it('the starting value takes the edit out', async () => {
		const a = set('3d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect((await a).status).toBe('applied');
		const b = set('2d');
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		expect(await b).toMatchObject({ status: 'noop' });
		expect(p.text()).toContain('effort 2d');
		expect(p.history.canUndo).toBe(false);
	});
});
