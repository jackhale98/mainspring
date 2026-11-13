// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { NO_LINE, describeRow, describeRowParts, floatAmount } from './describe';
import { project } from '../schedule/testing';
import { D, modelOf, row } from './testing';

const calendar = { startEpoch: Date.UTC(2026, 0, 5) / 1000, env: { zone: null }, locale: 'en-US' };
const model = modelOf(
	[
		row(0, 0, 3 * D, 'task', { name: 'Code' }),
		row(1, 3 * D, 3 * D, 'milestone', { name: 'Ship' }),
		row(2, null, null, 'task', { name: 'Later' }),
		row(3, 0, 5, 'task', { name: 'Tiny' }),
		row(4, 0, 3 * D, 'task', { name: 'Team', people: ['Ana', 'Ben'] }),
		row(5, 0, 3 * D, 'task', { name: 'Hot', critical: true }),
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

	it('says once that a critical task is on the critical path, not by colour alone', () => {
		const line = describeRow(model, 5);
		expect(line).toBe('Hot: Mon, Jan 5, 2026 to Wed, Jan 7, 2026. On the critical path (estimate)');
		expect(line.match(/critical/gi)).toHaveLength(1);
	});

	it('keeps the note apart, so a cut line can still show it', () => {
		expect(describeRowParts(model, 5)).toEqual({
			text: 'Hot: Mon, Jan 5, 2026 to Wed, Jan 7, 2026',
			note: 'On the critical path (estimate)',
		});
		expect(describeRowParts(model, 0).note).toBeNull();
		expect(describeRowParts(model, null)).toBe(NO_LINE);
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

	it('ends with the estimate: critical, or the float in working days or hours', () => {
		const p = project();
		const est = modelOf(
			[
				row(0, 0, 3 * D, 'task', { name: 'Code', critical: true }),
				row(1, 0, 3 * D, 'task', { name: 'Docs', floatMin: 2 * 480, people: ['Ana'] }),
				row(2, 0, 3 * D, 'task', { name: 'Spike', floatMin: 90 }),
				row(3, 0, 3 * D, 'task', { name: 'Zero', floatMin: 0 }),
			],
			[],
			{ calendar, project: p },
		);
		expect(describeRow(est, 0)).toBe(
			'Code: Mon, Jan 5, 2026 to Wed, Jan 7, 2026. On the critical path (estimate)',
		);
		expect(describeRow(est, 1)).toBe(
			'Docs: Mon, Jan 5, 2026 to Wed, Jan 7, 2026. Ana. Float about 2 working days (estimate)',
		);
		expect(describeRow(est, 2)).toBe(
			'Spike: Mon, Jan 5, 2026 to Wed, Jan 7, 2026. Float about 2 working hours (estimate)',
		);
		expect(describeRow(est, 3)).toBe('Zero: Mon, Jan 5, 2026 to Wed, Jan 7, 2026');
	});

	it('writes float in whole units, at least 1, and in hours without working days', () => {
		const p = project();
		expect(floatAmount(480, { project: p })).toBe('1 working day');
		expect(floatAmount(700, { project: p })).toBe('1 working day');
		expect(floatAmount(20, { project: p })).toBe('1 working hour');
		expect(floatAmount(960, { project: { ...p, dailyWorkingHours: 0 } })).toBe('16 working hours');
		expect(floatAmount(960, { project: null })).toBe('16 working hours');
	});
});
