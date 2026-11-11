// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Cursor, parseWith } from './cursor';

describe('Cursor', () => {
	it('peeks, eats and expects tokens', () => {
		const c = new Cursor('a , 5', 10);
		expect(c.isId()).toBe(true);
		expect(c.isId('b')).toBe(false);
		expect(c.expect('id').text).toBe('a');
		expect(c.offset).toBe(11);
		expect(c.isLiteral(',')).toBe(true);
		expect(c.eat(';')).toBeNull();
		expect(c.eat(',')?.from).toBe(12);
		expect(c.expect('integer').to).toBe(15);
		expect(c.end).toBe(15);
		expect(c.peek()).toBeNull();
		expect(() => c.finish()).not.toThrow();
	});

	it('raises precise errors', () => {
		const c = new Cursor('a', 3);
		expect(() => c.expect('integer')).toThrowError('unexpected-token');
		expect(() => c.expect('id')).toThrowError('unexpected-end');
		expect(() => new Cursor('x').expectLiteral('-')).toThrowError('unexpected-token');
		expect(() => new Cursor('').expectLiteral('-')).toThrowError('unexpected-end');
	});
});

describe('parseWith', () => {
	const ids = (text: string, base = 0) => parseWith(text, base, (c) => c.expect('id').text);

	it('reports the value range without surrounding trivia', () => {
		expect(ids('  a  # c\n', 100)).toEqual({ ok: true, value: 'a', from: 102, to: 103 });
	});

	it('fails on trailing text, from its first token to the end', () => {
		expect(ids('a b c', 10)).toMatchObject({
			ok: false,
			error: { code: 'trailing-text', from: 12, to: 15 },
		});
	});

	it('fails on empty text at its end', () => {
		expect(ids('  ', 4)).toMatchObject({
			ok: false,
			error: { code: 'unexpected-end', from: 6, to: 6 },
		});
	});

	it('adds per-kind extras on success', () => {
		const r = parseWith(
			'a',
			0,
			(c) => c.expect('id').text,
			(v) => ({ upper: v.toUpperCase() }),
		);
		expect(r).toMatchObject({ ok: true, value: 'a', upper: 'A' });
	});

	it('lets errors that are not value errors through', () => {
		expect(() =>
			parseWith('a', 0, () => {
				throw new TypeError('bug');
			}),
		).toThrow(TypeError);
	});
});
