// SPDX-License-Identifier: GPL-2.0-or-later
// Refinement (phase-4.md 6.4 rule 2, 8.3; types.ts): line conflicts inside a task, resource or
// project block, or among a file's top-level statements, merged statement by statement.
import { describe, expect, it } from 'vitest';
import { merge1, resolveAll } from './testing';

const HEAD = 'project p "P" 2027-01-04 +3m\nresource dev "Dev"\nresource qa "QA"\n';
const TASK = (lines: string): string => `${HEAD}task api "Build API" {\n${lines}}\n`;
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';

describe('statements of one block', () => {
	it('merges changes to two different attributes on adjacent lines', () => {
		const base = TASK('  effort 3d\n  allocate dev\n');
		const m = merge1(
			base,
			TASK('  effort 5d\n  allocate dev\n'),
			TASK('  effort 3d\n  allocate qa\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(TASK('  effort 5d\n  allocate qa\n'));
	});

	it('makes the same attribute changed both ways one attribute conflict naming it', () => {
		const ours = TASK('  effort 5d\n  allocate dev\n');
		const m = merge1(
			TASK('  effort 3d\n  allocate dev\n'),
			ours,
			TASK('  effort 8d\n  allocate dev\n'),
		);
		expect(m.conflicts).toHaveLength(1);
		const c = m.conflicts[0];
		expect(c?.subject).toEqual({
			kind: 'attribute',
			owner: { kind: 'task', id: 'api', name: 'Build API' },
			attr: 'effort',
		});
		expect([c?.base, c?.ours, c?.theirs]).toEqual(['effort 3d', 'effort 5d', 'effort 8d']);
		expect(c?.both).toBe(false);
		expect(text(m)).toBe(ours);
		expect(text(m).slice(c?.at.from, c?.at.to)).toBe('effort 5d');
		expect(ours.slice(c?.atOurs?.from, c?.atOurs?.to)).toBe('effort 5d');
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(TASK('  effort 8d\n  allocate dev\n'));
		expect(resolveAll(m, { text: 'effort 6d' }).get('plan.tjp')).toBe(
			TASK('  effort 6d\n  allocate dev\n'),
		);
		expect(resolveAll(m, { text: '' }).get('plan.tjp')).toBe(TASK('  allocate dev\n'));
	});

	it('merges identical changes cleanly', () => {
		const x = TASK('  effort 5d\n');
		expect(merge1(TASK('  effort 3d\n'), x, x)).toEqual(merge1(x, x, x));
		expect(merge1(TASK('  effort 3d\n'), x, x).conflicts).toEqual([]);
	});

	it('keeps a scenario prefix apart from the plain attribute, and names it', () => {
		const base = TASK('  effort 3d\n  delayed:effort 4d\n');
		const clean = merge1(
			base,
			TASK('  effort 5d\n  delayed:effort 4d\n'),
			TASK('  effort 3d\n  delayed:effort 6d\n'),
		);
		expect(clean.conflicts).toEqual([]);
		expect(text(clean)).toBe(TASK('  effort 5d\n  delayed:effort 6d\n'));
		const both = merge1(
			base,
			TASK('  effort 3d\n  delayed:effort 5d\n'),
			TASK('  effort 3d\n  delayed:effort 6d\n'),
		);
		expect(both.conflicts.map((c) => c.subject)).toEqual([
			{
				kind: 'attribute',
				owner: { kind: 'task', id: 'api', name: 'Build API' },
				attr: 'delayed:effort',
			},
		]);
	});

	it('takes a re-indent on one side and a new value on the other', () => {
		const m = merge1(
			TASK('  effort 3d\n  allocate dev\n'),
			TASK('    effort 3d\n  allocate qa\n'),
			TASK('  effort 4d\n  allocate dev\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(TASK('    effort 4d\n  allocate qa\n'));
	});

	it('adds attributes with different keys at the same place, ours first', () => {
		const m = merge1(
			TASK('  effort 3d\n'),
			TASK('  effort 3d\n  priority 600\n'),
			TASK('  effort 3d\n  note "n"\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(TASK('  effort 3d\n  priority 600\n  note "n"\n'));
	});

	it('makes two different statements of one keyword added at one place an attribute conflict without both', () => {
		const base = `${HEAD}task a "A" {\n  effort 1d\n}\ntask b "B" {\n  effort 1d\n}\ntask c "C" {\n  effort 3d\n}\n`;
		const at = (dep: string): string =>
			base.replace('  effort 3d\n', `  effort 3d\n  depends ${dep}\n`);
		const m = merge1(base, at('a'), at('b'));
		expect(m.conflicts.map((c) => [c.subject, c.base, c.ours, c.theirs, c.both])).toEqual([
			[
				{ kind: 'attribute', owner: { kind: 'task', id: 'c', name: 'C' }, attr: 'depends' },
				null,
				'depends a',
				'depends b',
				false,
			],
		]);
	});

	it('makes an attribute one side removed and the other changed a conflict with that side null', () => {
		const base = TASK('  effort 3d\n  allocate dev\n  priority 500\n');
		const m = merge1(
			base,
			TASK('  effort 3d\n  allocate qa\n'),
			TASK('  effort 3d\n  allocate dev\n  priority 700\n'),
		);
		expect(m.conflicts.map((c) => [c.subject.kind, c.base, c.ours, c.theirs])).toEqual([
			['attribute', 'priority 500', null, 'priority 700'],
		]);
		const c = m.conflicts[0];
		expect(c?.at.from).toBe(c?.at.to);
		expect(resolveAll(m, 'ours').get('plan.tjp')).toBe(TASK('  effort 3d\n  allocate qa\n'));
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(
			TASK('  effort 3d\n  allocate qa\n  priority 700\n'),
		);
	});
});

describe('blocks', () => {
	const base = `${HEAD}task a "A" {\n  effort 1d\n}\ntask t "T" {\n  effort 2d\n}\n`;

	it('merges an attribute appended in one task and a task added after it', () => {
		const ours = base.replace('  effort 1d\n}', '  effort 1d\n  allocate dev\n}');
		const theirs = base.replace('task t "T"', 'task n "N" {\n  effort 1d\n}\ntask t "T"');
		const m = merge1(base, ours, theirs);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(ours.replace('task t "T"', 'task n "N" {\n  effort 1d\n}\ntask t "T"'));
	});

	it('makes a block deleted on one side and changed on the other a block conflict holding it', () => {
		const ours = base.replace('task t "T" {\n  effort 2d\n}\n', '');
		const theirs = base.replace('effort 2d', 'effort 4d');
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.map((c) => c.subject)).toEqual([
			{ kind: 'block', owner: { kind: 'task', id: 't', name: 'T' }, change: 'deleted-ours' },
		]);
		const c = m.conflicts[0];
		expect([c?.base, c?.ours, c?.theirs]).toEqual([
			'task t "T" {\n  effort 2d\n}\n',
			null,
			'task t "T" {\n  effort 4d\n}\n',
		]);
		expect(text(m)).toBe(theirs);
		expect(resolveAll(m, 'ours').get('plan.tjp')).toBe(ours);
		const swapped = merge1(base, theirs, ours);
		expect(swapped.conflicts.map((x) => x.subject)).toEqual([
			{ kind: 'block', owner: { kind: 'task', id: 't', name: 'T' }, change: 'deleted-theirs' },
		]);
		expect(text(swapped)).toBe(theirs);
	});

	it('makes blocks with different ids added at one place one added-twice conflict with both', () => {
		const ours = `${base}task x "X" {\n  effort 1d\n}\n`;
		const theirs = `${base}task y "Y" {\n  effort 2d\n}\n`;
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.map((c) => [c.subject, c.both])).toEqual([
			[
				{ kind: 'block', owner: { kind: 'other', id: null, name: null }, change: 'added-twice' },
				true,
			],
		]);
		expect(resolveAll(m, 'both').get('plan.tjp')).toBe(`${ours}task y "Y" {\n  effort 2d\n}\n`);
	});

	it('makes a block added on both sides with the same id a conflict, never a duplicate', () => {
		const m = merge1(
			base,
			`${base}task x "X" {\n  effort 1d\n}\n`,
			`${base}task x "X2" {\n  effort 2d\n}\n`,
		);
		expect(m.conflicts.map((c) => [c.subject, c.both])).toEqual([
			[
				{ kind: 'block', owner: { kind: 'task', id: 'x', name: 'X' }, change: 'added-twice' },
				false,
			],
		]);
	});

	it('refines inside nested blocks and names the full id', () => {
		const nest = (e: string, a: string): string =>
			`${HEAD}task top "Top" {\n  task api "API" {\n    effort ${e}\n    allocate ${a}\n  }\n}\n`;
		const clean = merge1(nest('3d', 'dev'), nest('5d', 'dev'), nest('3d', 'qa'));
		expect(clean.conflicts).toEqual([]);
		expect(text(clean)).toBe(nest('5d', 'qa'));
		const m = merge1(nest('3d', 'dev'), nest('5d', 'dev'), nest('8d', 'dev'));
		expect(m.conflicts.map((c) => c.subject)).toEqual([
			{ kind: 'attribute', owner: { kind: 'task', id: 'top.api', name: 'API' }, attr: 'effort' },
		]);
	});

	it('merges a renamed header on one side with a body change next to it on the other', () => {
		const t = (name: string, e: string): string =>
			`${HEAD}task api "${name}" {\n  effort ${e}\n}\n`;
		const m = merge1(t('API', '3d'), t('Build API', '3d'), t('API', '5d'));
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(t('Build API', '5d'));
	});

	it('makes a header changed both ways one both-edited block conflict', () => {
		const t = (name: string, e: string): string =>
			`${HEAD}task api "${name}" {\n  effort ${e}\n}\n`;
		const m = merge1(t('API', '3d'), t('Build API', '3d'), t('The API', '5d'));
		expect(m.conflicts.map((c) => c.subject)).toEqual([
			{
				kind: 'block',
				owner: { kind: 'task', id: 'api', name: 'Build API' },
				change: 'both-edited',
			},
		]);
	});

	it('refines resources and the project header', () => {
		const r = (lim: string, rate: string): string =>
			`project p "P" 2027-01-04 +3m {\n  timezone "UTC"\n  currency "${lim}"\n}\nresource dev "Dev" {\n  rate ${rate}\n  email "d@x"\n}\n`;
		const m = merge1(r('EUR', '300'), r('USD', '300'), r('GBP', '400'));
		expect(m.conflicts.map((c) => c.subject)).toEqual([
			{ kind: 'attribute', owner: { kind: 'project', id: 'p', name: 'P' }, attr: 'currency' },
		]);
		expect(text(m)).toBe(r('USD', '400'));
	});
});

describe('line conflicts', () => {
	it('keeps a hunk with a syntax error a line conflict, named by its block', () => {
		const base = TASK('  effort 3d\n  allocate dev\n');
		const m = merge1(
			base,
			TASK('  effort 5d\n  allocate dev\n'),
			TASK('  efort 8d\n  allocate qa\n'),
		);
		expect(m.conflicts.map((c) => [c.subject, c.both])).toEqual([
			[
				{
					kind: 'block',
					owner: { kind: 'task', id: 'api', name: 'Build API' },
					change: 'both-edited',
				},
				false,
			],
		]);
		expect(m.conflicts[0]?.theirs).toBe('  efort 8d\n  allocate qa\n');
	});

	it('makes top-level comments changed both ways a text conflict offering both', () => {
		const base = `# plan\n${HEAD}`;
		const m = merge1(base, `# our plan\n${HEAD}`, `# their plan\n${HEAD}`);
		expect(m.conflicts.map((c) => [c.subject, c.both, c.ours, c.theirs])).toEqual([
			[{ kind: 'text' }, true, '# our plan\n', '# their plan\n'],
		]);
		expect(resolveAll(m, 'both').get('plan.tjp')).toBe(`# our plan\n# their plan\n${HEAD}`);
	});
});

describe('line endings and bytes', () => {
	it('keeps CR, a BOM and replacement characters untouched', () => {
		const crlf = (s: string): string => s.replace(/\n/g, '\r\n');
		const base = `﻿${crlf(TASK('  effort 3d\n  note "�"\n  allocate dev\n'))}`;
		const ours = `﻿${crlf(TASK('  effort 5d\n  note "�"\n  allocate dev\n'))}`;
		const theirs = `﻿${crlf(TASK('  effort 3d\n  note "�"\n  allocate qa\n'))}`;
		const m = merge1(base, ours, theirs);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(`﻿${crlf(TASK('  effort 5d\n  note "�"\n  allocate qa\n'))}`);
		const both = merge1(base, ours, ours.replace('5d', '8d'));
		expect(both.conflicts.map((c) => c.ours)).toEqual(['effort 5d']);
		const added = merge1(
			crlf(TASK('  effort 3d\n  priority 500\n')),
			crlf(TASK('  effort 5d\n')),
			crlf(TASK('  effort 3d\n  priority 700\n')),
		);
		expect(resolveAll(added, 'theirs').get('plan.tjp')).toBe(
			crlf(TASK('  effort 5d\n  priority 700\n')),
		);
	});
});
