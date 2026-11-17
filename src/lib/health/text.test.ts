// SPDX-License-Identifier: GPL-2.0-or-later
// A finding in words (text.ts, strings.ts `healthStrings`): every check's sentence with its names
// and dates, the plurals, the fallbacks, and the fix labels.
import { describe, expect, it } from 'vitest';
import { at, plan } from '../schedule/testing';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { fixLabel, personName, sentenceOf, subjectTask, taskName, type TextContext } from './text';
import type { Finding, FindingOf } from './types';

const TEXT = `project p "P" 2026-01-05 - 2026-03-02 {
}
resource dev "Dev 1"
task api "Build API" {
}
task login "Login" {
}
`;
const C: TextContext = {
	index: buildIndex(inline({ 'plan.tjp': TEXT }).snapshot(), undefined, { cache: null }),
	result: plan([
		['api', { start: at(0, 9), end: at(1, 17) }],
		['login', { start: at(2, 9), end: at(3, 17) }],
		['engine', { start: at(2, 9), end: at(3, 17) }],
	]),
	locale: 'en-GB',
};

const base = { severity: 'warning', at: null, fixes: [] } as const;
const task = (id: string) => ({ kind: 'task', id }) as const;
const say = (f: Finding) => sentenceOf(f, C);

describe('health sentences', () => {
	it('H1 and H2', () => {
		expect(say({ ...base, check: 'no-predecessor', subject: task('login'), facts: null })).toBe(
			'Nothing comes before it, so only the project start sets when it starts.',
		);
		expect(say({ ...base, check: 'no-successor', subject: task('login'), facts: null })).toBe(
			'Nothing comes after it, so no other task waits for it to end.',
		);
	});

	it('H3, with the date in the plan’s zone, the parent, or no date', () => {
		const h3 = (facts: FindingOf<'hard-constraint'>['facts']): string =>
			say({ ...base, check: 'hard-constraint', subject: task('login'), facts });
		expect(h3({ attr: 'start', date: 0, from: null })).toBe('Its start is fixed at 5 Jan 2026.');
		// An end at midnight is the last day it allows.
		expect(h3({ attr: 'end', date: 1440, from: null })).toBe('Its end is fixed at 5 Jan 2026.');
		expect(h3({ attr: 'minstart', date: 1440, from: 'api' })).toBe(
			'It may not start before 6 Jan 2026, set on Build API.',
		);
		expect(h3({ attr: 'maxend', date: null, from: null })).toBe('It must end by a set date.');
		expect(h3({ attr: 'start', date: null, from: 'api' })).toBe(
			'Its start is fixed, set on Build API.',
		);
	});

	it('H4, with a day count or without one', () => {
		const h4 = (limit: FindingOf<'constraint-warning'>['facts']['limit'], days: number) =>
			say({
				...base,
				check: 'constraint-warning',
				subject: { kind: 'message', index: 0 },
				facts: { limit, days, text: '', task: 'login' },
			});
		expect(h4('maxstart', 3)).toBe('Starts 3 working days after its latest allowed start.');
		expect(h4('minstart', 1)).toBe('Starts 1 working day before its earliest allowed start.');
		expect(h4('maxend', 0.5)).toBe('Ends 0.5 working days after its latest allowed end.');
		expect(h4('minend', 0)).toBe('Ends before its earliest allowed end.');
	});

	it('H5 and H6', () => {
		const link = { kind: 'link', pred: 'api', succ: 'login' } as const;
		expect(
			say({ ...base, check: 'long-gap', subject: link, facts: { gap: 'gaplength', days: 6 } }),
		).toBe('Waits 6 working days after Build API.');
		expect(
			say({ ...base, check: 'long-gap', subject: link, facts: { gap: 'gapduration', days: 1 } }),
		).toBe('Waits 1 calendar day after Build API.');
		expect(say({ ...base, check: 'long-task', subject: task('api'), facts: { days: 21 } })).toBe(
			'Runs for 21 working days. A long task hides how far along it is.',
		);
	});

	it('H7 and H8: the person, the task they were booked on, the hours', () => {
		const h7 = (on: string | null) =>
			say({
				...base,
				check: 'held-by-people',
				subject: task('login'),
				facts: { resource: 'dev', days: 6, on },
			});
		expect(h7('api')).toBe('Waits 6 working days for Dev 1 (booked on Build API).');
		expect(h7(null)).toBe('Waits 6 working days for Dev 1 (on leave or off work).');
		expect(
			say({
				...base,
				check: 'work-without-people',
				subject: task('login'),
				facts: { resource: 'dev', minutes: 90 },
			}),
		).toBe('Runs without Dev 1 for 1.5 hours, while Dev 1 works on other tasks.');
		expect(
			say({
				...base,
				check: 'work-without-people',
				subject: task('login'),
				facts: { resource: 'nobody', minutes: 60 },
			}),
		).toBe('Runs without nobody for 1 hour, while nobody works on other tasks.');
	});

	it('H9, one sentence per message; result names when the text has none', () => {
		const h9 = (
			message: FindingOf<'resource-warning'>['facts']['message'],
			t: string | null,
			tasks: string[] = [],
		) =>
			say({
				...base,
				check: 'resource-warning',
				subject: { kind: 'message', index: 0 },
				facts: { message, text: '', tasks, task: t },
			});
		expect(h9('allocate_no_assigned', 'login')).toBe(
			'Login asked for people but got none. Without an effort, it books them only when they happen to be free.',
		);
		expect(h9('priority_inversion', 'login', ['api', 'engine'])).toBe(
			'Tasks with a lower priority took people from Login: Build API, engine.',
		);
		expect(h9('priority_inversion', null)).toBe(
			'Tasks with a lower priority took people from A task.',
		);
		expect(h9('overbooked_effort', 'api')).toBe(
			'The bookings of Build API add up to more effort than it asks for.',
		);
		expect(h9('overbooked_length', 'api')).toBe(
			'The bookings of Build API run longer than its length.',
		);
		expect(h9('overbooked_duration', 'api')).toBe(
			'The bookings of Build API run longer than its duration.',
		);
	});

	it('labels each fix', () => {
		const labels = [
			{
				kind: 'intent',
				label: 'Remove start',
				intent: { type: 'removeAttr', task: 'a', attr: 'start' },
			},
			{ kind: 'pick', role: 'predecessor', task: 'a' },
			{ kind: 'pick', role: 'successor', task: 'a' },
			{ kind: 'replace-person', task: 'a', from: 'dev' },
			{ kind: 'open', view: 'workload', resource: 'dev', at: 0 },
			{ kind: 'open', view: 'calendar', resource: 'dev', at: 0 },
			{ kind: 'why', task: 'a' },
			{ kind: 'show' },
		] as const;
		expect(labels.map((x) => fixLabel({ ...x, disabled: null }, C))).toEqual([
			'Remove start',
			'Add predecessor…',
			'Add successor…',
			'Replace Dev 1…',
			'Open in Workload',
			'Open in Calendar',
			'Why here?',
			'Show in text',
		]);
	});

	it('names tasks and people from the text, then the result, then the id', () => {
		expect([
			taskName(C, 'api'),
			taskName(C, 'engine'),
			taskName(C, 'gone'),
			taskName(C, null),
		]).toEqual(['Build API', 'engine', 'gone', 'A task']);
		expect([personName(C, 'dev'), personName(C, 'x')]).toEqual(['Dev 1', 'x']);
		expect(
			subjectTask({
				...base,
				check: 'long-gap',
				subject: { kind: 'link', pred: 'a', succ: 'b' },
				facts: { gap: 'gaplength', days: 6 },
			}),
		).toBe('b');
		expect(
			subjectTask({
				...base,
				check: 'resource-warning',
				subject: { kind: 'message', index: 0 },
				facts: { message: 'overbooked_length', text: '', tasks: [], task: 'a' },
			}),
		).toBe('a');
	});
});
