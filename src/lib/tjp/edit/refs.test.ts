// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	checkReferences,
	dependenciesNaming,
	dependenciesOf,
	references,
	resolvesTo,
	rewrittenRef,
	subtree,
	taskRefText,
	unfixableReferences,
} from './refs';
import { setup } from './testing';

describe('writing references', () => {
	it('writes !id for siblings, else the absolute id', () => {
		expect(taskRefText('a.b', 'a.c')).toBe('!c');
		expect(taskRefText('a', 'b')).toBe('!b');
		expect(taskRefText('a.b', 'c')).toBe('c');
		expect(taskRefText('a.b.c', 'a.d')).toBe('a.d');
		expect(taskRefText(null, 'x.y')).toBe('x.y');
	});

	it('resolves written references as rule_taskDepId', () => {
		expect(resolvesTo('!c', 'a.b', 'a.c')).toBe(true);
		expect(resolvesTo('!!x', 'a.b', 'x')).toBe(true);
		expect(resolvesTo('!!x.y', 'a.b.c', 'a.x.y')).toBe(true);
		expect(resolvesTo('a.c', 'q', 'a.c')).toBe(true);
		expect(resolvesTo('!c', null, 'c')).toBe(false);
		expect(resolvesTo('!!!c', 'a.b', 'c')).toBe(false);
		expect(resolvesTo('${x}', 'a', 'x')).toBe(false);
	});

	it('keeps a reference while it still names its target', () => {
		expect(rewrittenRef('a.c', 'a.b', 'a.c')).toBeNull();
		expect(rewrittenRef('!c', 'a.b', 'a.c')).toBeNull();
		expect(rewrittenRef('!c', 'x.b', 'a.c')).toBe('a.c');
		expect(rewrittenRef('a.c', 'a.b', 'a.d')).toBe('!d');
	});
});

describe('finding references', () => {
	const files = {
		'plan.tjp': [
			'project p "P" 2026-01-05 +2m',
			'resource r "R"',
			'resource s "S" { managers r }',
			'macro m [ depends top.a ]',
			'task top "Top" {',
			'  task a "A" { effort 1d allocate r }',
			'  task b "B" { effort 1d depends !a }',
			'}',
			'task c "C" { effort 1d depends top.a, top.b precedes top }',
			'include "sub.tji" { taskprefix top.a }',
			'',
		].join('\n'),
		'sub.tji': 'task d "D" { effort 1d depends top.b }\n',
	};
	const s = setup(files);

	it('lists references and dependency items across files', () => {
		const refs = references(s.index, 'task', 'top.b');
		expect(refs.map((r) => [r.at.file, r.written, r.owner])).toEqual(
			expect.arrayContaining([
				['plan.tjp', 'top.b', 'c'],
				['sub.tji', 'top.b', 'top.a.d'],
			]),
		);
		expect(
			references(s.index, 'resource', 'r')
				.map((r) => r.via)
				.sort(),
		).toEqual(['allocate', 'managers']);
		const naming = dependenciesNaming(s.index, ['top.a']);
		expect(naming.map((d) => [d.written, d.succ])).toEqual(
			expect.arrayContaining([
				['!a', 'top.b'],
				['top.a', 'c'],
			]),
		);
		expect(dependenciesNaming(s.index, 'top').map((d) => d.form)).toEqual(['precedes']);
		expect(dependenciesOf(s.index, 'c').map((d) => d.written)).toEqual(['top.a', 'top.b', 'top']);
	});

	it('walks subtrees', () => {
		expect(subtree(s.index, 'task', 'top')).toEqual(['top', 'top.a', 'top.a.d', 'top.b']);
		expect(subtree(s.index, 'task', 'nope')).toEqual([]);
	});

	it('finds references the edit API cannot fix', () => {
		const un = unfixableReferences(s.index, 'task', subtree(s.index, 'task', 'top'));
		const text = s.file().text.toString();
		const written = un.map((r) => text.slice(r.from, r.to));
		expect(written).toEqual(expect.arrayContaining(['top.a']));
		expect(un.some((r) => r.from > text.indexOf('macro') && r.to < text.indexOf('task top'))).toBe(
			true,
		);
		expect(un.some((r) => r.from > text.indexOf('include'))).toBe(true);
		expect(checkReferences(s.index, 'task', 'top.b')).toBeNull();
		expect(checkReferences(s.index, 'task', 'top.a')).toMatchObject({
			reason: 'unfixable-reference',
		});
		const all = [{ file: 'plan.tjp', from: 0, to: text.length }];
		expect(checkReferences(s.index, 'task', 'top.a', all)).toBeNull();
	});
});
