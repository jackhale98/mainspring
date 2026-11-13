// SPDX-License-Identifier: GPL-2.0-or-later
// The show-source text (source.ts): highlighting and the block of a declaration.
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../workspace/workspace';
import { MAX_LINES, highlight, sourceBlock } from './source';

const TEXT = 'project p "P" 2026-01-05 +8w\ntask a "A" {\n  effort 3d # note\n}\ntask b "B" {}\n';
const joined = (s: ReadonlyArray<{ text: string }>) => s.map((x) => x.text).join('');

describe('highlight', () => {
	it('splits the text into classed runs that join back to it', () => {
		const segs = highlight('task a "A" {\n  effort 3d # c\n}\n');
		expect(joined(segs)).toBe('task a "A" {\n  effort 3d # c\n}\n');
		expect(segs.find((s) => s.text === 'task')?.cls).toBe('tok-keyword');
		expect(segs.find((s) => s.text === '"A"')?.cls).toBe('tok-string');
		expect(segs.find((s) => s.text.startsWith('# c'))?.cls).toBe('tok-comment');
	});
});

describe('sourceBlock', () => {
	const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': TEXT } });
	const from = TEXT.indexOf('task a');
	const to = TEXT.indexOf('}\n', from) + 1;

	it('gives the highlighted block with its line count', () => {
		const b = sourceBlock(ws, undefined, { file: 'plan.tjp', from, to });
		expect(joined(b?.segments ?? [])).toBe('task a "A" {\n  effort 3d # note\n}');
		expect(b).toMatchObject({ lines: 3, cut: false });
	});

	it('cuts a very long block', () => {
		const long = `task t "T" {\n${'  note "x"\n'.repeat(MAX_LINES + 20)}}\n`;
		const w = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': long } });
		const b = sourceBlock(w, undefined, { file: 'plan.tjp', from: 0, to: long.length - 1 });
		expect(b?.cut).toBe(true);
		expect(joined(b?.segments ?? []).split('\n')).toHaveLength(MAX_LINES);
	});

	it('is null for a file that is gone', () => {
		expect(sourceBlock(ws, undefined, { file: 'none.tjp', from: 0, to: 1 })).toBeNull();
	});
});
