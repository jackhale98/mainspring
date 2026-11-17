// SPDX-License-Identifier: GPL-2.0-or-later
// H1 and H2 (links.ts) on hand-made results over inline text: the ancestor rules, `precedes`, the
// start and finish milestone exemptions, containers, and the text-only reason of the picker.
// Day 0 is Monday 2026-01-05, working 09:00-17:00.
import { describe, expect, it } from 'vitest';
import { at, dep, plan, type TaskSpec } from '../schedule/testing';
import { checkPlan } from './report';
import { inlineInput, only } from './testing';

/** Inline text declaring the tasks, nested by their `parent`. */
function textOf(tasks: ReadonlyArray<readonly [string, TaskSpec]>, extra = ''): string {
	const kids = (p: string | undefined): string =>
		tasks
			.filter(([, s]) => s.parent === p)
			.map(([id]) => {
				const local = id.split('.').pop() ?? id;
				return `task ${local} "${local.toUpperCase()}" {\n${kids(id)}}\n`;
			})
			.join('');
	return `project p "P" 2026-01-05 - 2026-03-02 {\n}\n${extra}${kids(undefined)}`;
}

function found(
	check: 'no-predecessor' | 'no-successor',
	tasks: Array<[string, TaskSpec]>,
	linkMilestones = true,
) {
	const settings = { ...only(check), linkMilestones };
	const r = checkPlan(inlineInput(plan(tasks), textOf(tasks), settings));
	return r.findings.map((f) => (f.subject.kind === 'task' ? f.subject.id : '?'));
}

describe('H1 no predecessor', () => {
	it('finds a leaf with no depends, no precedes into it or an ancestor', () => {
		expect(
			found('no-predecessor', [
				['a', { start: at(0, 9), end: at(1, 17) }],
				['b', { start: at(2, 9), end: at(3, 17), depends: [dep('a')] }],
			]),
		).toEqual(['a']);
	});

	it('counts a task that precedes it, or precedes or is depended on by an ancestor', () => {
		const tasks: Array<[string, TaskSpec]> = [
			['x', { start: at(0, 9), end: at(0, 17), precedes: [dep('p')], milestone: false }],
			['p', { start: at(1, 9), end: at(2, 17) }],
			['p.c', { start: at(1, 9), end: at(2, 17), parent: 'p' }],
			['q', { start: at(1, 9), end: at(2, 17), depends: [dep('x')] }],
			['q.d', { start: at(1, 9), end: at(2, 17), parent: 'q' }],
			['r', { start: at(0, 9), end: at(0, 17), precedes: [dep('s')] }],
			['s', { start: at(1, 9), end: at(1, 17) }],
		];
		// p.c: p is preceded by x. q.d: q depends on x. s: preceded by r. Only x and r are first.
		expect(found('no-predecessor', tasks)).toEqual(['x', 'r']);
	});

	it('exempts a milestone at the project start, or at its first working minute', () => {
		const tasks = (start: number, milestone: boolean): Array<[string, TaskSpec]> => [
			['kick', { start, end: start, milestone }],
			['a', { start: at(0, 9), end: at(1, 17), depends: [dep('kick')] }],
		];
		expect(found('no-predecessor', tasks(0, true))).toEqual([]);
		expect(found('no-predecessor', tasks(at(0, 9), true))).toEqual([]);
		expect(found('no-predecessor', tasks(at(0, 10), true))).toEqual(['kick']);
		expect(found('no-predecessor', tasks(0, false))).toEqual(['kick']);
	});

	it('leaves milestones out by default (key dates are unlinked on purpose), in with the setting', () => {
		const tasks: Array<[string, TaskSpec]> = [
			['a', { start: at(0, 9), end: at(1, 17) }],
			['m', { start: at(3, 9), end: at(3, 9), milestone: true }],
		];
		expect(found('no-predecessor', tasks, false)).toEqual(['a']);
		expect(found('no-successor', tasks, false)).toEqual(['a']);
		expect(found('no-predecessor', tasks, true)).toEqual(['a', 'm']);
		// m ends last: with the setting on it is still the finish milestone, exempt from H2.
		expect(found('no-successor', tasks, true)).toEqual(['a']);
	});

	it('does not check containers, and checks milestones with the setting on', () => {
		expect(
			found('no-predecessor', [
				['g', { start: at(0, 9), end: at(1, 17) }],
				['g.a', { start: at(0, 9), end: at(1, 17), parent: 'g' }],
				['m', { start: at(3, 9), end: at(3, 9), milestone: true }],
			]),
		).toEqual(['g.a', 'm']);
	});

	it('opens the picker, disabled for a task only a macro declares', () => {
		const tasks: Array<[string, TaskSpec]> = [
			['a', { start: at(0, 9), end: at(1, 17) }],
			['made', { start: at(0, 9), end: at(1, 17), depends: [dep('a')] }],
			['b', { start: at(2, 9), end: at(2, 17), depends: [dep('made')] }],
		];
		const text = textOf(tasks.filter(([id]) => id !== 'made')).replace('task b', '${made}\ntask b');
		const r = checkPlan(
			inlineInput(
				plan(tasks.map(([id, s]) => [id, id === 'made' ? { ...s, depends: [] } : s])),
				`macro made [task made "Made" {}]\n${text}`,
				only('no-predecessor'),
			),
		);
		expect(r.findings.map((f) => [f.subject, f.fixes])).toEqual([
			[
				{ kind: 'task', id: 'a' },
				[{ kind: 'pick', role: 'predecessor', task: 'a', disabled: null }],
			],
			[
				{ kind: 'task', id: 'made' },
				[{ kind: 'pick', role: 'predecessor', task: 'made', disabled: 'expanded-only' }],
			],
		]);
		expect(r.findings[1]?.at).toBeNull();
	});
});

describe('H2 no successor', () => {
	it('finds a leaf nothing depends on, with no precedes of its own or an ancestor', () => {
		expect(
			found('no-successor', [
				['a', { start: at(0, 9), end: at(1, 17) }],
				['b', { start: at(2, 9), end: at(3, 17), depends: [dep('a')] }],
				['c', { start: at(2, 9), end: at(2, 17) }],
			]),
		).toEqual(['b', 'c']);
	});

	it('counts a task depending on an ancestor, and an ancestor that precedes', () => {
		expect(
			found('no-successor', [
				['g', { start: at(0, 9), end: at(1, 17) }],
				['g.a', { start: at(0, 9), end: at(1, 17), parent: 'g' }],
				['h', { start: at(0, 9), end: at(1, 17), precedes: [dep('z')] }],
				['h.b', { start: at(0, 9), end: at(1, 17), parent: 'h' }],
				['z', { start: at(2, 9), end: at(4, 17), depends: [dep('g')] }],
				['done', { start: at(4, 17), end: at(4, 17), milestone: true, depends: [dep('z')] }],
			]),
		).toEqual([]);
	});

	it('exempts a milestone that ends at the scenario finish only', () => {
		const tasks = (end: number): Array<[string, TaskSpec]> => [
			['a', { start: at(0, 9), end: at(1, 17) }],
			['b', { start: at(0, 9), end: at(2, 17), precedes: [dep('m')] }],
			['m', { start: end, end, milestone: true, depends: [dep('a')] }],
		];
		expect(found('no-successor', tasks(at(2, 17)))).toEqual([]);
		// A milestone before the finish (b ends later) is not the finish milestone.
		expect(found('no-successor', tasks(at(1, 17)))).toEqual(['m']);
	});
});
