// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ratio, renderReport, type PlanRow } from './report';

const row = (over: Partial<PlanRow>): PlanRow => ({
	id: 'p',
	run: 'shuffled',
	tasks: 3,
	workerMs: 200,
	nativeMs: 100,
	pass: true,
	diffs: [],
	...over,
});

describe('golden report', () => {
	it('computes the ratio, or a dash without both times', () => {
		expect(ratio(300, 100)).toBe('3.0');
		expect(ratio(null, 100)).toBe('-');
		expect(ratio(300, null)).toBe('-');
	});

	it('renders a table row per run and the counts', () => {
		const text = renderReport([row({}), row({ id: 'q', run: 'fresh' })], {
			seed: 5,
			expectedPlans: 1,
			engine: null,
		});
		expect(text).toContain('Plans: 1 of 1 expected run; 1 match their golden. Shuffle seed 5.');
		expect(text).toContain('| p | shuffled | 3 | 200 | 100 | 2.0 | yes |');
		expect(text).toContain('| q | fresh | 3 | 200 | 100 | 2.0 | yes |');
		expect(text).not.toContain('## Differences');
	});

	it('lists the differences of failing plans', () => {
		const text = renderReport(
			[row({ pass: false, workerMs: null, diffs: ['/ok: expected true, got false'] })],
			{ seed: 1, expectedPlans: 34, engine: null },
		);
		expect(text).toContain('| p | shuffled | 3 | - | 100 | - | NO |');
		expect(text).toContain('/ok: expected true, got false');
		expect(text).toContain('0 match their golden');
	});
});
