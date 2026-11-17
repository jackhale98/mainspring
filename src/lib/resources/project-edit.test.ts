// SPDX-License-Identifier: GPL-2.0-or-later
// The rest of the project sheet's edits (project-edit.ts, phase-2.md 19.9): the intent and label
// of each, and the exact patch of the project header the edit API writes.
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../tjp/edit/apply';
import { setup, textsAfter } from '../tjp/edit/testing';
import { projectDetails } from '../inspector/project';
import { dailyHoursEdit, dailyHoursStep, textSettingEdit, weekStartEdit } from './project-edit';

const HEAD = 'project p "P" 2026-03-02 +8w';
const TEXT = `${HEAD} {\n  timezone "UTC"\n}\ntask t "T" { effort 1d }\n`;
const s = setup(TEXT);
const after = (e: { intent: Parameters<typeof applyIntent>[2] } | null): string =>
	textsAfter(s.snap, applyIntent(s.snap, s.index, e!.intent))['plan.tjp'] as string;

describe('the working day', () => {
	it('is written as typed, and cleared when emptied', () => {
		const e = dailyHoursEdit('7.5');
		expect(e?.label.text).toBe('Working day: 7.5 h');
		expect(after(e)).toBe(
			`${HEAD} {\n  timezone "UTC"\n  dailyworkinghours 7.5\n}\ntask t "T" { effort 1d }\n`,
		);
		expect(dailyHoursEdit('')?.intent).toEqual({
			type: 'removeProjectAttr',
			attr: 'dailyworkinghours',
		});
		expect(dailyHoursEdit('')?.label.text).toBe('Working day back to 8 h');
	});

	it('refuses zero and what is not a number', () => {
		expect(dailyHoursEdit('0')).toBeNull();
		expect(dailyHoursEdit('-3')).toBeNull();
		expect(dailyHoursEdit('eight')).toBeNull();
	});

	it('a stepper sends the value it reaches, in hundredths, never below a quarter hour', () => {
		expect(dailyHoursStep(8.5).intent).toMatchObject({ value: '8.5' });
		expect(dailyHoursStep(7.999999).intent).toMatchObject({ value: '8' });
		expect(dailyHoursStep(0).intent).toMatchObject({ value: '0.25' });
	});
});

describe('the first day of the week', () => {
	it('Sunday writes weekstartssunday, Monday takes it back', () => {
		const e = weekStartEdit(false);
		expect(e.label.text).toBe('Weeks start on Sunday');
		const text = after(e);
		expect(text).toContain('weekstartssunday');
		const s2 = setup(text);
		const back = textsAfter(s2.snap, applyIntent(s2.snap, s2.index, weekStartEdit(true).intent));
		// The Sunday statement is opaque to the edit API, which never touches it: Monday is written
		// after it, and the last of the two is the one TaskJuggler keeps.
		expect(back['plan.tjp']).toContain('weekstartssunday\n  weekstartsmonday\n');
		expect(projectDetails(setup(back['plan.tjp'] as string).index, null)?.weekStartsMonday).toBe(
			true,
		);
		expect(weekStartEdit(true).label.text).toBe('Weeks start on Monday');
	});

	it('is read from the text: Monday unless the last statement says Sunday', () => {
		expect(projectDetails(s.index, null)?.weekStartsMonday).toBe(true);
		const sun = setup(`${HEAD} {\n  weekstartssunday\n}\ntask t "T" { effort 1d }\n`);
		expect(projectDetails(sun.index, null)?.weekStartsMonday).toBe(false);
		const both = setup(
			`${HEAD} {\n  weekstartssunday\n  weekstartsmonday\n}\ntask t "T" { effort 1d }\n`,
		);
		expect(projectDetails(both.index, null)?.weekStartsMonday).toBe(true);
	});
});

describe('the time format and the currency', () => {
	it('are strings, and cleared when emptied', () => {
		const f = textSettingEdit('timeformat', '%Y-%m-%d');
		expect(f?.label.text).toBe('Time format: %Y-%m-%d');
		expect(after(f)).toContain('timeformat "%Y-%m-%d"');
		const c = textSettingEdit('currency', 'EUR');
		expect(after(c)).toContain('currency "EUR"');
		expect(textSettingEdit('currency', ' ')?.label.text).toBe('Currency cleared');
		expect(textSettingEdit('timeformat', '')?.intent).toEqual({
			type: 'removeProjectAttr',
			attr: 'timeformat',
		});
	});

	it('are read from the text, with their state', () => {
		const t = setup(
			`${HEAD} {\n  currency "EUR"\n  timeformat "%d"\n  dailyworkinghours 7\n}\ntask t "T" { effort 1d }\n`,
		);
		const d = projectDetails(t.index, null);
		expect(d).toMatchObject({
			currency: { kind: 'own', text: 'EUR' },
			timeformat: { kind: 'own', text: '%d' },
			dailyHours: { kind: 'own', text: '7' },
		});
		expect(projectDetails(s.index, null)).toMatchObject({
			currency: { kind: 'unset' },
			dailyHours: { kind: 'unset' },
		});
	});
});
