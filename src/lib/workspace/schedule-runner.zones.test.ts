// SPDX-License-Identifier: GPL-2.0-or-later
// The runner's `zones` option (phase-1.md 6.8, 15.21): the index it builds knows time-zone data,
// so zone names and zone-dependent value checks are made instead of skipped as uncheckable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimeZoneHost } from '../../engine/timezone';
import { createScheduleRunner, type ScheduleRunner } from './schedule-runner';
import { FakeEngineClient, flush } from './testing/fake-engine-client';
import { typeInto } from './testing/runner-fixture';
import { createWorkspace } from './workspace';

const KATHMANDU = [
	'project p "P" 2026-01-05 +1m {',
	'  timezone "Asia/Kathmandu"',
	'  timingresolution 30min',
	'}',
	'task t "T" { effort 1d }',
	'',
].join('\n');

const UNKNOWN_ZONE = KATHMANDU.replace('Asia/Kathmandu', 'Mars/Olympus').replace(
	'  timingresolution 30min\n',
	'',
);

let runner: ScheduleRunner | null = null;
afterEach(() => {
	runner?.dispose();
	runner = null;
	vi.useRealTimers();
});

function start(text: string, withZones: boolean): ScheduleRunner {
	const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': text } });
	const client = new FakeEngineClient();
	runner = createScheduleRunner({
		workspace: ws,
		client,
		...(withZones ? { zones: createTimeZoneHost() } : {}),
	});
	return runner;
}

const local = (r: ScheduleRunner) => r.state.diagnostics.filter((d) => d.source === 'value');

describe('ScheduleRunner zones option', () => {
	it('checks a timing resolution against the zone when it has zone data', () => {
		const withZones = start(KATHMANDU, true);
		const found = local(withZones);
		expect(found.length).toBeGreaterThan(0);
		expect(found.every((d) => d.severity === 'error')).toBe(true);
		runner?.dispose();
		// The same plan without zone data: the check is skipped as uncheckable.
		expect(local(start(KATHMANDU, false))).toEqual([]);
	});

	it('knows which zone names exist', () => {
		expect(local(start(UNKNOWN_ZONE, true)).map((d) => d.messageId)).toContain('bad_time_zone');
		runner?.dispose();
		expect(local(start(UNKNOWN_ZONE, false))).toEqual([]);
	});

	it('keeps the zone data after edits and results (every rebuild of the index)', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': KATHMANDU } });
		const client = new FakeEngineClient();
		runner = createScheduleRunner({ workspace: ws, client, zones: createTimeZoneHost() });
		typeInto(ws, '# edit\n');
		vi.advanceTimersByTime(300);
		client.done(1, {});
		await flush();
		vi.advanceTimersByTime(300);
		expect(local(runner).length).toBeGreaterThan(0);
	});
});
