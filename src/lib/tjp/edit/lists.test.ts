// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildEdit } from './apply';
import { appendOrInsert, checkBodyMacros, itemSpans, listPlacement, removeItems } from './lists';
import { setup, span, stmt, textsAfter } from './testing';
import type { EditOp } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const INTENT = { type: 'addDepends', task: 'b', target: 'a' } as const;

function apply(files: string, ops: readonly EditOp[]): string {
	const s = setup(files);
	return textsAfter(s.snap, buildEdit(s.snap, INTENT, ops))['plan.tjp'] ?? '';
}

describe('itemSpans', () => {
	it('lists the items of depends, precedes and allocate, macro items included', () => {
		const s = setup(
			HEAD + 'macro m [r]\ntask a "A"\ntask b "B" { depends !a { onend }, a\n allocate ${m}, r }\n',
		);
		const f = s.file();
		const deps = itemSpans(f, stmt(f, 'depends'));
		expect(deps?.map((x) => f.text.sliceString(x.from, x.to))).toEqual(['!a { onend }', 'a']);
		expect(itemSpans(f, stmt(f, 'allocate'))).toHaveLength(2);
		expect(itemSpans(f, stmt(f, 'task a'))).toBeNull();
	});
});

describe('removeItems', () => {
	it('removes items with one comma, or the statement when none is left', () => {
		const plan = HEAD + 'task a "A"\ntask c "C"\ntask b "B" {\n  depends !a, !c\n}\n';
		const s = setup(plan);
		const f = s.file();
		const st = stmt(f, 'depends');
		const one = removeItems(f, st, [span(f, '!a')]);
		expect(Array.isArray(one) && apply(plan, one)).toBe(plan.replace('!a, !c', '!c'));
		const both = removeItems(f, st, [span(f, '!a'), span(f, '!c')]);
		expect(Array.isArray(both) && apply(plan, both)).toBe(plan.replace('  depends !a, !c\n', ''));
		expect(removeItems(f, st, [])).toEqual([]);
		expect(removeItems(f, stmt(f, 'task a'), [])).toMatchObject({ status: 'refused' });
	});
});

describe('listPlacement and appendOrInsert', () => {
	it('places by rank, but never after the first child task', () => {
		const s = setup(
			HEAD + 'task b "B" {\n  effort 1d\n  task c "C"\n  note "x"\n}\ntask d "D" { effort 1d }\n',
		);
		const f = s.file();
		expect(listPlacement(f, stmt(f, 'task b'), 'depends')).toEqual({ before: stmt(f, 'task c') });
		expect(listPlacement(f, stmt(f, 'task d'), 'depends')).toEqual({
			scope: 'task',
			keyword: 'depends',
		});
	});

	it('appends to a list or inserts a statement, reporting where it is read', () => {
		const plan = HEAD + 'task a "A"\ntask b "B" {\n  depends a\n}\ntask d "D"\n';
		const s = setup(plan);
		const f = s.file();
		const files = (p: string) => s.snap.files.get(p);
		const block = s.index.tasks.get('d')?.decl.block;
		const last = s.index.tasks.get('b')?.attrs[0]?.statement ?? null;
		if (!block) throw new Error('no d');
		const app = appendOrInsert(files, last, block, 'depends', 'b');
		if ('status' in app) throw new Error('refused');
		expect(app.at.from).toBe(last?.from);
		expect(apply(plan, app.ops)).toBe(plan.replace('depends a\n', 'depends a, b\n'));
		const ins = appendOrInsert(files, null, block, 'depends', 'b');
		if ('status' in ins) throw new Error('refused');
		expect(apply(plan, ins.ops)).toBe(
			plan.replace('task d "D"\n', 'task d "D" {\n  depends b\n}\n'),
		);
		expect(f.text.sliceString(0, 7)).toBe('project');
	});
});

describe('checkBodyMacros', () => {
	it('refuses calls whose definition may write the keyword, or is missing', () => {
		const plan =
			HEAD +
			'macro dep [depends a]\nmacro pri [priority 600]\nmacro nest [${pri}]\n' +
			'task a "A"\ntask b "B" {\n  ${dep}\n}\ntask c "C" {\n  ${pri}\n  ${?none}\n}\ntask d "D" {\n  ${nest}\n}\n' +
			'task e "E" {\n  ${missing}\n}\n';
		const s = setup(plan);
		const t = (id: string) => {
			const sym = s.index.tasks.get(id);
			if (!sym) throw new Error(id);
			return sym;
		};
		expect(checkBodyMacros(s.snap, s.index, t('b'), ['depends'])).toMatchObject({
			reason: 'macro-in-body',
		});
		expect(checkBodyMacros(s.snap, s.index, t('b'), ['allocate'])).toBeNull();
		expect(checkBodyMacros(s.snap, s.index, t('c'), ['depends'])).toBeNull();
		expect(checkBodyMacros(s.snap, s.index, t('d'), ['depends'])).toMatchObject({
			reason: 'macro-in-body',
		});
		expect(checkBodyMacros(s.snap, s.index, t('e'), ['depends'])).toMatchObject({
			reason: 'macro-in-body',
		});
	});
});
