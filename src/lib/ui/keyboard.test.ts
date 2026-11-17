// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// A sheet opens at its final place: with a touch keyboard up it waits for the keyboard to go.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYBOARD_WAIT_MS, keyboardUp, whenKeyboardGone } from './keyboard';

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

describe('whenKeyboardGone', () => {
	it('runs at once when no keyboard is up, and leaves the focus alone', () => {
		const input = document.body.appendChild(document.createElement('input'));
		input.focus();
		const then = vi.fn();
		whenKeyboardGone(then, () => ({ innerHeight: 800, visual: { height: 800, scale: 1 } }));
		expect(then).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(input);
	});

	it('blurs the field and waits until the viewport is back', () => {
		vi.useFakeTimers();
		const input = document.body.appendChild(document.createElement('input'));
		input.focus();
		let height = 470;
		const listeners: (() => void)[] = [];
		vi.stubGlobal('visualViewport', {
			addEventListener: (_: string, f: () => void) => listeners.push(f),
			removeEventListener: () => undefined,
		});
		const then = vi.fn();
		whenKeyboardGone(then, () => ({ innerHeight: 800, visual: { height, scale: 1 } }));
		expect(document.activeElement).not.toBe(input);
		vi.advanceTimersByTime(100);
		for (const f of listeners) f();
		expect(then).not.toHaveBeenCalled();
		height = 800;
		for (const f of listeners) f();
		expect(then).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(KEYBOARD_WAIT_MS * 2);
		expect(then, 'once, the timer is cancelled').toHaveBeenCalledTimes(1);
	});

	it('gives up waiting after a short time', () => {
		vi.useFakeTimers();
		vi.stubGlobal('visualViewport', {
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		});
		const then = vi.fn();
		whenKeyboardGone(then, () => ({ innerHeight: 800, visual: { height: 470, scale: 1 } }));
		vi.advanceTimersByTime(KEYBOARD_WAIT_MS - 5);
		expect(then).not.toHaveBeenCalled();
		vi.advanceTimersByTime(10);
		expect(then).toHaveBeenCalledTimes(1);
	});
});
