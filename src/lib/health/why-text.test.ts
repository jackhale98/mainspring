// SPDX-License-Identifier: GPL-2.0-or-later
// "Why here?" in words (why-text.ts, phase-3.md 9.7): the explainer's causes of real golden plans as
// sentences with their links, the dates in the plan's zone and the Schedule block's rule for a
// finish, "says less when unsure", and the frame cause that never claims a start at the project
// start. Expectations are the sentences for the hand-checked causes of explain.test.ts.
import { describe, expect, it } from 'vitest';
import { explainTask } from '../schedule/explain';
import { goldenContext } from '../schedule/explain-testing';
import type { Placement } from '../schedule/explain-types';
import { whyText, windowText } from './why-text';

const LOCALE = 'en-GB';
const why = (plan: string, id: string) => {
	const ctx = goldenContext(plan);
	return whyText(explainTask(id, ctx), ctx, LOCALE);
};
const texts = (plan: string, id: string): string[] => {
	const w = why(plan, id);
	return [...w.causes, ...w.inside].map((l) => l.text);
};

describe('causes as sentences', () => {
	it('a dependency names the task and when it ends; a milestone ends on its own day', () => {
		expect(texts('workload-held-effort', 'build')).toEqual([
			'Waits for Kickoff (ends Mon 5 Jan).',
			"Outside the project's working hours, Mon 5 Jan.",
		]);
		const w = why('workload-held-effort', 'build');
		expect(w.causes[0]?.links).toEqual([{ kind: 'task', task: 'kick', label: 'Select Kickoff' }]);
	});

	it('a gap is said after the dependency', () => {
		expect(texts('syn-08-deps-gaps-alap', 'line.build')[0]).toBe(
			'Waits for Design (ends Fri 9 Jan), then a gap.',
		);
	});

	it('the frame says only that the project start is the limit', () => {
		expect(texts('workload-held-effort', 'kick')).toEqual([
			'No dependency or date sets this. The project start is the limit.',
		]);
		for (const line of texts('syn-17-priority-efficiency', 'contend.urgent')) {
			expect(line).not.toMatch(/starts at the project start/i);
		}
	});

	it('a person booked elsewhere: the tasks, the window and the hours, with links', () => {
		const w = why('syn-17-priority-efficiency', 'contend.normal');
		const busy = w.causes.find((l) => l.kind === 'busy');
		expect(busy?.text).toBe(
			'Fox is booked on Urgent and Slow worker, Mon 5 Jan to Tue 3 Feb (176 h).',
		);
		expect(busy?.links.map((l) => l.kind)).toEqual(['person', 'task', 'task']);
		expect(busy?.links[0]).toMatchObject({
			kind: 'person',
			resource: 'fox',
			label: 'Open Fox in Workload',
		});
	});

	it('names at most three tasks and counts the rest', () => {
		const ctx = goldenContext('syn-17-priority-efficiency');
		const p = explainTask('contend.low', ctx);
		const busy = p.causes.find((c) => c.kind === 'busy');
		if (busy?.kind !== 'busy') throw new Error('no busy cause');
		const more: Placement = {
			...p,
			causes: [
				{
					...busy,
					on: [
						{ task: 'contend.urgent', minutes: 60 },
						{ task: 'contend.normal', minutes: 60 },
						{ task: 'contend.slow', minutes: 60 },
						{ task: 'contend.fast', minutes: 60 },
						{ task: 'contend', minutes: 60 },
					],
				},
			],
		};
		const w = whyText(more, ctx, LOCALE);
		expect(w.causes[0]?.text).toMatch(/booked on Urgent, Normal, Slow worker and 2 other tasks, /);
		expect(w.causes[0]?.links.filter((l) => l.kind === 'task')).toHaveLength(3);
	});

	it('leave: a person with the type, and the project calendar', () => {
		const all = texts('syn-13-calendars-leaves', 'calendar.build');
		expect(all).toContain('Xan is on sick leave, Wed 4 Feb.');
		expect(all).toContain('The project is on holiday, Mon 9 Feb.');
		expect(texts('syn-13-calendars-leaves', 'calendar.mid')).toContain(
			'Xan is on annual leave, Mon 19 Jan to Thu 22 Jan.',
		);
	});

	it('a written date is a constraint with its date and a link to the text', () => {
		expect(texts('syn-13-calendars-leaves', 'calendar.kick')[0]).toBe(
			'“start 5 Jan 2026” is written on this task (a constraint).',
		);
		const link = why('syn-13-calendars-leaves', 'calendar.kick').causes[0]?.links[0];
		expect(link?.kind).toBe('text');
	});

	it('an inherited date names the container, and says no date when it is a macro', () => {
		expect(texts('fedora-res', 'f20.first_day')).toEqual([
			'A start is written on Fedora 20, which contains this task (a constraint).',
		]);
		expect(texts('fedora-res', 'f20.naming')[0]).toMatch(
			/^“start 17 Sept? 2013” is written on this task \(a constraint\)\.$/,
		);
	});

	it('a limits statement may hold it, and says on whom', () => {
		expect(texts('syn-03-limits-resource-max', 'deliver.alpha')).toContain(
			'A “limits” statement on Eve may hold it.',
		);
		// It is a gap inside the bar (an effort task), so it is listed under "Inside the bar".
		const limit = why('syn-03-limits-resource-max', 'deliver.alpha').inside.find(
			(l) => l.kind === 'limit',
		);
		expect(limit?.links[0]?.kind).toBe('text');
	});

	it('says less when unsure: unknown claims nothing and has no links', () => {
		const ctx = goldenContext('workload-held-effort');
		const p: Placement = {
			task: 'build',
			anchor: 'start',
			bound: null,
			at: 540,
			causes: [{ kind: 'unknown' }],
			inside: [],
		};
		const w = whyText(p, ctx, LOCALE);
		expect(w.causes).toEqual([
			{ kind: 'unknown', text: 'The schedule does not show why.', links: [] },
		]);
	});

	it('an ALAP task is told by what it has to be done before, and an end constraint by its container', () => {
		// beta ends before gamma starts (Mon 13 Apr 09:00), with a gap; gamma inherits `end 2026-04-15`.
		expect(texts('syn-08-deps-gaps-alap', 'alap.beta')[1]).toMatch(
			/^Has to be done before Gamma starts \(Mon 13 Apr\), allowing a gap\.$/,
		);
		expect(texts('syn-08-deps-gaps-alap', 'alap.gamma')[1]).toMatch(
			/is written on .*, which contains this task \(a constraint\)\.$/,
		);
	});
});

describe('windowText', () => {
	const project = { start: '2026-01-05T00:00:00Z', timezone: 'UTC' };
	const p = project as unknown as Parameters<typeof windowText>[1];
	it('is one date inside a day, and the last day worked at the end of a window', () => {
		expect(windowText([540, 1020], p, LOCALE)).toBe('Mon 5 Jan');
		// To the end of Friday 9 Jan: the window's last day is Friday, not Saturday.
		expect(windowText([0, 5 * 1440], p, LOCALE)).toBe('Mon 5 Jan to Fri 9 Jan');
	});
});
