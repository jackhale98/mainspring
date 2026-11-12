// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../strings';
import { createScheduleRunner, type ScheduleRunner } from '../workspace/schedule-runner';
import { FakeEngineClient, flush, message, task } from '../workspace/testing/fake-engine-client';
import { PLAN, TASKS, typeInto } from '../workspace/testing/runner-fixture';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { formatDelta, formatSpan, statusView } from './status';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	client = new FakeEngineClient();
	runner = createScheduleRunner({ workspace: ws, client });
});

afterEach(() => {
	runner.dispose();
	vi.useRealTimers();
});

describe('formatSpan and formatDelta', () => {
	it('picks days, hours or minutes', () => {
		expect(formatSpan(3 * 24 * 60, 'en')).toBe('3 days');
		expect(formatSpan(-90, 'en')).toBe('1.5 hours');
		expect(formatSpan(20, 'en')).toBe('20 minutes');
		expect(formatSpan(36 * 60, 'en')).toBe('1.5 days');
	});

	it('says later or earlier, and nothing for no change', () => {
		expect(formatDelta(1440, 'en')).toBe('1 day later');
		expect(formatDelta(-120, 'en')).toBe('2 hours earlier');
		expect(formatDelta(0, 'en')).toBeNull();
		expect(formatDelta(null, 'en')).toBeNull();
	});
});

describe('statusView', () => {
	it('shows the engine start before the first result', () => {
		client.setState('booting');
		expect(statusView(runner.state, 'en')).toMatchObject({
			kind: 'booting',
			label: strings.status.engineStarting,
			finish: null,
			failure: null,
		});
	});

	it('shows the finish date in the project zone and the change since the last good run', async () => {
		client.done(1, { tasks: TASKS });
		await flush();
		const first = statusView(runner.state, 'en');
		expect(first).toMatchObject({ kind: 'ok', label: strings.status.ok, outdated: false });
		expect(first.zone).toBe('UTC');
		expect(first.finish).toMatch(/2026/);
		expect(first.delta).toBeNull();

		typeInto(ws, '# edit\n');
		vi.advanceTimersByTime(300);
		client.done(2, { tasks: [task('t1', 4, 600), task('b', 7, 1500 + 24 * 60)] });
		await flush();
		expect(statusView(runner.state, 'en').delta).toBe('1 day later');
	});

	it('keeps the last good finish, marked outdated, when a run has errors', async () => {
		client.done(1, { tasks: TASKS });
		await flush();
		const good = statusView(runner.state, 'en').finish;
		typeInto(ws, '# edit\n');
		vi.advanceTimersByTime(300);
		client.done(2, { ok: false, tasks: [], messages: [message('error', 3, 'broken')] });
		await flush();
		const v = statusView(runner.state, 'en');
		expect(v).toMatchObject({
			kind: 'errors',
			label: strings.status.notScheduled,
			outdated: true,
			finish: good,
			errors: 1,
		});
		expect(v.counts).toBe('1 error');
	});

	it('explains a failed run by its kind', async () => {
		client.done(1, { tasks: TASKS });
		await flush();
		typeInto(ws, '# edit\n');
		vi.advanceTimersByTime(300);
		client.fail(2, { kind: 'timeout', message: 'slow' });
		await flush();
		expect(statusView(runner.state, 'en')).toMatchObject({
			kind: 'failed',
			failure: strings.engine.failure.timeout,
			outdated: true,
		});
	});

	it('lists messages without a place apart', async () => {
		client.done(1, {
			tasks: TASKS,
			messages: [{ ...message('warning', null, 'No place'), file: null }],
		});
		await flush();
		const v = statusView(runner.state, 'en');
		expect(v.unlocated.map((d) => d.message)).toContain('No place');
		expect(v.warnings).toBe(1);
		expect(v.counts).toBe('1 warning');
	});

	it('says "Scheduled with problems" when the run produced a schedule that has errors', async () => {
		client.done(1, { tasks: TASKS, messages: [message('error', 3, 'odd')] });
		await flush();
		expect(statusView(runner.state, 'en')).toMatchObject({
			kind: 'errors',
			label: strings.status.errors,
		});
	});
});
