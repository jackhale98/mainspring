// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT, projectContext } from './context';
import { float, int } from './number';
import { DEFAULT_WEEK, weeklyWorkingHours } from './workinghours';

describe('ProjectContext', () => {
	it("has TaskJuggler's defaults", () => {
		expect(DEFAULT_CONTEXT).toEqual({
			dailyWorkingHours: float(8),
			yearlyWorkingDays: float(260.714),
			weeklyWorkingHours: 40,
			granularity: 3600,
			zone: null,
			start: null,
			end: null,
		});
		expect(DEFAULT_CONTEXT.weeklyWorkingHours).toBe(weeklyWorkingHours(DEFAULT_WEEK));
		expect('zones' in DEFAULT_CONTEXT).toBe(false);
	});

	it('overrides only what is given', () => {
		const zones = { offset: () => 0, valid: () => true };
		const c = projectContext({
			dailyWorkingHours: int(7),
			granularity: 900,
			zone: 'Europe/Berlin',
			zones,
		});
		expect(c).toMatchObject({ dailyWorkingHours: int(7), granularity: 900, zone: 'Europe/Berlin' });
		expect(c.zones).toBe(zones);
		expect(c.yearlyWorkingDays).toEqual(float(260.714));
		expect(projectContext({})).toEqual(DEFAULT_CONTEXT);
	});
});
