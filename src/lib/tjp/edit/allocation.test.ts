// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { addAllocation, allocate, removeAllocation, replaceAllocation } from './link-intents';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const HEAD =
	'project p "P" 2026-01-05 +2m\nresource ana "Ana"\nresource bo "Bo"\nresource cy "Cy"\n';

function run(files: Record<string, string> | string, intent: EditIntent): EditResult {
	const s = setup(files);
	return applyIntent(s.snap, s.index, intent);
}

function after(
	files: Record<string, string> | string,
	intent: EditIntent,
	path = 'plan.tjp',
): string {
	const s = setup(files);
	return textsAfter(s.snap, applyIntent(s.snap, s.index, intent))[path] ?? '';
}

const addA = (task: string, resource: string): EditIntent => ({
	type: 'addAllocation',
	task,
	resource,
});
const remA = (task: string, resource: string): EditIntent => ({
	type: 'removeAllocation',
	task,
	resource,
});
const alloc = (task: string, resources: string[]): EditIntent => ({
	type: 'allocate',
	task,
	resources,
});

describe('addAllocation', () => {
	it('appends to the last own list, else inserts by 7.2 order', () => {
		const plan = HEAD + 'task t "T" {\n  effort 2d\n  allocate ana\n  complete 0\n}\n';
		expect(after(plan, addA('t', 'bo'))).toBe(plan.replace('allocate ana', 'allocate ana, bo'));
		const none = HEAD + 'task t "T" {\n  effort 2d\n  complete 0\n}\n';
		expect(after(none, addA('t', 'bo'))).toBe(
			none.replace('  complete', '  allocate bo\n  complete'),
		);
		const tabs = HEAD + 'task t "T" {\r\n\teffort 2d\r\n}\r\n';
		expect(after(tabs, addA('t', 'cy'))).toBe(
			HEAD + 'task t "T" {\r\n\teffort 2d\r\n\tallocate cy\r\n}\r\n',
		);
	});

	it('is already-set for own and inherited resources', () => {
		const plan =
			HEAD +
			'task g "G" {\n  allocate ana\n  task t "T" {\n    effort 1d\n    allocate bo\n  }\n}\n';
		expect(run(plan, addA('g.t', 'bo'))).toEqual({ status: 'noop', reason: 'already-set' });
		expect(run(plan, addA('g.t', 'ana'))).toEqual({ status: 'noop', reason: 'already-set' });
		expect(after(plan, addA('g.t', 'cy'))).toContain('allocate bo, cy');
	});

	it('refuses unknown resources and resources declared after the allocation', () => {
		const plan = HEAD + 'task t "T" { effort 1d allocate ana }\nresource late "Late"\n';
		expect(run(plan, addA('t', 'nobody'))).toMatchObject({ reason: 'unknown-target' });
		expect(run(plan, addA('t', 'late'))).toMatchObject({ reason: 'unknown-target' });
		expect(run(plan, addA('zz', 'ana'))).toMatchObject({ reason: 'unknown-target' });
	});

	it('follows resourceprefix as rule_resourceId reads it', () => {
		// Resource ids are global: `dev` under `resourceprefix team` is `dev` (child of team), and
		// a reference read under the prefix looks up `team.<id>`, which only a dotted id could
		// match. So no resource can be written there; outside the prefix, plain ids work.
		const files = {
			'plan.tjp':
				'project p "P" 2026-01-05 +2m\nresource team "Team"\ninclude "people.tji" { resourceprefix team }\n' +
				'include "tasks.tji" { resourceprefix team }\ntask u "U" {\n  effort 1d\n  allocate dev\n}\n',
			'people.tji': 'resource dev "Dev"\nresource qa "QA"\n',
			'tasks.tji': 'task t "T" {\n  length 1d\n}\n',
		};
		const s = setup(files);
		expect(s.index.resources.get('qa')?.parent).toBe('team');
		expect(textsAfter(s.snap, addAllocation(s.snap, s.index, 'u', 'qa'))['plan.tjp']).toContain(
			'allocate dev, qa\n',
		);
		expect(addAllocation(s.snap, s.index, 't', 'qa')).toMatchObject({ reason: 'unsupported-form' });
	});

	it('refuses a task TaskJuggler would make a milestone when that leaves it underspecified', () => {
		// Start-only: it runs to the project end, unless something depends on its open end.
		const plan = HEAD + 'task a "A" { effort 1d allocate ana }\ntask m "M" { depends !a }\n';
		expect(run(plan, addA('m', 'bo'))).toMatchObject({ status: 'edit' });
		const waited = plan + 'task s "S" { depends m length 1d }\n';
		expect(run(waited, addA('m', 'bo'))).toMatchObject({ reason: 'conflicting-attribute' });
		const none = HEAD + 'task m "M"\n';
		expect(run(none, addA('m', 'bo'))).toMatchObject({ reason: 'conflicting-attribute' });
		const both = HEAD + 'task m "M" { start 2026-01-06 end 2026-01-09 }\n';
		expect(run(both, addA('m', 'bo'))).toMatchObject({ status: 'edit' });
	});

	it('refuses items with a body (alternatives, select)', () => {
		const plan = HEAD + 'task t "T" { effort 1d allocate ana { alternative bo } }\n';
		expect(run(plan, addA('t', 'cy'))).toMatchObject({ reason: 'unsupported-form' });
	});

	it('never inserts after a child task', () => {
		const plan = HEAD + 'task g "G" {\n  task t "T" { effort 1d allocate ana }\n  note "n"\n}\n';
		expect(after(plan, addA('g', 'bo'))).toBe(
			HEAD +
				'task g "G" {\n  allocate bo\n  task t "T" { effort 1d allocate ana }\n  note "n"\n}\n',
		);
	});
});

describe('removeAllocation', () => {
	it('removes the item or the statement, across declaration and supplements', () => {
		const plan =
			HEAD +
			'task t "T" {\n  effort 1d\n  allocate ana, bo\n}\nsupplement task t {\n  allocate bo\n}\n';
		expect(after(plan, remA('t', 'bo'))).toBe(
			HEAD + 'task t "T" {\n  effort 1d\n  allocate ana\n}\nsupplement task t {\n}\n',
		);
		expect(run(plan, remA('t', 'cy'))).toEqual({ status: 'noop', reason: 'not-present' });
	});

	it('refuses inherited resources and the last allocation of an effort task', () => {
		const plan =
			HEAD +
			'task g "G" {\n  allocate ana\n  task t "T" {\n    effort 1d\n    allocate bo\n  }\n}\n';
		expect(run(plan, remA('g.t', 'ana'))).toMatchObject({ reason: 'inherited' });
		const lone = HEAD + 'task t "T" {\n  effort 1d\n  allocate ana\n}\n';
		expect(run(lone, remA('t', 'ana'))).toMatchObject({ reason: 'conflicting-attribute' });
		const s = setup(lone.replace('effort', 'length'));
		expect(textsAfter(s.snap, removeAllocation(s.snap, s.index, 't', 'ana'))['plan.tjp']).toBe(
			HEAD + 'task t "T" {\n  length 1d\n}\n',
		);
	});

	it("refuses leaving a container's later effort children without allocations", () => {
		// c inherits g's list: without it, effort_no_allocations natively.
		const plan = HEAD + 'task g "G" {\n  allocate ana\n  task c "C" { effort 2d }\n}\n';
		const effort = { from: plan.indexOf('effort 2d'), to: plan.indexOf('effort 2d') + 9 };
		for (const intent of [remA('g', 'ana'), alloc('g', [])]) {
			expect(run(plan, intent)).toEqual({
				status: 'refused',
				reason: 'conflicting-attribute',
				at: [{ file: 'plan.tjp', ...effort }],
			});
		}
		// Replacing the list keeps c allocated; so does c's own list.
		expect(after(plan, alloc('g', ['bo']))).toBe(plan.replace('allocate ana', 'allocate bo'));
		const ownList = plan.replace('effort 2d }', 'effort 2d allocate cy }');
		expect(after(ownList, remA('g', 'ana'))).toBe(ownList.replace('  allocate ana\n', ''));
		const twice = plan.replace('allocate ana', 'allocate ana, bo');
		expect(after(twice, remA('g', 'ana'))).toBe(plan.replace('allocate ana', 'allocate bo'));
		// A child without an effort needs no allocation.
		const bare = HEAD + 'task g "G" {\n  allocate ana\n  task c "C" { length 2d }\n}\n';
		expect(after(bare, remA('g', 'ana'))).toBe(bare.replace('  allocate ana\n', ''));
	});

	it('leaves scenario-prefixed lists alone', () => {
		const plan =
			'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario d "D"\n  }\n}\n' +
			'resource ana "Ana"\nresource bo "Bo"\ntask t "T" {\n  effort 1d\n  allocate ana\n  d:allocate bo\n}\n';
		expect(run(plan, remA('t', 'bo'))).toEqual({ status: 'noop', reason: 'not-present' });
	});
});

describe('allocate', () => {
	it('reshapes the lists with the fewest edits', () => {
		const plan = HEAD + 'task t "T" {\n  effort 1d\n  allocate ana, bo\n}\n';
		expect(after(plan, alloc('t', ['bo', 'cy']))).toBe(
			HEAD + 'task t "T" {\n  effort 1d\n  allocate bo, cy\n}\n',
		);
		expect(after(plan, alloc('t', ['cy']))).toBe(
			HEAD + 'task t "T" {\n  effort 1d\n  allocate cy\n}\n',
		);
		expect(run(plan, alloc('t', ['bo', 'ana']))).toEqual({ status: 'noop', reason: 'already-set' });
		expect(run(plan, alloc('t', []))).toMatchObject({ reason: 'conflicting-attribute' });
		const two = HEAD + 'task t "T" {\n  effort 1d\n  allocate ana\n  allocate bo\n}\n';
		expect(after(two, alloc('t', ['cy']))).toBe(
			HEAD + 'task t "T" {\n  effort 1d\n  allocate cy\n}\n',
		);
	});

	it('refuses dropping an inherited resource', () => {
		const plan = HEAD + 'task g "G" {\n  allocate ana\n  task t "T" { effort 1d }\n}\n';
		const s = setup(plan);
		expect(allocate(s.snap, s.index, 'g.t', ['bo'])).toMatchObject({ reason: 'inherited' });
		expect(
			textsAfter(s.snap, allocate(s.snap, s.index, 'g.t', ['ana', 'bo']))['plan.tjp'],
		).toContain('task t "T" { effort 1d allocate bo }');
	});
});

describe('replaceAllocation', () => {
	it('rewrites the id token in place', () => {
		const plan = HEAD + 'task t "T" {\n  effort 1d\n  allocate ana, bo # team\n}\n';
		const s = setup(plan);
		const r = replaceAllocation(s.snap, s.index, 't', 'ana', 'cy');
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(plan.replace('ana, bo', 'cy, bo'));
		expect(
			textsAfter(s.snap, replaceAllocation(s.snap, s.index, 't', 'ana', 'bo'))['plan.tjp'],
		).toBe(plan.replace('ana, bo', 'bo'));
		expect(replaceAllocation(s.snap, s.index, 't', 'cy', 'ana')).toEqual({
			status: 'noop',
			reason: 'not-present',
		});
		expect(replaceAllocation(s.snap, s.index, 't', 'ana', 'ana')).toMatchObject({ status: 'noop' });
		expect(replaceAllocation(s.snap, s.index, 't', 'ana', 'zz')).toMatchObject({
			reason: 'unknown-target',
		});
	});

	it('refuses a macro-written list', () => {
		const plan = HEAD + 'macro who [ana]\ntask t "T" {\n  effort 1d\n  allocate ${who}\n}\n';
		expect(run(plan, addA('t', 'bo'))).toMatchObject({ status: 'refused' });
	});
});
