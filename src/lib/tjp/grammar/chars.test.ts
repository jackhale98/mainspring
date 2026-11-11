// SPDX-License-Identifier: GPL-2.0-or-later
// Character reads around a token (chars.ts).
import { describe, expect, it } from 'vitest';
import { MAX_LOOKBEHIND, isSpace, isWordChar, readWord, startsLine, type Peek } from './chars';

/** A peek function over `text`, relative to the position of the first `|`. */
function at(marked: string): Peek {
	const pos = marked.indexOf('|');
	const text = marked.replace('|', '');
	return (offset) => {
		const i = pos + offset;
		return i < 0 || i >= text.length ? -1 : text.charCodeAt(i);
	};
}

describe('chars', () => {
	it('classifies ASCII word characters and Ruby whitespace', () => {
		expect([...'aZ0_'].every((c) => isWordChar(c.charCodeAt(0)))).toBe(true);
		expect([...'-.é$'].some((c) => isWordChar(c.charCodeAt(0)))).toBe(false);
		expect([...' \t\n\v\f\r'].every((c) => isSpace(c.charCodeAt(0)))).toBe(true);
		expect(isSpace(0xa0)).toBe(false);
	});

	it('reads a word, optionally after blanks', () => {
		expect(readWord(at('|effort 5d'), 0)).toBe('effort');
		expect(readWord(at('delayed:|  effort'), 0, true)).toBe('effort');
		expect(readWord(at('delayed:|  effort'), 0)).toBe('');
		expect(readWord(at('|x'), 5)).toBe('');
	});

	it('sees a line start through blanks, up to the look-behind limit', () => {
		expect(startsLine(at('|effort'))).toBe(true);
		expect(startsLine(at('a\n  \t|effort'))).toBe(true);
		expect(startsLine(at('a\r\n|effort'))).toBe(true);
		expect(startsLine(at('dev |effort'))).toBe(false);
		expect(startsLine(at(`a\n${' '.repeat(MAX_LOOKBEHIND - 1)}|x`))).toBe(true);
		expect(startsLine(at(`a\n${' '.repeat(MAX_LOOKBEHIND)}|x`))).toBe(false);
	});
});
