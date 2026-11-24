// SPDX-License-Identifier: GPL-2.0-or-later
// The items of repeatable statements (check.ts): the weekdays of `workinghours` in every form
// TaskJuggler reads, and statements whose items cannot be read (the last T6 review: a hyphenated
// range and a macro day merged cleanly, and the later hours silently won).
import { describe, expect, it } from 'vitest';
import { weekdaysOf } from './check';
import { merge1 } from './testing';

const H = 'project p "P" 2027-01-04 +3m\n';
const BASE = `${H}macro D [ mon ]\nresource dev "Dev" {\n  efficiency 1.0\n}\n`;
const withHours = (line: string): string =>
	BASE.replace('  efficiency 1.0\n', `  efficiency 1.0\n  ${line}\n`);

describe('weekdaysOf', () => {
	it('reads single days, lists and ranges, spaced or hyphenated', () => {
		expect(weekdaysOf(' mon 9:00 - 12:00')).toEqual(['mon']);
		expect(weekdaysOf(' mon, wed 9:00 - 12:00')).toEqual(['mon', 'wed']);
		expect(weekdaysOf(' mon - wed 9:00 - 12:00')).toEqual(['mon', 'tue', 'wed']);
		expect(weekdaysOf(' mon-wed 9:00 - 12:00')).toEqual(['mon', 'tue', 'wed']);
		expect(weekdaysOf(' Mon-Wed, fri off')).toEqual(['mon', 'tue', 'wed', 'fri']);
		expect(weekdaysOf(' sat - mon off')).toEqual(['sat', 'sun', 'mon']);
	});

	it('does not read the hours as days: the list ends at the first time or off', () => {
		expect(weekdaysOf(' tue 9:00 - 12:00, 13:00 - 17:00')).toEqual(['tue']);
		expect(weekdaysOf(' sun off')).toEqual(['sun']);
	});

	it('says so when the day list cannot be read', () => {
		expect(weekdaysOf(' ${D} 9:00 - 12:00')).toBeNull();
		expect(weekdaysOf(' mon - 9:00 - 12:00')).toBeNull();
		expect(weekdaysOf(' weekdays 9:00 - 12:00')).toBeNull();
		expect(weekdaysOf(' 9:00 - 12:00')).toBeNull();
	});
});

describe('working hours added by both sides to one resource', () => {
	it('a hyphenated range that holds the other side’s day is a conflict', () => {
		const m = merge1(
			BASE,
			withHours('workinghours mon-wed 9:00 - 12:00'),
			withHours('workinghours tue 13:00 - 17:00'),
		);
		expect(m.conflicts.length).toBeGreaterThan(0);
	});

	it('a day given by a macro is a conflict with any day', () => {
		const m = merge1(
			BASE,
			withHours('workinghours ${D} 9:00 - 12:00'),
			withHours('workinghours mon 13:00 - 17:00'),
		);
		expect(m.conflicts.length).toBeGreaterThan(0);
	});

	it('a hyphenated range and a day outside it still merge', () => {
		const m = merge1(
			BASE,
			withHours('workinghours mon-wed 9:00 - 12:00'),
			withHours('workinghours fri 13:00 - 17:00'),
		);
		expect(m.conflicts).toEqual([]);
		const text = m.files.get('plan.tjp') ?? '';
		expect(text).toContain('workinghours mon-wed 9:00 - 12:00');
		expect(text).toContain('workinghours fri 13:00 - 17:00');
	});
});

describe('a dependency given by a macro', () => {
	it('is a conflict with a dependency the other side adds to the same task', () => {
		const base = `${H}macro X [ b ]\ntask b "B" {\n  length 1d\n}\ntask c "C" {\n  length 1d\n}\n`;
		const add = (line: string): string =>
			base.replace('task c "C" {\n  length 1d\n', `task c "C" {\n  length 1d\n  ${line}\n`);
		const m = merge1(base, add('depends ${X}'), add('depends b { gaplength 2d }'));
		expect(m.conflicts.length).toBeGreaterThan(0);
	});
});

describe('each side adds statements at one place, one pair of them clashing (CI seed -2121482778)', () => {
	const base = `${H}resource ben "Ben"\nresource ann "Ann" {\n  efficiency 0.9\n  limits { dailymax 6h }\n}\n`;
	const end = '  limits { dailymax 6h }\n';
	const one = base.replace(end, `${end}  rate 310\n`);
	const two = base.replace(end, `${end}  managers ben\n  rate 250\n`);

	it('is the same attribute conflict whichever side is ours, and the other statement stays', () => {
		for (const [ours, theirs] of [
			[one, two],
			[two, one],
		] as const) {
			const m = merge1(base, ours, theirs);
			expect(m.conflicts.map((c) => c.subject.kind)).toEqual(['attribute']);
			const text = m.files.get('plan.tjp') ?? '';
			expect(text.match(/managers ben/g)).toHaveLength(1);
			expect(text.match(/\brate\b/g)).toHaveLength(1);
		}
	});
});
