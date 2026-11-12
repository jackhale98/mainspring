// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import { createWorkspace } from '../../workspace/workspace';
import { buildIndex } from '../index';
import { applyIntent } from './apply';
import { removeProjectAttr, setProjectAttr, setProjectHeader } from './settings';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const zones = createTimeZoneHost();

/** An edit on a one-file plan, with time-zone data in the index (as the engine has it). */
function run(text: string, intent: EditIntent): { r: EditResult; text: string | undefined } {
	const snap = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': text } }).snapshot();
	const index = buildIndex(snap, undefined, { cache: null, zones });
	const r = applyIntent(snap, index, intent);
	return { r, text: r.status === 'edit' ? textsAfter(snap, r)['plan.tjp'] : undefined };
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

const plan = (body: string, task = 'start 2026-02-02-09:00'): string =>
	`project p "P" 2026-02-02 - 2026-03-27 {\n${body}}\nresource raj "Raj"\n` +
	`task s "S" {\n  ${task}\n  effort 3d\n  allocate raj\n}\n`;

describe('setProjectHeader', () => {
	it('rewrites the name and the interval tokens, keeping spellings', () => {
		const t = plan('');
		expect(run(t, { type: 'setProjectHeader', name: 'Q' }).text).toContain(
			'project p "Q" 2026-02-02 - 2026-03-27 {',
		);
		expect(run(t, { type: 'setProjectHeader', end: '2026-04-30' }).text).toContain(
			'2026-02-02 - 2026-04-30 {',
		);
		expect(run(t, { type: 'setProjectHeader', start: '2026-02-01', end: '+2m' }).text).toContain(
			'project p "P" 2026-02-01 +2m {',
		);
		expect(status(run(t, { type: 'setProjectHeader', start: '2026-02-02', name: 'P' }).r)).toBe(
			'noop:already-set',
		);
	});

	it('keeps a duration end as a duration', () => {
		const t = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
		expect(run(t, { type: 'setProjectHeader', end: '2026-01-15' }).text).toContain(
			'2026-01-05 +10d\n',
		);
		expect(run(t, { type: 'setProjectHeader', end: '2026-01-05-12:00' }).text).toContain(
			'2026-01-05 +12h\n',
		);
		expect(run(t, { type: 'setProjectHeader', start: '2026-02-05' }).text).toContain(
			'2026-02-05 +2m\n',
		);
	});

	it('refuses an end before the start, unsafe names and a frame that loses dates', () => {
		const t = plan('');
		expect(status(run(t, { type: 'setProjectHeader', end: '2026-01-01' }).r)).toBe(
			'refused:invalid-value',
		);
		expect(status(run(t, { type: 'setProjectHeader', start: 'tomorrow' }).r)).toBe(
			'refused:invalid-value',
		);
		expect(status(run(t, { type: 'setProjectHeader', name: 'a${b}' }).r)).toBe(
			'refused:unsafe-text',
		);
		expect(run(t, { type: 'setProjectHeader', start: '2026-02-03' }).r).toMatchObject({
			status: 'refused',
			reason: 'invalid-value',
			at: [{ from: t.indexOf('2026-02-02-09:00') }],
		});
	});

	it('the wrapper builds the intent', () => {
		const s = setup(plan(''));
		expect(setProjectHeader(s.snap, s.index, { name: 'New' }).status).toBe('edit');
	});
});

describe('setProjectAttr', () => {
	it('inserts a time zone before the first ranked statement, and rewrites one', () => {
		expect(
			run(plan('  now 2026-02-16\n'), {
				type: 'setProjectAttr',
				attr: 'timezone',
				value: '"Europe/Berlin"',
			}).text,
		).toContain('{\n  timezone "Europe/Berlin"\n  now 2026-02-16\n}');
		expect(
			run(plan('  timezone "UTC"\n'), {
				type: 'setProjectAttr',
				attr: 'timezone',
				value: '"America/New_York"',
			}).text,
		).toContain('  timezone "America/New_York"\n');
		expect(
			run(plan('  workinghours mon 9:00 - 17:00\n'), {
				type: 'setProjectAttr',
				attr: 'timezone',
				value: '"UTC"',
			}).text,
		).toContain('{\n  timezone "UTC"\n  workinghours mon');
	});

	it('refuses unknown zones (bad_time_zone)', () => {
		expect(
			status(run(plan(''), { type: 'setProjectAttr', attr: 'timezone', value: '"Mars/Base"' }).r),
		).toBe('refused:invalid-value');
		expect(
			status(run(plan(''), { type: 'setProjectAttr', attr: 'timezone', value: '"CET"' }).r),
		).toBe('refused:invalid-value');
		expect(
			status(run(plan(''), { type: 'setProjectAttr', attr: 'timezone', value: 'Europe/Berlin' }).r),
		).toBe('refused:invalid-value');
	});

	it('re-checks the timing resolution cap and date alignment for the new zone (Kathmandu)', () => {
		const kolkata = plan(
			'  timezone "Asia/Kolkata"\n  now 2026-02-16-11:30\n  timingresolution 30min\n',
			'start 2026-02-02-11:30',
		);
		const r = run(kolkata, {
			type: 'setProjectAttr',
			attr: 'timezone',
			value: '"Asia/Kathmandu"',
		}).r;
		expect(r).toMatchObject({ status: 'refused', reason: 'invalid-value' });
		const at = r.status === 'refused' ? r.at.map((x) => kolkata.slice(x.from, x.to)) : [];
		expect(at).toEqual(['2026-02-16-11:30', '30min', '2026-02-02-11:30']);
		// A resolution read before the zone is not capped (TaskJuggler checks it where it stands).
		expect(
			status(
				run(plan('  timingresolution 15min\n'), {
					type: 'setProjectAttr',
					attr: 'timezone',
					value: '"Asia/Kathmandu"',
				}).r,
			),
		).toBe('edit');
		// The default 60 min resolution: 12:00 in Kathmandu is 06:15Z, not aligned.
		expect(
			status(
				run(plan('  now 2026-02-16-12:00\n', 'effort 1d'), {
					type: 'setProjectAttr',
					attr: 'timezone',
					value: '"Asia/Kathmandu"',
				}).r,
			),
		).toBe('refused:invalid-value');
	});

	it('checks now, daily working hours and the remaining string settings', () => {
		const t = plan('  now 2026-02-16\n');
		expect(
			run(t, { type: 'setProjectAttr', attr: 'now', value: '2026-02-17-10:00' }).text,
		).toContain('now 2026-02-17-10:00\n');
		expect(
			status(run(t, { type: 'setProjectAttr', attr: 'now', value: '2026-02-17-10:30' }).r),
		).toBe('refused:invalid-value');
		expect(
			status(run(t, { type: 'setProjectAttr', attr: 'dailyworkinghours', value: '0' }).r),
		).toBe('refused:invalid-value');
		expect(
			run(t, { type: 'setProjectAttr', attr: 'dailyworkinghours', value: '7.5' }).text,
		).toContain('  now 2026-02-16\n  dailyworkinghours 7.5\n');
		expect(run(t, { type: 'setProjectAttr', attr: 'currency', value: '"EUR"' }).text).toContain(
			'{\n  currency "EUR"\n  now 2026-02-16\n',
		);
		expect(
			run(t, { type: 'setProjectAttr', attr: 'timeformat', value: "'%Y-%m-%d %H:%M'" }).text,
		).toContain('{\n  timeformat "%Y-%m-%d %H:%M"\n');
	});

	it('writes weekstartsmonday as a flag', () => {
		const t = plan('  now 2026-02-16\n');
		expect(
			status(run(t, { type: 'setProjectAttr', attr: 'weekstartsmonday', value: true }).r),
		).toBe('noop:already-set');
		const sunday =
			run(t, { type: 'setProjectAttr', attr: 'weekstartsmonday', value: false }).text ?? '';
		expect(sunday).toContain('  now 2026-02-16\n  weekstartssunday\n');
		expect(
			run(sunday, { type: 'setProjectAttr', attr: 'weekstartsmonday', value: true }).text,
		).toContain('  now 2026-02-16\n  weekstartssunday\n  weekstartsmonday\n');
		const monday = plan('  weekstartsmonday\n  now 2026-02-16\n');
		expect(
			run(monday, { type: 'setProjectAttr', attr: 'weekstartsmonday', value: false }).text,
		).toContain('{\n  weekstartssunday\n  now 2026-02-16\n');
		expect(
			status(run(t, { type: 'setProjectAttr', attr: 'weekstartsmonday', value: 'yes' }).r),
		).toBe('refused:invalid-value');
	});

	it('opens a body for a header without one', () => {
		const t = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
		expect(run(t, { type: 'setProjectAttr', attr: 'now', value: '2026-01-06' }).text).toBe(
			'project p "P" 2026-01-05 +2m {\n  now 2026-01-06\n}\nresource r "R"\n',
		);
	});

	it('refuses project body macros that may set the attribute', () => {
		const t = 'project p "P" 2026-01-05 +2m {\n  ${zone}\n}\n';
		const m = 'macro zone [ timezone "UTC" ]\n';
		// The macro must be defined before the call; TaskJuggler reads it before the header here.
		const r = run(m + t, { type: 'setProjectAttr', attr: 'timezone', value: '"Europe/Berlin"' }).r;
		expect(status(r)).toBe('refused:macro-in-body');
		expect(status(run(m + t, { type: 'setProjectAttr', attr: 'currency', value: '"EUR"' }).r)).toBe(
			'edit',
		);
	});
});

describe('removeProjectAttr', () => {
	it('removes every site, and re-checks', () => {
		const t = plan('  weekstartsmonday\n  now 2026-02-16\n  weekstartsmonday\n');
		expect(run(t, { type: 'removeProjectAttr', attr: 'weekstartsmonday' }).text).toContain(
			'{\n  now 2026-02-16\n}',
		);
		const opaque = plan('  weekstartssunday\n');
		expect(status(run(opaque, { type: 'removeProjectAttr', attr: 'weekstartsmonday' }).r)).toBe(
			'refused:text-only',
		);
		expect(status(run(t, { type: 'removeProjectAttr', attr: 'timezone' }).r)).toBe(
			'noop:not-present',
		);
		const berlin = plan('  timezone "Asia/Kolkata"\n', 'start 2026-02-02-09:30');
		expect(status(run(berlin, { type: 'removeProjectAttr', attr: 'timezone' }).r)).toBe(
			'refused:invalid-value',
		);
	});

	it('the wrappers build the intents', () => {
		const s = setup(plan('  now 2026-02-16\n'));
		expect(setProjectAttr(s.snap, s.index, 'now', '2026-02-16').status).toBe('noop');
		expect(removeProjectAttr(s.snap, s.index, 'now').status).toBe('edit');
	});
});
