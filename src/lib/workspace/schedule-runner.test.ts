// SPDX-License-Identifier: GPL-2.0-or-later
// Schedule runner (phase-1.md 6.8) against a fake EngineClient with fake timers: debounce and
// immediate runs, results and lastGood on errors, latest-wins interplay, stale mapping and hints
// on untouched lines only. Engine states and the store contract are in
// schedule-runner.states.test.ts, latest-wins through the real client in
// schedule-runner.client.test.ts, the real engine in schedule-runner.engine.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduleRunner, type ScheduleRunner } from './schedule-runner';
import { FakeEngineClient, flush, message, task } from './testing/fake-engine-client';
import { applyEdit, PLAN, sliceOf, TASKS, typeInto, type TypeAt } from './testing/runner-fixture';
import { createWorkspace, type Workspace } from './workspace';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;

function start(opts: { debounceMs?: number; runAtStart?: boolean } = {}): void {
	runner = createScheduleRunner({ workspace: ws, client, ...opts });
}

const type = (insert: string, at?: TypeAt): void => typeInto(ws, insert, at);
const apply = (intent: string, find: string, insert: string): void =>
	applyEdit(ws, intent, find, insert);
const textOf = (d: { from: number; to: number }): string => sliceOf(ws, d);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	client = new FakeEngineClient();
});

afterEach(() => {
	runner.dispose();
	vi.useRealTimers();
});

describe('runs', () => {
	it('schedules at start, then waits for 300 ms of quiet after typing', () => {
		start();
		expect(client.requests.map((r) => r.revision)).toEqual([1]);
		expect(runner.state).toMatchObject({ status: 'scheduling', pending: true, engine: 'idle' });
		type('# a\n');
		vi.advanceTimersByTime(299);
		type('# b\n');
		vi.advanceTimersByTime(299);
		expect(client.requests).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(client.requests).toHaveLength(2);
		const r = client.lastRequest;
		expect(r).toEqual({
			files: { 'plan.tjp': `# b\n# a\n${PLAN}` },
			entry: 'plan.tjp',
			revision: 2,
		});
		expect('options' in r).toBe(false);
	});

	it('schedules format and intent edits at once, replacing a waiting debounce', () => {
		start({ runAtStart: false });
		expect(runner.state.status).toBe('idle');
		type('# a\n');
		apply('format', '  effort 1d', '\teffort 1d');
		expect(client.requests.map((r) => r.revision)).toEqual([1]);
		expect(client.lastRequest.files['plan.tjp']).toContain('\teffort 1d');
		vi.advanceTimersByTime(1000);
		expect(client.requests).toHaveLength(1);
		apply('setAttr', 'effort 2d', 'effort 3d');
		expect(client.requests).toHaveLength(2);
	});

	it('honours debounceMs and sends a version only once while it is open', () => {
		start({ debounceMs: 50 });
		runner.changed('now');
		expect(client.requests).toHaveLength(1);
		type('# a\n');
		vi.advanceTimersByTime(50);
		expect(client.requests).toHaveLength(2);
		runner.changed('typing');
		vi.advanceTimersByTime(50);
		expect(client.requests).toHaveLength(2);
	});

	it('continues the revisions of an earlier runner on the same client', async () => {
		start();
		client.done(1);
		await flush();
		runner.dispose();
		start();
		expect(client.requests.map((r) => r.revision)).toEqual([1, 2]);
	});

	it('reports a refused request as a failure', async () => {
		start({ runAtStart: false });
		// Someone else used a higher revision on this client.
		client.schedule({ files: {}, entry: 'x.tjp', revision: 99 }).catch(() => {});
		runner.changed('now');
		await flush();
		expect(runner.state.status).toBe('failed');
		expect(runner.state.failure?.error.kind).toBe('invalid-request');
	});
});

describe('results', () => {
	it('publishes diagnostics, counts, hints, finish and timings', async () => {
		start();
		client.done(1, { ok: false, tasks: TASKS, messages: [message('error', 7, 'Bad effort')] });
		await flush();
		const s = runner.state;
		expect(s).toMatchObject({ status: 'errors', pending: false, outdated: false, version: 0 });
		expect(s.latest).toMatchObject({ revision: 1, workspaceVersion: 0, latest: true });
		expect(s.lastGood).toBeNull();
		expect(s.counts).toEqual({ errors: 1, warnings: 0, infos: 0 });
		const [d] = s.diagnostics;
		expect(d).toMatchObject({ source: 'engine', line: 7, revision: 1, stale: false });
		expect(textOf(d ?? { from: 0, to: 0 })).toBe('effort 2d');
		expect(s.hints.tasks.map((h) => [h.id, h.line])).toEqual([
			['t1', 3],
			['b', 6],
		]);
		expect(s.index.tasks.get('t1')?.idSource).toBe('engine');
		expect(s.finish).toBeNull();
		expect(s.timings?.engine.totalMs).toBe(7);
		expect(s.timings?.roundTripMs).toBeGreaterThanOrEqual(0);
	});

	it('publishes the finish of a good result with the delta against the previous one', async () => {
		start();
		client.done(1, { tasks: TASKS });
		await flush();
		expect(runner.state).toMatchObject({ status: 'ok', outdated: false });
		expect(runner.state.finish).toMatchObject({
			minutes: 1500,
			date: '2026-01-06T01:00:00Z',
			delta: null,
			revision: 1,
		});
		apply('setAttr', 'effort 2d', 'effort 3d');
		client.done(2, { tasks: [task('t1', 3, 600), task('b', 6, 1980)] });
		await flush();
		expect(runner.state.finish).toMatchObject({ minutes: 1980, delta: 480, revision: 2 });
	});

	it('keeps the last good run on errors and failures, and marks it outdated', async () => {
		start();
		client.done(1, { tasks: TASKS });
		await flush();
		const good = runner.state.lastGood;
		apply('setAttr', 'effort 2d', 'effort x');
		client.done(2, { ok: false, messages: [message('error', 7)] });
		await flush();
		expect(runner.state).toMatchObject({ status: 'errors', outdated: true, lastGood: good });
		expect(runner.state.finish?.revision).toBe(1);
		expect(runner.state.latest?.revision).toBe(2);
		// Parsing stopped, so the result names no ids: the hints of run 1 stay.
		expect(runner.state.index.tasks.get('t1')?.idSource).toBe('engine');
		apply('setAttr', 'effort x', 'effort 2d');
		client.fail(3, { kind: 'timeout', message: 'slow' });
		await flush();
		expect(runner.state).toMatchObject({ status: 'failed', outdated: true, lastGood: good });
		expect(runner.state.failure).toEqual({
			revision: 3,
			error: { kind: 'timeout', message: 'slow' },
		});
	});
});

describe('latest-wins interplay', () => {
	it('shows a result that arrives with latest false but stays scheduling', async () => {
		start();
		type('# a\n');
		vi.advanceTimersByTime(300);
		expect(client.open).toEqual([1, 2]);
		client.done(1, { tasks: TASKS, messages: [message('warning', 7)] });
		await flush();
		expect(runner.state).toMatchObject({ status: 'scheduling', pending: true });
		expect(runner.state.latest).toMatchObject({ revision: 1, latest: false });
		expect(runner.state.lastGood?.revision).toBe(1);
		expect(runner.state.diagnostics.map((d) => [d.line, d.stale])).toEqual([[8, true]]);
		client.done(2, { tasks: [task('t1', 4, 600), task('b', 7, 1500)] });
		await flush();
		expect(runner.state).toMatchObject({ status: 'ok', pending: false });
		expect(runner.state.diagnostics).toEqual([]);
	});

	it('ignores superseded runs and outcomes older than a handled result', async () => {
		start();
		type('# a\n');
		vi.advanceTimersByTime(300);
		type('# b\n');
		vi.advanceTimersByTime(300);
		client.supersede(2, 3);
		await flush();
		expect(runner.state.status).toBe('scheduling');
		client.done(3, { tasks: TASKS });
		await flush();
		client.done(1, { ok: false, messages: [message('error', 1)] });
		await flush();
		expect(runner.state.latest?.revision).toBe(3);
		expect(runner.state.status).toBe('ok');
	});

	it('stays scheduling when typing continues after the newest result', async () => {
		start();
		type('# a\n');
		client.done(1, { tasks: TASKS });
		await flush();
		expect(runner.state).toMatchObject({ status: 'scheduling', pending: true });
		vi.advanceTimersByTime(300);
		client.done(2, { tasks: TASKS });
		await flush();
		expect(runner.state.status).toBe('ok');
	});
});

describe('mapping through later edits', () => {
	it('maps engine diagnostics as stale until the next result replaces them', async () => {
		start();
		client.done(1, { ok: false, tasks: TASKS, messages: [message('error', 7)] });
		await flush();
		type('# new first line\n');
		const [d] = runner.state.diagnostics;
		expect(d).toMatchObject({ line: 8, stale: true, revision: 1 });
		expect(textOf(d ?? { from: 0, to: 0 })).toBe('effort 2d');
		expect(runner.state.status).toBe('scheduling');
		vi.advanceTimersByTime(300);
		client.done(2, { tasks: [task('t1', 4, 600), task('b', 7, 1500)] });
		await flush();
		expect(runner.state.diagnostics).toEqual([]);
	});

	it('places diagnostics in the sent text when edits happen during the run', async () => {
		start();
		type('# during the run\n');
		client.done(1, { ok: false, tasks: TASKS, messages: [message('error', 7)] });
		await flush();
		const [d] = runner.state.diagnostics;
		expect(d).toMatchObject({ line: 8, stale: true });
		expect(textOf(d ?? { from: 0, to: 0 })).toBe('effort 2d');
	});

	it('applies hints to untouched lines only, shifted by the edits since the run', async () => {
		start();
		client.done(1, { tasks: TASKS });
		await flush();
		type('# shift\n');
		expect(runner.state.hints.tasks.map((h) => [h.id, h.line])).toEqual([
			['t1', 4],
			['b', 7],
		]);
		expect(runner.state.index.tasks.get('t1')?.idSource).toBe('engine');
		// Enter at the end of the header line leaves the header as it was.
		type('\n  # note', { after: '"Macro task" {' });
		expect(runner.state.index.tasks.get('t1')?.idSource).toBe('engine');
		type(' renamed', { after: '"Macro task' });
		expect(runner.state.hints.tasks.map((h) => h.id)).toEqual(['b']);
		expect(runner.state.index.tasks.has('t1')).toBe(false);
		expect(runner.state.index.unresolved.length).toBeGreaterThan(0);
	});

	it('includes local syntax diagnostics at once, before any result', () => {
		start();
		type('task c "C" {\n', { line: 9 });
		expect(runner.state.counts.errors).toBeGreaterThan(0);
		expect(runner.state.diagnostics.every((d) => d.source !== 'engine')).toBe(true);
	});
});
