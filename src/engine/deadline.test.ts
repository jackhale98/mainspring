// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Deadline, checkDuration } from './deadline';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('Deadline', () => {
	it('fires once, ms after start, and disarms itself', () => {
		const expire = vi.fn();
		const deadline = new Deadline(100, expire);
		expect(deadline.armed).toBe(false);
		deadline.start();
		expect(deadline.armed).toBe(true);
		vi.advanceTimersByTime(99);
		expect(expire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(expire).toHaveBeenCalledOnce();
		expect(deadline.armed).toBe(false);
		vi.advanceTimersByTime(1_000);
		expect(expire).toHaveBeenCalledOnce();
	});

	it('restarts the countdown on start and cancels on stop', () => {
		const expire = vi.fn();
		const deadline = new Deadline(100, expire);
		deadline.start();
		vi.advanceTimersByTime(60);
		deadline.start();
		vi.advanceTimersByTime(60);
		expect(expire).not.toHaveBeenCalled();
		deadline.stop();
		vi.advanceTimersByTime(1_000);
		expect(expire).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([Number.POSITIVE_INFINITY, 2 ** 31])('never arms for %s ms', (ms) => {
		const deadline = new Deadline(ms, () => undefined);
		deadline.start();
		expect([deadline.armed, vi.getTimerCount()]).toEqual([false, 0]);
	});
});

describe('checkDuration', () => {
	it('accepts positive durations, Infinity included', () => {
		expect(checkDuration('t', 1)).toBe(1);
		expect(checkDuration('t', Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
	});

	it.each([0, -1, Number.NaN, Number.NEGATIVE_INFINITY])('rejects %s', (ms) => {
		expect(() => checkDuration('timeoutMs', ms)).toThrow(RangeError);
	});
});
