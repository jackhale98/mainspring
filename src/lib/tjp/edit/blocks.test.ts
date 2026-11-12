// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { childPlace, containerOf, insertBlock, movedText, targetIndent } from './blocks';
import { ops, setup } from './testing';

describe('blocks', () => {
	it('re-indents a block, keeping string lines, and converts the unit', () => {
		const text =
			'resource g "G" {\n\t# c\n\tresource a "A" {\n\t\tnote "x\n\tline"\n\t\trate 1\n\t}\n}\n';
		const s = setup({ 'plan.tjp': 'project p "P" 2026-01-05 +1m\n' + text });
		const a = s.index.resources.get('a');
		if (!a) throw new Error('a');
		const m = movedText(s.file(), a.decl.block, '', '  ', '\r\n');
		expect(m.text).toBe('# c\r\nresource a "A" {\r\n  note "x\r\n\tline"\r\n  rate 1\r\n}');
		expect(m.text.slice(m.header, m.header + 8)).toBe('resource');
	});

	it('places children after a sibling, before the first one, or in the parent body', () => {
		const s = setup(
			'project p "P" 2026-01-05 +1m\nresource g "G" {\n  resource a "A"\n\n  resource b "B"\n}\n',
		);
		const g = s.index.resources.get('g') ?? null;
		const kids = ['a', 'b'].map((id) => s.index.resources.get(id)).filter((x) => x !== undefined);
		const root = () => ({ file: s.file(), place: 'end' as const });
		const after = childPlace(s.ctx, g, kids, 2, root);
		if ('status' in after) throw new Error('refused');
		expect(after.blank).toBe('before');
		expect(containerOf(g, kids[0]!.decl)).toEqual(g?.decl.block);
		expect(targetIndent(after.file, after.owner)).toBe('  ');
		const op = ops(insertBlock(after, 'resource c "C"', { from: 0, to: 8 }))[0];
		expect(op?.insert).toBe('\n  resource c "C"\n');
		const first = childPlace(s.ctx, g, kids, 0, root);
		if ('status' in first) throw new Error('refused');
		expect(first.place).toEqual({ before: kids[0]?.decl.block });
		const empty = childPlace(s.ctx, s.index.resources.get('a') ?? null, [], 0, root);
		expect(empty).toMatchObject({ place: { scope: 'resource', keyword: 'resource' } });
	});
});
