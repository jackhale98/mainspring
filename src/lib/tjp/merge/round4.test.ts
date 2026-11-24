// SPDX-License-Identifier: GPL-2.0-or-later
// Cases from the fourth T6 review: what counts as a block for the structural rule (types.ts G1,
// G2). A body-less declaration given a body (B1), any brace body (B2), the file's top level (B3)
// and a supplement with its declaration in one file (B4); moves whose Take theirs or Take mine
// would leave a second copy (L4).
import { describe, expect, it } from 'vitest';
import { edited, PLAN } from '../../sync/merge-testing';
import { mergeAll, merge1, resolveAll } from './testing';
import { resolve } from '../../sync/merge';
import { isUnresolved } from './types';

const H = 'project p "P" 2027-01-04 +3m\n';
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';
const kinds = (m: ReturnType<typeof merge1>): string[] => m.conflicts.map((c) => c.subject.kind);

describe('a body-less declaration given a body by both sides (B1)', () => {
	it('checks the new body: the same weekday through the edit API is a conflict', () => {
		const hours = (h: [string, string]) =>
			edited(PLAN, {
				type: 'setWorkingHours',
				scope: { kind: 'resource', resource: 'dev' },
				days: ['mon'] as never,
				hours: [h],
			});
		const ours = hours(['9:00', '12:00']);
		const theirs = hours(['13:00', '17:00']);
		expect(ours['people.tji']).toContain('resource dev "Dev" {');
		const m = mergeAll('plan.tjp', PLAN, ours, theirs);
		expect(m.conflicts.length).toBeGreaterThan(0);
		expect(resolveAll(m, 'ours').get('people.tji')).toBe(ours['people.tji']);
	});

	it('also for a one-line body and for the project header', () => {
		const base = `${H}resource dev "Dev"\n`;
		const m = merge1(
			base,
			base.replace('"Dev"\n', '"Dev" { workinghours mon 9:00 - 12:00 }\n'),
			base.replace('"Dev"\n', '"Dev" { workinghours mon 13:00 - 17:00 }\n'),
		);
		expect(m.conflicts.length).toBeGreaterThan(0);
		const p = merge1(
			base,
			base.replace('+3m\n', '+3m {\n  workinghours mon 9:00 - 12:00\n}\n'),
			base.replace('+3m\n', '+3m {\n  workinghours mon 13:00 - 17:00\n}\n'),
		);
		expect(p.conflicts.length).toBeGreaterThan(0);
	});

	it('keys depends by target there too: one target with two gaps is a conflict', () => {
		const base = `${H}task a "A" {\n  length 1d\n}\ntask b "B"\n`;
		const m = merge1(
			base,
			base.replace('task b "B"\n', 'task b "B" {\n  depends a { gaplength 1d }\n}\n'),
			base.replace('task b "B"\n', 'task b "B" {\n  depends a { gaplength 3d }\n}\n'),
		);
		expect(kinds(m)).toEqual(['attribute']);
		expect(text(m).match(/depends/g)).toHaveLength(1);
	});

	it('takes the same new body written in two layouts once, both ways round', () => {
		// Found by typed.property.test.ts (blocks-testing.ts): swapping the sides gave a conflict.
		const base = `${H}resource dev "Dev"\n`;
		const lines = base.replace('"Dev"\n', '"Dev" {\n  workinghours tue 13:00 - 17:00\n}\n');
		const one = base.replace('"Dev"\n', '"Dev" { workinghours tue 13:00 - 17:00 }\n');
		expect(merge1(base, lines, one).conflicts).toEqual([]);
		expect(merge1(base, one, lines).conflicts).toEqual([]);
		expect(text(merge1(base, one, lines))).toBe(one);
	});

	it('still merges two different weekdays and two different targets', () => {
		const base = `${H}task a "A" {\n  length 1d\n}\ntask c "C" {\n  length 1d\n}\ntask b "B"\n`;
		const m = merge1(
			base,
			base.replace('task b "B"\n', 'task b "B" {\n  depends a\n}\n'),
			base.replace('task b "B"\n', 'task b "B" {\n  depends c\n}\n'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toContain('depends a');
		expect(text(m)).toContain('depends c');
	});
});

describe('every brace body is a block (B2)', () => {
	it('a shift body both sides changed is one conflict', () => {
		const base = `${H}shift s1 "S1" {\n  timezone "UTC"\n  workinghours sat off\n  workinghours sun off\n}\n`;
		const m = merge1(
			base,
			base.replace('{\n  timezone', '{\n  workinghours mon - fri 9:00 - 12:00\n  timezone'),
			base.replace('sun off\n}', 'sun off\n  workinghours mon - fri 13:00 - 17:00\n}'),
		);
		expect(m.conflicts.length).toBe(1);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toContain('mon - fri 13:00 - 17:00');
		expect(resolveAll(m, 'theirs').get('plan.tjp')).not.toContain('mon - fri 9:00 - 12:00');
	});

	it('an account body and an allocation’s body too', () => {
		const base = `${H}account cost "Cost" {\n  credits 2027-01-04 "a" 10\n  credits 2027-01-05 "b" 10\n  credits 2027-01-06 "c" 10\n}\n`;
		const a = merge1(base, base.replace('"a" 10', '"a" 20'), base.replace('"c" 10', '"c" 30'));
		expect(a.conflicts.length).toBe(1);
		const t = `${H}resource r "R"\ntask t "T" {\n  effort 1d\n  allocate r {\n    alternative q\n    persistent\n    select minloaded\n  }\n}\n`;
		const b = merge1(
			t,
			t.replace('alternative q', 'alternative q, z'),
			t.replace('select minloaded', 'select maxloaded'),
		);
		expect(b.conflicts.length).toBe(1);
	});
});

describe('the file’s top level is a block (B3)', () => {
	it('a macro defined at two places is a conflict', () => {
		const base = `${H}task a "A" {\n  length 1d\n}\ntask b "B" {\n  length 1d\n}\n`;
		const m = merge1(
			base,
			base.replace('task a', 'macro m [ 1d ]\ntask a'),
			`${base}macro m [ 2d ]\n`,
		);
		expect(m.conflicts.length).toBeGreaterThan(0);
	});

	it('a single-valued top-level statement said twice is a conflict; includes merge by path', () => {
		const base = `${H}task a "A" {\n  length 1d\n}\ntask b "B" {\n  length 1d\n}\n`;
		const c = merge1(
			base,
			base.replace('task a', 'copyright "Ours"\ntask a'),
			`${base}copyright "Theirs"\n`,
		);
		expect(c.conflicts.length).toBeGreaterThan(0);
		const i = merge1(
			base,
			base.replace('task a', 'include "x.tji"\ntask a'),
			`${base}include "y.tji"\n`,
		);
		expect(i.conflicts).toEqual([]);
	});
});

describe('a supplement and its declaration in one file are one block (B4)', () => {
	it('start in the declaration against start in the supplement is a conflict', () => {
		const base = `${H}task a "A" {\n  length 1d\n  note "n"\n}\nsupplement task a {\n  priority 5\n}\n`;
		const m = merge1(
			base,
			base.replace('  length 1d\n', '  length 1d\n  start 2027-01-11\n'),
			base.replace('  priority 5\n', '  priority 5\n  start 2027-01-18\n'),
		);
		expect(m.conflicts.length).toBeGreaterThan(0);
		expect(resolveAll(m, 'ours').get('plan.tjp')?.match(/start/g)).toHaveLength(1);
		expect(resolveAll(m, 'theirs').get('plan.tjp')?.match(/start/g)).toHaveLength(1);
	});

	it('different attributes in the two still merge', () => {
		const base = `${H}task a "A" {\n  length 1d\n  note "n"\n}\nsupplement task a {\n  priority 5\n}\n`;
		const m = merge1(
			base,
			base.replace('  length 1d\n', '  length 1d\n  start 2027-01-11\n'),
			base.replace('  priority 5\n', '  priority 5\n  complete 50\n'),
		);
		expect(m.conflicts).toEqual([]);
	});
});

describe('a moved task offers only the choices that leave one copy (L4)', () => {
	const T = (e: string): string => `  task t "T" {\n    effort ${e}\n  }\n`;
	const base = `${H}task p1 "P1" {\n${T('1d')}}\ntask p2 "P2" {\n${T('9d')}}\ntask p3 "P3" {\n  length 1d\n}\n`;
	const moved = `${H}task p1 "P1" {\n}\ntask p2 "P2" {\n${T('9d')}}\ntask p3 "P3" {\n  length 1d\n${T('1d')}}\n`;
	const edit = base.replace('effort 1d', 'effort 5d');

	it('ours moved it: only Take mine (and Edit…)', () => {
		const m = merge1(base, moved, edit);
		const c = m.conflicts.find((x) => x.subject.kind === 'text');
		expect(c?.only).toBe('ours');
		expect(isUnresolved(resolve(m, [{ conflict: c?.id ?? '', take: 'theirs' }]))).toBe(true);
		expect(
			resolveAll(m, 'ours')
				.get('plan.tjp')
				?.match(/task t /g),
		).toHaveLength(2);
	});

	it('theirs moved it: only Take theirs', () => {
		const m = merge1(base, edit, moved);
		const c = m.conflicts.find((x) => x.subject.kind === 'text');
		expect(c?.only).toBe('theirs');
		expect(isUnresolved(resolve(m, [{ conflict: c?.id ?? '', take: 'ours' }]))).toBe(true);
		expect(
			resolveAll(m, 'theirs')
				.get('plan.tjp')
				?.match(/task t /g),
		).toHaveLength(2);
	});

	it('a move to another file with a new full id (t to q.t) offers only the moving side', () => {
		const plan = `${H}include "more.tji"\ntask t "T" {\n  effort 1d\n}\n`;
		const more = 'task q "Q" {\n  length 1d\n}\n';
		const b = { 'plan.tjp': plan, 'more.tji': more };
		const ours = {
			'plan.tjp': plan.replace('task t "T" {\n  effort 1d\n}\n', ''),
			'more.tji': more.replace(
				'  length 1d\n',
				'  length 1d\n  task t "T" {\n    effort 1d\n  }\n',
			),
		};
		const theirs = { ...b, 'plan.tjp': plan.replace('effort 1d', 'effort 5d') };
		const m = mergeAll('plan.tjp', b, ours, theirs);
		expect(m.conflicts.map((c) => [c.file, c.only])).toEqual([['plan.tjp', 'ours']]);
		const swapped = mergeAll('plan.tjp', b, theirs, ours);
		expect(swapped.conflicts.map((c) => [c.file, c.only])).toEqual([['plan.tjp', 'theirs']]);
	});
});
