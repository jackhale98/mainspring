// SPDX-License-Identifier: GPL-2.0-or-later
// The runner's contract with the edit dispatcher (run-types.ts, phase-2.md 6.8, 6.9; T8 review):
// every published state describes the text as it is, an undo in another file included; a failed
// run settles the edits it covered; ensureIndex throws when the index cannot be built; and an
// idle task chains file scans only, never a scan with the link.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory } from './history';
import {
	createScheduleRunner,
	RUNNER_MEASURE,
	TYPING_PAUSE_MS,
	type ScheduleRunner,
	type ScheduleRunnerOptions,
} from './schedule-runner';
import { FakeEngineClient, flush } from './testing/fake-engine-client';
import { intent, seedWorkspace, type } from './testing/history-fixture';
import { IdleQueue } from './testing/idle-queue';
import { applyEdit, PLAN, TASKS, typeInto } from './testing/runner-fixture';
import { createWorkspace, type Workspace } from './workspace';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;
let idleTasks: IdleQueue;

function start(opts: Partial<ScheduleRunnerOptions> = {}): void {
	runner = createScheduleRunner({
		workspace: ws,
		client,
		// A clock that never moves: how steps group into tasks does not depend on load.
		timers: { ...idleTasks.timers, now: () => 0 },
		...opts,
	});
}

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

describe('every published state describes the text as it is', () => {
	it('after an intent in another file and its undo, from the first publish on', () => {
		ws = seedWorkspace();
		start();
		const history = createHistory(ws);
		// plan.tjp is the file the editor shows; the intent and its undo change b.tji.
		type(ws, 'plan.tjp', 0, '# open\n');
		const published: Array<{ version: number; now: number; diagnostics: number }> = [];
		runner.subscribe((s) =>
			published.push({
				version: s.version,
				now: ws.snapshot().version,
				diagnostics: s.diagnostics.length,
			}),
		);
		published.length = 0;
		expect(intent(ws, { type: 'setAttr', task: 'b', attr: 'effort', value: '9d' })).not.toBeNull();
		expect(history.undo().status).toBe('done');
		expect(published.length).toBeGreaterThanOrEqual(2);
		for (const p of published) expect(p.version).toBe(p.now);
		expect(runner.state.indexVersion).toBeLessThan(runner.state.version);
		idleTasks.run();
		expect(runner.state.indexVersion).toBe(ws.snapshot().version);
		history.dispose();
	});
});

describe('settling edits', () => {
	it('settles the edits a failed run covered, through failure.workspaceVersion', async () => {
		start();
		client.done(1, { tasks: TASKS });
		await flush();
		idleTasks.run();
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d'); // v1, revision 2
		const v1 = ws.snapshot().version;
		applyEdit(ws, 'setAttr', 'effort 3d', 'effort 4d'); // v2, revision 3
		const v2 = ws.snapshot().version;
		client.supersede(2, 3);
		client.fail(3, { kind: 'timeout', message: 'slow' });
		await flush();
		const s = runner.state;
		expect(s.failure).toMatchObject({ revision: 3, workspaceVersion: v2 });
		// Both edits are settled, as failed: the failure is newer than the latest result.
		expect(s.latest?.workspaceVersion).toBeLessThan(v1);
		expect(s.failure?.workspaceVersion).toBeGreaterThanOrEqual(v1);
		expect(s.failure?.revision).toBeGreaterThan(s.latest?.revision ?? 0);
		expect(s.pending).toBe(false);
	});
});

describe('ensureIndex', () => {
	it('throws when the index cannot be built, and works again once it can', () => {
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
		client.done(1, { tasks: TASKS });
		return flush().then(() => {
			idleTasks.run();
			const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => {});
			broken = true;
			typeInto(ws, '# a\n');
			const before = runner.state;
			expect(() => runner.ensureIndex()).toThrow('broken');
			expect(runner.state).toBe(before);
			broken = false;
			spy.mockRestore();
			expect(runner.ensureIndex().version).toBe(ws.snapshot().version);
		});
	});
});

describe('idle tasks', () => {
	it('chain file scans only: the link and the checks each have a task of their own', () => {
		ws = seedWorkspace();
		start();
		performance.clearMeasures(RUNNER_MEASURE);
		const snap = ws.snapshot();
		const change = (path: string, find: string, insert: string) => {
			const text = snap.files.get(path)?.text.toString() ?? '';
			const at = text.indexOf(find);
			return ws.state(path).changes({ from: at, to: at + find.length, insert });
		};
		ws.apply({
			id: 'two-files',
			intent: { type: 'setAttr' },
			base: {
				'a.tji': snap.files.get('a.tji')?.version ?? 0,
				'b.tji': snap.files.get('b.tji')?.version ?? 0,
			},
			changes: { 'a.tji': change('a.tji', '1d', '2d'), 'b.tji': change('b.tji', '4d', '5d') },
		});
		idleTasks.run();
		const tasks = performance
			.getEntriesByName(RUNNER_MEASURE)
			.map((e) => ((e as PerformanceMeasure).detail as { steps: string[] }).steps.join('+'));
		expect(tasks).toEqual(['post', 'scan+scan', 'view', 'view']);
	});

	it('take one step each with a zero slice, and wait for the pause while typing', () => {
		start({ sliceMs: 0 });
		typeInto(ws, '# a\n');
		vi.advanceTimersByTime(TYPING_PAUSE_MS - 1);
		expect(idleTasks.size).toBe(0);
		vi.advanceTimersByTime(1);
		expect(idleTasks.run()).toBe(3);
	});
});
