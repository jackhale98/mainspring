// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ALL_KEYS, SHORTCUTS, commandFor, linkKey, progressKey, type KeyEventLike } from './keys';

const key = (k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
	key: k,
	code: '',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
});

describe('commandFor', () => {
	it('sizes with Ctrl+Alt+Right and Left, Cmd too (R1)', () => {
		expect(commandFor(key('ArrowRight', { altKey: true, ctrlKey: true }))).toEqual({
			type: 'size',
			steps: 1,
		});
		expect(commandFor(key('ArrowLeft', { altKey: true, metaKey: true }))).toEqual({
			type: 'size',
			steps: -1,
		});
	});

	it('moves by a working day with Alt+Right and Left (R2)', () => {
		expect(commandFor(key('ArrowRight', { altKey: true }))).toEqual({ type: 'move', days: 1 });
		expect(commandFor(key('ArrowLeft', { altKey: true }))).toEqual({ type: 'move', days: -1 });
	});

	it('reorders with Alt+Shift+Up and Down, indents with Alt+Shift+Right and Left (R5)', () => {
		const alt = { altKey: true, shiftKey: true };
		expect(commandFor(key('ArrowUp', alt))).toEqual({ type: 'reorder', step: 'up' });
		expect(commandFor(key('ArrowDown', alt))).toEqual({ type: 'reorder', step: 'down' });
		expect(commandFor(key('ArrowRight', alt))).toEqual({ type: 'reorder', step: 'indent' });
		expect(commandFor(key('ArrowLeft', alt))).toEqual({ type: 'reorder', step: 'outdent' });
	});

	it('maps the single letters and the extra keys', () => {
		expect(commandFor(key('l'))).toEqual({ type: 'link' });
		expect(commandFor(key('p'))).toEqual({ type: 'progress' });
		expect(commandFor(key('t'))).toEqual({ type: 'today' });
		expect(commandFor(key('Delete'))).toEqual({ type: 'delete' });
		expect(commandFor(key('Insert'))).toEqual({ type: 'add' });
		expect(commandFor(key('Enter', { ctrlKey: true }))).toEqual({ type: 'add' });
		expect(commandFor(key('Enter', { metaKey: true }))).toEqual({ type: 'add' });
	});

	it('leaves everything else alone, so typing and the browser keep their keys', () => {
		for (const e of [
			key('a'),
			key('ArrowRight'),
			key('Enter'),
			key('l', { ctrlKey: true }),
			key('l', { shiftKey: true }),
			key('ArrowUp', { altKey: true }),
			key('x', { altKey: true, shiftKey: true }),
			key('ArrowRight', { altKey: true, ctrlKey: true, shiftKey: true }),
			key('ArrowUp', { altKey: true, ctrlKey: true }),
			key('Enter', { ctrlKey: true, shiftKey: true }),
		]) {
			expect(commandFor(e), JSON.stringify(e)).toBeNull();
		}
	});
});

describe('link mode keys', () => {
	it('picks the successor with the arrows and ends with Enter or Escape', () => {
		expect(linkKey(key('ArrowDown'))).toBe('next');
		expect(linkKey(key('ArrowUp'))).toBe('previous');
		expect(linkKey(key('Enter'))).toBe('confirm');
		expect(linkKey(key('Escape'))).toBe('cancel');
		expect(linkKey(key('Home'))).toBe('first');
		expect(linkKey(key('End'))).toBe('last');
		expect(linkKey(key('a'))).toBeNull();
		expect(linkKey(key('ArrowDown', { altKey: true }))).toBeNull();
	});
});

describe('progress mode keys', () => {
	it('changes by 5 %, 20 % with Shift, to the ends with Home and End', () => {
		expect(progressKey(key('ArrowRight'))).toEqual({ by: 5 });
		expect(progressKey(key('ArrowLeft'))).toEqual({ by: -5 });
		expect(progressKey(key('ArrowRight', { shiftKey: true }))).toEqual({ by: 20 });
		expect(progressKey(key('Home'))).toEqual({ to: 0 });
		expect(progressKey(key('End'))).toEqual({ to: 100 });
		expect(progressKey(key('Enter'))).toEqual({ done: true });
		expect(progressKey(key('Escape'))).toEqual({ done: true });
		expect(progressKey(key('x'))).toBeNull();
	});
});

describe('SHORTCUTS', () => {
	it('lists every key once, in the aria-keyshortcuts form', () => {
		expect(ALL_KEYS.split(' ')).toContain('Alt+Shift+ArrowRight');
		expect(ALL_KEYS.split(' ')).toContain('Control+Alt+ArrowLeft');
		expect(new Set(ALL_KEYS.split(' ')).size).toBe(ALL_KEYS.split(' ').length);
		expect(SHORTCUTS.map((s) => s.id)).toContain('indent');
	});

	it('every listed chord is a command (the list does not drift from the keys)', () => {
		const press = (aria: string): KeyEventLike => {
			const parts = aria.split('+');
			const k = parts.pop() as string;
			return key(k, {
				ctrlKey: parts.includes('Control'),
				altKey: parts.includes('Alt'),
				shiftKey: parts.includes('Shift'),
			});
		};
		for (const s of SHORTCUTS) {
			if (s.id === 'rename') continue; // F2 is the treegrid's own
			for (const a of s.aria) expect(commandFor(press(a)), a).not.toBeNull();
		}
	});
});
