// SPDX-License-Identifier: GPL-2.0-or-later
// Workload model types (phase-3.md 6.2): the default thresholds, and compile checks of the
// interface (`npm run typecheck` enforces them). The behaviour tests come with T9's code.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ProjectInfo, ScheduleResult } from '../../engine/protocol';
import type { DemandMarks } from '../schedule/explain-types';
import type { ZoneOffsets } from '../tjp/values/civil';
import {
	DEFAULT_THRESHOLDS,
	type Availability,
	type AvailabilityFn,
	type Band,
	type BucketAxis,
	type BucketAxisFn,
	type BucketKind,
	type BuildLoadFn,
	type CellTask,
	type LoadInput,
	type LoadModel,
	type Thresholds,
	type WithDimmedFn,
} from './types';

describe('workload types (6.2)', () => {
	it('defaults the thresholds to spare below 80 % and over above 100 % (18.3)', () => {
		expect(DEFAULT_THRESHOLDS).toEqual({ spareBelow: 80, overAbove: 100 });
		expect(Object.isFrozen(DEFAULT_THRESHOLDS)).toBe(true);
		expectTypeOf(DEFAULT_THRESHOLDS).toEqualTypeOf<Readonly<Thresholds>>();
	});

	it('names the bucket kinds, the bands and the cell task kinds', () => {
		expectTypeOf<BucketKind>().toEqualTypeOf<'day' | 'week' | 'month'>();
		expectTypeOf<Band>().toEqualTypeOf<'off' | 'spare' | 'full' | 'over'>();
		expectTypeOf<CellTask['kind']>().toEqualTypeOf<'booked' | 'held' | 'unmet'>();
	});

	it('fixes the signatures T9 implements', () => {
		expectTypeOf<BucketAxisFn>().parameters.toEqualTypeOf<[ProjectInfo, ZoneOffsets, BucketKind]>();
		expectTypeOf<BucketAxisFn>().returns.toEqualTypeOf<BucketAxis>();
		expectTypeOf<BuildLoadFn>().parameters.toEqualTypeOf<[LoadInput]>();
		expectTypeOf<BuildLoadFn>().returns.toEqualTypeOf<LoadModel>();
		expectTypeOf<LoadInput['demand']>().toEqualTypeOf<DemandMarks | null>();
		expectTypeOf<LoadInput['availability']>().toEqualTypeOf<Availability>();
		expectTypeOf<AvailabilityFn>().parameters.toEqualTypeOf<[ScheduleResult, string]>();
		expectTypeOf<AvailabilityFn>().returns.toEqualTypeOf<Availability>();
		expectTypeOf<WithDimmedFn>().parameters.toEqualTypeOf<[LoadModel, boolean]>();
		expectTypeOf<WithDimmedFn>().returns.toEqualTypeOf<LoadModel>();
		// Dimming is not an input: it re-wraps a model (`WithDimmedFn`).
		expectTypeOf<LoadInput>().not.toHaveProperty('outdated');
	});

	it('takes sample values', () => {
		// Two weeks of a frame that starts on a Wednesday: the first bucket starts the Monday before.
		const axis: BucketAxis = {
			kind: 'week',
			bounds: Int32Array.from([-2 * 1440, 5 * 1440, 12 * 1440]),
			count: 2,
			indexOf: (m) => (m < 0 || m >= 12 * 1440 ? -1 : m < 5 * 1440 ? 0 : 1),
		};
		const availability: Availability = {
			revision: 1,
			scenario: 'plan',
			people: new Map([
				[
					'dev1',
					{
						working: [[540, 1020]],
						leave: [{ type: 'annual', intervals: [[1980, 2460]] }],
						booked: [[540, 780]],
						free: [[780, 1020]],
					},
				],
			]),
		};
		expect(axis.bounds.length).toBe(axis.count + 1);
		expect(axis.indexOf(-1)).toBe(-1);
		expect(availability.people.get('dev1')?.free).toEqual([[780, 1020]]);
	});
});
