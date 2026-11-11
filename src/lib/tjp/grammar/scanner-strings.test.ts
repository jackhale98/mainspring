// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for the string modes of the scanner port. Cases marked "native" were checked
// against TaskJuggler 3.8.4's own scanner while writing the port.
import { describe, expect, it } from 'vitest';
import { TokenFlag, type TjpToken } from './token-kinds';
import { tokenizeTjp } from './tokens';

/** `Kind:text` for every token except whitespace; `!reason` marks errors. */
function lex(text: string): string[] {
	return tokenizeTjp(text)
		.filter((t) => t.kind !== 'Whitespace')
		.map((t) => `${t.kind}:${text.slice(t.from, t.to)}${t.error ? `!${t.error}` : ''}`);
}

function only(text: string, kind: TjpToken['kind']): TjpToken {
	const found = tokenizeTjp(text).filter((t) => t.kind === kind);
	expect(found).toHaveLength(1);
	return found[0] as TjpToken;
}

describe('strings', () => {
	it('reads a line of many short strings linearly, with the same tokens', () => {
		const text = 'a "s" \'t\' "u\\"v" '.repeat(500);
		const strings = tokenizeTjp(text).filter((t) => t.kind === 'String');
		expect(strings).toHaveLength(1500);
		expect(text.slice(strings[2]?.from, strings[2]?.to)).toBe('"u\\"v"');
	});
	it('reads double- and single-quoted strings across lines', () => {
		expect(lex('"a\nb" \'c\nd\' ""')).toEqual(['String:"a\nb"', "String:'c\nd'", 'String:""']);
		expect(only("'x'", 'String').flags).toBe(TokenFlag.SingleQuoted);
	});
	it('treats any quote after a backslash as escaped (native)', () => {
		expect(lex('"a\\\\" b" \'it\\\'s\' "q\'"')).toEqual([
			'String:"a\\\\" b"',
			"String:'it\\'s'",
			'String:"q\'"',
		]);
	});
	it('keeps comment-like text inside strings', () => {
		expect(lex('"# a // b /* c */"')).toEqual(['String:"# a // b /* c */"']);
	});
	it('ends a last line without a line feed at an escaped quote (native)', () => {
		expect(lex('"x\nabc\\" def')).toEqual(['String:"x\nabc\\"', 'Identifier:def']);
	});
	it('makes an unterminated string an error to the end (native)', () => {
		expect(lex('a "b\nc\n')).toEqual(['Identifier:a', 'Error:"b\nc\n!unterminated-string']);
		expect(lex('"abc\\" def')).toEqual(['Error:"abc\\" def!unterminated-string']);
	});
});

describe('cut-here strings', () => {
	it('closes at a line whose first non-blank text is ->8- (native)', () => {
		expect(lex('x -8<-   \n  y ->8- z\n\t->8-w\n')).toEqual([
			'Identifier:x',
			'String:-8<-   \n  y ->8- z\n\t->8-',
			'Identifier:w',
		]);
		const t = only('-8<-\n->8-', 'String');
		expect([t.to, t.flags]).toEqual([9, TokenFlag.CutHere]);
	});
	it('accepts CRLF after the mark', () => {
		expect(lex('-8<-\r\na\r\n  ->8-\r\n')).toEqual(['String:-8<-\r\na\r\n  ->8-']);
	});
	it('makes junk after -8<- an error token over the string only (native: junk_after_cut)', () => {
		expect(lex('-8<- junk\n x\n->8- a')).toEqual([
			'Error:-8<- junk\n x\n->8-!junk-after-cut',
			'Identifier:a',
		]);
		expect(lex('-8<- ->8- {\nx\n')).toEqual(['Error:-8<- ->8- {\nx\n!junk-after-cut']);
	});
	it('checks for junk unanchored, as TaskJuggler does (native)', () => {
		expect(lex('-8<- junk -8<-\n x\n->8- a')).toEqual([
			'String:-8<- junk -8<-\n x\n->8-',
			'Identifier:a',
		]);
	});
	it('reads -8<- on a last line without a line feed as punctuation (native)', () => {
		expect(lex('a -8<-')).toEqual(['Identifier:a', 'Punct:-', 'Integer:8', 'Punct:<', 'Punct:-']);
	});
	it('makes an unterminated cut-here string an error to the end', () => {
		expect(lex('-8<-\nabc\n')).toEqual(['Error:-8<-\nabc\n!unterminated-string']);
	});
	it('flags macro calls inside, which may span lines', () => {
		const t = only('-8<-\n a ${m "x"\n "y"} ->8-\n->8-', 'String');
		expect(t.flags).toBe(TokenFlag.CutHere | TokenFlag.Macro);
		// The prefix and expansion are rescanned first, so the ->8- after the call is text.
		expect(t.to).toBe(31);
		expect(lex('-8<-\n${a}\n${b} x\n  ->8- y')).toEqual([
			'String:-8<-\n${a}\n${b} x\n  ->8-',
			'Identifier:y',
		]);
	});
	it('runs to the end when only an expansion would close it (upstream Macros.tjp)', () => {
		expect(lex('note -8<-\n  ${n5}\n}\n')).toEqual([
			'Identifier:note',
			'Error:-8<-\n  ${n5}\n}\n!unterminated-string',
		]);
	});
});
