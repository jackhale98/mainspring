// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ValueLexer, hasExpansion, type Token } from './lex';
import { ValueParseError } from './result';

function lex(text: string, base = 0): Token[] {
	const l = new ValueLexer(text, base);
	const out: Token[] = [];
	for (let t = l.next(); t !== null; t = l.next()) out.push(t);
	return out;
}
const kinds = (text: string) => lex(text).map((t) => `${t.kind}:${t.text}`);
function lexError(text: string) {
	try {
		lex(text);
	} catch (e) {
		if (e instanceof ValueParseError) return e.error;
		throw e;
	}
	throw new Error('expected a lex error');
}

describe('ValueLexer', () => {
	it('splits 5d into an integer and an id, as the scanner does', () => {
		expect(kinds('5d')).toEqual(['integer:5', 'id:d']);
		expect(kinds('1.5h')).toEqual(['float:1.5', 'id:h']);
		expect(kinds('.5')).toEqual(['float:.5']);
		expect(kinds('5.')).toEqual(['integer:5', 'literal:.']);
	});

	it('tries DATE before TIME before FLOAT before INTEGER', () => {
		expect(kinds('2026-01-05-09:00-+0100 9:00 12')).toEqual([
			'date:2026-01-05-09:00-+0100',
			'time:9:00',
			'integer:12',
		]);
		expect(kinds('2026-1-5')).toEqual(['date:2026-1-5']);
		expect(kinds('2026-01-05-9:5:7')).toEqual(['date:2026-01-05-9:5:7']);
	});

	it('tries the scenario prefix before absolute ids before plain ids', () => {
		expect(kinds('delayed:effort a.b.c a')).toEqual([
			'idColon:delayed:',
			'id:effort',
			'absId:a.b.c',
			'id:a',
		]);
	});

	it('reads multi-char literals and single characters', () => {
		expect(kinds('!!a != <= >= %{')).toEqual([
			'literal:!',
			'literal:!',
			'id:a',
			'literal:!=',
			'literal:<=',
			'literal:>=',
			'literal:%',
			'literal:{',
		]);
	});

	it('skips ASCII whitespace only', () => {
		expect(kinds(' \t\v\f\r\n5')).toEqual(['integer:5']);
		expect(kinds(' 5')).toEqual(['literal: ', 'integer:5']);
		expect(kinds('﻿5')).toEqual(['literal:﻿', 'integer:5']);
	});

	it('skips # and // comments to the end of the line', () => {
		expect(kinds('5 # x 6\nd')).toEqual(['integer:5', 'id:d']);
		expect(kinds('5 // x\nd')).toEqual(['integer:5', 'id:d']);
	});

	it('makes a one-line block comment greedy to the last */ on its line', () => {
		expect(kinds('5 /* a */ 6 /* b */ d')).toEqual(['integer:5', 'id:d']);
		expect(kinds('/* a\n b\n c */ x */ d')).toEqual(['id:d']);
	});

	it('reports an unterminated block comment', () => {
		expect(lexError('5 /* a\n b').code).toBe('unterminated');
	});

	it('keeps offsets relative to base', () => {
		const [a, b] = lex('  5 d', 100);
		expect(a).toMatchObject({ from: 102, to: 103 });
		expect(b).toMatchObject({ from: 104, to: 105 });
	});

	it('decodes double and single quoted strings, with only the quote escape', () => {
		const [d] = lex(String.raw`"a \"b\" c\\ \'"`);
		expect(d?.str).toEqual({ value: String.raw`a "b" c\\ \'`, style: 'double' });
		const [s] = lex(String.raw`'it\'s "x"'`);
		expect(s?.str).toEqual({ value: `it's "x"`, style: 'single' });
	});

	it('reads multi-line strings and keeps \\r as content', () => {
		const [t] = lex('"a\r\nb"');
		expect(t?.str?.value).toBe('a\r\nb');
	});

	it('reads a backslash before a newline as a plain backslash', () => {
		const [t] = lex('"a\\\n"');
		expect(t?.str?.value).toBe('a\\\n');
	});

	it('reads cut-here strings, removing the first line indentation', () => {
		// A less indented line loses only the characters it shares with the first line's indent.
		const [t, u] = lex('-8<-  \n    one\n      two\n  three\n    ->8- x');
		expect(t?.str).toEqual({ value: 'one\n  two\nthree\n', style: 'cut' });
		expect(t?.text.endsWith('->8-')).toBe(true);
		expect(u?.text).toBe('x');
		expect(lex('-8<-\n->8-')[0]?.str?.value).toBe('');
	});

	it('does not end a cut-here string at an inline ->8-', () => {
		const [t] = lex('-8<-\n  a ->8- b\n  ->8-');
		expect(t?.str?.value).toBe('a ->8- b\n');
	});

	it('refuses junk after the cut mark', () => {
		expect(lexError('-8<- x\n->8-')).toMatchObject({
			code: 'junk-after-cut',
			tj: 'junk_after_cut',
		});
	});

	it('reports unterminated strings', () => {
		expect(lexError('"abc').code).toBe('unterminated');
		expect(lexError("'abc\n").code).toBe('unterminated');
		expect(lexError('-8<-\nabc\n').code).toBe('unterminated');
	});

	it('stops at macro calls and environment references, glued prefixes included', () => {
		expect(lexError('5d${x}')).toMatchObject({ code: 'macro-call', from: 0 });
		expect(lexError('${ ?x }').code).toBe('macro-call');
		expect(lexError('"a ${b}"').code).toBe('macro-call');
		expect(lexError('"a\n${b}"').code).toBe('macro-call');
		expect(lexError('-8<-\n  ${x}\n->8-').code).toBe('macro-call');
		expect(lexError('$(HOME)').code).toBe('env-var');
		expect(lexError('"x $(HOME)"').code).toBe('env-var');
	});

	it('leaves $ text that TaskJuggler does not expand alone', () => {
		expect(lex('"${1} $x $(lower)"')[0]?.str?.value).toBe('${1} $x $(lower)');
		expect(lex('"a\n$(HOME)"')[0]?.str?.value).toBe('a\n$(HOME)');
	});

	it('peeks without consuming', () => {
		const l = new ValueLexer('a b');
		expect(l.peek()?.text).toBe('a');
		expect(l.peek()?.text).toBe('a');
		expect(l.next()?.text).toBe('a');
		expect(l.offset).toBe(1);
		expect(l.next()?.text).toBe('b');
		expect(l.next()).toBeNull();
	});
});

describe('hasExpansion', () => {
	it('detects macro calls and environment references', () => {
		expect(hasExpansion('a ${b}')).toBe(true);
		expect(hasExpansion('$(HOME)')).toBe(true);
		expect(hasExpansion('cost: $5 (approx)')).toBe(false);
	});
});
