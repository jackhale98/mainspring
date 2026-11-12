// SPDX-License-Identifier: GPL-2.0-or-later
// addTask (phase-1.md 7.1, 7.2): exact text, positions by sibling index, ids, attributes, layout
// of the destination file (unit, line breaks, blank lines), and refusals.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { addTask } from './task-tree';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

const H = 'project p "P" 2026-01-05 +2m\nresource r "R"\nflags hot\n';

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

const add = (
	parent: string | null,
	index: number,
	name: string,
	extra: Partial<Extract<EditIntent, { type: 'addTask' }>> = {},
): EditIntent => ({ type: 'addTask', parent, index, name, ...extra });

describe('addTask positions', () => {
	const plan = H + 'task a "A" {\n  effort 1d\n  task x "X"\n  task y "Y"\n}\n';

	it('inserts after sibling index-1, before the first sibling, or into an empty body', () => {
		expect(after(plan, add('a', 1, 'New'))).toBe(
			H + 'task a "A" {\n  effort 1d\n  task x "X"\n  task new "New"\n  task y "Y"\n}\n',
		);
		expect(after(plan, add('a', 0, 'New'))).toBe(
			H + 'task a "A" {\n  effort 1d\n  task new "New"\n  task x "X"\n  task y "Y"\n}\n',
		);
		expect(after(plan, add('a', 2, 'New'))).toBe(
			H + 'task a "A" {\n  effort 1d\n  task x "X"\n  task y "Y"\n  task new "New"\n}\n',
		);
		expect(after(plan, add('a.x', 0, 'New'))).toBe(
			H + 'task a "A" {\n  effort 1d\n  task x "X" {\n    task new "New"\n  }\n  task y "Y"\n}\n',
		);
		expect(after(plan, add(null, 1, 'Root'))).toBe(plan + 'task root "Root"\n');
		expect(after(H, add(null, 0, 'First'))).toBe(H + 'task first "First"\n');
	});

	it('adds inline to a one-line body and keeps a trailing comment on the header line', () => {
		expect(after(H + 'task a "A" { priority 600 }\n', add('a', 0, 'N'))).toBe(
			H + 'task a "A" { priority 600 task n "N" }\n',
		);
		expect(after(H + 'task a "A" # note\n', add('a', 0, 'N'))).toBe(
			H + 'task a "A" { # note\n  task n "N"\n}\n',
		);
	});

	it('copies the previous sibling blank-line separation', () => {
		const spaced = H + '\ntask a "A"\n\n# about b\ntask b "B"\n';
		expect(after(spaced, add(null, 2, 'C'))).toBe(spaced + '\ntask c "C"\n');
		expect(after(spaced, add(null, 1, 'M'))).toBe(
			H + '\ntask a "A"\n\ntask m "M"\n\n# about b\ntask b "B"\n',
		);
		// Index 0: the separation between the first two siblings goes between the new and old first.
		expect(after(spaced, add(null, 0, 'Z'))).toBe(
			H + '\ntask z "Z"\n\ntask a "A"\n\n# about b\ntask b "B"\n',
		);
		const tight = H + 'task a "A"\ntask b "B"\n';
		expect(after(tight, add(null, 0, 'Z'))).toBe(H + 'task z "Z"\ntask a "A"\ntask b "B"\n');
	});

	it('follows the file unit and line breaks (tabs, CRLF)', () => {
		const tabs = (
			H + 'task a "A" {\n\tallocate r\n\ttask b "B" {\n\t\tpriority 600\n\t}\n}\n'
		).replace(/\n/g, '\r\n');
		const out = after(tabs, add('a.b', 0, 'N', { attrs: [['effort', '2d']] }));
		expect(out).toBe(
			(
				H +
				'task a "A" {\n\tallocate r\n\ttask b "B" {\n\t\tpriority 600\n\t\ttask n "N" {\n\t\t\teffort 2d\n\t\t}\n\t}\n}\n'
			).replace(/\n/g, '\r\n'),
		);
	});

	it('lands in a prefixed include when the previous sibling is declared there', () => {
		const files = {
			'plan.tjp': H + 'task p "P" {\n  task x "X"\n}\ninclude "s.tji" { taskprefix p }\n',
			's.tji': 'task s "S" {\n  effort 1d\n}\n',
		};
		const s = setup(files);
		const r = addTask(s.snap, s.index, 'p', 2, 'n', 'N');
		expect(textsAfter(s.snap, r)['s.tji']).toBe('task s "S" {\n  effort 1d\n}\ntask n "N"\n');
	});

	it('selects the new header', () => {
		const s = setup(H + 'task a "A"\n');
		const r = addTask(s.snap, s.index, 'a', 0, undefined, 'Child');
		if (r.status !== 'edit') throw new Error(JSON.stringify(r));
		const text = textsAfter(s.snap, r)['plan.tjp'] ?? '';
		const sel = r.edit.select;
		expect(sel && text.slice(sel.from, sel.to)).toBe('task child "Child"');
	});
});

describe('addTask ids, names and attributes', () => {
	const plan = H + 'task a "A" {\n  task build "Build"\n}\n';

	it('makes the id from the name with a suffix on collision, or takes the given id', () => {
		expect(after(plan, add('a', 1, 'Build'))).toContain('task build_2 "Build"');
		expect(after(plan, add('a', 1, 'Écrire 2!'))).toContain('task ecrire_2 "Écrire 2!"');
		expect(after(plan, add('a', 1, 'X', { id: 'qa' }))).toContain('task qa "X"');
	});

	it('refuses taken and invalid ids, unsafe names and bad positions', () => {
		expect(run(plan, add('a', 0, 'X', { id: 'build' }))).toMatchObject({ reason: 'id-collision' });
		expect(run(plan, add('a', 0, 'X', { id: '9x' }))).toMatchObject({ reason: 'invalid-value' });
		expect(run(plan, add('a', 0, 'X', { id: 'a.b' }))).toMatchObject({ reason: 'invalid-value' });
		expect(run(plan, add('a', 0, 'x ${m}'))).toMatchObject({ reason: 'unsafe-text' });
		expect(run(plan, add('a', 0, 'two\nlines'))).toMatchObject({ reason: 'unsafe-text' });
		expect(run(plan, add('a', 5, 'X'))).toMatchObject({ reason: 'invalid-value' });
		expect(run(plan, add('a', -1, 'X'))).toMatchObject({ reason: 'invalid-value' });
		expect(run(plan, add('nope', 0, 'X'))).toMatchObject({ reason: 'unknown-target' });
	});

	it('escapes quotes in the name', () => {
		expect(after(plan, add(null, 1, 'Say "hi"', { id: 'hi' }))).toContain('task hi "Say \\"hi\\""');
	});

	it('writes attributes through setAttr: canonical order and printing', () => {
		const attrs = [
			['effort', '3d'],
			['flags', ['hot']],
			['note', '"Why"'],
			['responsible', ['r']],
			['priority', '0700'],
		] as const;
		const plan = H + 'task p "P" {\n  allocate r\n}\n';
		expect(after(plan, add('p', 0, 'T', { attrs }))).toBe(
			H +
				'task p "P" {\n  allocate r\n  task t "T" {\n    note "Why"\n    flags hot\n' +
				'    priority 700\n    responsible r\n    effort 3d\n  }\n}\n',
		);
		expect(after(H, add(null, 0, 'M', { attrs: [['milestone', true]] }))).toContain(
			'task m "M" {\n  milestone\n}',
		);
		expect(after(H, add(null, 0, 'M', { attrs: [['milestone', false]] }))).toContain(
			'task m "M"\n',
		);
	});

	it('refuses what setAttr refuses, and effort without an allocation', () => {
		const bad = (attrs: Extract<EditIntent, { type: 'addTask' }>['attrs'], text = H): EditResult =>
			run(text, add(null, 0, 'T', attrs ? { attrs } : {}));
		expect(bad([['duration', 'soon']])).toMatchObject({ reason: 'invalid-value' });
		expect(bad([['note', 'plain text']])).toMatchObject({ reason: 'invalid-value' });
		expect(bad([['note', '"${x}"']])).toMatchObject({ status: 'refused' });
		expect(bad([['flags', ['cold']]])).toMatchObject({ reason: 'undeclared-flag' });
		expect(bad([['responsible', ['nobody']]])).toMatchObject({ reason: 'invalid-value' });
		expect(
			bad([
				['milestone', true],
				['duration', '1d'],
			]),
		).toMatchObject({ reason: 'conflicting-attribute' });
		// effort_no_allocations: no allocation to inherit.
		expect(bad([['effort', '1d']])).toMatchObject({ reason: 'conflicting-attribute' });
	});

	it('refuses native errors found against tj3 (flag declared later, resourceprefix, overspecified)', () => {
		const late = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
		expect(
			run(late + 'task a "A"\nflags hot\n', add(null, 0, 'T', { attrs: [['flags', ['hot']]] })),
		).toMatchObject({ reason: 'undeclared-flag' });
		const prefixed = {
			'plan.tjp': late + 'resource g "G"\ninclude "t.tji" { resourceprefix g }\n',
			't.tji': 'task t "T"\n',
		};
		expect(run(prefixed, add(null, 1, 'N', { attrs: [['responsible', ['r']]] }))).toMatchObject({
			reason: 'invalid-value',
		});
		const timed = [
			['start', '2026-01-06'],
			['end', '2026-01-20'],
			['duration', '2d'],
		] as const;
		expect(run(late, add(null, 0, 'T', { attrs: timed }))).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});

	it('refuses a child under a leaf with its own sizing or milestone', () => {
		const plan = H + 'task a "A" {\n  allocate r\n  effort 2d\n}\ntask m "M" {\n  milestone\n}\n';
		expect(run(plan, add('a', 0, 'C'))).toMatchObject({ reason: 'conflicting-attribute' });
		expect(run(plan, add('m', 0, 'C'))).toMatchObject({ reason: 'conflicting-attribute' });
	});
});

describe('addTask refusals from the text', () => {
	it('refuses a parent whose id is a macro and a parent in a shared file', () => {
		const mac = H + 'macro id [ t ]\ntask ${id} "T" {\n  effort 1d\n}\n';
		const s = setup(mac);
		const t = [...s.index.unresolved];
		expect(t).toHaveLength(1);
		expect(run(mac, add(null, 0, 'N'))).toMatchObject({ reason: 'needs-schedule' });
		const shared = {
			'plan.tjp':
				H +
				'task g1 "G1"\ntask g2 "G2"\n' +
				'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
			't.tji': 'task t "T" {\n  priority 600\n}\n',
		};
		expect(run(shared, add('g1.t', 0, 'N'))).toMatchObject({
			reason: 'shared-declaration',
			affects: ['g1.t', 'g2.t'],
		});
	});

	it('refuses next to a macro call whose expansion could join the new text', () => {
		const plan = H + 'macro body [ { effort 1d } ]\ntask a "A" ${body}\n';
		expect(run(plan, add('a', 0, 'N'))).toMatchObject({ status: 'refused' });
	});
});
