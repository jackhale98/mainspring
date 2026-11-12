// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { destination, insertBlock, siblingsAt } from './task-place';
import { setup } from './testing';
import { isRefused } from './types';

const H = 'project p "P" 2026-01-05 +2m\n';

describe('destination', () => {
	const plan = H + 'task a "A" {\n\ttask x "X"\n\n\ttask y "Y"\n}\n';

	it('anchors on siblings, inherits unit, indentation and blank-line separation', () => {
		const s = setup(plan);
		const a = s.index.tasks.get('a') ?? null;
		const sibs = siblingsAt(s.ctx, a, null);
		expect(sibs.map((x) => x.id)).toEqual(['a.x', 'a.y']);
		const d = destination(s.ctx, a, sibs, 2);
		if (isRefused(d)) throw new Error(JSON.stringify(d));
		expect([d.base, d.unit, d.eol, d.blank]).toEqual(['\t', '\t', '\n', 'before']);
		const ops = insertBlock(d, 'task n "N"', { from: 0, to: 4 });
		if (isRefused(ops)) throw new Error(JSON.stringify(ops));
		expect(ops.map((o) => o.insert)).toEqual(['\n\ttask n "N"\n']);
		const first = destination(s.ctx, a, sibs, 0);
		expect(!isRefused(first) && first.blank).toBe('after');
	});

	it('leaves out the moved task and refuses bad positions', () => {
		const s = setup(plan);
		const a = s.index.tasks.get('a') ?? null;
		expect(siblingsAt(s.ctx, a, 'a.x').map((x) => x.id)).toEqual(['a.y']);
		expect(destination(s.ctx, a, [], 1)).toMatchObject({ reason: 'invalid-value' });
		expect(destination(s.ctx, a, [], 0.5)).toMatchObject({ reason: 'invalid-value' });
	});

	it('goes to the end of the entry file for a first root', () => {
		const s = setup(H);
		const d = destination(s.ctx, null, [], 0);
		if (isRefused(d)) throw new Error(JSON.stringify(d));
		expect([d.file.path, d.owner, d.place]).toEqual(['plan.tjp', null, 'end']);
	});
});
