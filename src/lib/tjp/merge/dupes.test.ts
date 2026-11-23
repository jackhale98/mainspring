// SPDX-License-Identifier: GPL-2.0-or-later
// No silent duplicates (phase-4.md 6.4 rule 3): the same id added, or moved, to different places
// on the two sides.
import { describe, expect, it } from 'vitest';
import { mayDouble } from './dupes';
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

	it('looks only at merges where both sides added a matching declaration line', () => {
		const pre = (o: string, a: string, b: string): boolean => {
			const l = lined([o, a, b]);
			return mayDouble(l.lines, l.regions);
		};
		expect(pre(BASE, `${BASE}task n "N"\n`, `task n "M"\n${BASE}`)).toBe(true);
		expect(pre(BASE, `${BASE}task n "N"\n`, `task m "M"\n${BASE}`)).toBe(false);
	});
});
