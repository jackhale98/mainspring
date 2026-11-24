// SPDX-License-Identifier: GPL-2.0-or-later
// No silent duplicates (phase-4.md 6.4 rule 3): the same id added, or moved, to different places
// on the two sides.
import { describe, expect, it } from 'vitest';
import { bothAdded } from './dupes';
import { lined } from './refine';
import { merge1, resolveAll } from './testing';

const HEAD = 'project p "P" 2027-01-04 +3m\nresource dev "Dev"\n';
const A = 'task a "A" {\n  effort 1d\n}\n';
const B = 'task b "B" {\n  effort 1d\n}\n';
const BASE = `${HEAD}${A}${B}`;
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';

describe('the same block added in two places', () => {
	it('is one added-twice conflict held at ours, without theirs’ copy', () => {
		const mine = 'task n "New task" {\n  effort 3h\n}\n';
		const yours = 'task n "New task" {\n  effort 2h\n}\n';
		const ours = `${HEAD}${mine}${A}${B}`;
		const theirs = `${HEAD}${A}${B}${yours}`;
		const m = merge1(BASE, ours, theirs);
		expect(m.conflicts.map((c) => [c.subject, c.base, c.ours, c.theirs, c.both])).toEqual([
			[
				{
					kind: 'block',
					owner: { kind: 'task', id: 'n', name: 'New task' },
					change: 'added-twice',
				},
				null,
				mine,
				yours,
				false,
			],
		]);
		expect(text(m)).toBe(ours);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(`${HEAD}${yours}${A}${B}`);
		expect(merge1(BASE, theirs, ours).conflicts).toHaveLength(1);
	});

	it('keeps one copy of identical additions, cleanly', () => {
		const n = 'task n "N"\n';
		const m = merge1(BASE, `${HEAD}${n}${A}${B}`, `${HEAD}${A}${B}${n}`);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(`${HEAD}${n}${A}${B}`);
	});

	const C = 'task c "C" {\n  effort 2d\n}\n';
	const count = (t: string | undefined): number => (t ?? '').split('task b "B"').length - 1;

	it('makes a task both sides moved to different places one conflict of the moves', () => {
		const ours = `${HEAD}${B}${A}${C}`;
		const theirs = `${HEAD}${A}${C}${B}`;
		const m = merge1(`${HEAD}${A}${B}${C}`, ours, theirs);
		expect(m.conflicts.map((c) => [c.subject, c.ours, c.theirs])).toEqual([
			[{ kind: 'text' }, `${B}${A}${C}`, `${A}${C}${B}`],
		]);
		expect(text(m)).toBe(ours);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(theirs);
	});

	it('makes a task moved on one side and edited on the other a conflict, never a copy', () => {
		const edited = B.replace('1d', '4d');
		const m = merge1(`${HEAD}${A}${B}${C}`, `${HEAD}${B}${A}${C}`, `${HEAD}${A}${edited}${C}`);
		expect(m.conflicts).toHaveLength(1);
		expect(count(text(m))).toBe(1);
		expect(count(resolveAll(m, 'ours').get('plan.tjp'))).toBe(1);
		expect(count(resolveAll(m, 'theirs').get('plan.tjp'))).toBe(1);
		// Moved on one side only, with nothing else changed there: clean.
		const clean = merge1(`${HEAD}${A}${B}${C}`, `${HEAD}${B}${A}${C}`, `${HEAD}${A}${B}${C}`);
		expect(clean.conflicts).toEqual([]);
	});

	it('runs the declaration pass whenever both sides added lines', () => {
		const pre = (o: string, a: string, b: string): boolean => {
			const l = lined([o, a, b]);
			return bothAdded(l.regions);
		};
		expect(pre(BASE, `${BASE}# one\n`, `# two\n${BASE}`)).toBe(true);
		expect(pre(BASE, `${BASE}task n "N"\n`, BASE.replace('1d', '2d'))).toBe(true);
		expect(pre(BASE, `${BASE}task n "N"\n`, BASE.replace('  effort 1d\n', ''))).toBe(false);
	});
});

describe('one value said twice at different lines (review H1)', () => {
	const base =
		'project p "P" 2027-01-04 +3m\nresource dev "Dev"\ntask a "A" {\n  note "n"\n  effort 1d\n  allocate dev\n}\n';
	const after = (line: string, add: string): string => base.replace(line, `${line}\n  ${add}`);

	it('makes a single-valued statement both sides added at different lines one attribute conflict', () => {
		const ours = after('task a "A" {', 'priority 100');
		const theirs = after('  note "n"', 'priority 900');
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.map((c) => [c.subject, c.base, c.ours, c.theirs])).toEqual([
			[
				{ kind: 'attribute', owner: { kind: 'task', id: 'a', name: 'A' }, attr: 'priority' },
				null,
				'priority 100',
				'priority 900',
			],
		]);
		expect(text(m)).toBe(ours);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(
			ours.replace('priority 100', 'priority 900'),
		);
		expect(merge1(base, theirs, ours).conflicts).toHaveLength(1);
	});

	it.each([
		['start 2027-01-05', 'start 2027-01-06'],
		['complete 10', 'complete 90'],
		['duration 2d', 'length 3d'],
	])('also for %s and %s', (x, y) => {
		// No sizing criterion in this base: the sizing criteria are one value.
		const b = base.replace('  effort 1d\n', '');
		const add = (line: string, s: string): string => b.replace(line, `${line}\n  ${s}`);
		const m = merge1(b, add('task a "A" {', x), add('  allocate dev', y));
		expect(m.conflicts.map((c) => c.subject.kind)).toEqual(['attribute']);
	});

	it('covers a resource’s rate and the project’s timezone', () => {
		const res =
			'project p "P" 2027-01-04 +3m {\n  now 2027-01-04\n  currency "EUR"\n}\nresource dev "Dev" {\n  email "d@x"\n  efficiency 1\n}\n';
		const r = merge1(
			res,
			res.replace('resource dev "Dev" {', 'resource dev "Dev" {\n  rate 300'),
			res.replace('  efficiency 1', '  efficiency 1\n  rate 400'),
		);
		expect(
			r.conflicts.map((c) => [c.subject.kind === 'attribute' && c.subject.owner.id, c.ours]),
		).toEqual([['dev', 'rate 300']]);
		const t = merge1(
			res,
			res.replace('  now 2027-01-04', '  timezone "Europe/Berlin"\n  now 2027-01-04'),
			res.replace('  currency "EUR"', '  currency "EUR"\n  timezone "Europe/Paris"'),
		);
		expect(
			t.conflicts.map((c) => [c.subject.kind === 'attribute' && c.subject.owner.kind, c.ours]),
		).toEqual([['project', 'timezone "Europe/Berlin"']]);
	});

	it('merges additive statements added at different lines, keeping identical ones once', () => {
		const m = merge1(
			base,
			after('task a "A" {', 'depends x'),
			after('  allocate dev', 'depends y'),
		);
		expect(m.conflicts).toEqual([]);
		const same = merge1(
			base,
			after('task a "A" {', 'flags hot'),
			after('  allocate dev', 'flags hot'),
		);
		expect(same.conflicts).toEqual([]);
		expect(text(same)).toBe(after('task a "A" {', 'flags hot'));
		const one = merge1(
			base,
			after('task a "A" {', 'priority 5'),
			after('  allocate dev', 'priority 5'),
		);
		expect(one.conflicts).toEqual([]);
		expect(text(one)).toBe(after('task a "A" {', 'priority 5'));
	});
});

describe('resources are global (review L3)', () => {
	it('makes the same resource id added under two parents one added-twice conflict', () => {
		const base = 'project p "P" 2027-01-04 +3m\nresource t1 "T1" {\n}\nresource t2 "T2" {\n}\n';
		const ours = base.replace('resource t1 "T1" {\n', 'resource t1 "T1" {\n  resource ann "Ann"\n');
		const theirs = base.replace(
			'resource t2 "T2" {\n',
			'resource t2 "T2" {\n  resource ann "Ann B"\n',
		);
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.map((c) => c.subject)).toEqual([
			{ kind: 'block', owner: { kind: 'resource', id: 'ann', name: 'Ann' }, change: 'added-twice' },
		]);
		expect(text(m)).toBe(ours);
	});
});

describe('a block moved to two places carries the base (review L6)', () => {
	it('holds the base block and its range in the base', () => {
		const A = 'task a "A" {\n  effort 1d\n}\n';
		const B = 'task b "B" {\n  effort 1d\n}\n';
		const C = 'task c "C" {\n  effort 2d\n}\n';
		const H = 'project p "P" 2027-01-04 +3m\n';
		// Moved apart far enough that the line merge is clean: the duplicate pass sees it.
		const pad = '# 1\n# 2\n# 3\n';
		const base = `${H}${A}${pad}${B}${pad}${C}`;
		const m = merge1(base, `${H}${B}${A}${pad}${pad}${C}`, `${H}${A}${pad}${pad}${C}${B}`);
		// Both sides moved it: one conflict, which carries the base's block.
		const c = m.conflicts[0];
		if (c?.subject.kind === 'block') {
			expect(c.subject).toEqual({
				kind: 'block',
				owner: { kind: 'task', id: 'b', name: 'B' },
				change: 'both-edited',
			});
			expect(c.base).toBe(B);
		} else expect(c?.base).toContain(B);
		expect(m.conflicts).toHaveLength(1);
	});
});
