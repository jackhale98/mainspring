// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// "Move which task?" (WhichTask.svelte): it takes the focus when it opens, and gives it back when it
// closes by a choice, Escape or Cancel (T22: the focus used to fall to the page).
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WhichTask from './WhichTask.svelte';

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

const TASKS = [
	{ task: 'a', name: 'Alpha', minutes: 120 },
	{ task: 'b', name: 'Beta', minutes: 60 },
];

/** A view with a grid whose focus cell has tabindex 0, and the chooser mounted inside it. */
function open(opts: { focusBefore: boolean }) {
	document.body.innerHTML =
		'<div id="view"><div role="grid"><div role="gridcell" id="cell" tabindex="0">c</div>' +
		'<button id="other">x</button></div></div>';
	const other = document.getElementById('other') as HTMLButtonElement;
	if (opts.focusBefore) other.focus();
	const m = mount(WhichTask, {
		target: document.getElementById('view') as HTMLElement,
		props: { ask: 'To Ben', tasks: TASKS, onchoose: vi.fn(), oncancel: vi.fn() },
	});
	mounted.push(m);
	flushSync();
	return {
		other,
		cell: document.getElementById('cell') as HTMLElement,
		close: () => {
			mounted.splice(0);
			void unmount(m);
		},
	};
}

describe('WhichTask focus', () => {
	it('takes the focus when it opens', () => {
		open({ focusBefore: false });
		expect(document.activeElement?.getAttribute('data-task')).toBe('a');
	});

	it('gives the focus back to what had it before, when it closes', () => {
		const { other, close } = open({ focusBefore: true });
		expect(document.activeElement).not.toBe(other);
		close();
		expect(document.activeElement).toBe(other);
	});

	it('falls back to the grid focus cell of its view when nothing had the focus', () => {
		const { cell, close } = open({ focusBefore: false });
		close();
		expect(document.activeElement).toBe(cell);
	});

	it('falls back to the grid focus cell when what had the focus before is gone', () => {
		const { other, cell, close } = open({ focusBefore: true });
		other.remove();
		close();
		expect(document.activeElement).toBe(cell);
	});

	it('leaves the focus alone when something else took it while the chooser was open', () => {
		const { other, cell, close } = open({ focusBefore: false });
		other.focus();
		close();
		expect(document.activeElement).toBe(other);
		expect(document.activeElement).not.toBe(cell);
	});
});
