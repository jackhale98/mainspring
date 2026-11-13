// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The show-source text (source.ts), the range mapping (range.ts) and the focus helpers (focus.ts).
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../workspace/workspace';
import { focusRow, keepRowClear } from './focus';
import { currentRange } from './range';
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

describe('currentRange', () => {
	it('maps a range through the changes made since the index', () => {
		const w = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': TEXT } });
		const v = w.snapshot().version;
		const st = w.state('plan.tjp');
		w.commit('plan.tjp', st.update({ changes: { from: 0, insert: '# new line\n' } }), 'typing');
		const r = { file: 'plan.tjp', from: 10, to: 20 };
		expect(currentRange(w, v, r)).toEqual({ file: 'plan.tjp', from: 21, to: 31 });
		expect(currentRange(w, undefined, r)).toBe(r);
	});
});

describe('focus helpers', () => {
	function grid(): HTMLElement {
		document.body.innerHTML = `<div class="scroller" style="overflow:auto"><div role="treegrid">
			<div role="row" data-key="task:a" tabindex="-1">A</div><div role="row" data-key="task:b" tabindex="-1">B</div>
		</div></div>`;
		return document.body;
	}

	it('puts the focus on a row by its key, and says when it is not mounted', () => {
		const root = grid();
		expect(focusRow('task:b', root)).toBe(true);
		expect(document.activeElement?.getAttribute('data-key')).toBe('task:b');
		expect(focusRow('task:zz', root)).toBe(false);
		expect(focusRow(null, root)).toBe(false);
	});

	it('scrolls the chart so that a row ends above the sheet', () => {
		const root = grid();
		const scroller = root.querySelector<HTMLElement>('.scroller');
		const row = root.querySelector<HTMLElement>('[data-key="task:a"]');
		if (!scroller || !row) throw new Error('markup');
		row.getBoundingClientRect = () => ({ bottom: 700 }) as DOMRect;
		scroller.scrollTop = 0;
		// A 400 px sheet in a 800 px viewport leaves 392 px: the row is 308 px too low.
		keepRowClear('task:a', 400, root, 800);
		expect(scroller.scrollTop).toBe(308);
		scroller.scrollTop = 0;
		keepRowClear('task:a', 0, root, 800);
		expect(scroller.scrollTop).toBe(0);
	});
});
