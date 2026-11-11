// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	checkComplete,
	checkPriority,
	float,
	int,
	parseInteger,
	parseNumber,
	plainDecimal,
	printNumber,
	rDiv,
	rMul,
	rRound,
	rToI,
	sameNumber,
} from './number';

describe('parseNumber', () => {
	it('keeps integer and float apart', () => {
		expect(parseNumber('8')).toMatchObject({ ok: true, value: { value: 8, float: false } });
		expect(parseNumber('8.0')).toMatchObject({ ok: true, value: { value: 8, float: true } });
		expect(parseNumber(' .5 ')).toMatchObject({
			ok: true,
			value: { value: 0.5, float: true },
			from: 1,
			to: 3,
		});
		expect(parseNumber('007')).toMatchObject({ ok: true, value: { value: 7, float: false } });
	});

	it('has no sign and no exponent', () => {
		expect(parseNumber('-1')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-token', from: 0, to: 1 },
		});
		expect(parseNumber('1e3')).toMatchObject({
			ok: false,
			error: { code: 'trailing-text', from: 1, to: 3 },
		});
	});

	it('reports precise errors', () => {
		expect(parseNumber('')).toMatchObject({ ok: false, error: { code: 'unexpected-end' } });
		expect(parseNumber('5 5', 10)).toMatchObject({
			ok: false,
			error: { code: 'trailing-text', from: 12, to: 13 },
		});
		expect(parseNumber('99999999999999999999')).toMatchObject({
			ok: false,
			error: { code: 'number-too-large' },
		});
	});

	it('parseInteger refuses floats', () => {
		expect(parseInteger('500')).toMatchObject({ ok: true, value: 500 });
		expect(parseInteger('5.0')).toMatchObject({ ok: false, error: { code: 'unexpected-token' } });
	});
});

describe('printNumber', () => {
	it('writes canonical text that reads back the same', () => {
		expect(printNumber(int(5))).toEqual({ ok: true, value: '5' });
		expect(printNumber(float(2))).toEqual({ ok: true, value: '2.0' });
		expect(printNumber(float(0.5))).toEqual({ ok: true, value: '0.5' });
		expect(printNumber(float(1e-7))).toEqual({ ok: true, value: '0.0000001' });
		expect(printNumber(float(1.5e21))).toEqual({ ok: true, value: '1500000000000000000000.0' });
	});

	it('refuses what TaskJuggler cannot read', () => {
		expect(printNumber(int(-1)).ok).toBe(false);
		expect(printNumber(float(Number.NaN)).ok).toBe(false);
		expect(printNumber(int(1.5)).ok).toBe(false);
		expect(printNumber(float(-0)).ok).toBe(false);
	});
});

describe('plainDecimal', () => {
	it('expands exponent notation', () => {
		expect(plainDecimal(1.25e-9)).toBe('0.00000000125');
		expect(plainDecimal(1.2345e22)).toBe('12345000000000000000000');
		expect(plainDecimal(42.5)).toBe('42.5');
	});
});

describe('Ruby arithmetic helpers', () => {
	it('keeps Integer op Integer integral, with floor division', () => {
		expect(rDiv(int(2700), int(3600))).toEqual(int(0));
		expect(rDiv(float(2700), int(3600))).toEqual(float(0.75));
		expect(rMul(int(3), float(2))).toEqual(float(6));
	});

	it('rounds half away from zero and truncates', () => {
		expect(rRound(float(0.5))).toBe(1);
		expect(rRound(float(2.5))).toBe(3);
		expect(rRound(float(0.49999999999999994))).toBe(0);
		expect(rToI(float(2.9))).toBe(2);
	});

	it('compares numbers with their type', () => {
		expect(sameNumber(int(2), int(2))).toBe(true);
		expect(sameNumber(int(2), float(2))).toBe(false);
	});
});

describe('range checks', () => {
	it('checks complete and priority as TaskJuggler does', () => {
		expect(checkComplete(float(100)).ok).toBe(true);
		expect(checkComplete(float(100.5))).toMatchObject({
			ok: false,
			error: { code: 'number-range', tj: 'task_complete' },
		});
		expect(checkPriority(1000).ok).toBe(true);
		expect(checkPriority(1001)).toMatchObject({ ok: false, error: { tj: 'task_priority' } });
	});
});
