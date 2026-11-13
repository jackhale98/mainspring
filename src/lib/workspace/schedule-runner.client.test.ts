// SPDX-License-Identifier: GPL-2.0-or-later
// The schedule runner through the real engine client (src/engine/client.ts) and its latest-wins
// queue, with the client's fake worker: a run waiting behind another is superseded, a finished
// run with a newer one waiting arrives with latest false, and a worker crash restarts the engine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, type EngineClient } from '../../engine/client';
import { FakeWorkerFactory, flush } from '../../engine/testing/fake-worker';
import { createScheduleRunner, type ScheduleRunner } from './schedule-runner';
import { IdleQueue } from './testing/idle-queue';
import { createWorkspace, type Workspace } from './workspace';

const PLAN = 'project p "P" 2026-01-05 +1m\ntask a "A" {\n  effort 1d\n}\n';

let ws: Workspace;
let factory: FakeWorkerFactory;
let client: EngineClient;
let runner: ScheduleRunner;
let idleTasks: IdleQueue;

/** Delivers the worker's replies, then runs the runner's idle tasks that show results. */
async function shown(): Promise<void> {
	await flush();
	idleTasks.run();
}

function type(insert: string): void {
	const state = ws.state('plan.tjp');
	ws.commit('plan.tjp', state.update({ changes: { from: 0, insert } }), 'typing');
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	factory = new FakeWorkerFactory();
	client = createEngineClient({ transport: factory.create });
	idleTasks = new IdleQueue();
	runner = createScheduleRunner({ workspace: ws, client, timers: idleTasks.timers });
});

afterEach(() => {
	runner.dispose();
	client.dispose();
	vi.useRealTimers();
});

describe('runner and engine client', () => {
	it('waits for boot, then keeps only the newest waiting run', async () => {
		expect(runner.state).toMatchObject({ status: 'scheduling', engine: 'booting' });
		factory.current.boot();
		expect(runner.state.engine).toBe('busy');
		expect(factory.current.postedRevisions()).toEqual([1]);
		type('# a\n');
		vi.advanceTimersByTime(300);
		type('# b\n');
		vi.advanceTimersByTime(300);
		// Revision 2 waited in the client's pending slot and was replaced by 3.
		expect(factory.current.postedRevisions()).toEqual([1]);
		factory.current.answerNext();
		await shown();
		expect(runner.state).toMatchObject({ status: 'scheduling', pending: true });
		expect(runner.state.latest).toMatchObject({ revision: 1, latest: false });
		expect(factory.current.postedRevisions()).toEqual([1, 3]);
		factory.current.answerNext();
		await shown();
		expect(runner.state).toMatchObject({ status: 'ok', pending: false, engine: 'idle' });
		expect(runner.state.latest).toMatchObject({ revision: 3, latest: true, workspaceVersion: 2 });
	});

	it('reports a crash, follows the restart and runs again on the next change', async () => {
		factory.current.boot();
		factory.current.answerNext();
		await shown();
		type('# a\n');
		vi.advanceTimersByTime(300);
		factory.current.emitError('error', 'wasm trap');
		await flush();
		expect(runner.state).toMatchObject({ status: 'failed', engine: 'booting', outdated: true });
		expect(runner.state.failure?.error.kind).toBe('crash');
		expect(factory.workers).toHaveLength(2);
		factory.current.boot();
		expect(runner.state).toMatchObject({ status: 'failed', engine: 'idle' });
		type('# b\n');
		vi.advanceTimersByTime(300);
		factory.current.answerNext();
		await shown();
		expect(runner.state).toMatchObject({ status: 'ok', failure: null });
		expect(runner.state.latest?.revision).toBe(3);
	});
});
