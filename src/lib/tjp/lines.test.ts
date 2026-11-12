// SPDX-License-Identifier: GPL-2.0-or-later
// TaskJuggler line numbers (lines.ts): `\n`, `\r\n` and a lone `\r` each end one line.
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { TjLines, tjLineOf, tjLineRange } from './lines';

describe('TjLines', () => {
	it.each([
		['\\n', 'a\nbb\nccc'],
		['\\r\\n', 'a\r\nbb\r\nccc'],
		['a lone \\r', 'a\rbb\rccc'],
		['mixed breaks', 'a\r\nbb\rccc'],
	])('counts lines broken by %s', (_what, text) => {
		const lines = new TjLines(text);
		expect(lines.count).toBe(3);
		expect(lines.lineOf(0)).toBe(1);
		expect(lines.lineOf(text.indexOf('bb'))).toBe(2);
		expect(lines.lineOf(text.indexOf('ccc') + 2)).toBe(3);
		expect(text.slice(lines.range(1).from, lines.range(1).to)).toBe('a');
		expect(text.slice(lines.range(2).from, lines.range(2).to)).toBe('bb');
		expect(text.slice(lines.range(3).from, lines.range(3).to)).toBe('ccc');
	});

	it('keeps a break with its line, and \\r\\n as one break', () => {
		const text = 'a\r\nb';
		expect(tjLineOf(text, 1)).toBe(1); // the \r
		expect(tjLineOf(text, 2)).toBe(1); // the \n of \r\n
		expect(tjLineOf(text, 3)).toBe(2);
		expect(new TjLines('a\r\r\nb').count).toBe(3);
	});

	it('counts blank lines and a final break', () => {
		const lines = new TjLines('a\r\rb\r');
		expect(lines.count).toBe(4);
		expect(lines.range(2)).toEqual({ from: 2, to: 2 });
		expect(lines.range(4)).toEqual({ from: 5, to: 5 });
	});

	it('clamps offsets and rejects missing lines', () => {
		const lines = new TjLines('a\nb');
		expect(lines.lineOf(-3)).toBe(1);
		expect(lines.lineOf(99)).toBe(2);
		expect(() => lines.range(0)).toThrow(RangeError);
		expect(() => lines.range(3)).toThrow(RangeError);
	});

	it('reads CodeMirror documents too', () => {
		const doc = Text.of(['a\rb', 'c']);
		expect(tjLineOf(doc, doc.toString().indexOf('c'))).toBe(3);
		expect(tjLineRange(doc, 2)).toEqual({ from: 2, to: 3 });
	});
});
