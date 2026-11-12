// SPDX-License-Identifier: GPL-2.0-or-later
// Zone-dependent refusals of the project intents through the app's path: the index the schedule
// runner builds with the engine's time-zone data (`ScheduleRunnerOptions.zones`, phase-1.md
// 15.21), which revalidate.ts reads its zones from. Without zone data the same edits go through
// unchecked, which is why the app must pass them.
import { afterEach, describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/timezone';
import { createScheduleRunner, type ScheduleRunner } from '../../workspace/schedule-runner';
import { FakeEngineClient } from '../../workspace/testing/fake-engine-client';
import { createWorkspace } from '../../workspace/workspace';
import { applyIntent } from './apply';
import type { EditIntent, EditResult } from './types';

const PLAN = [
	'project p "P" 2026-01-05 +2m {',
	'  timezone "UTC"',
	'  timingresolution 30min',
	'}',
	'resource a "A"',
	'task t "T" { start 2026-01-06-09:30 effort 1d allocate a }',
	'',
].join('\n');

let runner: ScheduleRunner | null = null;
afterEach(() => {
	runner?.dispose();
	runner = null;
});

/** Applies `intent` with the index of a runner made with or without zone data. */
function viaRunner(text: string, intent: EditIntent, withZones: boolean): EditResult {
	runner?.dispose();
	const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': text } });
	runner = createScheduleRunner({
		workspace: ws,
		client: new FakeEngineClient(),
		...(withZones ? { zones: createTimeZoneHost() } : {}),
	});
	const snap = ws.snapshot();
	expect(runner.state.index.isFor(snap)).toBe(true);
	return applyIntent(snap, runner.state.index, intent);
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

const zone = (value: string): EditIntent => ({ type: 'setProjectAttr', attr: 'timezone', value });

describe('project intents through the runner index', () => {
	it('refuses a zone that caps the timing resolution below the plan (Kathmandu)', () => {
		const k = zone('"Asia/Kathmandu"');
		expect(status(viaRunner(PLAN, k, true))).toBe('refused:invalid-value');
		expect(status(viaRunner(PLAN, k, false))).toBe('edit');
	});

	it('refuses a zone that misaligns a written date with the timing resolution', () => {
		const hourly = PLAN.replace('timingresolution 30min', 'timingresolution 60min').replace(
			'09:30',
			'09:00',
		);
		const kolkata = zone('"Asia/Kolkata"');
		expect(status(viaRunner(hourly, kolkata, true))).toBe('refused:invalid-value');
		expect(status(viaRunner(hourly, zone('"Europe/Berlin"'), true))).toBe('edit');
	});

	it('refuses a zone the zone data does not know (bad_time_zone)', () => {
		expect(status(viaRunner(PLAN, zone('"Mars/Olympus"'), true))).toBe('refused:invalid-value');
		expect(status(viaRunner(PLAN, zone('"Europe/Berlin"'), true))).toBe('edit');
	});
});
