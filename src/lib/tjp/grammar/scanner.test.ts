// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for the ProjectFileScanner port. Cases marked "native" were checked against
// TaskJuggler 3.8.4's own scanner while writing the port.
import { describe, expect, it } from 'vitest';
import { scanToken, type ScanSource } from './scanner';
import { StringSource } from './scanner-core';
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

describe('trivia', () => {
	it('merges ASCII whitespace across lines, CRLF included', () => {
		expect(tokenizeTjp(' \t\v\f\r\n \r\nx').map((t) => t.kind)).toEqual([
			'Whitespace',
			'Identifier',
		]);
	});
	it('treats NBSP and a U+FEFF after offset 0 as punctuation, as Ruby does', () => {
		expect(lex('a\u00a0b\ufeff')).toEqual([
			'Identifier:a',
			'Punct:\u00a0',
			'Identifier:b',
			'Punct:\ufeff',
		]);
	});
	it('keeps a leading BOM as trivia', () => {
		expect(tokenizeTjp('\ufefftask').map((t) => t.kind)).toEqual(['Bom', 'Identifier']);
	});
	it('ends # and // comments before the line break: \n, \r\n or a lone \r (native)', () => {
		expect(lex('# a // b\nx // c\r\ny # c\r  effort 3d #')).toEqual([
			'LineComment:# a // b',
			'Identifier:x',
			'LineComment:// c',
			'Identifier:y',
			'LineComment:# c',
			'Identifier:effort',
			'Integer:3',
			'Identifier:d',
			'LineComment:#',
		]);
	});
	it('ends a block comment line at \r as well', () => {
		expect(lex('/* a */ b\r*/ c')).toEqual([
			'BlockComment:/* a */',
			'Identifier:b',
			'Punct:*',
			'Punct:/',
			'Identifier:c',
		]);
		expect(lex('/* a\rb */ c')).toEqual(['BlockComment:/* a\rb */', 'Identifier:c']);
	});
	it('makes a one-line block comment greedy to the last */ (native)', () => {
		expect(lex('/* a */ b */ c\n/**/ d\n/*/ e */')).toEqual([
			'BlockComment:/* a */ b */',
			'Identifier:c',
			'BlockComment:/**/',
			'Identifier:d',
			'BlockComment:/*/ e */',
		]);
	});
	it('ends a multi-line comment at the last */ on its closing line (native)', () => {
		expect(lex('/* a\n# b\nc */ d */ e\n')).toEqual([
			'BlockComment:/* a\n# b\nc */ d */',
			'Identifier:e',
		]);
	});
	it('reads /* without */ on a last line with no line feed as punctuation (native)', () => {
		expect(lex('a /* foo')).toEqual(['Identifier:a', 'Punct:/', 'Punct:*', 'Identifier:foo']);
	});
	it('makes an unterminated comment an error to the end', () => {
		expect(lex('a /* b\nc')).toEqual(['Identifier:a', 'Error:/* b\nc!unterminated-comment']);
	});
});

describe('identifiers and numbers', () => {
	it('tries ScenarioPrefix, then AbsoluteId, then Identifier', () => {
		expect(lex('delayed:effort a.b.c a.b: a.5 a. _x9')).toEqual([
			'ScenarioPrefix:delayed:',
			'Identifier:effort',
			'AbsoluteId:a.b.c',
			'AbsoluteId:a.b',
			'Punct::',
			'Identifier:a',
			'Float:.5',
			'Identifier:a',
			'Punct:.',
			'Identifier:_x9',
		]);
	});
	it('does not treat non-ASCII letters as word characters', () => {
		expect(lex('é1')).toEqual(['Punct:é', 'Integer:1']);
	});
	it('tries Date, Time, Float, Integer in order (native)', () => {
		expect(lex('2024-1-2-3:4:5-+0100 2024-1-2-3 10:300 1.2.3 5d 007')).toEqual([
			'Date:2024-1-2-3:4:5-+0100',
			'Date:2024-1-2',
			'Punct:-',
			'Integer:3',
			'Time:10:30',
			'Integer:0',
			'Float:1.2',
			'Float:.3',
			'Integer:5',
			'Identifier:d',
			'Integer:007',
		]);
	});
	it('reads dates with seconds and zones, and keeps 100:00 apart', () => {
		expect(lex('2026-01-05-09:00 2026-01-05-09:00:30-0500 100:00')).toEqual([
			'Date:2026-01-05-09:00',
			'Date:2026-01-05-09:00:30-0500',
			'Integer:100',
			'Punct::',
			'Integer:00',
		]);
	});
});

describe('macro bodies', () => {
	it('reads [ … ]\\n on one line, greedy to the last ]', () => {
		expect(lex('macro a [x] [y]\nb')).toEqual([
			'Identifier:macro',
			'Identifier:a',
			'MacroBody:[x] [y]',
			'Identifier:b',
		]);
	});
	it('needs ] to end its line; otherwise it ends at the first line ending in ] (native)', () => {
		expect(lex('macro a [x] # c\nfoo]\nbar\n')).toEqual([
			'Identifier:macro',
			'Identifier:a',
			'MacroBody:[x] # c\nfoo]',
			'Identifier:bar',
		]);
	});
	it('leaves the required line feed to whitespace', () => {
		const toks = tokenizeTjp('[a\nb]\nc');
		expect(toks.map((t) => [t.kind, t.from, t.to])).toEqual([
			['MacroBody', 0, 5],
			['Whitespace', 5, 6],
			['Identifier', 6, 7],
		]);
	});
	it('closes on ] before \r\n or a lone \r, which TaskJuggler reads as \n (native)', () => {
		expect(lex('macro a [x]\r\ntask\r\n')).toEqual([
			'Identifier:macro',
			'Identifier:a',
			'MacroBody:[x]',
			'Identifier:task',
		]);
		expect(lex('macro a [\r\n  effort 3d\r\n]\r\nb')).toEqual([
			'Identifier:macro',
			'Identifier:a',
			'MacroBody:[\r\n  effort 3d\r\n]',
			'Identifier:b',
		]);
		expect(lex('macro a [x]\rb [\ry\r]\r')).toEqual([
			'Identifier:macro',
			'Identifier:a',
			'MacroBody:[x]',
			'Identifier:b',
			'MacroBody:[\ry\r]',
		]);
		expect(lex('[x] \r]\r')).toEqual(['MacroBody:[x] \r]']);
	});
	it('reads [ on a last line without a line feed as punctuation (native)', () => {
		expect(lex('a [b]')).toEqual(['Identifier:a', 'Punct:[', 'Identifier:b', 'Punct:]']);
	});
	it('does not expand calls inside a body', () => {
		expect(lex('[${1}d]\n')).toEqual(['MacroBody:[${1}d]']);
	});
});

describe('macro calls', () => {
	it('reads a lone call, with optional ?, blanks and quoted arguments', () => {
		expect(lex('${x} ${ ?y } ${z "a" "b\\"c"}')).toEqual([
			'MacroCall:${x}',
			'MacroCall:${ ?y }',
			'MacroCall:${z "a" "b\\"c"}',
		]);
		expect(only('${x}', 'MacroCall').flags).toBe(TokenFlag.Macro);
	});
	it('lets arguments continue on later lines', () => {
		expect(lex('${x "a"\n  "b"\n} y')).toEqual(['MacroCall:${x "a"\n  "b"\n}', 'Identifier:y']);
	});
	it('needs the name on the line of ${', () => {
		expect(lex('${\nx}')).toEqual(['Punct:$', 'Punct:{', 'Identifier:x', 'Punct:}']);
	});
	it('swallows lines until one starts with } when the arguments are not quoted', () => {
		expect(lex('${x bad}\nfoo\n} y')).toEqual(['MacroCall:${x bad}\nfoo\n}', 'Identifier:y']);
	});
	it('makes an unterminated call an error to the end', () => {
		expect(lex('a ${x "b"\nc')).toEqual([
			'Identifier:a',
			'Error:${x "b"\nc!unterminated-macro-call',
		]);
	});
	it('glues prefixes, suffixes and chained calls into one MacroWord', () => {
		expect(
			lex('t${major} ${content}${major} ${tid}_sub ${y}-01-01 a.${b}.c ${?undefined}1d 1d${?x}'),
		).toEqual([
			'MacroWord:t${major}',
			'MacroWord:${content}${major}',
			'MacroWord:${tid}_sub',
			'MacroWord:${y}-01-01',
			'MacroWord:a.${b}.c',
			'MacroWord:${?undefined}1d',
			'MacroWord:1d${?x}',
		]);
	});
	it('reads $(NAME) as EnvRef, uppercase only, on one line', () => {
		expect(lex('$(HOME) a$(X_1)b $(lower)')).toEqual([
			'EnvRef:$(HOME)',
			'EnvRef:a$(X_1)b',
			'Punct:$',
			'Punct:(',
			'Identifier:lower',
			'Punct:)',
		]);
		expect(only('$(A)${b}', 'MacroWord').flags).toBe(TokenFlag.Macro | TokenFlag.Env);
	});
	it('keeps a string around its calls and flags it templated', () => {
		expect(lex('"${title "Plain" "name"}" "a ${x}\n${y} b" \'say "hi ${x}"\'')).toEqual([
			'String:"${title "Plain" "name"}"',
			'String:"a ${x}\n${y} b"',
			'String:\'say "hi ${x}"\'',
		]);
		expect(only('"a ${x} b"', 'String').flags).toBe(TokenFlag.Macro);
		expect(only('"a ${x\n} b"', 'String').to).toBe(11);
	});
	it('flags env references on the opening line only, as TaskJuggler expands them', () => {
		expect(only('"$(HOME)/x"', 'String').flags).toBe(TokenFlag.Env);
		expect(only('"a\n$(HOME)"', 'String').flags).toBe(0);
		expect(only('"${ 1 } $"', 'String').flags).toBe(0);
	});
});

describe('punctuation', () => {
	it('reads <=, >= and != as one token, anything else as one code point', () => {
		expect(lex('<= >= != <> ! = 😀 {}')).toEqual([
			'Punct:<=',
			'Punct:>=',
			'Punct:!=',
			'Punct:<',
			'Punct:>',
			'Punct:!',
			'Punct:=',
			'Punct:😀',
			'Punct:{',
			'Punct:}',
		]);
		expect(tokenizeTjp('\ud800x').map((t) => t.to)).toEqual([1, 2]);
	});
});

describe('scanToken', () => {
	/** A string source starting at `start` that records the farthest offset it was asked for. */
	function source(text: string, start: number): ScanSource & { readonly far: number } {
		const inner = new StringSource(text);
		inner.base = start;
		const src = {
			far: -1,
			peek(offset: number) {
				src.far = Math.max(src.far, offset);
				return inner.peek(offset);
			},
			slice(offset: number, length: number) {
				const s = inner.slice(offset, length);
				src.far = Math.max(src.far, offset + s.length - 1);
				return s;
			},
			line(offset: number) {
				const s = inner.line(offset);
				src.far = Math.max(src.far, offset + s.length - 1);
				return s;
			},
		};
		return src;
	}
	it('returns null at the end of input', () => {
		expect(scanToken(source('', 0), true)).toBeNull();
		expect(scanToken(source('ab', 2), false)).toBeNull();
	});
	it('reads a BOM only at the start of the file', () => {
		expect(scanToken(source('\ufeffa', 0), true)?.kind).toBe('Bom');
		expect(scanToken(source('\ufeffa', 0), false)?.kind).toBe('Punct');
	});
	it('scans from a token boundary inside the text', () => {
		const text = 'task a "A\nB" { }';
		expect(scanToken(source(text, 7), false)).toEqual({
			kind: 'String',
			length: 5,
			flags: 0,
			error: null,
		});
	});
	it('reads only the token and two more code units for words, numbers and punctuation', () => {
		const tail = ' x'.repeat(1000) + '\n';
		for (const [head, length] of [
			['task', 4],
			['a.b.c', 5],
			['2024-01-02', 10],
			['10:30', 5],
			['{', 1],
			['"s"', 3],
			['<=', 2],
		] as const) {
			const src = source(head + tail, 0);
			expect(scanToken(src, false)?.length).toBe(length);
			expect(src.far, head).toBeLessThanOrEqual(length + 1);
		}
	});
	it('reads the rest of the line only where a pattern looks there', () => {
		const src = source('/* a */ b */ c\nd', 0);
		expect(scanToken(src, false)?.length).toBe(12);
		expect(src.far).toBe(14);
	});
});
