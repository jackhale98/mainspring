// SPDX-License-Identifier: GPL-2.0-or-later
// Highlighting tags on TJP trees (highlight.ts).
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { tjpGlobalParser } from './parser';

const highlighter = tagHighlighter([
	{ tag: t.keyword, class: 'kw' },
	{ tag: t.string, class: 'str' },
	{ tag: t.number, class: 'num' },
	{ tag: t.unit, class: 'unit' },
	{ tag: t.literal, class: 'lit' },
	{ tag: t.lineComment, class: 'cmt' },
	{ tag: t.macroName, class: 'mac' },
	{ tag: t.definition(t.variableName), class: 'def' },
	{ tag: t.variableName, class: 'var' },
	{ tag: t.attributeName, class: 'attr' },
	{ tag: t.brace, class: 'brace' },
]);

function classes(text: string): string[] {
	const out: string[] = [];
	highlightTree(tjpGlobalParser.parse(text), highlighter, (from, to, cls) => {
		out.push(`${cls}:${text.slice(from, to)}`);
	});
	return out;
}

describe('highlighting', () => {
	it('tags keywords, ids, values, macros and comments', () => {
		const text =
			'task t "T" { # c\n effort 5d start 2024-01-01 depends !a allocate ${r} Phone "1" }';
		expect(classes(text)).toEqual([
			'kw:task',
			'def:t',
			'str:"T"',
			'brace:{',
			'cmt:# c',
			'kw:effort',
			'num:5',
			'unit:d',
			'kw:start',
			'lit:2024-01-01',
			'kw:depends',
			'var:a',
			'kw:allocate',
			'mac:${r}',
			'attr:Phone',
			'str:"1"',
			'brace:}',
		]);
	});
});
