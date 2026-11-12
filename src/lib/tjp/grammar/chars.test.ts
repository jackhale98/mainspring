// SPDX-License-Identifier: GPL-2.0-or-later
// Character reads around a token (chars.ts).
import { describe, expect, it } from 'vitest';
import { isSpace, isWordChar, readWord, type Peek } from './chars';

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
});
