// SPDX-License-Identifier: GPL-2.0-or-later
// The line merge refinement falls back to (emit.ts): what diff3 proves clean is merged, the rest is
// a line conflict named by the block its lines lie in, or `text` offering both.
import { describe, expect, it } from 'vitest';
import { parseTjp } from '../document';
import { emitMerged, lineMerge, linesClean, lineSubject, type Cx } from './emit';
import { Naming, OTHER } from './hints';
import { Out } from './out';
import { contextOf } from './testing';

function cx(o: string, a: string, b: string): Cx {
	const sides = [o, a, b].map((text) => ({ text, tree: parseTjp(text) }));
	return {
		sides: sides as unknown as Cx['sides'],
		naming: new Naming('plan.tjp', contextOf('plan.tjp', { 'plan.tjp': a }).includes),
		out: new Out(),
		span: () => {},
	};
}
const all = (
	c: Cx,
): [{ from: number; to: number }, { from: number; to: number }, { from: number; to: number }] => [
	{ from: 0, to: c.sides[0].text.length },
	{ from: 0, to: c.sides[1].text.length },
	{ from: 0, to: c.sides[2].text.length },
];

describe('lineMerge', () => {
	it('merges what diff3 proves clean', () => {
		const c = cx('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n');
		expect(linesClean(c, all(c))).toBe(true);
		lineMerge(c, all(c), { owner: OTHER, inBlock: false });
		expect(c.out.text()).toBe('A\nb\nC\n');
	});

	it('names a conflict inside a task by the task, and at the top level as text with both', () => {
		const t = (e: string): string => `task a "A" {\n  effort ${e}\n}\n# ${e}\n`;
		const c = cx(t('1d'), t('2d'), t('3d'));
		expect(linesClean(c, all(c))).toBe(false);
		lineMerge(c, all(c), { owner: OTHER, inBlock: false });
		expect(c.out.text()).toBe(t('2d'));
		expect(c.out.conflicts.map((x) => [x.subject, x.both, x.ours])).toEqual([
			[
				{ kind: 'block', owner: { kind: 'task', id: 'a', name: 'A' }, change: 'both-edited' },
				false,
				'  effort 2d\n',
			],
			[{ kind: 'text' }, true, '# 2d\n'],
		]);
		const at = { from: 0, to: 0 };
		expect(
			lineSubject(c, [at, at, at], { owner: { kind: 'task', id: 'q', name: null }, inBlock: true }),
		).toEqual({
			kind: 'block',
			owner: { kind: 'task', id: 'q', name: null },
			change: 'both-edited',
		});
	});

	it('emits the side merge3 picks, or nothing when both changed', () => {
		const c = cx('o', 'a', 'o');
		expect(emitMerged(c, all(c))).toBe(true);
		expect(c.out.text()).toBe('a');
		const d = cx('o', 'a', 'b');
		expect(emitMerged(d, all(d))).toBe(false);
		expect(d.out.text()).toBe('');
	});
});
