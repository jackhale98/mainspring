// SPDX-License-Identifier: GPL-2.0-or-later
// Schedule runner (phase-1.md 6.8) against a fake EngineClient with fake timers: failures,
// restarts and a failed engine; derived state while typing (the index follows in idle tasks after
// a pause) and exceptions while deriving; the store contract, listener errors and dispose.
// Intents, history and chunked results (phase-2.md 6.9) are in schedule-runner.derive.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createScheduleRunner,
	IDLE_TIMEOUT_MS,
	MAX_TYPING_WAIT_MS,
	TYPING_PAUSE_MS,
	type ScheduleRunner,
} from './schedule-runner';
import { FakeEngineClient, flush, message } from './testing/fake-engine-client';
import { IdleQueue } from './testing/idle-queue';
import { PLAN, TASKS, typeInto, type TypeAt } from './testing/runner-fixture';
import { createWorkspace, type Workspace } from './workspace';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;
let idleTasks: IdleQueue;

function start(): void {
	runner = createScheduleRunner({ workspace: ws, client, timers: idleTasks.timers });
}

const type = (insert: string, at?: TypeAt): void => typeInto(ws, insert, at);
/** Delivers settled outcomes, then runs the idle tasks that show them. */
const shown = async (): Promise<void> => {
	await flush();
	idleTasks.run();
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	client = new FakeEngineClient();
	idleTasks = new IdleQueue();
});

afterEach(() => {
	runner.dispose();
	vi.useRealTimers();
});

describe('engine states', () => {
	it('follows a crash and restart, and runs again on the next change', async () => {
		start();
		client.done(1, { tasks: TASKS });
		await shown();
		type('# a\n');
		vi.advanceTimersByTime(300);
		client.setState('busy');
		client.fail(2, { kind: 'crash', message: 'trap' });
		client.setState('booting');
		await flush();
		expect(runner.state).toMatchObject({ status: 'failed', engine: 'booting', outdated: true });
		expect(runner.state.failure?.error.kind).toBe('crash');
		expect(runner.state.lastGood?.revision).toBe(1);
		client.setState('idle');
		expect(runner.state).toMatchObject({ status: 'failed', engine: 'idle' });
		// No retry by itself: the same text would fail the same way.
		vi.advanceTimersByTime(10_000);
		expect(client.requests).toHaveLength(2);
		type('# b\n');
		vi.advanceTimersByTime(300);
		client.done(3, { tasks: TASKS });
		await shown();
		expect(runner.state).toMatchObject({ status: 'ok', failure: null, outdated: false });
	});

	it('keeps the failure of a run when an older one fails later', async () => {
		start();
		type('# a\n');
		vi.advanceTimersByTime(300);
		client.fail(2, { kind: 'internal', message: 'two' });
		client.fail(1, { kind: 'internal', message: 'one' });
		await flush();
		expect(runner.state.failure?.revision).toBe(2);
	});

	it('is failed while the engine is failed for good', () => {
		start();
		client.setState('failed');
		expect(runner.state).toMatchObject({ status: 'failed', engine: 'failed', pending: true });
	});
});

describe('derived state while typing', () => {
	it('shows syntax at once and brings the index along in idle tasks after a pause', () => {
		start();
		type('# a\n');
		type('task c "C" {\n', { line: 10 });
		type('# b\n');
		// No idle task during a burst of typing: it is asked for after a pause.
		vi.advanceTimersByTime(TYPING_PAUSE_MS - 1);
		type('# b2\n');
		vi.advanceTimersByTime(TYPING_PAUSE_MS - 1);
		expect(idleTasks.timeouts).toEqual([]);
		expect(runner.state).toMatchObject({ version: 4, indexVersion: 0 });
		expect(runner.state.diagnostics.some((d) => d.source === 'syntax')).toBe(true);
		vi.advanceTimersByTime(1);
		expect(idleTasks.timeouts).toEqual([IDLE_TIMEOUT_MS]);
		// The index in one task, the value checks in the next.
		idleTasks.runOne();
		expect(runner.state).toMatchObject({ version: 4, indexVersion: 4, pending: true });
		expect(runner.state.index.tasks.has('c')).toBe(true);
		expect(idleTasks.size).toBe(1);
		const checks = runner.state.diagnostics;
		idleTasks.runOne();
		expect(runner.state.diagnostics).not.toBe(checks);
		expect(idleTasks.size).toBe(0);
		type('# c\n');
		vi.advanceTimersByTime(TYPING_PAUSE_MS);
		expect(idleTasks.size).toBe(1);
	});

	it('brings the index along during a burst that never pauses, at most MAX_TYPING_WAIT_MS late', () => {
		start();
		let caughtUpAt = -1;
		for (let i = 0; i < 30; i++) {
			type('# k\n');
			vi.advanceTimersByTime(TYPING_PAUSE_MS - 50);
			// The main thread is idle between keystrokes.
			idleTasks.run();
			if (caughtUpAt < 0 && runner.state.indexVersion > 0)
				caughtUpAt = (i + 1) * (TYPING_PAUSE_MS - 50);
		}
		expect(idleTasks.ran).toBeGreaterThan(0);
		expect(caughtUpAt).toBeGreaterThan(0);
		expect(caughtUpAt).toBeLessThanOrEqual(MAX_TYPING_WAIT_MS + TYPING_PAUSE_MS);
		// Caught up again within the cap of the next burst too.
		expect(runner.state.indexVersion).toBeGreaterThan(30 - MAX_TYPING_WAIT_MS / 100 - 2);
	});

	it('shows a result while typing goes on, and leaves the index for the pause', async () => {
		start();
		type('# a\n');
		client.done(1, { tasks: TASKS });
		await flush();
		vi.advanceTimersByTime(TYPING_PAUSE_MS - 1);
		type('# b\n');
		idleTasks.run();
		expect(runner.state.latest?.revision).toBe(1);
		expect(runner.state).toMatchObject({ version: 2, indexVersion: 0 });
		vi.advanceTimersByTime(TYPING_PAUSE_MS);
		idleTasks.run();
		expect(runner.state).toMatchObject({ version: 2, indexVersion: 2 });
		expect(runner.state.index.tasks.get('t1')?.idSource).toBe('engine');
	});

	it('keeps the previous view when deriving throws; commit and other subscribers go on', async () => {
		let broken = false;
		const failing = new Proxy(ws, {
			get(target, p) {
				if (p === 'changesSince' && broken) {
					return () => {
						throw new Error('broken');
					};
				}
				const v: unknown = Reflect.get(target, p, target);
				return typeof v === 'function' ? v.bind(target) : v;
			},
		});
		runner = createScheduleRunner({ workspace: failing, client, timers: idleTasks.timers });
		client.done(1, { tasks: TASKS, messages: [message('warning', 7)] });
		await flush();
		idleTasks.run();
		let other = 0;
		ws.subscribe(() => other++);
		const thrown: unknown[] = [];
		const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((fn) => {
			try {
				fn();
			} catch (e) {
				thrown.push(e);
			}
		});
		broken = true;
		type('# a\n');
		vi.advanceTimersByTime(TYPING_PAUSE_MS);
		// A step that threw is not tried again for the same text: the idle tasks end.
		idleTasks.run();
		spy.mockRestore();
		expect(other).toBe(1);
		expect(thrown).toEqual([new Error('broken'), new Error('broken')]);
		expect(runner.state).toMatchObject({ version: 0, indexVersion: 0, pending: true });
		broken = false;
		type('# b\n');
		expect(runner.state.version).toBe(2);
		expect(runner.state.diagnostics[0]).toMatchObject({ line: 9, stale: true });
		vi.advanceTimersByTime(TYPING_PAUSE_MS);
		idleTasks.run();
		expect(runner.state).toMatchObject({ version: 2, indexVersion: 2 });
	});
});

describe('store contract and dispose', () => {
	it('calls a subscriber at once and on every change, until it unsubscribes', async () => {
		start();
		const seen: string[] = [];
		const off = runner.subscribe((s) => seen.push(s.status));
		client.done(1);
		await shown();
		off();
		type('# a\n');
		expect(seen).toEqual(['scheduling', 'ok']);
	});

	it('publishes once per change and rethrows listener errors after every listener ran', () => {
		start();
		const thrown: unknown[] = [];
		const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((fn) => {
			try {
				fn();
			} catch (e) {
				thrown.push(e);
			}
		});
		const calls: number[] = [];
		runner.subscribe(() => calls.push(1));
		let first = true;
		runner.subscribe(() => {
			if (first) first = false;
			else throw new Error('listener');
		});
		const calls2: number[] = [];
		runner.subscribe(() => calls2.push(1));
		type('# a\n');
		spy.mockRestore();
		expect(calls).toEqual([1, 1]);
		expect(calls2).toEqual([1, 1]);
		expect(thrown).toEqual([new Error('listener')]);
	});

	it('cancels open runs and stops listening on dispose', async () => {
		start();
		type('# a\n');
		runner.dispose();
		expect(client.cancelled).toEqual([1]);
		expect(client.listenerCount).toBe(0);
		vi.advanceTimersByTime(1000);
		type('# b\n');
		vi.advanceTimersByTime(1000);
		await flush();
		expect(client.requests).toHaveLength(1);
		const seen: unknown[] = [];
		runner.subscribe((s) => seen.push(s));
		expect(seen).toHaveLength(1);
		runner.changed('now');
		expect(client.requests).toHaveLength(1);
	});
});
