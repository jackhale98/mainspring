// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// A sheet opens at its final place: with a touch keyboard up it waits for the keyboard to go, and the
// field that held it gets its focus and selection back when the sheet has gone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	KEYBOARD_WAIT_MS,
	keyboardUp,
	rememberFocus,
	restoreFocus,
	whenKeyboardGone,
} from './keyboard';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

const field = (): HTMLInputElement => document.body.appendChild(document.createElement('input'));

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
		const input = field();
		input.focus();
		const then = vi.fn();
		whenKeyboardGone(then, () => ({ innerHeight: 800, visual: { height: 800, scale: 1 } }));
		expect(then).toHaveBeenCalledWith(null);
		expect(document.activeElement).toBe(input);
	});

	it('blurs the field, hands it over, and waits until the viewport is back', () => {
		vi.useFakeTimers();
		const input = field();
		input.value = 'hello';
		input.focus();
		input.setSelectionRange(1, 3);
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
		expect(then.mock.calls[0]?.[0]).toMatchObject({ el: input, start: 1, end: 3 });
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

describe('restoreFocus', () => {
	it('gives a text box its focus and selection back', () => {
		const input = field();
		input.value = 'hello world';
		input.focus();
		input.setSelectionRange(2, 7, 'backward');
		const was = rememberFocus(input);
		input.blur();
		input.setSelectionRange(0, 0);
		restoreFocus(was);
		expect(document.activeElement).toBe(input);
		expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
	});

	it('gives an editable region its range back', () => {
		const div = document.body.appendChild(document.createElement('div'));
		div.contentEditable = 'true';
		div.tabIndex = 0;
		div.textContent = 'a line of text';
		div.focus();
		const text = div.firstChild as Text;
		const range = document.createRange();
		range.setStart(text, 3);
		range.setEnd(text, 6);
		getSelection()?.removeAllRanges();
		getSelection()?.addRange(range);
		const was = rememberFocus(div);
		expect(was.range?.startOffset).toBe(3);
		div.blur();
		getSelection()?.removeAllRanges();
		restoreFocus(was);
		expect(document.activeElement).toBe(div);
		expect(getSelection()?.getRangeAt(0).startOffset).toBe(3);
	});

	it('takes the focus from what is inside the dialog that is leaving', () => {
		const dialog = document.body.appendChild(document.createElement('div'));
		const close = dialog.appendChild(document.createElement('button'));
		const a = field();
		a.focus();
		const was = rememberFocus(a);
		a.blur();
		close.focus();
		restoreFocus(was);
		expect(document.activeElement, 'without `leaving` it is deliberate').toBe(close);
		restoreFocus(was, dialog);
		expect(document.activeElement).toBe(a);
	});

	it('does not take the focus from something that has it on purpose, nor from a removed field', () => {
		const a = field();
		const b = field();
		a.focus();
		const was = rememberFocus(a);
		a.blur();
		b.focus();
		restoreFocus(was);
		expect(document.activeElement).toBe(b);
		const gone = rememberFocus(a);
		a.remove();
		b.blur();
		restoreFocus(gone);
		expect(document.activeElement).toBe(document.body);
		restoreFocus(null);
	});
});
