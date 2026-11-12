// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { addLeave, removeLeave, updateLeave } from './settings';
import { setup, span, textsAfter } from './testing';
import type { EditIntent, EditResult, IntentOf } from './types';

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
const ref = (text: string, needle: string) => ({
	item: { file: 'plan.tjp', ...span(setup(text).file(), needle) },
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
		const add = (leave: IntentOf<'addLeave'>['leave']): string =>
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
