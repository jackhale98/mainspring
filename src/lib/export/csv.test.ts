// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { BOM, csvField, csvFile, csvText } from './csv';

describe('csvField', () => {
	it('leaves a plain field as it is', () => {
		expect(csvField('Research')).toBe('Research');
		expect(csvField('')).toBe('');
		expect(csvField('2026-03-02 09:00')).toBe('2026-03-02 09:00');
	});

	it('quotes a field with a comma, a quote or a line break, and doubles the quotes', () => {
		expect(csvField('Ana, Ben')).toBe('"Ana, Ben"');
		expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
		expect(csvField('two\nlines')).toBe('"two\nlines"');
		expect(csvField('a\rb')).toBe('"a\rb"');
		expect(csvField('"')).toBe('""""');
	});

	it('keeps a leading space, a semicolon and unicode unquoted', () => {
		expect(csvField(' x; y')).toBe(' x; y');
		expect(csvField('Überprüfung ✓')).toBe('Überprüfung ✓');
	});
});

describe('csvText', () => {
	it('ends every record, the last too, with CRLF', () => {
		expect(
			csvText([
				['a', 'b'],
				['1', '2'],
			]),
		).toBe('a,b\r\n1,2\r\n');
	});

	it('writes an empty field between commas, and nothing for no rows', () => {
		expect(csvText([['a', '', 'c']])).toBe('a,,c\r\n');
		expect(csvText([])).toBe('');
	});
});

describe('csvFile', () => {
	it('starts with a byte order mark that is EF BB BF in UTF-8', () => {
		const text = csvFile([['é']]);
		expect(text.startsWith(BOM)).toBe(true);
		expect([...new TextEncoder().encode(text)].slice(0, 5)).toEqual([0xef, 0xbb, 0xbf, 0xc3, 0xa9]);
	});
});
