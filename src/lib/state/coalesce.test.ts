// SPDX-License-Identifier: GPL-2.0-or-later
// Held calls and gestures of the dispatcher's coalescing (coalesce.ts). The replace behaviour is
// tested through the dispatcher in edits-gestures.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Coalescer } from './coalesce';

const timers = {
	setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

let quiet: string[];
let co: Coalescer<string, string>;

beforeEach(() => {
	vi.useFakeTimers();
	quiet = [];
	co = new Coalescer(timers, 300, (k) => quiet.push(k));
});
afterEach(() => void vi.useRealTimers());

describe('Coalescer', () => {
	it('holds the newest call per key and says when a key has been quiet for 300 ms', () => {
		const r = vi.fn();
		expect(co.hold('a', 'one', r)).toBeNull();
		vi.advanceTimersByTime(200);
		expect(co.hold('a', 'two', r)?.job).toBe('one');
		vi.advanceTimersByTime(299);
		expect(quiet).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(quiet).toEqual(['a']);
		expect(co.take('a').map((h) => h.job)).toEqual(['two']);
		expect(co.take('a')).toEqual([]);
	});

	it('takes one key or all, and a taken call no longer fires', () => {
		co.hold('a', 'x', vi.fn());
		co.hold('b', 'y', vi.fn());
		expect(co.take('b').map((h) => h.key)).toEqual(['b']);
		expect(co.take().map((h) => h.key)).toEqual(['a']);
		vi.advanceTimersByTime(1000);
		expect(quiet).toEqual([]);
	});

	it('keeps one gesture per key until it ends; a taken call keeps its own', () => {
		const g = co.gesture('a');
		g.applied = 'e1';
		expect(co.gesture('a')).toBe(g);
		expect(co.keys()).toEqual(['a']);
		co.end('a');
		const next = co.gesture('a');
		expect(next).not.toBe(g);
		expect(next).toEqual({ base: null, applied: null, broken: false });
		expect(g.applied).toBe('e1');
	});

	it('clears everything and hands back the held calls', () => {
		co.hold('a', 'x', vi.fn());
		co.gesture('a');
		expect(co.clear().map((h) => h.job)).toEqual(['x']);
		expect(co.keys()).toEqual([]);
	});
});
