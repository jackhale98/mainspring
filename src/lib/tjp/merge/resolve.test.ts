// SPDX-License-Identifier: GPL-2.0-or-later
// Applying choices (resolve.ts): statement insertion and removal, Keep both, the kept-file rule.
import { describe, expect, it } from 'vitest';
import { indentFor, insertStatement, removeStatement, resolve } from './resolve';
import type { MergeConflict, WorkspaceMerge } from './types';

describe('insertStatement', () => {
	it('puts a statement on its own line, indented like the statements around it', () => {
		const t = 'task a "A" {\n  effort 1d\n}\n';
		const at = t.indexOf('}');
		expect(insertStatement(t, at, 'priority 5')).toBe(
			'task a "A" {\n  effort 1d\n  priority 5\n}\n',
		);
		expect(insertStatement(t, t.indexOf('  effort'), 'priority 5')).toBe(
			'task a "A" {\n  priority 5\n  effort 1d\n}\n',
		);
	});

	it('opens a line after a brace, with one more level, and keeps CRLF', () => {
		const t = 'task a "A" {\r\n}\r\n';
		expect(insertStatement(t, t.indexOf('{') + 1, 'effort 1d')).toBe(
			'task a "A" {\r\n  effort 1d\r\n}\r\n',
		);
		expect(indentFor('x {\n\ty\n}\n', 'x {\n\ty\n}\n'.indexOf('}'))).toBe('\t');
	});
});

describe('removeStatement', () => {
	it('removes the statement, and its line when nothing else is left on it', () => {
		const t = 'task a "A" {\n  effort 1d\n  allocate r\n}\n';
		const from = t.indexOf('effort');
		expect(removeStatement(t, from, from + 'effort 1d'.length)).toBe(
			'task a "A" {\n  allocate r\n}\n',
		);
		const one = 'task a "A" { effort 1d allocate r }\n';
		const f = one.indexOf('effort');
		expect(removeStatement(one, f, f + 9)).toBe('task a "A" {  allocate r }\n');
		expect(removeStatement(t, 5, 5)).toBe(t);
	});
});

describe('resolve', () => {
	const c = (over: Partial<MergeConflict>): MergeConflict => ({
		id: 'x',
		file: 'a.tji',
		subject: { kind: 'text' },
		base: 'b\n',
		ours: 'o\n',
		theirs: 't\n',
		at: { file: 'a.tji', from: 0, to: 2 },
		atOurs: { file: 'a.tji', from: 0, to: 2 },
		both: true,
		...over,
	});
	const m = (files: Record<string, string>, conflicts: MergeConflict[]): WorkspaceMerge => ({
		files: new Map(Object.entries(files)),
		conflicts,
	});

	it('applies each choice to its region, last region first', () => {
		const two = m({ 'a.tji': 'o\nx\nO\n' }, [
			c({ id: '1' }),
			c({ id: '2', ours: 'O\n', theirs: 'T\n', at: { file: 'a.tji', from: 4, to: 6 } }),
		]);
		const r = resolve(two, [
			{ conflict: '1', take: 'both' },
			{ conflict: '2', take: { text: 'E\n' } },
		]);
		expect(r).toEqual(new Map([['a.tji', 'o\nt\nx\nE\n']]));
	});

	it('removes a block on Keep mine when ours deleted it, and keeps a file a choice would remove', () => {
		const block = m({ 'a.tji': 'k\nB\n' }, [
			c({
				subject: {
					kind: 'block',
					owner: { kind: 'task', id: 'b', name: null },
					change: 'deleted-ours',
				},
				ours: null,
				theirs: 'B\n',
				at: { file: 'a.tji', from: 2, to: 4 },
				both: false,
			}),
		]);
		expect(resolve(block, [{ conflict: 'x', take: 'ours' }])).toEqual(new Map([['a.tji', 'k\n']]));
		const file = m({ 'a.tji': 'o\n' }, [
			c({ subject: { kind: 'file', change: 'deleted-theirs' }, theirs: null, both: false }),
		]);
		expect(resolve(file, [{ conflict: 'x', take: 'theirs' }])).toEqual(new Map([['a.tji', 'b\n']]));
	});
});
