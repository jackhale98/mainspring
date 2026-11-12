// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFile, textOf } from './document';
import {
	contentAtOrBefore,
	contentSpan,
	engineLine,
	engineLineAt,
	engineLineCount,
	lineColumn,
} from './diagnostics-lines';

describe('engine lines', () => {
	it('count \\n, \\r\\n and a lone \\r as one break each, as TaskJuggler does', () => {
		const doc = textOf('a\nb\r\nc\rd');
		expect(engineLineCount(doc)).toBe(4);
		const s = doc.toString();
		expect(
			[1, 2, 3, 4].map((n) => s.slice(engineLine(doc, n).from, engineLine(doc, n).to)),
		).toEqual(['a', 'b', 'c', 'd']);
		expect(engineLineAt(doc, s.indexOf('d'))).toBe(4);
		expect(engineLineAt(doc, s.indexOf('c'))).toBe(3);
	});

	it('clamp lines before the first and after the last', () => {
		const doc = textOf('one\ntwo\n');
		expect(engineLine(doc, 0).number).toBe(1);
		expect(engineLine(doc, 99)).toEqual({ from: 8, to: 8, number: 3 });
	});

	it('give line and column by the same rule', () => {
		const doc = textOf('ab\rcd\nef');
		expect(lineColumn(doc, 4)).toEqual({ line: 2, column: 2 });
		expect(lineColumn(doc, 7)).toEqual({ line: 3, column: 2 });
		expect(lineColumn(doc, 99)).toEqual({ line: 3, column: 3 });
	});

	it('agree with CodeMirror lines for files without a lone \\r', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('a', ' ', '\n', '\r\n', 'é', '日'), { maxLength: 40 }),
				fc.nat(),
				(parts, k) => {
					const doc = textOf(parts.join(''));
					const pos = k % (doc.length + 1);
					const cm = doc.lineAt(pos);
					const at = engineLineAt(doc, pos);
					expect(at).toBe(cm.number);
					expect(engineLine(doc, at).from).toBe(cm.from);
				},
			),
		);
	});
});

describe('contentSpan', () => {
	const f = createFile('plan.tjp', 'task a "A" {\n  effort 2d # why\n  # only a comment\n\n}\n');
	const s = f.text.toString();
	const content = (n: number) => {
		const span = contentSpan(f.tree, s, engineLine(f.text, n));
		return span && s.slice(span.from, span.to);
	};

	it('trims blanks and a trailing comment', () => {
		expect(content(2)).toBe('effort 2d');
		expect(content(1)).toBe('task a "A" {');
	});

	it('is null for a comment-only or blank line', () => {
		expect(content(3)).toBeNull();
		expect(content(4)).toBeNull();
	});

	it('finds the nearest line with content before a blank one', () => {
		const back = contentAtOrBefore(f.tree, f.text, 4);
		expect(back && [back.line, s.slice(back.from, back.to)]).toEqual([2, 'effort 2d']);
	});
});
