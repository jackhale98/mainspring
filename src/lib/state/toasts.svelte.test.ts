// SPDX-License-Identifier: GPL-2.0-or-later
// The edit toasts' list (phase-2.md 9.4): timing, stickiness, the cap and Undo's enabled state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toastStrings } from '../strings';
import { MAX_TOASTS, TOAST_MS, Toasts, type Toast } from './toasts.svelte';

const timers = {
	setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
const label = { text: 'Effort of A: 1d to 2d', approx: false };

let closed: Toast[];
let t: Toasts;

beforeEach(() => {
	vi.useFakeTimers();
	closed = [];
	t = new Toasts(timers, (x) => closed.push(x));
});
afterEach(() => void vi.useRealTimers());

describe('Toasts', () => {
	it('keeps a pending edit until it settles, then closes it 6 s later', () => {
		const id = t.edit(label, 'e1', null);
		expect(t.get(id)).toMatchObject({ status: 'pending', detail: toastStrings.rescheduling });
		vi.advanceTimersByTime(TOAST_MS * 5);
		expect(t.list).toHaveLength(1);
		t.settle(id, { status: 'scheduled' });
		vi.advanceTimersByTime(TOAST_MS);
		expect(t.list).toHaveLength(0);
		expect(closed.map((x) => x.id)).toEqual([id]);
	});

	it('keeps problems until dismissed, with the label under the message', () => {
		const id = t.edit(label, 'e1', null);
		const at = { file: 'plan.tjp', from: 1, to: 2, version: 3 };
		t.settle(id, { status: 'not-scheduled', message: 'Changed. No', at });
		vi.advanceTimersByTime(TOAST_MS * 5);
		expect(t.get(id)).toMatchObject({
			text: 'Changed. No',
			detail: label.text,
			show: at,
			sticky: true,
		});
		const f = t.edit(label, 'e2', null);
		t.settle(f, { status: 'failed', message: 'Changed. Failed' });
		const r = t.refused('No.', null);
		vi.advanceTimersByTime(TOAST_MS * 5);
		expect(t.list.map((x) => x.status)).toEqual(['not-scheduled', 'failed', 'refused']);
		t.remove(r);
		expect(t.list).toHaveLength(2);
	});

	it('keeps the one-time warning until dismissed', () => {
		const id = t.edit(label, 'e1', 'A fixed start…');
		t.settle(id, { status: 'scheduled' });
		vi.advanceTimersByTime(TOAST_MS * 2);
		expect(t.get(id)?.warning).toBe('A fixed start…');
	});

	it('closes a no-op after 6 s, and closes the toast of an undone or dropped edit', () => {
		t.noop('Nothing changed.');
		vi.advanceTimersByTime(TOAST_MS);
		expect(t.list).toEqual([]);
		const a = t.edit(label, 'e1', null);
		t.settle(a, { status: 'undone' });
		const b = t.edit(label, 'e2', null);
		t.settle(b, { status: 'dropped' });
		expect(t.list).toEqual([]);
	});

	it('lets only the toast of the top entry undo', () => {
		t.setTop('e1');
		const a = t.edit(label, 'e1', null);
		expect(t.get(a)?.canUndo).toBe(true);
		const b = t.edit(label, 'e2', null);
		t.setTop('e2');
		expect([t.get(a)?.canUndo, t.get(b)?.canUndo]).toEqual([false, true]);
		t.setTop(null);
		expect(t.list.every((x) => !x.canUndo)).toBe(true);
		t.removeEntry('e1');
		expect(t.list.map((x) => x.id)).toEqual([b]);
	});

	it(`keeps at most ${MAX_TOASTS}, the oldest going first`, () => {
		const ids = [1, 2, 3, 4, 5].map((i) => t.edit(label, `e${i}`, null));
		expect(t.list.map((x) => x.id)).toEqual(ids.slice(-MAX_TOASTS));
		t.clear();
		expect(t.list).toEqual([]);
	});
});
