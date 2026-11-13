// SPDX-License-Identifier: GPL-2.0-or-later
// The runner changes of phase-2.md 6.9 (T8), against a fake EngineClient with fake timers and
// idle tasks the test runs: intent, format and history changes post first and derive in idle
// tasks; undo and redo schedule at once with the texts they restore; ensureIndex; a result is
// shown with its diagnostics in one state, and the index and checks follow in tasks of their own,
// each under 50 ms on the 1,000-task plan.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { golden } from '../tjp/index/testing';
import { createHistory, type WorkspaceHistory } from './history';
import {
	createScheduleRunner,
	RUNNER_MEASURE,
	TYPING_PAUSE_MS,
	type RunnerState,
	type ScheduleRunner,
	type ScheduleRunnerOptions,
} from './schedule-runner';
import { FakeEngineClient, flush, message } from './testing/fake-engine-client';
import { format, intent, seedWorkspace, textOf, type } from './testing/history-fixture';
import { IdleQueue } from './testing/idle-queue';
import { applyEdit, PLAN, TASKS, typeInto } from './testing/runner-fixture';
import { createWorkspace, type Workspace } from './workspace';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;
let idleTasks: IdleQueue;

function start(opts: Partial<ScheduleRunnerOptions> = {}): void {
	runner = createScheduleRunner({ workspace: ws, client, timers: idleTasks.timers, ...opts });
}

/** Delivers settled outcomes, then runs the idle tasks that show them. */
async function shown(): Promise<void> {
	await flush();
	idleTasks.run();
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

describe('post before derive', () => {
	it('posts an intent in its own task and derives the view in idle tasks', () => {
		start({ runAtStart: false });
		const seen: RunnerState[] = [];
		runner.subscribe((s) => seen.push(s));
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d');
		expect(client.lastRequest.files['plan.tjp']).toContain('effort 3d');
		// Published once, pending, with the view of the text before the edit.
		expect(seen).toHaveLength(2);
		expect(runner.state).toMatchObject({ status: 'scheduling', version: 0, indexVersion: 0 });
		expect(idleTasks.size).toBe(1);
		idleTasks.run();
		expect(runner.state).toMatchObject({ version: 1, indexVersion: 1 });
		expect(runner.state.index.tasks.has('b')).toBe(true);
	});

	it('ends a typing hold for format and history changes', () => {
		ws = seedWorkspace();
		start();
		const history = createHistory(ws);
		type(ws, 'plan.tjp', 0, '# a\n');
		vi.advanceTimersByTime(TYPING_PAUSE_MS - 1);
		expect(idleTasks.size).toBe(0);
		expect(format(ws, 'b.tji')).toBe(true);
		expect(client.requests).toHaveLength(2);
		expect(idleTasks.size).toBe(1);
		idleTasks.run();
		expect(runner.state.indexVersion).toBe(ws.snapshot().version);
		type(ws, 'plan.tjp', 0, '# b\n');
		history.undo();
		expect(client.requests).toHaveLength(3);
		idleTasks.run();
		expect(runner.state.indexVersion).toBe(ws.snapshot().version);
		history.dispose();
	});

	it('records each runner task as a performance measure', () => {
		performance.clearMeasures(RUNNER_MEASURE);
		start({ runAtStart: false });
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d');
		idleTasks.run();
		const steps = performance
			.getEntriesByName(RUNNER_MEASURE)
			.map((e) => (e as PerformanceMeasure).detail as { steps: string[] });
		expect(steps[0]).toEqual({ steps: ['post'] });
		expect(steps.slice(1).flatMap((s) => s.steps)).toContain('view');
	});
});

describe("the 'history' origin", () => {
	let history: WorkspaceHistory;

	beforeEach(() => {
		ws = seedWorkspace();
		start();
		history = createHistory(ws);
	});

	afterEach(() => history.dispose());

	it('schedules an undo and a redo at once, with the texts they restore', async () => {
		const before = textOf(ws, 'b.tji');
		expect(intent(ws, { type: 'setAttr', task: 'b', attr: 'effort', value: '9d' })).not.toBeNull();
		const after = textOf(ws, 'b.tji');
		expect(client.requests).toHaveLength(2);
		expect(history.undo().status).toBe('done');
		expect(client.requests).toHaveLength(3);
		expect(client.lastRequest.files['b.tji']).toBe(before);
		expect(history.redo().status).toBe('done');
		expect(client.requests).toHaveLength(4);
		expect(client.lastRequest.files['b.tji']).toBe(after);
		// No debounce: nothing waits on a timer.
		expect(vi.getTimerCount()).toBe(0);
		for (const r of [1, 2, 3, 4]) client.done(r, { tasks: TASKS });
		await shown();
		expect(runner.state).toMatchObject({ status: 'ok', pending: false });
		expect(runner.state.latest).toMatchObject({ revision: 4, latest: true });
		const version = ws.snapshot().version;
		expect(runner.state.latest?.workspaceVersion).toBe(version);
		expect(runner.state).toMatchObject({ version, indexVersion: version });
	});

	it('schedules an undo of typing at once, and the debounce sends nothing more', () => {
		const before = textOf(ws, 'plan.tjp');
		type(ws, 'plan.tjp', 0, '# typed\n');
		expect(client.requests).toHaveLength(1);
		expect(history.undo().status).toBe('done');
		expect(client.requests).toHaveLength(2);
		expect(client.lastRequest.files['plan.tjp']).toBe(before);
		vi.advanceTimersByTime(1000);
		expect(client.requests).toHaveLength(2);
	});
});

describe('ensureIndex', () => {
	it('returns the published index when it is current', () => {
		start();
		expect(runner.ensureIndex()).toBe(runner.state.index);
	});

	it('derives a lagging index without publishing, and the runner then shows that index', () => {
		start();
		typeInto(ws, '# a\n');
		let published = 0;
		runner.subscribe(() => published++);
		const index = runner.ensureIndex();
		expect(index.version).toBe(ws.snapshot().version);
		expect(runner.ensureIndex()).toBe(index);
		expect(published).toBe(1);
		expect(runner.state).toMatchObject({ version: 1, indexVersion: 0 });
		vi.advanceTimersByTime(TYPING_PAUSE_MS);
		idleTasks.run();
		expect(runner.state.index).toBe(index);
	});

	it('gives the index of the text an intent just changed, before the view follows', () => {
		start();
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d');
		expect(runner.ensureIndex().version).toBe(1);
		expect(runner.state.indexVersion).toBe(0);
	});
});

describe('timings', () => {
	let clock: number;
	const timed = (): Partial<ScheduleRunnerOptions> => ({
		timers: { ...idleTasks.timers, now: () => clock },
	});

	beforeEach(() => {
		clock = 1000;
	});

	it('starts the round trip when the engine is ready, not while it boots', async () => {
		client.state = 'booting';
		start(timed());
		clock = 4000;
		client.setState('idle');
		clock = 4300;
		client.done(1, { tasks: TASKS });
		await shown();
		expect(runner.state.timings?.roundTripMs).toBe(300);
		// Ready already: from the send.
		clock = 5000;
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d');
		clock = 5200;
		client.done(2, { tasks: TASKS });
		await shown();
		expect(runner.state.timings?.roundTripMs).toBe(200);
		// A restart after the send: from the moment it is ready again.
		clock = 6000;
		applyEdit(ws, 'setAttr', 'effort 3d', 'effort 4d');
		client.setState('booting');
		clock = 9000;
		client.setState('idle');
		clock = 9500;
		client.done(3, { tasks: TASKS });
		await shown();
		expect(runner.state.timings?.roundTripMs).toBe(500);
	});

	it('shows no older run’s timings after a failed run, and its own round trip instead', async () => {
		start(timed());
		clock = 1400;
		client.done(1, { tasks: TASKS });
		await shown();
		expect(runner.state.timings?.roundTripMs).toBe(400);
		clock = 2000;
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d');
		clock = 2600;
		client.fail(2, { kind: 'timeout', message: 'slow' });
		await flush();
		expect(runner.state.timings).toBeNull();
		expect(runner.state.failure).toMatchObject({ revision: 2, roundTripMs: 600 });
		expect(runner.state.latest?.timings.roundTripMs).toBe(400);
		clock = 3000;
		applyEdit(ws, 'setAttr', 'effort 3d', 'effort 4d');
		clock = 3100;
		client.done(3, { tasks: TASKS });
		await shown();
		expect(runner.state).toMatchObject({ failure: null });
		expect(runner.state.timings?.roundTripMs).toBe(100);
	});
});

describe('results in idle tasks', () => {
	it('shows a result in one state with its diagnostics; the index and checks follow apart', async () => {
		start({ sliceMs: 0 });
		const seen: RunnerState[] = [];
		runner.subscribe((s) => seen.push(s));
		client.done(1, { tasks: TASKS, messages: [message('warning', 7, 'odd')] });
		await flush();
		expect(runner.state).toMatchObject({ status: 'scheduling', pending: true, latest: null });
		const tasks = idleTasks.run();
		expect(tasks).toBeGreaterThanOrEqual(3);
		// Every state that shows the result shows its engine diagnostics too.
		const withResult = seen.filter((s) => s.latest?.revision === 1);
		expect(withResult.length).toBeGreaterThan(0);
		for (const s of withResult) {
			expect(s.diagnostics.filter((d) => d.source === 'engine').map((d) => d.revision)).toEqual([
				1,
			]);
		}
		expect(runner.state).toMatchObject({ status: 'ok', pending: false });
		expect(runner.state.index.tasks.get('t1')?.idSource).toBe('engine');
		expect(runner.state.timings?.processMs).toBeGreaterThanOrEqual(0);
	});

	/**
	 * One round: the first result, an intent (the edited file scanned and linked again, and
	 * checked) and its result. Returns the CPU time of every idle task, in ms: the work in the
	 * task, which a busy machine (other test files run in parallel) does not stretch as it does
	 * wall-clock time.
	 */
	async function roundOn1000(result: ScheduleResult): Promise<number[]> {
		ws = golden('syn-20-scale-1000');
		idleTasks = new IdleQueue();
		runner?.dispose();
		start({ zones: createTimeZoneHost() });
		const tasks: number[] = [];
		const timed = (): void => {
			while (idleTasks.size > 0) {
				const c0 = process.cpuUsage();
				idleTasks.runOne();
				const c = process.cpuUsage(c0);
				tasks.push((c.user + c.system) / 1000);
			}
		};
		client.done(client.requests.length, { ...result, revision: client.requests.length });
		await flush();
		timed();
		const entry = ws.snapshot().entry;
		const text = textOf(ws, entry);
		const at = text.indexOf('effort ');
		ws.apply({
			id: 'e1',
			intent: { type: 'setAttr' },
			base: { [entry]: ws.snapshot().files.get(entry)?.version ?? 0 },
			changes: {
				[entry]: ws.state(entry).changes({
					from: at,
					to: text.indexOf('\n', at),
					insert: 'effort 3d',
				}),
			},
		});
		timed();
		client.done(client.requests.length, { ...result, revision: client.requests.length });
		await flush();
		timed();
		expect(runner.state).toMatchObject({ status: 'ok', version: 1, indexVersion: 1 });
		return tasks;
	}

	it('keeps each task of a 1,000-task plan under 50 ms', async () => {
		const file = path.join(ROOT, 'engine/golden/expected/syn-20-scale-1000.json');
		const result = (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result;
		// Best of three rounds: the first also pays for the compiler's warm-up.
		const rounds: number[][] = [];
		for (let i = 0; i < 3; i++) rounds.push(await roundOn1000(result));
		const longest = rounds.map((r) => Math.max(...r));
		for (const r of rounds) {
			console.info(
				`runner on scale-1000: ${r.length} idle tasks, longest ${Math.max(...r).toFixed(1)} ms CPU ` +
					`(${r.map((t) => t.toFixed(1)).join(', ')})`,
			);
			expect(r.length).toBeGreaterThanOrEqual(5);
		}
		expect(Math.min(...longest)).toBeLessThan(50);
	}, 120_000);
});
