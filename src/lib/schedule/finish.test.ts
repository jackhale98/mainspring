// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult, TaskResult } from '../../engine/protocol';
import { result, task } from '../workspace/testing/fake-engine-client';
import {
	finishDelta,
	finishMinutes,
	finishOf,
	finishScenario,
	formatFinish,
	isoAt,
	type Finish,
} from './finish';

/** A golden's result; goldens hold no revision, so this sets one. */
function golden(id: string, revision = 7): ScheduleResult {
	const file = path.join(ROOT, 'engine/golden/expected', `${id}.json`);
	const r = (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result;
	return { ...r, revision };
}

/** A task with results in two scenarios. */
function twoScenarios(id: string, planEnd: number, delayedEnd: number): TaskResult {
	const t = task(id, 1, planEnd);
	const plan = t.scenarios['plan'];
	if (!plan) throw new Error('no plan scenario');
	return { ...t, scenarios: { plan, delayed: { ...plan, end: delayedEnd } } };
}

describe('finishScenario', () => {
	it('is the first active scenario in declaration pre-order', () => {
		const base = result(1);
		const project = base.project;
		if (!project) throw new Error('no project');
		const scenarios = [
			{ id: 'plan', name: 'Plan', parent: null, active: false },
			{ id: 'delayed', name: 'Delayed', parent: 'plan', active: true },
			{ id: 'worst', name: 'Worst', parent: 'plan', active: true },
		];
		expect(finishScenario(result(1, { project: { ...project, scenarios } }))).toBe('delayed');
		expect(finishScenario(golden('syn-05-scenarios-tree'))).toBe('plan');
		expect(finishScenario(result(1, { project: null }))).toBeNull();
	});
});

describe('finishMinutes', () => {
	it('is the latest end over scheduled tasks of that scenario', () => {
		const tasks = [
			task('a', 1, 600),
			task('b', 2, 2400, { scheduled: false }),
			task('c', 3, null),
			twoScenarios('d', 900, 9000),
			{ ...task('e', 4, 0), scenarios: {} },
		];
		expect(finishMinutes(result(1, { tasks }))).toBe(900);
	});

	it('is null without a project or a scheduled task', () => {
		expect(finishMinutes(result(1))).toBeNull();
		expect(finishMinutes(result(1, { project: null, tasks: [task('a', 1, 60)] }))).toBeNull();
		expect(finishMinutes(result(1, { tasks: [task('a', 1, 60, { scheduled: false })] }))).toBeNull();
	});

	it('reads the goldens', () => {
		expect(finishMinutes(golden('upstream-tutorial'))).toBe(133_260);
		expect(finishMinutes(golden('upstream-fedora-20'))).toBe(308_040);
		expect(finishMinutes(golden('bridge-parse-failure'))).toBeNull();
	});
});

describe('finishOf', () => {
	it('gives the ISO instant for display, the scenario and the time zone', () => {
		const f = finishOf(golden('upstream-fedora-20'));
		expect(f).toEqual({
			minutes: 308_040,
			date: '2013-11-29T22:00:00Z',
			scenario: 'plan',
			projectStart: '2013-04-30T00:00:00Z',
			timezone: 'America/New_York',
			delta: null,
			revision: 7,
		});
	});

	it('gives the delta against the previous finish, as instants', () => {
		const a = finishOf(result(1, { tasks: [task('a', 1, 600)] }));
		const b = finishOf(result(2, { tasks: [task('a', 1, 1080)] }), a);
		expect(b?.delta).toBe(480);
		const project = result(3).project;
		if (!project || !b) throw new Error('setup');
		// The start moved a day later and the finish stayed at the same instant.
		const moved = finishOf(
			result(3, {
				project: { ...project, start: '2026-01-06T00:00:00Z' },
				tasks: [task('a', 1, 1080 - 1440)],
			}),
			b,
		);
		expect(moved?.date).toBe(b.date);
		expect(moved?.delta).toBe(0);
		expect(finishOf(result(4), b)).toBeNull();
	});

	it('isoAt and finishDelta agree with Date arithmetic', () => {
		expect(isoAt('2026-01-05T00:00:00Z', 90)).toBe('2026-01-05T01:30:00Z');
		const f = (minutes: number, projectStart: string): Finish => ({
			minutes,
			date: isoAt(projectStart, minutes),
			scenario: 'plan',
			projectStart,
			timezone: null,
			delta: null,
			revision: 1,
		});
		expect(finishDelta(f(60, '2026-01-05T00:00:00Z'), f(0, '2026-01-05T02:00:00Z'))).toBe(60);
	});
});

describe('formatFinish', () => {
	const fedora = finishOf(golden('upstream-fedora-20'));
	if (!fedora) throw new Error('no finish');

	it('formats in the project time zone with Intl', () => {
		const opts: Intl.DateTimeFormatOptions = {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		};
		expect(formatFinish(fedora, 'en-GB', opts)).toBe('29/11/2013, 17:00');
		expect(formatFinish({ ...fedora, timezone: null }, 'en-GB', opts)).toBe('29/11/2013, 22:00');
		expect(formatFinish({ ...fedora, timezone: 'Not/AZone' }, 'en-GB', opts)).toBe(
			'29/11/2013, 22:00',
		);
		expect(formatFinish(fedora, ['en-US'])).toMatch(/2013/);
	});
});
