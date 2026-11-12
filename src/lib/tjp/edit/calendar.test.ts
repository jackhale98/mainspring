// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { addLeave, removeLeave, setWorkingHours, updateLeave } from './settings';
import { setup, span, textsAfter } from './testing';
import type { EditIntent, EditResult, Weekday } from './types';

const PLAN = `project p "P" 2026-01-05 - 2026-03-27 {
  now 2026-02-02
  workinghours mon - fri 9:00 - 17:00
  workinghours fri 9:00 - 13:00
}

leaves holiday "Founders day" 2026-02-09
vacation "Closure" 2026-02-23, 2026-02-25

resource ann "Ann" {
  workinghours sat, sun off
  leaves annual 2026-01-19 - 2026-01-23
}
resource bob "Bob"

task t "T" {
  effort 3d
  allocate ann, bob
}
`;

function run(intent: EditIntent, text = PLAN) {
	const s = setup(text);
	const r = applyIntent(s.snap, s.index, intent);
	return { s, r, text: r.status === 'edit' ? textsAfter(s.snap, r)['plan.tjp'] : undefined };
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;
const WEEK: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const ref = (text: string, needle: string) => ({
	item: { file: 'plan.tjp', ...span(setup(text).file(), needle) },
});

describe('setWorkingHours', () => {
	it('rewrites the statement with the same days when nothing later overrides it', () => {
		const r = run({
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: ['fri'],
			hours: [['8:00', '12:00']],
		});
		expect(r.text).toContain(
			'  workinghours mon - fri 9:00 - 17:00\n  workinghours fri 8:00 - 12:00\n',
		);
		const same = run({
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: ['fri'],
			hours: [['9:00', '13:00']],
		});
		expect(status(same.r)).toBe('noop:already-set');
	});

	it('appends after the last statement when a later one sets some of the days', () => {
		const r = run({
			type: 'setWorkingHours',
			scope: { kind: 'project' },
			days: WEEK,
			hours: [
				['9:00', '12:00'],
				['13:00', '18:00'],
			],
		});
		expect(r.text).toContain(
			'  workinghours fri 9:00 - 13:00\n  workinghours mon - fri 9:00 - 12:00, 13:00 - 18:00\n}',
		);
	});

	it('inserts a resource statement by 7.2 order, opening a body', () => {
		expect(
			run({
				type: 'setWorkingHours',
				scope: { kind: 'resource', resource: 'bob' },
				days: ['mon'],
				hours: 'off',
			}).text,
		).toContain('resource bob "Bob" {\n  workinghours mon off\n}');
		expect(
			run({
				type: 'setWorkingHours',
				scope: { kind: 'resource', resource: 'ann' },
				days: ['sat', 'sun'],
				hours: [['10:00', '14:00']],
			}).text,
		).toContain('  workinghours sat, sun 10:00 - 14:00\n  leaves annual');
	});

	it('goes before another scenario prefixed statement', () => {
		const sc = PLAN.replace(
			'  now 2026-02-02\n',
			'  now 2026-02-02\n  scenario plan "Plan" { scenario b "B" }\n',
		).replace('resource bob "Bob"', 'resource bob "Bob" {\n  b:workinghours mon off\n}');
		expect(
			run(
				{
					type: 'setWorkingHours',
					scope: { kind: 'resource', resource: 'bob' },
					days: ['tue'],
					hours: 'off',
				},
				sc,
			).text,
		).toContain('resource bob "Bob" {\n  workinghours tue off\n  b:workinghours mon off\n}');
	});

	it('refuses invalid hours and days', () => {
		const set = (days: Weekday[], hours: Array<[string, string]> | 'off'): string =>
			status(run({ type: 'setWorkingHours', scope: { kind: 'project' }, days, hours }).r);
		expect(set([], 'off')).toBe('refused:invalid-value');
		expect(set(['mon'], [['12:00', '9:00']])).toBe('refused:invalid-value');
		expect(set(['mon'], [['9:00', '25:00']])).toBe('refused:invalid-value');
		expect(set(['mon'], [['9', '10']])).toBe('refused:invalid-value');
		expect(
			status(
				run({
					type: 'setWorkingHours',
					scope: { kind: 'resource', resource: 'zz' },
					days: ['mon'],
					hours: 'off',
				}).r,
			),
		).toBe('refused:unknown-target');
	});

	it('refuses statements written with macros and body macros', () => {
		const m =
			'project p "P" 2026-01-05 +1m\nmacro h [ workinghours mon off ]\nresource a "A" {\n  ${h}\n}\n';
		expect(
			status(
				run(
					{
						type: 'setWorkingHours',
						scope: { kind: 'resource', resource: 'a' },
						days: ['mon'],
						hours: 'off',
					},
					m,
				).r,
			),
		).toBe('refused:macro-in-body');
		const v =
			'project p "P" 2026-01-05 +1m\nmacro d [mon]\nresource a "A" {\n  workinghours ${d} off\n}\n';
		expect(
			status(
				run(
					{
						type: 'setWorkingHours',
						scope: { kind: 'resource', resource: 'a' },
						days: ['tue'],
						hours: 'off',
					},
					v,
				).r,
			),
		).toBe('refused:text-only');
	});

	it('keeps CRLF and tabs', () => {
		const crlf = 'project p "P" 2026-01-05 +1m {\r\n\tnow 2026-01-06\r\n}\r\n';
		expect(
			run(
				{
					type: 'setWorkingHours',
					scope: { kind: 'project' },
					days: ['sat'],
					hours: [['9:00', '12:00']],
				},
				crlf,
			).text,
		).toBe(
			'project p "P" 2026-01-05 +1m {\r\n\tnow 2026-01-06\r\n\tworkinghours sat 9:00 - 12:00\r\n}\r\n',
		);
	});

	it('the wrapper builds the intent', () => {
		const s = setup(PLAN);
		expect(
			setWorkingHours(s.snap, s.index, { kind: 'project' }, ['fri'], [['9:00', '13:00']]).status,
		).toBe('noop');
	});
});

describe('addLeave', () => {
	it('appends to the last list of the scope', () => {
		expect(
			run({
				type: 'addLeave',
				scope: { kind: 'global' },
				leave: { type: 'holiday', name: 'Y', start: '2026-02-16' },
			}).text,
		).toContain('leaves holiday "Founders day" 2026-02-09, holiday "Y" 2026-02-16\n');
		expect(
			run({
				type: 'addLeave',
				scope: { kind: 'resource', resource: 'ann' },
				leave: { type: 'sick', start: '2026-02-04', end: '+2d' },
			}).text,
		).toContain('  leaves annual 2026-01-19 - 2026-01-23, sick 2026-02-04 +2d\n');
	});

	it('inserts a list where there is none', () => {
		expect(
			run({
				type: 'addLeave',
				scope: { kind: 'resource', resource: 'bob' },
				leave: { type: 'unpaid', start: '2026-02-04', end: '2026-02-06' },
			}).text,
		).toContain('resource bob "Bob" {\n  leaves unpaid 2026-02-04 - 2026-02-06\n}');
		const bare = 'project p "P" 2026-01-05 +1m\nresource a "A"\n';
		expect(
			run(
				{
					type: 'addLeave',
					scope: { kind: 'project' },
					leave: { type: 'holiday', start: '2026-01-06' },
				},
				bare,
			).text,
		).toBe('project p "P" 2026-01-05 +1m\nleaves holiday 2026-01-06\nresource a "A"\n');
	});

	it('noops a listed leave and refuses invalid ones', () => {
		const add = (leave: EditIntent & { type: 'addLeave' }['leave']): string =>
			status(run({ type: 'addLeave', scope: { kind: 'global' }, leave }).r);
		expect(add({ type: 'holiday', name: 'Founders day', start: '2026-02-09' })).toBe(
			'noop:already-set',
		);
		expect(add({ type: 'holiday', start: '2026-02-09', end: '2026-02-08' })).toBe(
			'refused:invalid-value',
		);
		expect(add({ type: 'holiday', start: '2026-02-09-09:30' })).toBe('refused:invalid-value');
		expect(add({ type: 'holiday', start: 'monday' })).toBe('refused:invalid-value');
		expect(add({ type: 'holiday', start: '2026-02-09', name: 'a${b}' })).toBe(
			'refused:invalid-value',
		);
		expect(add({ type: 'holiday', start: '2026-02-09', end: '+0d' })).toBe('refused:invalid-value');
	});

	it('the wrapper builds the intent', () => {
		const s = setup(PLAN);
		expect(
			addLeave(s.snap, s.index, { kind: 'global' }, { type: 'special', start: '2026-03-02' })
				.status,
		).toBe('edit');
	});
});

describe('updateLeave and removeLeave', () => {
	it('rewrites one leave item, keeping the same text as a noop', () => {
		const leave = ref(PLAN, 'annual 2026-01-19 - 2026-01-23');
		expect(
			run({ type: 'updateLeave', leave, to: { type: 'annual', start: '2026-01-26', end: '+3d' } })
				.text,
		).toContain('  leaves annual 2026-01-26 +3d\n');
		const same = { type: 'annual' as const, start: '2026-01-19', end: '2026-01-23' };
		expect(status(run({ type: 'updateLeave', leave, to: same }).r)).toBe('noop:already-set');
	});

	it('rewrites a vacation interval as a holiday only', () => {
		const leave = ref(PLAN, '2026-02-25');
		expect(
			run({ type: 'updateLeave', leave, to: { type: 'holiday', start: '2026-02-26' } }).text,
		).toContain('vacation "Closure" 2026-02-23, 2026-02-26\n');
		expect(
			status(run({ type: 'updateLeave', leave, to: { type: 'sick', start: '2026-02-26' } }).r),
		).toBe('refused:unsupported-form');
		expect(
			status(
				run({ type: 'updateLeave', leave, to: { type: 'holiday', name: 'X', start: '2026-02-26' } })
					.r,
			),
		).toBe('refused:unsupported-form');
	});

	it('removes an item with its comma, or the statement with its line', () => {
		expect(run({ type: 'removeLeave', leave: ref(PLAN, '2026-02-23') }).text).toContain(
			'vacation "Closure" 2026-02-25\n',
		);
		expect(
			run({ type: 'removeLeave', leave: ref(PLAN, 'holiday "Founders day" 2026-02-09') }).text,
		).toContain('}\n\nvacation "Closure"');
		const s = setup(PLAN);
		expect(
			removeLeave(s.snap, s.index, { item: { file: 'plan.tjp', from: 0, to: 3 } }),
		).toMatchObject({
			reason: 'unknown-target',
		});
		expect(
			updateLeave(s.snap, s.index, ref(PLAN, '2026-02-23'), {
				type: 'holiday',
				start: '2026-02-23',
			}).status,
		).toBe('noop');
	});
});
