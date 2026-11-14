// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The Add task (+) control (T3): with nothing selected it adds at once; with a task selected it is
// a menu of two items, and each reports its mode.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddMode } from '../../lib/gantt/add-task';
import AddTaskMenu from './AddTaskMenu.svelte';

let mounted: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = null;
	document.body.innerHTML = '';
});

function setup(hasSelection: boolean, extra: { canSubtask?: boolean; onadd?: () => unknown } = {}) {
	const onadd = vi.fn((_mode: AddMode) => extra.onadd?.() as Promise<unknown> | void);
	mounted = mount(AddTaskMenu, {
		target: document.body,
		props: {
			hasSelection,
			onadd,
			...(extra.canSubtask === undefined ? {} : { canSubtask: extra.canSubtask }),
		},
	});
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

	it('ignores presses while an add is under way, and works again after', async () => {
		let release: () => void = () => undefined;
		const { onadd, button } = setup(false, {
			onadd: () => new Promise<void>((r) => (release = r)),
		});
		button.click();
		flushSync();
		button.click();
		button.click();
		flushSync();
		expect(onadd).toHaveBeenCalledTimes(1);
		expect(button.getAttribute('aria-busy')).toBe('true');
		release();
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(button.hasAttribute('aria-busy')).toBe(false);
		button.click();
		expect(onadd).toHaveBeenCalledTimes(2);
	});

	it('says why Add subtask is off, and does not send it', () => {
		const { onadd, button } = setup(true, { canSubtask: false });
		button.click();
		flushSync();
		const sub = document.querySelector<HTMLElement>('[data-action="subtask"]');
		expect(sub?.getAttribute('aria-disabled')).toBe('true');
		expect(sub?.textContent).toContain('Not available for a task declared by a macro');
		const why = sub?.getAttribute('aria-describedby');
		expect(why && document.getElementById(why)).not.toBeNull();
		sub?.click();
		flushSync();
		expect(onadd).not.toHaveBeenCalled();
		// The menu stays open: nothing was chosen.
		expect(document.querySelector('[role="menu"]')).not.toBeNull();
	});
});
