// SPDX-License-Identifier: GPL-2.0-or-later
import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../../tests/grammar/corpus';
import {
	changeSetOf,
	createFile,
	parseTjp,
	printTree,
	syntaxIssues,
	textOf,
	updateFile,
	withTop,
} from './document';

const PLAN =
	'project p "P" 2026-01-05 +1m {\r\n  now 2026-01-05\r\n}\r\ntask a "A" {\r\n  effort 2d\r\n}\r\n';

describe('textOf and changeSetOf', () => {
	it('split lines on \\n only, keeping \\r', () => {
		const t = textOf(PLAN);
		expect(t.toString()).toBe(PLAN);
		expect(t.lines).toBe(PLAN.split('\n').length);
		expect(t.line(1).text.endsWith('\r')).toBe(true);
		const cs = changeSetOf({ from: 0, insert: 'a\r\nb\rc\n' }, t.length);
		expect(cs.apply(t).toString()).toBe(`a\r\nb\rc\n${PLAN}`);
	});
});

describe('parseTjp', () => {
	it('parses with the requested top context', () => {
		const text = 'timezone "UTC"\nnow 2026-01-05\n';
		expect(syntaxIssues(parseTjp(text, { top: 'project' }), textOf(text))).toEqual([]);
		expect(syntaxIssues(parseTjp(text, { top: 'global' }), textOf(text)).length).toBeGreaterThan(0);
		const prolog = 'macro m [x]\ninclude "a.tji"\n';
		expect(syntaxIssues(parseTjp(prolog, { top: 'prolog' }), textOf(prolog))).toEqual([]);
	});
});

describe('TjpFile', () => {
	it('starts at version 0 and round-trips', () => {
		const f = createFile('plan.tjp', PLAN);
		expect(f.version).toBe(0);
		expect(f.top).toBe('global');
		expect(f.text.toString()).toBe(PLAN);
		expect(printTree(f.tree, PLAN)).toBe(PLAN);
	});

	it('updates incrementally to the tree of a fresh parse', () => {
		const f = createFile('plan.tjp', PLAN);
		const at = PLAN.indexOf('2d');
		const g = updateFile(
			f,
			changeSetOf({ from: at, to: at + 2, insert: '5d\r\n  milestone' }, f.text.length),
		);
		const text = g.text.toString();
		expect(text).toContain('effort 5d\r\n  milestone');
		expect(g.version).toBe(1);
		expect(serialize(g.tree)).toEqual(serialize(parseTjp(text)));
	});

	it('keeps trees equal to fresh parses around syntax errors', () => {
		let f = createFile('plan.tjp', PLAN);
		for (const [find, insert] of [
			['effort', '"'],
			['"A"', '{'],
			['"', ''],
		] as const) {
			const at = f.text.toString().indexOf(find);
			f = updateFile(f, changeSetOf({ from: at, insert }, f.text.length));
			expect(serialize(f.tree)).toEqual(serialize(parseTjp(f.text.toString())));
		}
	});

	it('returns the same file for an empty change and rejects a wrong length', () => {
		const f = createFile('plan.tjp', PLAN);
		expect(updateFile(f, ChangeSet.empty(f.text.length))).toBe(f);
		expect(() => updateFile(f, ChangeSet.empty(3))).toThrow(RangeError);
	});

	it('reparses with another top context', () => {
		const f = createFile('a.tji', 'timezone "UTC"\n');
		const g = withTop(f, 'project');
		expect(g.top).toBe('project');
		expect(g.version).toBe(1);
		expect(withTop(g, 'project')).toBe(g);
		expect(syntaxIssues(g.tree, g.text)).toEqual([]);
		const h = updateFile(g, changeSetOf({ from: 0, insert: 'now 2026-01-05\n' }, g.text.length));
		expect(h.top).toBe('project');
		expect(syntaxIssues(h.tree, h.text)).toEqual([]);
	});
});
