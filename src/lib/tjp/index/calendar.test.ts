// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import { checkValue, parseValue, utcSeconds } from '../values';
import { buildIndex } from './index';
import { inline } from './testing';

const text = [
	'project p "P" 2026-01-05 +2m {',
	'  timingresolution 30min',
	'  dailyworkinghours 6',
	'  yearlyworkingdays 200',
	'  workinghours mon-fri 9:00-13:00',
	'  timezone "Europe/Berlin"',
	'  scenario plan "Plan" { scenario late "Late" }',
	'}',
	'task a "A" {',
	'  start 2026-01-05-09:30',
	'}',
	'',
].join('\n');

describe('contextAt', () => {
	const idx = buildIndex(inline({ 'plan.tjp': text }).snapshot(), undefined, {
		cache: null,
		zones: createTimeZoneHost(),
	});
	const at = (needle: string) => idx.contextAt('plan.tjp', text.indexOf(needle));

	it('applies settings in reading order', () => {
		const before = at('timingresolution');
		expect(before.granularity).toBe(3600);
		expect(before.start).toBe(
			utcSeconds({ year: 2026, month: 1, day: 5, hour: 0, minute: 0, second: 0 }),
		);
		const inBody = at('dailyworkinghours');
		expect(inBody.granularity).toBe(1800);
		expect(inBody.dailyWorkingHours.value).toBe(8);
		const late = at('task a');
		expect(late.dailyWorkingHours).toEqual({ value: 6, float: false });
		expect(late.yearlyWorkingDays).toEqual({ value: 200, float: false });
		expect(late.weeklyWorkingHours).toBe(20);
		expect(late.zone).toBe('Europe/Berlin');
		expect(late.scenarios).toEqual(['plan', 'late']);
		expect(at('timezone').zone).toBeNull();
	});

	it('feeds checkValue: 9:30 is aligned to 30 min, 9:15 is not', () => {
		const ctx = at('start');
		const ok = parseValue('date', '2026-01-05-09:30');
		const bad = parseValue('date', '2026-01-05-09:15');
		if (!ok.ok || !bad.ok) throw new Error('parse');
		expect(checkValue('start', ok.value, ctx).ok).toBe(true);
		expect(checkValue('start', bad.value, ctx).ok).toBe(false);
	});

	it('lists project working hours and the project attributes', () => {
		expect(idx.workingHours.map((w) => w.scope)).toEqual([{ kind: 'project' }]);
		expect(idx.project?.attrs.map((a) => a.keyword)).toEqual([
			'timingresolution',
			'dailyworkinghours',
			'yearlyworkingdays',
			'workinghours',
			'timezone',
		]);
		expect(idx.scenarios.map((s) => [s.id, s.parent])).toEqual([
			['plan', null],
			['late', 'plan'],
		]);
	});

	it('gives the default context in a file the entry does not read', () => {
		const ws = inline({ 'plan.tjp': text, 'other.tji': 'task x "X"\n' });
		const i2 = buildIndex(ws.snapshot(), undefined, { cache: null });
		expect(i2.contextAt('other.tji', 0).granularity).toBe(3600);
		expect(i2.contextAt('other.tji', 0).start).toBeNull();
	});

	it('reads settings from files included in the header, at their site', () => {
		const ws = inline({
			'plan.tjp': 'project p "P" 2026-01-05 +2m {\n  include "set.tji"\n}\ntask a "A"\n',
			'set.tji': 'timingresolution 15min\n',
		});
		const i2 = buildIndex(ws.snapshot(), undefined, { cache: null });
		expect(i2.contextAt('plan.tjp', 60).granularity).toBe(900);
		expect(i2.contextAt('plan.tjp', 0).granularity).toBe(3600);
	});
});
