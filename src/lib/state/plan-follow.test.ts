// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { followPlan } from './plan-follow';

describe('followPlan', () => {
	it('starts over for a plan that opened, and only rekeys when the open plan was stored', () => {
		const calls: string[] = [];
		const follow = followPlan(
			(k) => calls.push(`use ${k}`),
			(k) => calls.push(`rekey ${k}`),
		);
		follow(1, 'upstream-tutorial');
		// The sample's first change stored its copy: same plan, new key.
		follow(1, 'ws:abc');
		// The same plan opened again (Open here instead), and another plan.
		follow(2, 'ws:abc');
		follow(3, 'ui-basic');
		expect(calls).toEqual(['use upstream-tutorial', 'rekey ws:abc', 'use ws:abc', 'use ui-basic']);
	});
});
