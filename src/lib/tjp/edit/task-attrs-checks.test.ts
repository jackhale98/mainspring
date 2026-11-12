// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseValue } from '../values';
import {
	bookingsOf,
	fixedBounds,
	isContainer,
	lastOwn,
	overspecifiedBy,
	ownSites,
	taskOf,
} from './task-attrs-checks';
import { setup } from './testing';
import { isRefused } from './types';

const SRC =
	'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario late "Late"\n  }\n}\n' +
	'resource r "R"\n' +
	'task a "A" {\n  start 2026-01-06\n  plan:end 2026-01-08\n  late:end 2026-01-09\n' +
	'  effort 1d\n  allocate r\n}\n' +
	'task c "C" {\n  task "Auto"\n}\n' +
	'task d "D" {\n  scheduling alap\n  task e "E" {\n    depends a\n    effort 1d\n  }\n}\n' +
	'supplement resource r {\n  booking a 2026-01-06-09:00 +1h\n}\n';

describe('task attribute checks', () => {
	const s = setup(SRC);
	const sym = (id: string) => {
		const t = taskOf(s.ctx, id);
		if (isRefused(t)) throw new Error(id);
		return t;
	};

	it('reads own top-scenario sites', () => {
		expect(ownSites(s.ctx, sym('a'), 'end').map((x) => x.scenario)).toEqual(['plan']);
		expect(lastOwn(s.ctx, sym('a'), 'start')?.keyword).toBe('start');
		expect(taskOf(s.ctx, 'zz')).toMatchObject({ reason: 'unknown-target' });
	});

	it('finds containers, bookings and differing bounds', () => {
		expect(isContainer(s.ctx, sym('c'))).toBe(true);
		expect(isContainer(s.ctx, sym('a'))).toBe(false);
		expect(bookingsOf(s.ctx, sym('a'))).toHaveLength(1);
		expect(fixedBounds(s.ctx, sym('a'))).toHaveLength(2);
		const same = parseValue('date', '2026-01-08');
		if (!same.ok) throw new Error('date');
		expect(fixedBounds(s.ctx, sym('a'), { keyword: 'start', value: same.value })).toBeNull();
	});

	it('refuses only changes that make a task overspecified', () => {
		const len = parseValue('duration', '2d');
		const asap = parseValue('scheduling', 'asap');
		if (!len.ok || !asap.ok) throw new Error('parse');
		// a already has start, end and effort: no new conflict.
		expect(overspecifiedBy(s.ctx, sym('a'), { attr: 'length', value: len.value })).toBeNull();
		const end = parseValue('date', '2026-01-20');
		if (!end.ok) throw new Error('date');
		// d.e is scheduled backward (inherited alap) with a start dependency and an effort: an end
		// is fine backward, and asap is fine without an end.
		expect(overspecifiedBy(s.ctx, sym('d.e'), { attr: 'end', value: end.value })).toBeNull();
		expect(
			overspecifiedBy(s.ctx, sym('d.e'), { attr: 'scheduling', value: asap.value }),
		).toBeNull();
	});
});
