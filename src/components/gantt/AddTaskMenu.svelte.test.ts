// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The Add task (+) control (T3): with nothing selected it adds at once; with a task selected it is
// a menu of two items, and each reports its mode.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddTaskMenu from './AddTaskMenu.svelte';

let mounted: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = null;
	document.body.innerHTML = '';
});

function setup(hasSelection: boolean) {
	const onadd = vi.fn();
	mounted = mount(AddTaskMenu, { target: document.body, props: { hasSelection, onadd } });
	flushSync();
	const button = document.querySelector<HTMLButtonElement>('[data-testid="add-task"]');
	if (!button) throw new Error('no button');
	return { onadd, button };
}

describe('AddTaskMenu', () => {
	it('has an accessible name', () => {
		expect(setup(false).button.getAttribute('aria-label')).toBe('Add task');
	});

	it('adds at once, after the end, when nothing is selected', () => {
		const { onadd, button } = setup(false);
		expect(button.hasAttribute('aria-haspopup')).toBe(false);
		button.click();
		flushSync();
		expect(onadd).toHaveBeenCalledExactlyOnceWith('after');
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it('opens a two-item menu when a task is selected', () => {
		const { onadd, button } = setup(true);
		expect(button.getAttribute('aria-haspopup')).toBe('menu');
		button.click();
		flushSync();
		expect(onadd).not.toHaveBeenCalled();
		expect(button.getAttribute('aria-expanded')).toBe('true');
		const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		expect(items.map((i) => i.textContent?.trim())).toEqual(['Add task after', 'Add subtask']);
		items[1]?.click();
		flushSync();
		expect(onadd).toHaveBeenCalledExactlyOnceWith('subtask');
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it('Escape closes the menu', () => {
		const { button } = setup(true);
		button.click();
		flushSync();
		document
			.querySelector('[role="menu"]')
			?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(button.getAttribute('aria-expanded')).toBe('false');
	});
});
