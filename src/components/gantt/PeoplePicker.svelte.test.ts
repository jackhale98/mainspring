// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The people picker (polish item 17): the Assign button opens an ARIA combobox with a listbox that
// the typed text narrows; Up, Down, Enter and Escape work; a click and Enter report different
// things (assign mode, and the selected task); assign mode shows who and a Done button.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChipDrag } from './chip-drag.svelte';
import PeoplePicker from './PeoplePicker.svelte';
import type { Person } from './types';

const PEOPLE: Person[] = [
	{ id: 'dev1', name: 'Dev 1', index: 0 },
	{ id: 'alopez', name: 'Ana López', index: 1 },
	{ id: 'bk', name: 'Bao Kim', index: 2 },
];

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const m of mounted.splice(0)) void unmount(m);
	document.body.innerHTML = '';
});

function setup(over: { assigning?: Person | null } = {}) {
	const onpick = vi.fn();
	const onpickkey = vi.fn();
	const ondone = vi.fn();
	const target = document.createElement('div');
	document.body.append(target);
	const drag = new ChipDrag({
		rowAt: () => null,
		drop: () => undefined,
		announce: () => undefined,
	});
	mounted.push(
		mount(PeoplePicker, {
			target,
			props: {
				people: PEOPLE,
				booked: new Set(['bk']),
				hasTask: true,
				drag,
				recent: [],
				assigning: over.assigning ?? null,
				onpick,
				onpickkey,
				ondone,
			},
		}),
	);
	flushSync();
	return { target, onpick, onpickkey, ondone };
}

const button = (t: HTMLElement) =>
	t.querySelector<HTMLButtonElement>('[data-testid="assign-button"]');
const search = () => document.querySelector<HTMLInputElement>('input[role="combobox"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
/** Presses the button and waits for the list, which is its own chunk (fetched when first opened). */
async function openList(target: HTMLElement): Promise<void> {
	button(target)?.click();
	flushSync();
	await vi.waitFor(() => expect(search()).not.toBeNull());
}
function type(text: string): void {
	const i = search();
	if (!i) throw new Error('no search box');
	i.value = text;
	i.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}
function key(name: string): void {
	search()?.dispatchEvent(
		new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
	);
	flushSync();
}

describe('PeoplePicker', () => {
	it('is a collapsed button until pressed, then a combobox over a listbox of everyone', async () => {
		const { target } = setup();
		expect(button(target)?.getAttribute('aria-expanded')).toBe('false');
		expect(search()).toBeNull();
		await openList(target);
		expect(button(target)?.getAttribute('aria-expanded')).toBe('true');
		expect(search()?.getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('[role="listbox"]')).not.toBeNull();
		expect(options().map((o) => o.dataset['person'])).toEqual(['dev1', 'alopez', 'bk']);
		// The person already on the selected task says so.
		expect(options()[2]?.textContent).toContain('on the selected task');
	});

	it('narrows by name or id as you type, and says when nothing matches', async () => {
		const { target } = setup();
		await openList(target);
		type('lopez');
		expect(options().map((o) => o.dataset['person'])).toEqual(['alopez']);
		type('BK');
		expect(options().map((o) => o.dataset['person'])).toEqual(['bk']);
		type('zzz');
		expect(options()).toHaveLength(0);
		expect(document.querySelector('[role="status"]')?.textContent).toContain(
			'No one matches "zzz"',
		);
	});

	it('moves with the arrows (wrapping), follows with aria-activedescendant, Enter picks by key', async () => {
		const { target, onpick, onpickkey } = setup();
		await openList(target);
		const active = () => search()?.getAttribute('aria-activedescendant');
		expect(active()).toBe(options()[0]?.id);
		key('ArrowDown');
		expect(active()).toBe(options()[1]?.id);
		key('ArrowUp');
		key('ArrowUp');
		expect(active()).toBe(options()[2]?.id);
		key('Enter');
		expect(onpickkey).toHaveBeenCalledWith(PEOPLE[2]);
		expect(onpick).not.toHaveBeenCalled();
		expect(search()).toBeNull();
	});

	it('a click on a person reports a pick (assign mode), not a key pick', async () => {
		const { target, onpick, onpickkey } = setup();
		await openList(target);
		options()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
		flushSync();
		expect(onpick).toHaveBeenCalledWith(PEOPLE[1]);
		expect(onpickkey).not.toHaveBeenCalled();
		expect(search()).toBeNull();
	});

	it('Escape closes the list and gives the focus back to the button', async () => {
		const { target } = setup();
		document.body.focus();
		await openList(target);
		key('Escape');
		expect(search()).toBeNull();
		expect(document.activeElement).toBe(button(target));
	});

	it('in assign mode the button names the person, and Done ends it', async () => {
		const { target, ondone } = setup({ assigning: PEOPLE[1] ?? null });
		expect(button(target)?.textContent).toContain('Assigning Ana López');
		const done = [...target.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Done',
		);
		expect(done?.getAttribute('aria-label')).toBe('Done assigning');
		done?.click();
		expect(ondone).toHaveBeenCalledOnce();
	});
});
