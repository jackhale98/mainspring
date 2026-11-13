// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The focus and scroll helpers between the inspector and the task list (focus.ts).
import { describe, expect, it } from 'vitest';
import { focusRow, keepRowClear } from './focus';

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
