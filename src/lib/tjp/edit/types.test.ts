// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { isNoop, isRefused, noop, refused } from './types';

describe('results', () => {
	it('builds refusals and no-ops', () => {
		const at = [{ file: 'plan.tjp', from: 1, to: 2 }];
		expect(refused('text-only', at, { textOnly: 'macro-call' })).toEqual({
			status: 'refused',
			reason: 'text-only',
			at,
			textOnly: 'macro-call',
		});
		expect(refused('stale')).toEqual({ status: 'refused', reason: 'stale', at: [] });
		expect(noop('not-present')).toEqual({ status: 'noop', reason: 'not-present' });
	});

	it('tells plans apart', () => {
		expect(isRefused(refused('cycle'))).toBe(true);
		expect(isRefused(noop('already-set'))).toBe(false);
		expect(isNoop(noop('already-set'))).toBe(true);
		expect(isNoop([])).toBe(false);
		expect(isRefused(null)).toBe(false);
	});
});
