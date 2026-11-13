// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	beyondSlop,
	distance,
	isBarHandle,
	longPressDeadline,
	longPressDue,
	pressMode,
	slopFor,
	type PressMode,
} from './long-press';
import { BODY, EMPTY, END_HANDLE, LINK, LINK_DOT, PROGRESS, ROW_HANDLE } from './testing';
import { DEFAULT_GESTURE_CONFIG as cfg, type GestureTarget, type PointerKind } from './types';

describe('slop', () => {
	it('is 3 px for a mouse, 4 for a pen and 8 for a finger', () => {
		expect([slopFor(cfg, 'mouse'), slopFor(cfg, 'pen'), slopFor(cfg, 'touch')]).toEqual([3, 4, 8]);
	});
	it('is exceeded only strictly beyond it, by distance', () => {
		expect(distance(0, 0, 3, 4)).toBe(5);
		expect(beyondSlop(cfg, 'touch', 0, 0, 8, 0)).toBe(false);
		expect(beyondSlop(cfg, 'touch', 0, 0, 8.1, 0)).toBe(true);
		expect(beyondSlop(cfg, 'touch', 0, 0, 6, 6)).toBe(true);
		expect(beyondSlop(cfg, 'mouse', 0, 0, 2, 2)).toBe(false);
	});
});

describe('long-press timing', () => {
	it('is due from 350 ms after the press', () => {
		const d = longPressDeadline(cfg, 1000);
		expect(d).toBe(1350);
		expect(longPressDue(d, 1349)).toBe(false);
		expect(longPressDue(d, 1350)).toBe(true);
		expect(longPressDue(null, 1e9)).toBe(false);
	});
});

describe('press mode (ADR-0008 #4)', () => {
	// kind, target, canDrag, selected -> mode
	const cases: Array<[string, PointerKind, GestureTarget, boolean, boolean, PressMode]> = [
		['mouse on a bar body', 'mouse', BODY, true, true, 'immediate'],
		['mouse on a handle', 'mouse', END_HANDLE, true, true, 'immediate'],
		['pen on a row handle', 'pen', ROW_HANDLE, true, true, 'immediate'],
		['mouse on empty space', 'mouse', EMPTY, true, true, 'none'],
		['mouse on a link', 'mouse', LINK, true, true, 'none'],
		['mouse on a bar that cannot drag', 'mouse', BODY, false, true, 'none'],
		['touch on a bar body', 'touch', BODY, true, true, 'long-press'],
		['touch on the end handle', 'touch', END_HANDLE, true, true, 'immediate'],
		['touch on the link dot', 'touch', LINK_DOT, true, true, 'immediate'],
		['touch on the progress handle', 'touch', PROGRESS, true, true, 'immediate'],
		['touch on a handle that cannot drag', 'touch', END_HANDLE, false, true, 'long-press'],
		['touch on a text-only bar', 'touch', BODY, false, true, 'long-press'],
		[
			'touch on the end handle of an unselected bar',
			'touch',
			END_HANDLE,
			true,
			false,
			'long-press',
		],
		['mouse on the end handle of an unselected bar', 'mouse', END_HANDLE, true, false, 'immediate'],
		['touch on a row handle', 'touch', ROW_HANDLE, true, true, 'long-press'],
		['touch on empty space', 'touch', EMPTY, true, true, 'none'],
		['touch on a link', 'touch', LINK, true, true, 'none'],
	];
	it.each(cases)('%s', (_name, kind, hit, can, selected, mode) => {
		expect(pressMode(kind, hit, can, selected)).toBe(mode);
	});
	it('knows the handles of a bar', () => {
		expect([BODY, END_HANDLE, LINK_DOT, PROGRESS, EMPTY].map(isBarHandle)).toEqual([
			false,
			true,
			true,
			true,
			false,
		]);
	});
});
