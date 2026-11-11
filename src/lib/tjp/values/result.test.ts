// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ValueParseError, at, capture, fail, ok, raise, valueError } from './result';

describe('result helpers', () => {
	it('builds results and errors', () => {
		expect(ok(1)).toEqual({ ok: true, value: 1 });
		expect(valueError('bad-unit', 1, 2)).toEqual({
			code: 'bad-unit',
			from: 1,
			to: 2,
			tj: null,
			args: {},
		});
		expect(fail('zero-duration', 0, 0, 'zero_duration', { n: 0 })).toEqual({
			ok: false,
			error: { code: 'zero-duration', from: 0, to: 0, tj: 'zero_duration', args: { n: 0 } },
		});
	});

	it('raise throws a ValueParseError that capture turns into a result', () => {
		expect(() => raise('trailing-text', 3, 5)).toThrow(ValueParseError);
		expect(capture(() => raise('trailing-text', 3, 5))).toEqual({
			ok: false,
			error: { code: 'trailing-text', from: 3, to: 5, tj: null, args: {} },
		});
		expect(capture(() => 7)).toBe(7);
		expect(() =>
			capture(() => {
				throw new RangeError('x');
			}),
		).toThrow(RangeError);
	});

	it('at places a semantic error on a span and leaves successes alone', () => {
		expect(at(fail('misaligned-date', 0, 0, 'misaligned_date'), { from: 4, to: 9 })).toMatchObject({
			ok: false,
			error: { code: 'misaligned-date', from: 4, to: 9, tj: 'misaligned_date' },
		});
		expect(at(ok(3), { from: 4, to: 9 })).toEqual({ ok: true, value: 3 });
	});
});
