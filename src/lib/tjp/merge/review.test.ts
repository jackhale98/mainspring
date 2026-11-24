// SPDX-License-Identifier: GPL-2.0-or-later
// Cases from the T6 review (L1, L4, L5): "Keep both" where it would declare a block twice, a task
// moved into another block on one side and edited on the other, a lost last line break, and an
// attribute theirs added to a one-line body.
import { describe, expect, it } from 'vitest';
import { insertStatement } from './resolve';
import { merge1, resolveAll } from './testing';

const H = 'project p "P" 2027-01-04 +3m\nresource dev "Dev"\n';
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';
const count = (t: string | undefined, s: string): number => (t ?? '').split(s).length - 1;

describe('Keep both (L1)', () => {
	it('is not offered on a text conflict whose sides hold the same task', () => {
		const A = 'task a "A" {\n  effort 1d\n}\n';
		const B = 'task b "B" {\n  effort 1d\n}\n';
		const C = 'task c "C" {\n  effort 2d\n}\n';
		const m = merge1(`${H}${A}${B}${C}`, `${H}${B}${A}${C}`, `${H}${A}${C}${B}`);
		expect(m.conflicts.map((c) => [c.subject.kind, c.both])).toEqual([['text', false]]);
		// Different tasks added at one place still offer it.
		const add = merge1(`${H}${A}`, `${H}${A}${B}`, `${H}${A}${C}`);
		expect(add.conflicts.map((c) => c.both)).toEqual([true]);
	});
});

describe('a task moved into another block on one side, edited on the other (L4)', () => {
	const T = '    task t "T" {\n      effort 1d\n    }\n';
	const base = `${H}task p1 "P1" {\n  task x "X" {\n${T}  }\n}\ntask p2 "P2" {\n  task y "Y"\n}\n`;
	const ours = `${H}task p1 "P1" {\n  task x "X" {\n  }\n}\ntask p2 "P2" {\n  task y "Y"\n${T.replace(/^ {2}/gm, '')}}\n`;
	const theirs = base.replace('effort 1d', 'effort 5d');

	it('is one conflict, without Keep both, and every choice leaves one task', () => {
		const m = merge1(base, ours, theirs);
		expect(m.conflicts).toHaveLength(1);
		expect(m.conflicts[0]?.both).toBe(false);
		expect(count(text(m), 'task t "T"')).toBe(1);
		expect(resolveAll(m, 'ours').get('plan.tjp')).toBe(ours);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(theirs);
		const swapped = merge1(base, theirs, ours);
		expect(swapped.conflicts).toHaveLength(1);
		expect(count(resolveAll(swapped, 'theirs').get('plan.tjp'), 'task t "T"')).toBe(1);
	});

	it('merges the move cleanly when the other side did not touch the blocks', () => {
		const elsewhere = base.replace('resource dev "Dev"', 'resource dev "Dev"\nresource qa "QA"');
		const m = merge1(base, ours, elsewhere);
		expect(m.conflicts).toEqual([]);
		expect(count(text(m), 'task t "T"')).toBe(1);
	});
});

describe('line breaks and one-line bodies (L5)', () => {
	it('keeps a line break between ours’ last line without one and a task theirs appended', () => {
		const base = `${H}task a "A" {\n  effort 1d\n}\n`;
		const ours = base.slice(0, -1);
		const theirs = `${base}task n "N" {\n  effort 2d\n}\n`;
		const m = merge1(base, ours, theirs);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(`${ours}\ntask n "N" {\n  effort 2d\n}\n`);
	});

	it('puts an attribute theirs added to a one-line body on that line', () => {
		const t = 'task a "A" { effort 1d }\n';
		expect(insertStatement(t, t.indexOf('}'), 'priority 7')).toBe(
			'task a "A" { effort 1d priority 7 }\n',
		);
		expect(insertStatement(t, t.indexOf('{') + 1, 'priority 7')).toBe(
			'task a "A" { priority 7 effort 1d }\n',
		);
		const base = `${H}task a "A" { effort 1d priority 5 }\n`;
		const m = merge1(
			base,
			`${H}task a "A" { effort 2d }\n`,
			`${H}task a "A" { effort 1d priority 7 }\n`,
		);
		expect(m.conflicts.map((c) => [c.subject.kind, c.ours, c.theirs])).toEqual([
			['attribute', null, 'priority 7'],
		]);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(
			`${H}task a "A" { effort 2d priority 7 }\n`,
		);
	});
});
