// SPDX-License-Identifier: GPL-2.0-or-later
// Reading TaskJuggler's messages (messages.ts): the task each names, the two dates of a constraint
// warning with their offsets, and priority_inversion's info lines. Texts as TaskScenario.rb
// writes them (and as the goldens hold them).
import { describe, expect, it } from 'vitest';
import type { EngineMessage } from '../../engine/protocol';
import { project } from '../schedule/testing';
import { inScenario, inversionTasks, messageTask, warningDates } from './messages';

const m = (id: string, text: string, scenario: string | null = 'plan'): EngineMessage => ({
	level: 'warning',
	id,
	text,
	file: null,
	line: null,
	column: null,
	scenario,
});
const KNOWN = new Set(['test', 'f20.pr.ceo_blog.ceo_blog_legal', 'a', 'b']);

describe('messages', () => {
	it('reads the task of each message, when the result has it', () => {
		const cases: Array<[string, string, string | null]> = [
			['maxstart', 'The start time (x) of task test is too late. Must be before y.', 'test'],
			['minstart', 'The start time (x) of task test is too early. Must be after y.', 'test'],
			['minend', 'The end time (x) of task test is too early. Must be after y.', 'test'],
			['maxend', 'The end time (x) of task gone is too late. Must be before y.', null],
			[
				'allocate_no_assigned',
				'Task f20.pr.ceo_blog.ceo_blog_legal has resource allocation requested, but did not get any resources assigned.',
				'f20.pr.ceo_blog.ceo_blog_legal',
			],
			['priority_inversion', 'the following task stole resources from b despite having', 'b'],
			['priority_inversion_info', 'Task a', 'a'],
			[
				'overbooked_effort',
				'The total effort of the provided bookings for task a exceeds it.',
				'a',
			],
			['other', 'Task a has something.', null],
		];
		for (const [id, text, task] of cases) expect(messageTask(m(id, text), KNOWN), id).toBe(task);
	});

	it('reads both dates of a warning as instants, offsets included', () => {
		const p = { project: project() };
		expect(
			warningDates(
				m(
					'maxstart',
					'The start time (2026-01-08-09:00-+0000) of task test is too late. Must be before 2026-01-07-00:00-+0000.',
				),
				p,
			),
		).toEqual({ date: 3 * 1440 + 540, limit: 2 * 1440 });
		expect(
			warningDates(
				m(
					'minstart',
					'The start time (2026-01-05-10:00-+0100) of task t is too early. Must be after 2026-01-06-00:00-+0100.',
				),
				p,
			),
		).toEqual({ date: 540, limit: 1440 - 60 });
		expect(warningDates(m('maxend', 'No dates here.'), p)).toBeNull();
		expect(warningDates(m('maxend', 'x'), { project: null })).toBeNull();
	});

	it('takes the info lines right after a priority_inversion', () => {
		const list = [
			m('priority_inversion', 'stole resources from b despite'),
			{ ...m('priority_inversion_info', 'Task a'), level: 'info' as const },
			{ ...m('priority_inversion_info', 'Task gone'), level: 'info' as const },
			m('maxend', 'x'),
			{ ...m('priority_inversion_info', 'Task b'), level: 'info' as const },
		];
		expect(inversionTasks(list, 0, KNOWN)).toEqual(['a']);
	});

	it('keeps the shown scenario’s and the scenario-less messages', () => {
		expect(
			[m('x', '', 'plan'), m('x', '', null), m('x', '', 'alt')].map((x) => inScenario(x, 'plan')),
		).toEqual([true, true, false]);
	});
});
