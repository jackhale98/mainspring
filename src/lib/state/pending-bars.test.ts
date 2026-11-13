// SPDX-License-Identifier: GPL-2.0-or-later
// The dispatcher's pending bars: owners, states and the "not scheduled" mark (phase-2.md 11.2).
import { describe, expect, it } from 'vitest';
import { PendingBars } from './pending-bars';

const mark = (task: string, end = 600) => ({ task, start: 0, end });

describe('PendingBars', () => {
	it('lets a newer preview replace an older call, which then never takes it back', () => {
		const b = new PendingBars();
		b.set(mark('a'), 'preview', 1);
		b.set(mark('a', 900), 'preview', 2);
		b.set(mark('a'), 'pending', 1, 7);
		expect(b.snapshot().get('a')).toEqual({ mark: mark('a', 900), state: 'preview' });
		expect(b.drop('a', 1)).toBe(false);
		expect(b.notScheduled('a', 1)).toBe(false);
		b.set(mark('a', 900), 'pending', 2, 8);
		expect(b.snapshot().get('a')?.state).toBe('pending');
		expect(b.drop('a', 2)).toBe(true);
		expect(b.snapshot().size).toBe(0);
	});

	it('marks a bar not scheduled, and clears marks by toast or all at once', () => {
		const b = new PendingBars();
		b.set(mark('a'), 'pending', 1, 10);
		b.set(mark('b'), 'pending', 2, 11);
		b.set(mark('c'), 'pending', 3, 12);
		b.notScheduled('a', 1);
		b.notScheduled('b', 2);
		expect(b.clearNotScheduled(10)).toBe(true);
		expect([...b.snapshot().keys()]).toEqual(['b', 'c']);
		expect(b.clearNotScheduled()).toBe(true);
		expect([...b.snapshot().keys()]).toEqual(['c']);
		expect(b.clearNotScheduled()).toBe(false);
		b.clear();
		expect(b.snapshot().size).toBe(0);
	});

	it('ignores calls without a task', () => {
		const b = new PendingBars();
		expect(b.drop(undefined, 1)).toBe(false);
		expect(b.notScheduled(null, 1)).toBe(false);
	});
});
