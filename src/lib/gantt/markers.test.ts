// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { markerState } from './markers';
import { D, modelOf } from './testing';

const model = (over: Parameters<typeof modelOf>[2]) =>
	modelOf([], [], { endMin: 100 * D, ...over });

describe('markerState', () => {
	it('puts a line on the chart between the first and last minute, and off it outside', () => {
		const m = model({ todayMin: 50 * D, statusMin: 200 * D });
		expect(markerState(m, -D)).toMatchObject({ today: 'on', status: 'off', merged: false });
		const before = model({ todayMin: -5 * D, statusMin: 0 });
		expect(markerState(before, -D)).toMatchObject({ today: 'off', status: 'on' });
		expect(markerState(model({}), 0)).toMatchObject({ today: null, status: null, target: null });
	});

	it('goes to today when it is on the chart, else to the status date, else nowhere', () => {
		expect(markerState(model({ todayMin: 10 * D, statusMin: 20 * D }), 0).target).toBe(10 * D);
		expect(markerState(model({ todayMin: 500 * D, statusMin: 20 * D }), 0).target).toBe(20 * D);
		expect(markerState(model({ todayMin: 500 * D, statusMin: 600 * D }), 0).target).toBeNull();
	});

	it('merges lines within an hour into one', () => {
		expect(markerState(model({ todayMin: 10 * D + 30, statusMin: 10 * D }), 0).merged).toBe(true);
		expect(markerState(model({ todayMin: 10 * D + 61, statusMin: 10 * D }), 0).merged).toBe(false);
		expect(markerState(model({ todayMin: 10 * D }), 0).merged).toBe(false);
	});
});
