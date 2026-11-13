// SPDX-License-Identifier: GPL-2.0-or-later
// The shared Android key guard (phase-1 audit §5; phase-2.md 6.8).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import {
	ANDROID_MAX_RETRIES,
	ANDROID_RETRY_MS,
	afterAndroidKey,
	androidKeyPending,
} from './android-key';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('androidKeyPending', () => {
	it("reads CodeMirror's delayed key, and is false without an observer", () => {
		const view = (o: unknown) => o as EditorView;
		expect(androidKeyPending(view({ observer: { delayedAndroidKey: { key: 'Enter' } } }))).toBe(
			true,
		);
		expect(androidKeyPending(view({ observer: { delayedAndroidKey: null } }))).toBe(false);
		expect(androidKeyPending(view({}))).toBe(false);
	});
});

describe('afterAndroidKey', () => {
	it('runs at once when no key is held', () => {
		const fn = vi.fn();
		afterAndroidKey(() => false, fn);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('waits in 16 ms steps until the key is handled', () => {
		let held = true;
		const fn = vi.fn();
		afterAndroidKey(() => held, fn);
		vi.advanceTimersByTime(ANDROID_RETRY_MS * 3);
		expect(fn).not.toHaveBeenCalled();
		held = false;
		vi.advanceTimersByTime(ANDROID_RETRY_MS);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('goes ahead after about 500 ms when the key stays held', () => {
		const fn = vi.fn();
		afterAndroidKey(() => true, fn);
		vi.advanceTimersByTime(ANDROID_RETRY_MS * (ANDROID_MAX_RETRIES - 1));
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(ANDROID_RETRY_MS);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(ANDROID_RETRY_MS * ANDROID_MAX_RETRIES).toBeGreaterThanOrEqual(480);
	});

	it('can be cancelled while it waits', () => {
		const fn = vi.fn();
		const cancel = afterAndroidKey(() => true, fn);
		cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});
});
