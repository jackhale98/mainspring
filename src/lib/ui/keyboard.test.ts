// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// A sheet opens at its final place: with a touch keyboard up it waits for the keyboard to go.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYBOARD_WAIT_MS, keyboardUp, settleKeyboard } from './keyboard';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe('keyboardUp', () => {
	it('is a visual viewport much shorter than the page', () => {
		expect(keyboardUp({ innerHeight: 800, visual: { height: 470, scale: 1 } })).toBe(true);
	});
	it('is not a browser bar, a zoom, or no visual viewport', () => {
		expect(keyboardUp({ innerHeight: 800, visual: { height: 740, scale: 1 } })).toBe(false);
		expect(keyboardUp({ innerHeight: 800, visual: { height: 400, scale: 2 } })).toBe(false);
		expect(keyboardUp({ innerHeight: 800, visual: null })).toBe(false);
	});
});

describe('settleKeyboard', () => {
	it('resolves at once when no keyboard is up, and leaves the focus alone', async () => {
		const input = document.body.appendChild(document.createElement('input'));
		input.focus();
		await settleKeyboard(() => ({ innerHeight: 800, visual: { height: 800, scale: 1 } }));
		expect(document.activeElement).toBe(input);
	});

	it('blurs the text field and waits until the viewport is back', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
		const input = document.body.appendChild(document.createElement('input'));
		input.focus();
		let height = 470;
		const listeners: (() => void)[] = [];
		vi.stubGlobal('visualViewport', {
			addEventListener: (_: string, f: () => void) => listeners.push(f),
			removeEventListener: () => undefined,
		});
		let settled = false;
		void settleKeyboard(() => ({ innerHeight: 800, visual: { height, scale: 1 } })).then(
			() => (settled = true),
		);
		expect(document.activeElement).not.toBe(input);
		await vi.advanceTimersByTimeAsync(100);
		expect(settled).toBe(false);
		height = 800;
		for (const f of listeners) f();
		await vi.advanceTimersByTimeAsync(5);
		expect(settled).toBe(true);
	});

	it('gives up waiting after a short time', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
		vi.stubGlobal('visualViewport', {
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		});
		let settled = false;
		void settleKeyboard(() => ({ innerHeight: 800, visual: { height: 470, scale: 1 } })).then(
			() => (settled = true),
		);
		await vi.advanceTimersByTimeAsync(KEYBOARD_WAIT_MS + 5);
		expect(settled).toBe(true);
	});
});
