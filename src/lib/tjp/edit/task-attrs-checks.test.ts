// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseValue } from '../values';
import {
	bookingsOf,
	fixedBounds,
	inheritedIds,
	inheritedSites,
	isContainer,
	lastOwn,
	macroInBody,
	otherScenarioSites,
	ownSites,
	taskOf,
} from './task-attrs-checks';
import { timingConflicts } from './task-attrs-timing';
import { setup, stmt } from './testing';
import { isRefused } from './types';

const SRC =
	'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario late "Late"\n  }\n}\n' +
	'resource r "R"\nflags hot, cold\n' +
	'task a "A" {\n  start 2026-01-06\n  plan:end 2026-01-08\n  late:end 2026-01-09\n' +
	'  effort 1d\n  allocate r\n}\n' +
	'task c "C" {\n  task "Auto"\n}\n' +
	'task d "D" {\n  scheduling alap\n  flags hot\n  task e "E" {\n    depends a\n    effort 1d\n  }\n' +
	'  priority 300\n  flags cold\n}\n' +
	'supplement resource r {\n  booking a 2026-01-06-09:00 +1h\n}\n';

describe('task attribute checks', () => {
	const s = setup(SRC);
	const sym = (id: string) => {
		const t = taskOf(s.ctx, id);
		if (isRefused(t)) throw new Error(id);
		return t;
	};

	it('reads own top-scenario sites and other scenarios', () => {
		expect(ownSites(s.ctx, sym('a'), 'end').map((x) => x.scenario)).toEqual(['plan']);
		expect(otherScenarioSites(s.ctx, sym('a'), 'end').map((x) => x.scenario)).toEqual(['late']);
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

	it('inherits only what the parent set before the child was created', () => {
		expect(inheritedSites(s.ctx, sym('d.e'), 'scheduling')).toHaveLength(1);
		// priority 300 and flags cold come after task e (TaskJuggler copies at creation).
		expect(inheritedSites(s.ctx, sym('d.e'), 'priority')).toEqual([]);
		expect([...inheritedIds(s.ctx, sym('d.e'), 'flags').keys()]).toEqual(['hot']);
	});

	it('times changes positionally', () => {
		const end = parseValue('date', '2026-01-20');
		const asap = parseValue('scheduling', 'asap');
		if (!end.ok || !asap.ok) throw new Error('parse');
		const f = s.file();
		const before = (needle: string) => ({ file: f.path, ...stmt(f, needle) });
		// d.e inherits alap, but its own depends makes it ASAP: an end read before the depends
		// overspecifies it, one read after the depends switches it back to ALAP.
		const dep = before('depends a');
		const at = { file: f.path, from: dep.from, to: dep.from };
		const e = sym('d.e');
		expect(
			timingConflicts(s.ctx, e, { attr: 'end', value: end.value, at, replaces: [] }),
		).not.toBeNull();
		const last = { file: f.path, from: dep.to + 1, to: dep.to + 1 };
		expect(
			timingConflicts(s.ctx, e, { attr: 'end', value: end.value, at: last, replaces: [] }),
		).toBeNull();
		expect(
			timingConflicts(s.ctx, e, { attr: 'scheduling', value: asap.value, at: last, replaces: [] }),
		).toBeNull();
	});
});

describe('statement-level macro calls', () => {
	it('allow edits of keywords the macro body does not hold', () => {
		const src =
			'macro team [\n  allocate r\n]\nmacro prio [ priority 300 ]\nmacro deep [ ${team} ]\n' +
			'project p "P" 2026-01-05 +2m\nresource r "R"\n' +
			'task a "A" {\n  ${team}\n}\ntask b "B" {\n  ${prio}\n}\ntask c "C" {\n  ${deep}\n}\n';
		const s = setup(src);
		const t = (id: string) => {
			const x = taskOf(s.ctx, id);
			if (isRefused(x)) throw new Error(id);
			return x;
		};
		const kw = (k: string) => new Set([k]);
		expect(macroInBody(s.ctx, t('a'), kw('priority'))).toBeNull();
		expect(macroInBody(s.ctx, t('a'), kw('allocate'))).toMatchObject({ reason: 'macro-in-body' });
		expect(macroInBody(s.ctx, t('b'), kw('priority'))).toMatchObject({ reason: 'macro-in-body' });
		expect(macroInBody(s.ctx, t('c'), kw('note'))).toMatchObject({ reason: 'macro-in-body' });
	});
});
