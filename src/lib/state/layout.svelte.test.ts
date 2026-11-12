// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { DESKTOP_MIN, LayoutState, TABLET_MIN, layoutFor } from './layout.svelte';

/** A window whose width can change, with the `matchMedia` of the two min-width queries. */
function fakeWindow(width: number) {
	let w = width;
	const lists: Array<{ min: number; listeners: Set<() => void> }> = [];
	return {
		resize(next: number): void {
			w = next;
			for (const l of lists) for (const f of l.listeners) f();
		},
		listenerCount: () => lists.reduce((n, l) => n + l.listeners.size, 0),
		matchMedia(query: string): MediaQueryList {
			const min = Number(/min-width: (\d+)px/.exec(query)?.[1]);
			const entry = { min, listeners: new Set<() => void>() };
			lists.push(entry);
			return {
				get matches() {
					return w >= min;
				},
				addEventListener: (_: string, f: () => void) => entry.listeners.add(f),
				removeEventListener: (_: string, f: () => void) => entry.listeners.delete(f),
			} as unknown as MediaQueryList;
		},
	};
}

describe('layoutFor', () => {
	it('uses the breakpoints of the spec: 600 and 1024', () => {
		expect([TABLET_MIN, DESKTOP_MIN]).toEqual([600, 1024]);
		expect(layoutFor(599)).toBe('phone');
		expect(layoutFor(600)).toBe('tablet');
		expect(layoutFor(1023)).toBe('tablet');
		expect(layoutFor(1024)).toBe('desktop');
	});
});

describe('LayoutState', () => {
	it('starts from the window width and follows resizes', () => {
		const win = fakeWindow(412);
		const layout = new LayoutState(win);
		expect(layout.kind).toBe('phone');
		win.resize(820);
		expect(layout.kind).toBe('tablet');
		win.resize(1280);
		expect(layout.kind).toBe('desktop');
		win.resize(1023);
		expect(layout.kind).toBe('tablet');
		win.resize(300);
		expect(layout.kind).toBe('phone');
	});

	it('stops listening when disposed', () => {
		const win = fakeWindow(1280);
		const layout = new LayoutState(win);
		expect(win.listenerCount()).toBe(2);
		layout.dispose();
		expect(win.listenerCount()).toBe(0);
		win.resize(400);
		expect(layout.kind).toBe('desktop');
	});
});
