// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { StringSource, finishCall, match, runaway } from './scanner-core';

function at(text: string, base: number): StringSource {
	const src = new StringSource(text);
	src.base = base;
	return src;
}

describe('StringSource', () => {
	it('reads relative to base: peek, slice and the rest of a line', () => {
		const src = at('ab\ncd\nef', 1);
		expect([src.peek(0), src.peek(1), src.peek(7)]).toEqual([98, 10, -1]);
		expect(src.slice(0, 4)).toBe('b\ncd');
		expect([src.line(0), src.line(2), src.line(5), src.line(7)]).toEqual(['b\n', 'cd\n', 'ef', '']);
		src.base = 0;
		expect(src.line(1)).toBe('b\n');
	});
});

describe('helpers', () => {
	it('matches sticky patterns at an index', () => {
		expect(match(/b+/y, 'abbc', 1)).toBe(2);
		expect(match(/b+/y, 'abbc', 0)).toBe(-1);
		expect(match(/x*/y, 'abc')).toBe(0);
	});
	it('finishes a macro call on a later line, or reports the end of input', () => {
		expect(finishCall(at('${x "a"\n "b" } y', 0), 7)).toBe(14);
		expect(finishCall(at('${x\nno close', 0), 3)).toBe(-1);
	});
	it('makes a runaway token reach the end of input', () => {
		expect(runaway(at('a "b\nc\nd', 2), 0, 'unterminated-string')).toEqual({
			kind: 'Error',
			length: 6,
			flags: 0,
			error: 'unterminated-string',
		});
	});
});
