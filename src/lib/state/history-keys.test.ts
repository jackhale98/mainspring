// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { bindHistoryKeys, historyBindings, historyInput, historyKey } from './history-keys';

const key = (k: string, o: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', { key: k, ...o });

describe('historyKey', () => {
	it('maps Mod-Z, Mod-Shift-Z and Mod-Y with Ctrl, or Cmd on Apple platforms', () => {
		expect(historyKey(key('z', { ctrlKey: true }), false)).toBe('undo');
		expect(historyKey(key('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo');
		expect(historyKey(key('y', { ctrlKey: true }), false)).toBe('redo');
		expect(historyKey(key('z', { metaKey: true }), true)).toBe('undo');
		expect(historyKey(key('z', { metaKey: true, shiftKey: true }), true)).toBe('redo');
		expect(historyKey(key('z', { metaKey: true }), false)).toBeNull();
		expect(historyKey(key('z', { ctrlKey: true }), true)).toBeNull();
		expect(historyKey(key('z', { ctrlKey: true, altKey: true }), false)).toBeNull();
		expect(historyKey(key('y', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
		expect(historyKey(key('x', { ctrlKey: true }), false)).toBeNull();
	});
});

describe('historyInput', () => {
	it('maps the browser history inputs', () => {
		expect(historyInput('historyUndo')).toBe('undo');
		expect(historyInput('historyRedo')).toBe('redo');
		expect(historyInput('insertText')).toBeNull();
	});
});

describe('historyBindings', () => {
	it('binds the three keys, always handled', () => {
		const h = { undo: vi.fn(() => false), redo: vi.fn(() => false) };
		const keys = historyBindings(h);
		expect(keys.map((k) => k.key)).toEqual(['Mod-z', 'Mod-Shift-z', 'Mod-y']);
		const view = {} as never;
		expect(keys.map((k) => k.run?.(view))).toEqual([true, true, true]);
		expect(h.undo).toHaveBeenCalledOnce();
		expect(h.redo).toHaveBeenCalledTimes(2);
	});
});

describe('bindHistoryKeys', () => {
	const ctrl = !/Mac|iPhone|iPad|iPod/.test(navigator.platform);
	const undoKey = () => key('z', ctrl ? { ctrlKey: true } : { metaKey: true });

	it('runs the history outside text fields and prevents the default', () => {
		const h = { undo: vi.fn(() => true), redo: vi.fn(() => true) };
		const off = bindHistoryKeys(window, h);
		const e = new KeyboardEvent('keydown', {
			key: 'z',
			bubbles: true,
			cancelable: true,
			...(ctrl ? { ctrlKey: true } : { metaKey: true }),
		});
		document.body.dispatchEvent(e);
		expect(h.undo).toHaveBeenCalledOnce();
		expect(e.defaultPrevented).toBe(true);
		off();
		document.body.dispatchEvent(undoKey());
		expect(h.undo).toHaveBeenCalledOnce();
	});

	it('leaves text fields and handled keys alone', () => {
		const h = { undo: vi.fn(() => true), redo: vi.fn(() => true) };
		const off = bindHistoryKeys(window, h);
		const input = document.createElement('input');
		const editable = document.createElement('div');
		editable.setAttribute('contenteditable', 'true');
		document.body.append(input, editable);
		for (const target of [input, editable]) {
			target.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'z',
					bubbles: true,
					...(ctrl ? { ctrlKey: true } : { metaKey: true }),
				}),
			);
		}
		const handled = new KeyboardEvent('keydown', {
			key: 'z',
			bubbles: true,
			cancelable: true,
			...(ctrl ? { ctrlKey: true } : { metaKey: true }),
		});
		handled.preventDefault();
		document.body.dispatchEvent(handled);
		expect(h.undo).not.toHaveBeenCalled();
		off();
		input.remove();
		editable.remove();
	});
});
