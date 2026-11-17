// SPDX-License-Identifier: GPL-2.0-or-later
// The working-hours editor's model (hours.ts): the week a scope works as the text says it, and the
// intent for one changed day, applied through the edit API to see the exact patch.
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../tjp/edit/apply';
import { setup, textsAfter } from '../tjp/edit/testing';
import { changeDay, hoursPhrase, pairsOf, parseTime, timeText, weekOf } from './hours';
import { readBeforeOf } from './sites';

const HEAD = 'project p "P" 2026-03-02 +8w';

const days = (r: ReturnType<typeof weekOf>): Record<string, string> => {
	if (r.kind !== 'week') throw new Error('not a week');
	return Object.fromEntries(r.days.map((d) => [d.day, hoursPhrase(d.ranges)]));
};

describe('weekOf: the project', () => {
	it('is TaskJuggler’s default, Monday to Friday 9:00 to 17:00, when nothing is written', () => {
		const w = weekOf(setup(`${HEAD}\ntask a "A"\n`).index, { kind: 'project' });
		expect(w).toMatchObject({ kind: 'week', own: false });
		expect(days(w)).toEqual({
			mon: '9:00 - 17:00',
			tue: '9:00 - 17:00',
			wed: '9:00 - 17:00',
			thu: '9:00 - 17:00',
			fri: '9:00 - 17:00',
			sat: 'Off',
			sun: 'Off',
		});
	});

	it('applies each statement in reading order, later ones over the days they name', () => {
		const t = `${HEAD} {\n  workinghours mon - fri 8:00 - 12:00, 13:00 - 17:00\n  workinghours fri 8:00 - 12:00\n  workinghours sat 10:00 - 14:00\n}\n`;
		const w = weekOf(setup(t).index, { kind: 'project' });
		expect(w).toMatchObject({ kind: 'week', own: true });
		expect(days(w)).toMatchObject({
			mon: '8:00 - 12:00, 13:00 - 17:00',
			fri: '8:00 - 12:00',
			sat: '10:00 - 14:00',
			sun: 'Off',
		});
	});

	it('drops the statements above a later timezone, which resets the hours (Project#[]=)', () => {
		const t = `${HEAD} {\n  workinghours mon 6:00 - 7:00\n  timezone "UTC"\n  workinghours tue 6:00 - 7:00\n}\n`;
		const d = days(weekOf(setup(t).index, { kind: 'project' }));
		expect(d['mon']).toBe('9:00 - 17:00');
		expect(d['tue']).toBe('6:00 - 7:00');
	});

	it('is text only when a statement is written with a macro', () => {
		const t = `macro WH [ 9:00 - 12:00 ]\n${HEAD} {\n  workinghours mon \${WH}\n}\n`;
		const w = weekOf(setup(t).index, { kind: 'project' });
		expect(w).toMatchObject({ kind: 'text-only', reason: 'macro-call' });
	});
});

describe('weekOf: a person', () => {
	const t = `${HEAD} {\n  workinghours mon - thu 8:00 - 16:00\n}\nresource team "Team" {\n  workinghours fri off\n  resource a "A" {\n    workinghours mon 10:00 - 12:00\n  }\n  resource b "B"\n}\nresource c "C"\n`;
	const ix = setup(t).index;

	it('starts from the project and applies their own statements', () => {
		const w = weekOf(ix, { kind: 'resource', resource: 'c' });
		expect(w).toMatchObject({ kind: 'week', own: false });
		expect(days(w)['mon']).toBe('8:00 - 16:00');
		expect(days(w)['fri']).toBe('9:00 - 17:00');
	});

	it('starts from the parent group, then their own', () => {
		const b = weekOf(ix, { kind: 'resource', resource: 'b' });
		expect(b).toMatchObject({ kind: 'week', own: false });
		expect(days(b)['fri']).toBe('Off');
		expect(days(b)['mon']).toBe('8:00 - 16:00');
		const a = weekOf(ix, { kind: 'resource', resource: 'a' });
		expect(a).toMatchObject({ kind: 'week', own: true });
		expect(days(a)['mon']).toBe('10:00 - 12:00');
		expect(days(a)['fri']).toBe('Off');
	});
});

describe('weekOf: what is read after the member does not reach it', () => {
	const t = `${HEAD} {\n  workinghours mon - thu 8:00 - 16:00\n}\nresource team "Team" {\n  resource a "A"\n  resource b "B"\n}\nsupplement resource team {\n  workinghours tue off\n}\nresource late "Late" {\n  resource c "C"\n  workinghours wed off\n}\n`;
	const s = setup(t);
	const rb = readBeforeOf(s.snap.includes);

	it('a supplement of the group below its members changes the group only', () => {
		for (const read of [undefined, rb]) {
			expect(days(weekOf(s.index, { kind: 'resource', resource: 'team' }, read))['tue']).toBe(
				'Off',
			);
			expect(days(weekOf(s.index, { kind: 'resource', resource: 'a' }, read))['tue']).toBe(
				'8:00 - 16:00',
			);
			expect(weekOf(s.index, { kind: 'resource', resource: 'a' }, read)).toMatchObject({
				own: false,
			});
		}
	});

	it('a statement in the group written after a member does not reach that member', () => {
		const c = days(weekOf(s.index, { kind: 'resource', resource: 'c' }, rb));
		expect(c['wed']).toBe('8:00 - 16:00');
		expect(days(weekOf(s.index, { kind: 'resource', resource: 'late' }, rb))['wed']).toBe('Off');
	});
});

describe('times', () => {
	it('prints and parses the way TaskJuggler writes them', () => {
		expect(timeText(540)).toBe('9:00');
		expect(timeText(1440)).toBe('24:00');
		expect(parseTime('9:00')).toBe(540);
		expect(parseTime('09:30')).toBe(570);
		expect(parseTime(' 17 ')).toBe(1020);
		expect(parseTime('24:00')).toBe(1440);
		expect(parseTime('25:00')).toBeNull();
		expect(parseTime('9:75')).toBeNull();
		expect(parseTime('lunch')).toBeNull();
		expect(parseTime('')).toBeNull();
	});

	it('pairs ranges as the edit API takes them', () => {
		expect(
			pairsOf([
				[540, 720],
				[780, 1020],
			]),
		).toEqual([
			['9:00', '12:00'],
			['13:00', '17:00'],
		]);
	});
});

describe('changeDay', () => {
	const scope = { kind: 'resource', resource: 'a' } as const;

	it('is the hours of one weekday, sorted, with its label', () => {
		const c = changeDay(scope, 'Ann', 'tue', [
			[780, 1020],
			[540, 720],
		]);
		expect(c).toEqual({
			status: 'intent',
			intent: {
				type: 'setWorkingHours',
				scope,
				days: ['tue'],
				hours: [
					['9:00', '12:00'],
					['13:00', '17:00'],
				],
			},
			label: { text: 'Ann, Tuesday: 9:00 - 12:00, 13:00 - 17:00', approx: false },
		});
	});

	it('is off for no ranges', () => {
		const c = changeDay({ kind: 'project' }, 'P', 'sat', []);
		expect(c).toMatchObject({
			status: 'intent',
			intent: { hours: 'off', days: ['sat'] },
			label: { text: 'P, Saturday: Off' },
		});
	});

	it('refuses a range that does not end after it starts, overlaps, or is not a time', () => {
		expect(changeDay(scope, 'A', 'mon', [[600, 600]])).toEqual({
			status: 'invalid',
			reason: 'order',
		});
		expect(changeDay(scope, 'A', 'mon', [[700, 600]])).toEqual({
			status: 'invalid',
			reason: 'order',
		});
		expect(
			changeDay(scope, 'A', 'mon', [
				[540, 720],
				[700, 800],
			]),
		).toEqual({ status: 'invalid', reason: 'order' });
		expect(changeDay(scope, 'A', 'mon', [[540, 1500]])).toEqual({
			status: 'invalid',
			reason: 'time',
		});
		expect(changeDay(scope, 'A', 'mon', [[-1, 60]])).toEqual({ status: 'invalid', reason: 'time' });
	});

	it('touching ranges are fine', () => {
		expect(
			changeDay(scope, 'A', 'mon', [
				[540, 720],
				[720, 1020],
			]).status,
		).toBe('intent');
	});
});

describe('the edit API patch of a changed day (W8)', () => {
	const t = `${HEAD}\nresource a "A" {\n  efficiency 0.8\n}\n`;

	it('adds one statement for that day to the person, and nothing else', () => {
		const s = setup(t);
		const c = changeDay({ kind: 'resource', resource: 'a' }, 'A', 'fri', [[480, 720]]);
		if (c.status !== 'intent') throw new Error('invalid');
		const r = applyIntent(s.snap, s.index, c.intent);
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(
			`${HEAD}\nresource a "A" {\n  efficiency 0.8\n  workinghours fri 8:00 - 12:00\n}\n`,
		);
	});

	it('rewrites the statement for exactly that day on a second change', () => {
		const s = setup(`${t.replace('}\n', '  workinghours fri 8:00 - 12:00\n}\n')}`);
		const c = changeDay({ kind: 'resource', resource: 'a' }, 'A', 'fri', []);
		if (c.status !== 'intent') throw new Error('invalid');
		const r = applyIntent(s.snap, s.index, c.intent);
		expect(textsAfter(s.snap, r)['plan.tjp']).toContain('workinghours fri off');
	});
});
