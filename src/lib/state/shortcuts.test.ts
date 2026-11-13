// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { modeForKey, type KeyLike } from './shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
});

describe('modeForKey', () => {
	it('maps Ctrl or Cmd with 1, 2, 3 to Text, Split, Visual', () => {
		expect(modeForKey(key('1', { ctrlKey: true }))).toBe('text');
		expect(modeForKey(key('2', { metaKey: true }))).toBe('split');
		expect(modeForKey(key('3', { ctrlKey: true }))).toBe('visual');
	});

	it('ignores other digits, plain digits and extra modifiers', () => {
		expect(modeForKey(key('4', { ctrlKey: true }))).toBeNull();
		expect(modeForKey(key('0', { ctrlKey: true }))).toBeNull();
		expect(modeForKey(key('1'))).toBeNull();
		expect(modeForKey(key('1', { ctrlKey: true, shiftKey: true }))).toBeNull();
		expect(modeForKey(key('1', { ctrlKey: true, altKey: true }))).toBeNull();
		expect(modeForKey(key('1', { ctrlKey: true, metaKey: true }))).toBeNull();
		expect(modeForKey(key('a', { ctrlKey: true }))).toBeNull();
		expect(modeForKey(key('1', { ctrlKey: true, isComposing: true }))).toBeNull();
	});
});
