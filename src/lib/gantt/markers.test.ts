// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { markerState } from './markers';
import { D, modelOf } from './testing';

const model = (over: Parameters<typeof modelOf>[2]) =>
	modelOf([], [], { endMin: 100 * D, ...over });
/** `markerState` of a model and the clock (`todayOf`), which the model does not hold. */
const state = (today: number | null, over: Parameters<typeof modelOf>[2], first = 0) =>
	markerState(model(over), first, today);

describe('markerState', () => {
	it('puts a line on the chart between the first and last minute, and off it outside', () => {
		expect(state(50 * D, { statusMin: 200 * D }, -D)).toMatchObject({
			today: 'on',
			status: 'off',
			merged: false,
		});
		expect(state(-5 * D, { statusMin: 0 }, -D)).toMatchObject({ today: 'off', status: 'on' });
		expect(state(null, {})).toMatchObject({ today: null, status: null, target: null });
	});

	it('goes to today when it is on the chart, else to the status date, else nowhere', () => {
		expect(state(10 * D, { statusMin: 20 * D }).target).toBe(10 * D);
		expect(state(500 * D, { statusMin: 20 * D }).target).toBe(20 * D);
		expect(state(500 * D, { statusMin: 600 * D }).target).toBeNull();
	});

	it('merges lines within an hour into one', () => {
		expect(state(10 * D + 30, { statusMin: 10 * D }).merged).toBe(true);
		expect(state(10 * D + 61, { statusMin: 10 * D }).merged).toBe(false);
		expect(state(10 * D, {}).merged).toBe(false);
	});

	it('takes today from the caller, so that the clock is not part of the model', () => {
		expect(state(10 * D, { statusMin: 20 * D })).toMatchObject({ today: 'on', target: 10 * D });
		expect(state(null, { statusMin: 20 * D }).today).toBeNull();
	});
});
