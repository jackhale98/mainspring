// SPDX-License-Identifier: GPL-2.0-or-later
// Schedule runner (phase-1.md 6.8) against a fake EngineClient with fake timers: debounce and
// immediate runs, latest-wins interplay, stale mapping, hints on untouched lines only, lastGood
// on errors, failures and restarts. Latest-wins through the real client is in
// schedule-runner.client.test.ts, the real engine in schedule-runner.engine.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeSetOf } from '../tjp/document';
import { createScheduleRunner, type ScheduleRunner } from './schedule-runner';
import { FakeEngineClient, flush, message, task } from './testing/fake-engine-client';
import { createWorkspace, type Workspace } from './workspace';

const PLAN = [
	'macro tid [t1]', // 1
	'project p "P" 2026-01-05 +1m', // 2
	'task ${tid} "Macro task" {', // 3
	'  effort 1d', // 4
	'}', // 5
	'task b "B" {', // 6
	'  effort 2d', // 7
	'}', // 8
	'',
].join('\n');

const TASKS = [task('t1', 3, 600), task('b', 6, 1500)];

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;

function start(opts: { debounceMs?: number; runAtStart?: boolean } = {}): void {
	runner = createScheduleRunner({ workspace: ws, client, ...opts });
}

/** Types `insert` into plan.tjp: at an offset, the start of a line, or right after some text. */
function type(insert: string, at: number | { line: number } | { after: string } = 0): void {
	const state = ws.state('plan.tjp');
	const pos =
		typeof at === 'number'
			? at
			: 'line' in at
				? state.doc.line(at.line).from
				: state.doc.toString().indexOf(at.after) + at.after.length;
	ws.commit('plan.tjp', state.update({ changes: { from: pos, insert } }), 'typing');
}

/** Applies a one-change edit with the given intent type ('format' gives origin 'format'). */
function apply(intent: string, find: string, insert: string): void {
	const file = ws.snapshot().files.get('plan.tjp');
	if (!file) throw new Error('no plan.tjp');
	const from = file.text.toString().indexOf(find);
	const changes = changeSetOf({ from, to: from + find.length, insert }, file.text.length);
	const r = ws.apply({
		id: `e-${intent}`,
		intent: { type: intent },
		base: { 'plan.tjp': file.version },
		changes: { 'plan.tjp': changes },
	});
	expect(r).toBe('applied');
}

const textOf = (d: { from: number; to: number }): string =>
	ws.snapshot().files.get('plan.tjp')?.text.sliceString(d.from, d.to) ?? '';

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
		expect(r).toEqual({ files: { 'plan.tjp': `# b\n# a\n${PLAN}` }, entry: 'plan.tjp', revision: 2 });
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
		expect(runner.state.failure).toEqual({ revision: 3, error: { kind: 'timeout', message: 'slow' } });
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

	it('publishes once per change and rethrows listener errors after every listener ran', async () => {
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
