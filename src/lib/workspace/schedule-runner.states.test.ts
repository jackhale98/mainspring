// SPDX-License-Identifier: GPL-2.0-or-later
// Schedule runner (phase-1.md 6.8) against a fake EngineClient with fake timers: failures,
// restarts and a failed engine; the store contract, listener errors and dispose.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduleRunner, type ScheduleRunner } from './schedule-runner';
import { FakeEngineClient, flush } from './testing/fake-engine-client';
import { PLAN, TASKS, typeInto } from './testing/runner-fixture';
import { createWorkspace, type Workspace } from './workspace';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;

function start(): void {
	runner = createScheduleRunner({ workspace: ws, client });
}

const type = (insert: string): void => typeInto(ws, insert);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	client = new FakeEngineClient();
});

afterEach(() => {
	runner.dispose();
	vi.useRealTimers();
});

describe('engine states', () => {
	it('follows a crash and restart, and runs again on the next change', async () => {
		start();
		client.done(1, { tasks: TASKS });
		await flush();
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
		await flush();
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

describe('store contract and dispose', () => {
	it('calls a subscriber at once and on every change, until it unsubscribes', async () => {
		start();
		const seen: string[] = [];
		const off = runner.subscribe((s) => seen.push(s.status));
		client.done(1);
		await flush();
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
