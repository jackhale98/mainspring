// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { isSafeText, parseString, printString, printStringPreferring } from './string-literal';

const read = (text: string) => {
	const r = parseString(text);
	if (!r.ok) throw new Error(`${text}: ${r.error.code}`);
	return r;
};

describe('parseString', () => {
	it('reads the three styles', () => {
		expect(read('"a"')).toMatchObject({ value: 'a', style: 'double' });
		expect(read("'a'")).toMatchObject({ value: 'a', style: 'single' });
		expect(read('-8<-\n  a\n  ->8-')).toMatchObject({ value: 'a\n', style: 'cut' });
	});

	it('unescapes only the quote character', () => {
		expect(read(String.raw`"say \"hi\" \n"`).value).toBe(String.raw`say "hi" \n`);
		expect(read(String.raw`"escaped \" quote and \\ text"`).value).toBe(
			String.raw`escaped " quote and \\ text`,
		);
		// `\\"` is a kept backslash, then an escaped quote: the string never closes.
		expect(parseString(String.raw`"\\"`)).toMatchObject({
			ok: false,
			error: { code: 'unterminated' },
		});
		expect(read(String.raw`'don\'t'`).value).toBe("don't");
		expect(read(String.raw`'x \" y'`).value).toBe(String.raw`x \" y`);
	});

	it('keeps comment-like text and braces inside strings', () => {
		expect(read('"# not // a /* comment */ { }"').value).toBe('# not // a /* comment */ { }');
	});

	it('refuses templated strings and non-strings', () => {
		expect(parseString('"a ${b}"')).toMatchObject({ ok: false, error: { code: 'macro-call' } });
		expect(parseString('a')).toMatchObject({ ok: false, error: { code: 'unexpected-token' } });
	});
});

describe('printString', () => {
	it('escapes the quote of the chosen style', () => {
		expect(printString('say "hi"')).toEqual({ ok: true, value: String.raw`"say \"hi\""` });
		expect(printString("it's", { style: 'single' })).toEqual({
			ok: true,
			value: String.raw`'it\'s'`,
		});
		expect(printString(String.raw`a\"b`)).toEqual({ ok: true, value: String.raw`"a\\"b"` });
		expect(printString('two\nlines')).toEqual({ ok: true, value: '"two\nlines"' });
	});

	it('reads back what it prints', () => {
		for (const v of ['', 'x', '"', String.raw`\"`, String.raw`a\b`, "'", 'é ✓ 🎉', 'a\r\nb']) {
			for (const style of ['double', 'single'] as const) {
				const p = printString(v, { style });
				expect(p.ok && read(p.value).value).toBe(v);
			}
		}
	});

	it('refuses text TaskJuggler would expand or cannot quote', () => {
		expect(printString('a ${b}')).toMatchObject({ ok: false, error: { code: 'unsafe-text' } });
		expect(printString('$(HOME)')).toMatchObject({ ok: false, error: { code: 'unsafe-text' } });
		expect(printString('ends with \\')).toMatchObject({
			ok: false,
			error: { code: 'unrepresentable' },
		});
		expect(isSafeText('$5 (net)')).toBe(true);
	});

	it('writes cut-here strings', () => {
		expect(printString('a\n  b\n', { style: 'cut', indent: '  ' })).toEqual({
			ok: true,
			value: '-8<-\n  a\n    b\n  ->8-',
		});
		expect(read('-8<-\n  a\n    b\n  ->8-').value).toBe('a\n  b\n');
		expect(printString('', { style: 'cut' })).toEqual({ ok: true, value: '-8<-\n->8-' });
		expect(printString('a', { style: 'cut' }).ok).toBe(false);
		expect(printString(' a\n', { style: 'cut' }).ok).toBe(false);
		expect(printString('a\n->8-\n', { style: 'cut' }).ok).toBe(false);
		expect(printString('a\n', { style: 'cut', indent: 'x' }).ok).toBe(false);
	});

	it('falls back to a style that can hold the value', () => {
		expect(printStringPreferring('x\\', 'double').ok).toBe(false);
		expect(printStringPreferring('a\n', 'cut')).toEqual({ ok: true, value: '-8<-\na\n->8-' });
		expect(printStringPreferring('a', 'cut')).toEqual({ ok: true, value: '"a"' });
	});
});
