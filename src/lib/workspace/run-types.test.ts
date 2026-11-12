// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultTimers, IDLE_FALLBACK_MS, IDLE_TIMEOUT_MS } from './run-types';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('defaultTimers', () => {
	it('keeps what is given', () => {
		const given = {
			setTimeout: () => 1,
			clearTimeout: () => {},
			requestIdle: () => 2,
			cancelIdle: () => {},
			now: () => 3,
		};
		expect(defaultTimers(given)).toEqual(given);
	});

	it('falls back to a short timeout without requestIdleCallback, through a given setTimeout', () => {
		vi.stubGlobal('requestIdleCallback', undefined);
		const calls: number[] = [];
		const t = defaultTimers({
			setTimeout: (_fn, ms) => {
				calls.push(ms);
				return 7;
			},
		});
		expect(t.requestIdle(() => {}, IDLE_TIMEOUT_MS)).toBe(7);
		expect(calls).toEqual([IDLE_FALLBACK_MS]);
	});

	it('uses requestIdleCallback with the timeout where there is one', () => {
		const seen: Array<number | undefined> = [];
		const cancelled: unknown[] = [];
		vi.stubGlobal('requestIdleCallback', (fn: () => void, o?: { timeout?: number }) => {
			seen.push(o?.timeout);
			fn();
			return 5;
		});
		vi.stubGlobal('cancelIdleCallback', (h: unknown) => cancelled.push(h));
		const t = defaultTimers({});
		let ran = false;
		expect(t.requestIdle(() => (ran = true), IDLE_TIMEOUT_MS)).toBe(5);
		t.cancelIdle(5);
		expect([ran, seen, cancelled]).toEqual([true, [IDLE_TIMEOUT_MS], [5]]);
	});

	it('uses the global timers at call time, so fake timers apply', () => {
		vi.stubGlobal('requestIdleCallback', undefined);
		const t = defaultTimers({});
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let n = 0;
		t.setTimeout(() => n++, 10);
		const h = t.requestIdle(() => n++, IDLE_TIMEOUT_MS);
		vi.advanceTimersByTime(10);
		expect(n).toBe(1);
		t.cancelIdle(h);
		vi.advanceTimersByTime(IDLE_FALLBACK_MS);
		expect(n).toBe(1);
		expect(t.now()).toBeGreaterThanOrEqual(0);
	});
});
