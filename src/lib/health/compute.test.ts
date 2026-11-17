// SPDX-License-Identifier: GPL-2.0-or-later
// The lazy half of plan health (compute.ts): the report of a result equals `checkPlan` over the same
// context (the golden counts of fedora-res, milestones exempt), the context and the demand are made
// once per result and index, a result with nothing to check gives no context, and a placement is
// the explainer's own.
import { describe, expect, it } from 'vitest';
import { explainTask } from '../schedule/explain';
import { goldenContext, goldenResult } from '../schedule/explain-testing';
import { golden } from '../tjp/index/testing';
import { buildIndex, hintsFromResult } from '../tjp/index';
import { contextFor, computeHealth, placementOf } from './compute';
import { withLinkMilestones } from './settings';
import { DEFAULT_HEALTH_SETTINGS } from './types';

const fedora = () => {
	const ctx = goldenContext('fedora-res');
	return { result: ctx.result, index: ctx.index };
};

describe('computeHealth', () => {
	const { result, index } = fedora();

	it('gives the golden counts of fedora-res with milestones exempt', () => {
		const r = computeHealth(result, index, DEFAULT_HEALTH_SETTINGS);
		expect(r?.findings).toHaveLength(241);
		expect(r?.counts['no-predecessor']).toBe(26);
		expect(r?.counts['no-successor']).toBe(61);
	});

	it('counts milestones in H1 and H2 only when the plan asks (linkMilestones)', () => {
		const off = computeHealth(result, index, DEFAULT_HEALTH_SETTINGS);
		const on = computeHealth(result, index, withLinkMilestones(DEFAULT_HEALTH_SETTINGS, true));
		expect(on?.counts['no-predecessor']).toBeGreaterThan(off?.counts['no-predecessor'] ?? 0);
		expect(on?.counts['no-successor']).toBeGreaterThan(off?.counts['no-successor'] ?? 0);
		// Nothing else changes.
		expect(on?.counts['hard-constraint']).toBe(off?.counts['hard-constraint']);
		expect(on?.counts['long-gap']).toBe(off?.counts['long-gap']);
	});

	it('makes the context once per result and index, and again for another index', () => {
		const a = contextFor(result, index);
		expect(contextFor(result, index)).toBe(a);
		const snap = golden('fedora-res').snapshot();
		const other = buildIndex(
			snap,
			hintsFromResult(goldenResult('fedora-res'), (_f, l) => l),
			{ cache: null },
		);
		expect(contextFor(result, other)).not.toBe(a);
	});

	it('gives nothing for a result without a project', () => {
		const bare = { ...result, project: null };
		expect(contextFor(bare, index)).toBeNull();
		expect(computeHealth(bare, index, DEFAULT_HEALTH_SETTINGS)).toBeNull();
		expect(placementOf(bare, index, 'f20')).toBeNull();
	});
});

describe('placementOf', () => {
	it('is the explainer on the same context', () => {
		const { result, index } = fedora();
		const got = placementOf(result, index, 'f20.first_day');
		const ctx = goldenContext('fedora-res');
		expect(got?.placement.causes).toEqual(explainTask('f20.first_day', ctx).causes);
		expect(got?.placement.causes).toContainEqual({
			kind: 'constraint',
			attr: 'start',
			inherited: true,
		});
	});
});
