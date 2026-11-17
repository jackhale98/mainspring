// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { filterPeople, fold } from './people-filter';
import type { Person } from './types';

const P = (id: string, name: string, index: number): Person => ({ id, name, index });
const PEOPLE = [
	P('dev1', 'Dev 1', 0),
	P('dev2', 'Dev 2', 1),
	P('alopez', 'Ana López', 2),
	P('bk', 'Bao Kim', 3),
	P('tl', 'Tom Alder', 4),
];
const ids = (q: string): string[] => filterPeople(PEOPLE, q).map((m) => m.person.id);

describe('filterPeople', () => {
	it('keeps everyone, in order, for an empty or blank query', () => {
		expect(ids('')).toEqual(['dev1', 'dev2', 'alopez', 'bk', 'tl']);
		expect(ids('   ')).toEqual(ids(''));
	});
	it('matches the name or the id, ignoring case', () => {
		expect(ids('KIM')).toEqual(['bk']);
		expect(ids('bk')).toEqual(['bk']);
		expect(ids('dev')).toEqual(['dev1', 'dev2']);
	});
	it('ignores accents on both sides', () => {
		expect(ids('lopez')).toEqual(['alopez']);
		expect(ids('LÓPEZ')).toEqual(['alopez']);
		expect(fold('Ünïcode')).toBe('unicode');
	});
	it('needs every word, in any order, in the name or the id', () => {
		expect(ids('ana lopez')).toEqual(['alopez']);
		expect(ids('lopez ana')).toEqual(['alopez']);
		expect(ids('dev 2')).toEqual(['dev2']);
		expect(ids('ana kim')).toEqual([]);
	});
	it('puts names and ids that start with the first word ahead of the rest', () => {
		// "al" starts Alder (a word of the name) and Ana's id ("alopez"): both ahead of any inside match.
		expect(ids('al')).toEqual(['alopez', 'tl']);
		const more = [P('x', 'Marta Roe', 0), P('y', 'Tara Mar', 1), P('mar', 'Zed', 2)];
		// "mar": Marta starts with it, Tara's second word does, Zed's id does: all three are first, in
		// the plan's order.
		expect(filterPeople(more, 'mar').map((m) => m.person.id)).toEqual(['x', 'y', 'mar']);
		const late = [P('a', 'Omar Bell', 0), P('b', 'Marie Bell', 1)];
		// Omar holds "mar" inside a word; Marie starts with it, so Marie comes first.
		expect(filterPeople(late, 'mar').map((m) => m.person.id)).toEqual(['b', 'a']);
	});
	it('keeps each person at their place in the full list', () => {
		const m = filterPeople(PEOPLE, 'dev 2');
		expect(m).toHaveLength(1);
		expect(m[0]?.index).toBe(1);
		expect(m[0]?.person.name).toBe('Dev 2');
	});
	it('returns nothing for no match and for no people', () => {
		expect(ids('zzz')).toEqual([]);
		expect(filterPeople([], 'a')).toEqual([]);
	});
});
