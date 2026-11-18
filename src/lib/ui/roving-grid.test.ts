// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { RovingGrid, tabStop } from './roving-grid';

type Key = string;
let root: HTMLElement;
const later: (() => void)[] = [];
const flush = (): void => {
	while (later.length) later.shift()?.();
};

function build(keys: string[]): void {
	root.replaceChildren(
		...keys.map((k) => {
			const el = document.createElement('div');
			el.dataset['k'] = k;
			el.tabIndex = -1;
			return el;
		}),
	);
}
const cell = (k: string): HTMLElement =>
	root.querySelector<HTMLElement>(`[data-k="${k}"]`) as HTMLElement;

function grid(): RovingGrid<Key> {
	return new RovingGrid<Key>({
		root: () => root,
		keyOf: (t) =>
			t instanceof HTMLElement ? (t.closest<HTMLElement>('[data-k]')?.dataset['k'] ?? null) : null,
		find: (r, k) => r.querySelector<HTMLElement>(`[data-k="${k}"]`),
		later: (fn) => later.push(fn),
	});
}
afterEach(() => {
	document.body.innerHTML = '';
	later.length = 0;
});
function setup(keys: string[]): void {
	root = document.createElement('div');
	document.body.append(root);
	build(keys);
}

describe('tabStop', () => {
	it('is the focus key when the window has it, else the first cell', () => {
		const has = (k: string): boolean => k !== 'z';
		expect(tabStop('b', has, 'a')).toBe('b');
		expect(tabStop('z', has, 'a')).toBe('a');
		expect(tabStop(null, has, 'a')).toBe('a');
		expect(tabStop(null, has, null)).toBeNull();
	});
});

describe('RovingGrid', () => {
	it('remembers the cell the focus is on', () => {
		setup(['a', 'b']);
		const g = grid();
		cell('b').focus();
		const e = { target: cell('b') } as unknown as FocusEvent;
		expect(g.focusin(e)).toBe('b');
		expect(g.last).toBe('b');
		expect(g.holding).toBe(true);
	});

	it('puts the focus back on the cell after a rebuild removed its element', () => {
		setup(['a', 'b']);
		const g = grid();
		cell('b').focus();
		g.focusin({ target: cell('b') } as unknown as FocusEvent);
		// A rebuild: new elements, the old focused one gone.
		const old = cell('b');
		build(['a', 'b']);
		expect(document.activeElement).toBe(document.body);
		g.focusout({ target: old, relatedTarget: null } as unknown as FocusEvent);
		flush(); // the old element is not connected: still holding
		expect(g.holding).toBe(true);
		expect(g.restore()).toBe(true);
		expect(document.activeElement).toBe(cell('b'));
	});

	it('lets go when the focus went to another element', () => {
		setup(['a']);
		const g = grid();
		cell('a').focus();
		g.focusin({ target: cell('a') } as unknown as FocusEvent);
		const other = document.createElement('button');
		document.body.append(other);
		expect(g.focusout({ target: cell('a'), relatedTarget: other } as unknown as FocusEvent)).toBe(
			true,
		);
		expect(g.holding).toBe(false);
		build(['a']);
		expect(g.restore()).toBe(false);
	});

	it('lets go after a click on nothing (the blurred element is still in the page)', () => {
		setup(['a']);
		const g = grid();
		cell('a').focus();
		g.focusin({ target: cell('a') } as unknown as FocusEvent);
		cell('a').blur();
		g.focusout({ target: cell('a'), relatedTarget: null } as unknown as FocusEvent);
		flush();
		expect(g.holding).toBe(false);
		expect(g.restore()).toBe(false);
		expect(document.activeElement).toBe(document.body);
	});

	it('does not say the focus left when it moved to another cell of the grid', () => {
		setup(['a', 'b']);
		const g = grid();
		cell('a').focus();
		g.focusin({ target: cell('a') } as unknown as FocusEvent);
		expect(
			g.focusout({ target: cell('a'), relatedTarget: cell('b') } as unknown as FocusEvent),
		).toBe(false);
		expect(g.holding).toBe(true);
	});

	it('does not take the focus back from an element the person moved it to', () => {
		setup(['a']);
		const g = grid();
		cell('a').focus();
		g.focusin({ target: cell('a') } as unknown as FocusEvent);
		const el = cell('a');
		build(['a']);
		g.focusout({ target: el, relatedTarget: null } as unknown as FocusEvent);
		const input = document.createElement('input');
		document.body.append(input);
		input.focus();
		expect(g.restore()).toBe(false);
		expect(document.activeElement).toBe(input);
	});

	it('does nothing when the cell is no longer in the window', () => {
		setup(['a']);
		const g = grid();
		cell('a').focus();
		g.focusin({ target: cell('a') } as unknown as FocusEvent);
		build(['x']);
		expect(g.restore()).toBe(false);
	});

	it('focusCell focuses a mounted cell and says when there is none', () => {
		setup(['a', 'b']);
		const g = grid();
		expect(g.focusCell('b')).toBe(true);
		expect(document.activeElement).toBe(cell('b'));
		expect(g.focusCell('nope')).toBe(false);
	});
});
