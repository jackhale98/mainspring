// SPDX-License-Identifier: GPL-2.0-or-later
// The workspace merge (phase-4.md 6.4, 8.1 #5, 16.1, 21, 22; tjp/merge/types.ts): the file table,
// the kept rule, conflict order and ids, resolving, and the gate's three scenarios on a three-file
// plan with sides made by the edit API. The blocked case's engine check is merge.engine.test.ts.
import { describe, expect, it } from 'vitest';
import { contextOf, filesOf, mergeAll, resolveAll } from '../tjp/merge/testing';
import { isUnresolved, type MergeConflict } from '../tjp/merge/types';
import { mergeFile, mergeWorkspace, resolve } from './merge';
import { edited, PLAN } from './merge-testing';

const ENTRY = 'plan.tjp';
const ctx = contextOf(ENTRY, { [ENTRY]: 'project p "P" 2027-01-04 +1m\n' });

describe('files some side lacks (the table)', () => {
	const F = 'a.tji';
	it.each([
		['ours only', null, 'x\n', null, 'x\n', []],
		['theirs only', null, null, 'y\n', 'y\n', []],
		['added twice, equal', null, 'x\n', 'x\n', 'x\n', []],
		['added twice, different', null, 'x\n', 'y\n', 'x\n', ['added-twice']],
		['deleted on theirs, unchanged here: kept with its base text', 'b\n', 'b\n', null, 'b\n', []],
		['deleted on theirs, changed here', 'b\n', 'x\n', null, 'x\n', ['deleted-theirs']],
		['deleted here, unchanged there: kept', 'b\n', null, 'b\n', 'b\n', []],
		['deleted here, changed there', 'b\n', null, 'y\n', 'y\n', ['deleted-ours']],
		['deleted on both sides', 'b\n', null, null, null, []],
		['on no side', null, null, null, null, []],
	] as const)('%s', (_, base, ours, theirs, text, changes) => {
		const m = mergeFile(F, base, ours, theirs, ctx);
		expect(m.text).toBe(text);
		expect(
			m.conflicts.map((c) => (c.subject.kind === 'file' ? c.subject.change : c.subject.kind)),
		).toEqual(changes);
		for (const c of m.conflicts) {
			expect([c.base, c.ours, c.theirs]).toEqual([base, ours, theirs]);
			expect(c.at).toEqual({ file: F, from: 0, to: (text ?? '').length });
			expect(c.atOurs).toEqual(ours === null ? null : { file: F, from: 0, to: ours.length });
			expect(c.both).toBe(false);
		}
	});

	it('never removes a file by a choice: a chosen side without it keeps the base text', () => {
		const m = mergeWorkspace(filesOf({ [F]: 'b\n' }), filesOf({ [F]: 'x\n' }), filesOf({}), ctx);
		expect(resolveAll(m, 'theirs').get(F)).toBe('b\n');
		expect(resolveAll(m, 'ours').get(F)).toBe('x\n');
		const d = mergeWorkspace(filesOf({ [F]: 'b\n' }), filesOf({}), filesOf({ [F]: 'y\n' }), ctx);
		expect(resolveAll(d, 'ours').get(F)).toBe('b\n');
		expect(resolveAll(d, 'theirs').get(F)).toBe('y\n');
		expect(resolveAll(d, { text: 'z\n' }).get(F)).toBe('z\n');
	});

	it('orders conflicts by file, then position, and gives ids unique in the merge', () => {
		const base = { [ENTRY]: '', 'b.tji': '# 1\n# 2\n# 3\n', 'a.tji': 'a\n' };
		const m = mergeAll(
			ENTRY,
			base,
			{ [ENTRY]: '', 'b.tji': '# one\n# 2\n# three\n', 'a.tji': 'a1\n' },
			{ [ENTRY]: '', 'b.tji': '# uno\n# 2\n# tres\n', 'a.tji': 'a2\n' },
		);
		expect(m.conflicts.map((c) => [c.file, c.ours])).toEqual([
			['a.tji', 'a1\n'],
			['b.tji', '# one\n'],
			['b.tji', '# three\n'],
		]);
		expect(new Set(m.conflicts.map((c) => c.id)).size).toBe(3);
	});
});

describe('resolve', () => {
	const x = 'task x "X"\n';
	const base = { [ENTRY]: `# a\n${x}# b\n` };
	const m = mergeAll(ENTRY, base, { [ENTRY]: `# A\n${x}# B\n` }, { [ENTRY]: `# 1\n${x}# 2\n` });
	const [first, second] = m.conflicts as [MergeConflict, MergeConflict];

	it('lists unresolved conflicts in order; unknown ids are ignored; the last choice wins', () => {
		expect(resolve(m, [])).toEqual({ unresolved: [first.id, second.id] });
		expect(
			resolve(m, [
				{ conflict: 'gone', take: 'ours' },
				{ conflict: second.id, take: 'ours' },
			]),
		).toEqual({
			unresolved: [first.id],
		});
		const r = resolve(m, [
			{ conflict: first.id, take: 'ours' },
			{ conflict: second.id, take: 'ours' },
			{ conflict: first.id, take: 'theirs' },
		]);
		expect(isUnresolved(r) ? r : r.get(ENTRY)).toBe(`# 1\n${x}# B\n`);
	});

	it('leaves `both` on a conflict without it unresolved', () => {
		const t = mergeAll(
			ENTRY,
			{ [ENTRY]: 'task a "A" {\n  effort 1d\n}\n' },
			{ [ENTRY]: 'task a "A" {\n  effort 2d\n}\n' },
			{
				[ENTRY]: 'task a "A" {\n  effort 3d\n}\n',
			},
		);
		const c = t.conflicts[0] as MergeConflict;
		expect(c.both).toBe(false);
		expect(resolve(t, [{ conflict: c.id, take: 'both' }])).toEqual({ unresolved: [c.id] });
	});
});

const addM2 = (files: Record<string, string>): Record<string, string> => ({
	...files,
	'more.tji': `${files['more.tji'] ?? ''}task m2 "M2" {\n  effort 2d\n  allocate qa\n}\n`,
});

describe('the gate scenarios (16.1)', () => {
	it('merges effort on A and allocate plus a task in an included file on B cleanly, in X', () => {
		const a = edited(PLAN, { type: 'setAttr', task: 'x', attr: 'effort', value: '5d' });
		const b = addM2(edited(PLAN, { type: 'allocate', task: 'x', resources: ['qa'] }));
		// The two edits are on adjacent lines: diff3 alone conflicts, refinement merges them.
		expect(a[ENTRY]).toContain('  effort 5d\n  allocate dev\n');
		expect(b[ENTRY]).toContain('  effort 3d\n  allocate qa\n');
		const m = mergeAll(ENTRY, PLAN, a, b);
		expect(m.conflicts).toEqual([]);
		expect(m.files.get(ENTRY)).toBe(
			PLAN[ENTRY].replace('effort 3d\n  allocate dev', 'effort 5d\n  allocate qa'),
		);
		expect(m.files.get('more.tji')).toBe(b['more.tji']);
		expect(m.files.get('people.tji')).toBe(PLAN['people.tji']);
		// Merging the other way round gives the same files.
		expect(mergeAll(ENTRY, PLAN, b, a).files).toEqual(m.files);
	});

	it('makes both changing effort of X one attribute conflict; Take theirs gives theirs', () => {
		const a = edited(PLAN, { type: 'setAttr', task: 'x', attr: 'effort', value: '5d' });
		const b = addM2(edited(PLAN, { type: 'setAttr', task: 'x', attr: 'effort', value: '8d' }));
		const m = mergeAll(ENTRY, PLAN, a, b);
		expect(m.conflicts.map((c) => [c.file, c.subject, c.base, c.ours, c.theirs])).toEqual([
			[
				ENTRY,
				{ kind: 'attribute', owner: { kind: 'task', id: 'x', name: 'X' }, attr: 'effort' },
				'effort 3d',
				'effort 5d',
				'effort 8d',
			],
		]);
		expect(Object.fromEntries(resolveAll(m, 'theirs'))).toEqual(b);
		expect(Object.fromEntries(resolveAll(m, 'ours'))).toEqual({ ...a, 'more.tji': b['more.tji'] });
	});

	it('merges a deleted task and a new dependency on it as text (the engine blocks it)', () => {
		const a = edited(PLAN, { type: 'deleteTask', task: 't' });
		const b = edited(PLAN, { type: 'addDepends', task: 'x', target: 't' });
		const m = mergeAll(ENTRY, PLAN, a, b);
		expect(m.conflicts).toEqual([]);
		const merged = m.files.get(ENTRY) ?? '';
		expect(merged).not.toContain('task t "T"');
		expect(merged).toMatch(/depends !t\n/);
	});
});

describe('owners in included files', () => {
	it('names the full id under the include prefix of the first visit', () => {
		const files = {
			[ENTRY]:
				'project p "P" 2027-01-04 +1m\nresource dev "Dev"\ntask outer "Outer"\ninclude "sub.tji" { taskprefix outer }\n',
			'sub.tji': 'task leaf "Leaf" {\n  effort 1d\n}\n',
		};
		const set = (e: string): Record<string, string> => ({
			...files,
			'sub.tji': files['sub.tji'].replace('1d', e),
		});
		const m = mergeAll(ENTRY, files, set('2d'), set('3d'));
		expect(m.conflicts.map((c) => c.subject)).toEqual([
			{
				kind: 'attribute',
				owner: { kind: 'task', id: 'outer.leaf', name: 'Leaf' },
				attr: 'effort',
			},
		]);
	});
});
