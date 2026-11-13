// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { describeRow } from './describe';
import { D, modelOf, row } from './testing';

const calendar = { startEpoch: Date.UTC(2026, 0, 5) / 1000, env: { zone: null }, locale: 'en-US' };
const model = modelOf(
	[
		row(0, 0, 3 * D, 'task', { name: 'Code' }),
		row(1, 3 * D, 3 * D, 'milestone', { name: 'Ship' }),
		row(2, null, null, 'task', { name: 'Later' }),
		row(3, 0, 5, 'task', { name: 'Tiny' }),
		row(4, 0, 3 * D, 'task', { name: 'Team', people: ['Ana', 'Ben'] }),
	],
	[],
	{ calendar },
);

describe('describeRow', () => {
	it('writes a task as its first and last working day', () => {
		// Ends at the start of Thursday: the last day is Wednesday.
		expect(describeRow(model, 0)).toBe('Code: Mon, Jan 5, 2026 to Wed, Jan 7, 2026');
		expect(describeRow(model, 3)).toBe('Tiny: Mon, Jan 5, 2026 to Mon, Jan 5, 2026');
	});

	it('adds the people on a task', () => {
		expect(describeRow(model, 4)).toBe('Team: Mon, Jan 5, 2026 to Wed, Jan 7, 2026. Ana, Ben');
	});

	it('writes a milestone as its day', () => {
		expect(describeRow(model, 1)).toBe('Ship: milestone on Thu, Jan 8, 2026');
	});

	it('says so for a task with no dates, and for nothing at all', () => {
		expect(describeRow(model, 2)).toBe('Later: not scheduled yet');
		expect(describeRow(model, null)).toBe('');
		expect(describeRow(model, 9)).toBe('');
		expect(describeRow({ ...model, calendar: null }, 0)).toBe('Code: not scheduled yet');
	});
});
