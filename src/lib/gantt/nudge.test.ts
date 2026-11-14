// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_MS, Nudges } from './nudge';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('Nudges', () => {
	it('sends the cumulative total of a gesture, per key', () => {
		const ended: string[] = [];
		const n = new Nudges((k) => ended.push(k));
		expect(n.press('move:a', 1)).toBe(1);
		expect(n.press('move:a', 1)).toBe(2);
		expect(n.press('size:a', -1)).toBe(-1);
		expect(n.press('move:a', -1)).toBe(1);
		expect(n.total('move:a')).toBe(1);
		expect(ended).toEqual([]);
	});

	it('ends a gesture after a pause, and the next press starts from zero', () => {
		const ended: string[] = [];
		const n = new Nudges((k) => ended.push(k));
		n.press('move:a', 1);
		vi.advanceTimersByTime(IDLE_MS - 1);
		n.press('move:a', 1);
		vi.advanceTimersByTime(IDLE_MS - 1);
		expect(ended).toEqual([]);
		vi.advanceTimersByTime(2);
		expect(ended).toEqual(['move:a']);
		expect(n.press('move:a', 1)).toBe(1);
	});

	it('ends one gesture or all of them on demand, once', () => {
		const ended: string[] = [];
		const n = new Nudges((k) => ended.push(k));
		n.press('a', 1);
		n.press('b', 1);
		n.end('a');
		n.end('a');
		expect(ended).toEqual(['a']);
		n.end();
		expect(ended).toEqual(['a', 'b']);
		vi.advanceTimersByTime(5 * IDLE_MS);
		expect(ended).toEqual(['a', 'b']);
	});

	it('forgets a refused gesture without flushing it', () => {
		const ended: string[] = [];
		const n = new Nudges((k) => ended.push(k));
		n.press('a', 3);
		n.forget('a');
		vi.advanceTimersByTime(5 * IDLE_MS);
		expect(ended).toEqual([]);
		expect(n.total('a')).toBe(0);
	});
});
