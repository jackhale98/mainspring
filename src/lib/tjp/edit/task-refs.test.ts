// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { subtree } from './refs';
import { deleteFixes, idMap, moveRewrites } from './task-refs';
import { setup } from './testing';
import { isRefused, type SourceRange } from './types';

const H = 'project p "P" 2026-01-05 +2m\n';

describe('idMap', () => {
	it('maps the subtree only', () => {
		const m = idMap('a.b', 'c.b');
		expect([m('a.b'), m('a.b.x'), m('a.bc'), m('a')]).toEqual(['c.b', 'c.b.x', 'a.bc', 'a']);
	});
});

describe('moveRewrites', () => {
	const plan =
		H +
		'task a "A" {\n  task b "B" { depends !c }\n  task c "C" { depends !b }\n}\ntask d "D" { depends a.b }\nsupplement task a.b { }\n';

	it('splits rewrites into the moved block and elsewhere', () => {
		const s = setup(plan);
		const sym = s.index.tasks.get('a.b');
		if (!sym) throw new Error('no a.b');
		const block: SourceRange = sym.decl.block;
		const r = moveRewrites(s.index, 'a.b', 'b', subtree(s.index, 'task', 'a.b'), block);
		if (isRefused(r)) throw new Error(JSON.stringify(r));
		expect(r.inner.map((w) => w.insert)).toEqual(['a.c']);
		expect(r.outer.map((w) => w.insert).sort()).toEqual(['!b', 'b', 'b']);
	});

	it('rewrites nothing when the ids stay', () => {
		const s = setup(plan);
		const sym = s.index.tasks.get('a.b');
		if (!sym) throw new Error('no a.b');
		expect(moveRewrites(s.index, 'a.b', 'a.b', ['a.b'], sym.decl.block)).toEqual({
			inner: [],
			outer: [],
		});
	});

	it('refuses an unresolved relative reference inside the moved block', () => {
		const s = setup(H + 'task a "A" {\n  task b "B" { depends !zz }\n}\n');
		const sym = s.index.tasks.get('a.b');
		if (!sym) throw new Error('no a.b');
		const r = moveRewrites(s.index, 'a.b', 'b', ['a.b'], sym.decl.block);
		expect(r).toMatchObject({ reason: 'unfixable-reference' });
	});
});

describe('deleteFixes', () => {
	it('lists the items to drop per statement, ignoring removed ranges', () => {
		const s = setup(H + 'task a "A"\ntask b "B" { depends a, c }\ntask c "C" { depends a }\n');
		const a = s.index.tasks.get('a');
		if (!a) throw new Error('no a');
		const r = deleteFixes(s.index, ['a'], [a.decl.block]);
		if (isRefused(r)) throw new Error(JSON.stringify(r));
		expect(r.map((f) => [f.items.length, f.remove])).toEqual([
			[2, [0]],
			[1, [0]],
		]);
	});
});
