// SPDX-License-Identifier: GPL-2.0-or-later
// The dispatcher's ledger (ledger.svelte.ts): open edits, renames, bars and how each settles.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerState } from '../workspace/run-types';
import { result } from '../workspace/testing/fake-engine-client';
import { Ledger, type Entry } from './ledger.svelte';
import { Toasts } from './toasts.svelte';

const timers = {
	setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
const mark = { task: 'b', start: 0, end: 600 };
const label = { text: 'E', approx: false };

const state = (over: Partial<RunnerState>): RunnerState =>
	({
		engine: 'idle',
		latest: null,
		failure: null,
		diagnostics: [],
		version: 5,
		lastGood: null,
		outdated: false,
		...over,
	}) as RunnerState;
const ran = (workspaceVersion: number, ok = true) =>
	({
		revision: 2,
		workspaceVersion,
		result: result(2, { ok }),
	}) as unknown as RunnerState['latest'];

let toasts: Toasts;
let ledger: Ledger;

function entry(over: Partial<Entry> = {}): Entry {
	const toast = toasts.edit(label, over.entry ?? 'e1', null);
	return {
		seq: 1,
		entry: 'e1',
		version: 5,
		baseline: new Set(),
		toast,
		task: 'b',
		rename: null,
		...over,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	toasts = new Toasts(timers);
	ledger = new Ledger(toasts);
});
afterEach(() => void vi.useRealTimers());

describe('Ledger', () => {
	it('counts open edits and their renames until a result includes them', async () => {
		ledger.bar(mark, 'pending', 1);
		const settled = ledger.add(entry({ rename: ['c', 'g.c'] }), state({}));
		expect(ledger.pending).toMatchObject({ count: 1 });
		expect(ledger.pending.renames.get('c')).toBe('g.c');
		ledger.onRunner(state({ latest: ran(4) }));
		expect(ledger.pending.count).toBe(1);
		ledger.onRunner(state({ latest: ran(5) }));
		await expect(settled).resolves.toEqual({ status: 'scheduled' });
		expect(ledger.pending).toMatchObject({ count: 0 });
		expect(ledger.pending.renames.size).toBe(0);
		expect(ledger.pending.byTask.size).toBe(0);
	});

	it('settles at once when the engine is already down', async () => {
		const settled = ledger.add(entry(), state({ engine: 'failed' }));
		await expect(settled).resolves.toMatchObject({ status: 'failed' });
		expect(ledger.pending.count).toBe(0);
	});

	it('marks the bar not scheduled, and clears it when the plan schedules or the toast closes', () => {
		const e = entry();
		ledger.bar(mark, 'pending', 1, e.toast);
		void ledger.add(e, null);
		ledger.onRunner(state({ latest: ran(5, false), outdated: true }));
		expect(ledger.pending.byTask.get('b')?.state).toBe('not-scheduled');
		ledger.closed(e.toast);
		expect(ledger.pending.byTask.size).toBe(0);
		ledger.bar(mark, 'pending', 2);
		void ledger.add(entry({ seq: 2, entry: 'e2', version: 6 }), null);
		ledger.onRunner(state({ latest: ran(6, false), outdated: true }));
		ledger.onRunner(state({ latest: ran(7) }));
		expect(ledger.pending.byTask.size).toBe(0);
	});

	it('settles an undone entry as undone, or replaced, once', async () => {
		const a = ledger.add(entry(), null);
		const b = ledger.add(entry({ seq: 2, entry: 'e2', version: 6 }), null);
		ledger.undone('e1', false);
		ledger.undone('e2', true);
		ledger.undone('e2', false);
		await expect(a).resolves.toEqual({ status: 'undone' });
		await expect(b).resolves.toEqual({ status: 'replaced' });
	});

	it('drops everything when the plan closes', async () => {
		ledger.bar(mark, 'preview', 1);
		const a = ledger.add(entry(), null);
		ledger.dispose();
		await expect(a).resolves.toEqual({ status: 'dropped' });
		expect(ledger.pending).toMatchObject({ count: 0 });
		expect(ledger.pending.byTask.size).toBe(0);
	});
});
