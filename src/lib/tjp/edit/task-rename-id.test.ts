// SPDX-License-Identifier: GPL-2.0-or-later
// A new task's id follows its first name (polish item 15): the automatic-id rule, every reason the
// id stays, the slug and its collision suffix, and `renameTask` with `id` (one edit, one undo step).
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { applyEdit, applyIntent, undoEdit } from './apply';
import { followingId, idKept, isAutomaticId } from './task-rename-id';
import { setup, textsAfter } from './testing';
import type { EditIntent } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const FIRST = 'New task';

function follow(src: string | Record<string, string>, task: string, name: string): string | null {
	const s = setup(src);
	return followingId(s.index, task, name, FIRST);
}

/** The entry file's text after renaming `task` as the inspector does (the id follows if it may). */
function named(src: string, task: string, name: string): string {
	const s = setup(src);
	const id = followingId(s.index, task, name, FIRST);
	const intent: EditIntent = { type: 'renameTask', task, name, ...(id === null ? {} : { id }) };
	return textsAfter(s.snap, applyIntent(s.snap, s.index, intent))['plan.tjp'] ?? '';
}

describe('isAutomaticId', () => {
	it('is exactly what addTask gives a task named "New task" without an id', () => {
		for (const id of ['new_task', 'new_task_2', 'new_task_9', 'new_task_10', 'new_task_123']) {
			expect(isAutomaticId(id, FIRST)).toBe(true);
		}
		for (const id of [
			'new_task_1',
			'new_task_0',
			'new_task_02',
			'new_taskx',
			'new_task_',
			'task',
		]) {
			expect(isAutomaticId(id, FIRST)).toBe(false);
		}
		expect(isAutomaticId('my_new_task', FIRST)).toBe(false);
		expect(isAutomaticId('New_task', FIRST)).toBe(false);
	});

	it('matches the ids addTask really writes', () => {
		let src = HEAD + 'task a "A"\n';
		for (let i = 0; i < 3; i++) {
			const s = setup(src);
			const r = applyIntent(s.snap, s.index, {
				type: 'addTask',
				parent: null,
				index: i + 1,
				name: FIRST,
			});
			src = textsAfter(s.snap, r)['plan.tjp'] ?? '';
		}
		const ids = [...setup(src).index.tasks.keys()];
		expect(ids).toEqual(['a', 'new_task', 'new_task_2', 'new_task_3']);
		expect(ids.filter((id) => isAutomaticId(id, FIRST))).toEqual(ids.slice(1));
	});
});

describe('the id follows the name', () => {
	it('sets the id from the name in the same edit', () => {
		const src = HEAD + 'task a "A"\ntask new_task "New task" {\n  effort 1d\n}\n';
		expect(named(src, 'new_task', 'Write specs')).toBe(
			src.replace('task new_task "New task"', 'task write_specs "Write specs"'),
		);
	});

	it('touches only the id token and the name string, and selects the name', () => {
		const src = HEAD + 'task new_task "New task"\n';
		const s = setup(src);
		const e = applyIntent(s.snap, s.index, {
			type: 'renameTask',
			task: 'new_task',
			name: 'Write specs',
			id: 'write_specs',
		});
		if (e.status !== 'edit') throw new Error(e.status);
		const at = src.indexOf('new_task');
		const name = src.indexOf('"New task"');
		expect(e.edit.targets['plan.tjp']).toEqual([
			{ file: 'plan.tjp', from: at, to: at + 'new_task'.length },
			{ file: 'plan.tjp', from: name, to: name + '"New task"'.length },
		]);
		const out = textsAfter(s.snap, e)['plan.tjp'] ?? '';
		expect(e.edit.select && out.slice(e.edit.select.from, e.edit.select.to)).toBe('"Write specs"');
	});

	it('works below a parent and in an included file, with the sibling rules', () => {
		const src = HEAD + 'task g "G" {\n  task new_task_2 "New task"\n}\n';
		expect(follow(src, 'g.new_task_2', 'Write specs')).toBe('write_specs');
		const files = { 'plan.tjp': HEAD + 'include "t.tji"\n', 't.tji': 'task new_task "New task"\n' };
		const s = setup(files);
		expect(followingId(s.index, 'new_task', 'Review', FIRST)).toBe('review');
		const r = applyIntent(s.snap, s.index, {
			type: 'renameTask',
			task: 'new_task',
			name: 'Review',
			id: 'review',
		});
		expect(textsAfter(s.snap, r)['t.tji']).toBe('task review "Review"\n');
	});

	it('adds the collision suffix among siblings only', () => {
		const src =
			HEAD +
			'task write_specs "W"\ntask new_task "New task"\ntask g "G" {\n  task new_task "New task"\n}\n';
		expect(follow(src, 'new_task', 'Write specs')).toBe('write_specs_2');
		expect(follow(src, 'g.new_task', 'Write specs')).toBe('write_specs');
		const two = HEAD + 'task write_specs "W"\ntask write_specs_2 "W"\ntask new_task "New task"\n';
		expect(follow(two, 'new_task', 'Write specs!')).toBe('write_specs_3');
	});

	it('leaves the id when the slug is the id already, and for a non-automatic id', () => {
		const src = HEAD + 'task new_task "Old"\ntask specs "New task"\n';
		expect(follow(src, 'new_task', 'New task')).toBeNull();
		expect(follow(src, 'specs', 'Write specs')).toBeNull();
		expect(named(src, 'specs', 'Write specs')).toBe(src.replace('"New task"', '"Write specs"'));
		// new_task_2 named "New task" again takes the free base id.
		const two = HEAD + 'task new_task_2 "x"\n';
		expect(follow(two, 'new_task_2', 'New task')).toBe('new_task');
	});

	it('keeps the automatic id for a name with no ASCII letter or digit', () => {
		const src = HEAD + 'task new_task "New task"\n';
		for (const name of ['日本語', '***', '— —']) expect(follow(src, 'new_task', name)).toBeNull();
		expect(named(src, 'new_task', '日本語')).toBe(src.replace('"New task"', '"日本語"'));
		// One ASCII letter is enough, and a name that is "Task" really means `task`.
		expect(follow(src, 'new_task', '日本語 v2')).toBe('v2');
		expect(follow(src, 'new_task', 'Task')).toBe('task');
	});

	it("counts an id a report's text mentions as taken (its own id included)", () => {
		const src = HEAD + 'task new_task_2 "New task"\ntaskreport r "r" {\n  taskroot new_task_2\n}\n';
		const free = HEAD + 'task new_task_2 "New task"\ntaskreport r "r" {\n  formats html\n}\n';
		expect(follow(src, 'new_task_2', 'X')).toBeNull();
		expect(follow(free, 'new_task_2', 'r')).toBe('r_2');
		expect(follow(free, 'new_task_2', 'Write specs')).toBe('write_specs');
	});

	it('counts a dangling reference to the new id as taken', () => {
		const src = HEAD + 'task new_task "New task"\ntask b "B" {\n  depends !write_specs\n}\n';
		expect(follow(src, 'new_task', 'Write specs')).toBe('write_specs_2');
	});
});

describe('the id stays when anything refers to the task', () => {
	const blocked = (src: string | Record<string, string>, task = 'new_task'): void => {
		expect(follow(src, task, 'Write specs')).toBeNull();
		const s = setup(src);
		const kept = idKept(s.index, task);
		expect(kept).not.toBeNull();
	};

	it('a dependency in any form', () => {
		const t = 'task new_task "New task"\n';
		blocked(HEAD + t + 'task b "B" {\n  depends !new_task\n}\n');
		blocked(HEAD + t + 'task b "B" {\n  depends new_task { gaplength 1d }\n}\n');
		blocked(HEAD + 'task b "B" {\n  precedes !new_task\n}\n' + t);
		blocked(
			HEAD + 'task g "G" {\n  ' + t + '  task c "C" {\n    depends !!new_task\n  }\n}\n',
			'g.new_task',
		);
		blocked(
			HEAD + 'task g "G" {\n  ' + t + '}\ntask c "C" {\n  depends g.new_task\n}\n',
			'g.new_task',
		);
	});

	it('a supplement, an allocation, a responsible, a flag or a report', () => {
		const t = 'task new_task "New task"\n';
		blocked(HEAD + t + 'supplement task new_task {\n  note "n"\n}\n');
		blocked(
			'project p "P" 2026-01-05 +2m\nresource new_task "R"\n' +
				t +
				'task b "B" {\n  allocate new_task\n}\n',
		);
		blocked(
			'project p "P" 2026-01-05 +2m\nresource new_task "R"\n' +
				t +
				'task b "B" {\n  responsible new_task\n}\n',
		);
		blocked(HEAD + 'flags new_task\n' + t + 'task b "B" {\n  flags new_task\n}\n');
		blocked(HEAD + t + 'taskreport r "r" {\n  taskroot new_task\n}\n');
	});

	it('a child, or a reference to a child', () => {
		blocked(HEAD + 'task new_task "New task" {\n  task c "C"\n}\n');
	});

	it('a macro body, a macro call or an environment reference anywhere', () => {
		const t = 'task new_task "New task"\n';
		blocked('macro m [ depends !new_task ]\n' + HEAD + t);
		blocked('macro m [ note "x" ]\n' + HEAD + t + 'task b "B" {\n  ${m}\n}\n');
		blocked('macro m [ ${1} ]\n' + HEAD + t + 'task b "B" {\n  depends !${m new_task}\n}\n');
		blocked(HEAD + t + 'task b "B" {\n  note "$(USER)"\n}\n');
		blocked({
			'plan.tjp': HEAD + t + 'include "m.tji"\n',
			'm.tji': 'macro m [ x ]\ntask c "${m}"\n',
		});
	});

	it('a declaration read in several include visits', () => {
		const files = {
			'plan.tjp':
				HEAD +
				'task g1 "G1"\ntask g2 "G2"\n' +
				'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
			't.tji': 'task new_task "New task"\n',
		};
		blocked(files, 'g1.new_task');
		expect(idKept(setup(files).index, 'g1.new_task')).toMatchObject({
			reason: 'shared-declaration',
		});
	});

	it('a syntax error anywhere', () => {
		blocked(HEAD + 'task new_task "New task"\ntask b "B" {\n  effort\n}\n');
	});

	it('the task keeps its own depends: they do not refer to it', () => {
		const src = HEAD + 'task a "A"\ntask new_task "New task" {\n  depends !a\n}\n';
		expect(named(src, 'new_task', 'Write specs')).toBe(
			src.replace('task new_task "New task"', 'task write_specs "Write specs"'),
		);
	});
});

describe('renameTask with id', () => {
	it('refuses an id the rules do not allow, and changes nothing', () => {
		const src =
			HEAD + 'task a "A"\ntask new_task "New task"\ntask b "B" {\n  depends !new_task\n}\n';
		const s = setup(src);
		const go = (id: string, task = 'new_task'): unknown =>
			applyIntent(s.snap, s.index, { type: 'renameTask', task, name: 'W', id });
		expect(go('w')).toMatchObject({ status: 'refused', reason: 'unfixable-reference' });
		const free = setup(HEAD + 'task a "A"\ntask new_task "New task"\n');
		const go2 = (id: string): unknown =>
			applyIntent(free.snap, free.index, { type: 'renameTask', task: 'new_task', name: 'W', id });
		expect(go2('a')).toMatchObject({ status: 'refused', reason: 'id-collision' });
		expect(go2('2x')).toMatchObject({ status: 'refused', reason: 'invalid-value' });
		expect(go2('new_task')).toMatchObject({ status: 'edit' });
		expect(
			applyIntent(free.snap, free.index, {
				type: 'renameTask',
				task: 'new_task',
				name: 'New task',
				id: 'new_task',
			}),
		).toMatchObject({ status: 'noop', reason: 'already-set' });
		expect(textsAfter(free.snap, go2('w') as never)['plan.tjp']).toBe(
			HEAD + 'task a "A"\ntask w "W"\n',
		);
	});

	it('changes the id alone when the name is the same', () => {
		const src = HEAD + 'task new_task "Specs"\n';
		const s = setup(src);
		const r = applyIntent(s.snap, s.index, {
			type: 'renameTask',
			task: 'new_task',
			name: 'Specs',
			id: 'specs',
		});
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(HEAD + 'task specs "Specs"\n');
	});

	it('is one edit that one undo takes back, name and id together', () => {
		const src = HEAD + 'task a "A"\ntask new_task "New task" {\n  effort 2d\n}\n';
		const s = setup(src);
		const r = applyIntent(s.snap, s.index, {
			type: 'renameTask',
			task: 'new_task',
			name: 'Write specs',
			id: 'write_specs',
		});
		if (r.status !== 'edit') throw new Error(r.status);
		const applied = applyEdit(s.workspace, r.edit);
		if (applied === 'stale') throw new Error('stale');
		const after = s.workspace.snapshot();
		expect(after.files.get('plan.tjp')?.text.toString()).toContain(
			'task write_specs "Write specs"',
		);
		const ids = [...buildIndex(after, undefined, { cache: null }).tasks.keys()];
		expect(ids).toEqual(['a', 'write_specs']);
		const undo = undoEdit(applied, after);
		if (!undo) throw new Error('no undo');
		expect(s.workspace.apply(undo)).toBe('applied');
		expect(s.workspace.texts()['plan.tjp']).toBe(src);
	});
});
