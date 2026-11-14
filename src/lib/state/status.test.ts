// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../strings';
import type { StatusKind } from './status';
import { createScheduleRunner, type ScheduleRunner } from '../workspace/schedule-runner';
import {
	FakeEngineClient,
	TIMINGS,
	flush,
	message,
	task,
} from '../workspace/testing/fake-engine-client';
import { IdleQueue } from '../workspace/testing/idle-queue';
import { PLAN, TASKS, typeInto } from '../workspace/testing/runner-fixture';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { formatDelta, formatMs, formatSpan, statusGlyph, statusView } from './status';

let ws: Workspace;
let client: FakeEngineClient;
let runner: ScheduleRunner;
let idleTasks: IdleQueue;

/** Delivers settled outcomes, then runs the runner's idle tasks that show them. */
async function shown(): Promise<void> {
	await flush();
	idleTasks.run();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
	client = new FakeEngineClient();
	idleTasks = new IdleQueue();
	runner = createScheduleRunner({ workspace: ws, client, timers: idleTasks.timers });
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
		await shown();
		const first = statusView(runner.state, 'en');
		expect(first).toMatchObject({ kind: 'ok', label: strings.status.ok, outdated: false });
		expect(first.zone).toBe('UTC');
		expect(first.finish).toMatch(/2026/);
		expect(first.delta).toBeNull();

		typeInto(ws, '# edit\n');
		vi.advanceTimersByTime(300);
		client.done(2, { tasks: [task('t1', 4, 600), task('b', 7, 1500 + 24 * 60)] });
		await shown();
		expect(statusView(runner.state, 'en').delta).toBe('1 day later');
	});

	it('keeps the last good finish, marked outdated, when a run has errors', async () => {
		client.done(1, { tasks: TASKS });
		await shown();
		const good = statusView(runner.state, 'en').finish;
		typeInto(ws, '# edit\n');
		vi.advanceTimersByTime(300);
		client.done(2, { ok: false, tasks: [], messages: [message('error', 3, 'broken')] });
		await shown();
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
		await shown();
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
		await shown();
		const v = statusView(runner.state, 'en');
		expect(v.unlocated.map((d) => d.message)).toContain('No place');
		expect(v.warnings).toBe(1);
		expect(v.counts).toBe('1 warning');
	});

	it('says "Scheduled with problems" when the run produced a schedule that has errors', async () => {
		client.done(1, { tasks: TASKS, messages: [message('error', 3, 'odd')] });
		await shown();
		expect(statusView(runner.state, 'en')).toMatchObject({
			kind: 'errors',
			label: strings.status.errors,
		});
	});
});

describe('formatMs', () => {
	it('writes a time for reading: a decimal below 10 ms, whole ms, then seconds', () => {
		expect(formatMs(0.42, 'en')).toBe('0.4 ms');
		expect(formatMs(7, 'en')).toBe('7 ms');
		expect(formatMs(182.4, 'en')).toBe('182 ms');
		expect(formatMs(1234, 'en')).toBe('1.2 s');
		expect(formatMs(-3, 'en')).toBe('0 ms');
	});
});

describe('statusView engine info', () => {
	const versions = {
		tj: '3.8.4' as const,
		tjCommit: '3b36c799605621103d7d065c69e3f958a3dd6698',
		rubyWasm: '2.10.1',
		bundleHash: '32a71b8ca68e0123',
	};

	it('has nothing to say before a run and before the engine has booted', () => {
		expect(statusView(runner.state, 'en').engine).toBeNull();
	});

	it('names the version as soon as the engine has booted, before any timing', () => {
		const info = statusView(runner.state, 'en', versions).engine;
		expect(info?.version).toBe('TaskJuggler 3.8.4');
		expect(info?.last).toBeNull();
		expect(info?.timings).toEqual([]);
		expect(info?.note).toBeNull();
		expect(info?.versions.map((l) => l.value)).toEqual([
			'3.8.4',
			'3b36c79',
			'2.10.1',
			'32a71b8ca68e',
		]);
	});

	it('shows the last run: the engine total, then each stage in pipeline order', async () => {
		client.done(1, { tasks: TASKS });
		await shown();
		const info = statusView(runner.state, 'en', versions).engine;
		expect(info?.last).toBe(`${TIMINGS.totalMs} ms`);
		const labels = info?.timings.map((l) => l.label);
		expect(labels).toEqual([
			strings.status.timing.engine,
			strings.status.timing.writeFs,
			strings.status.timing.parse,
			strings.status.timing.schedule,
			strings.status.timing.serialize,
			strings.status.timing.roundTrip,
			strings.status.timing.process,
		]);
		expect(info?.timings[2]?.value).toBe(`${TIMINGS.parseMs} ms`);
	});

	it('says honestly that the round trip is waiting as well as scheduling, and the first run includes start-up', async () => {
		client.done(1, { tasks: TASKS });
		await shown();
		const info = statusView(runner.state, 'en', versions).engine;
		const round = info?.timings.find((l) => l.label === strings.status.timing.roundTrip);
		expect(round?.label).toBe('Waiting and round trip');
		expect(info?.note).toMatch(/queueing included/);
		expect(info?.note).toMatch(/first run also includes the scheduler starting up/);
	});
});

describe('statusGlyph (the phone status button)', () => {
	const v = (kind: StatusKind, errors = 0, warnings = 0, failure: string | null = null) => ({
		kind,
		errors,
		warnings,
		failure,
	});

	it('ticks while the scheduler starts or works, and before there is a status', () => {
		expect(statusGlyph(null)).toBe('busy');
		expect(statusGlyph(v('booting'))).toBe('busy');
		expect(statusGlyph(v('idle'))).toBe('busy');
		expect(statusGlyph(v('scheduling', 2, 1))).toBe('busy');
	});

	it('is a circle when scheduled with no problems, a triangle with warnings only', () => {
		expect(statusGlyph(v('ok'))).toBe('ok');
		expect(statusGlyph(v('ok', 0, 3))).toBe('warning');
	});

	it('is a diamond for errors and for a failed scheduler, which outranks a run under way', () => {
		expect(statusGlyph(v('errors', 1, 0))).toBe('error');
		expect(statusGlyph(v('errors', 1, 4))).toBe('error');
		expect(statusGlyph(v('failed', 0, 0, 'The scheduler stopped.'))).toBe('error');
		expect(statusGlyph(v('scheduling', 0, 0, 'The scheduler stopped.'))).toBe('error');
	});
});
