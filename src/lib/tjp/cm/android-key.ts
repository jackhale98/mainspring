// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Android key guard (phase-1 audit §5; phase-2.md 6.8). On Android, CodeMirror holds an Enter
 * or Backspace back until the next animation frame (`delayAndroidKey`), and any transaction that
 * reaches the view meanwhile, a doc change or a selection change, drops that key. The app's own
 * dispatches therefore wait: the lint push (lint.ts), the edit dispatcher before it applies an
 * edit to the file the editor shows (state/edits.svelte.ts), and the editor's reveals
 * (state/editor-controller.ts). All of them check every `ANDROID_RETRY_MS` and go ahead after
 * about 500 ms anyway, so a key stuck as pending cannot stall them.
 *
 * Only a type comes from @codemirror/view: the main chunk (the dispatcher) imports this module,
 * and the editor packages must stay in their own chunk (phase-2.md 11.3).
 */
import type { EditorView } from '@codemirror/view';

/** How often a guarded dispatch checks again. */
export const ANDROID_RETRY_MS = 16;
/** About 500 ms of retries; then the dispatch goes in anyway. */
export const ANDROID_MAX_RETRIES = 30;

/**
 * True while CodeMirror holds back an Android Enter or Backspace until the next animation frame
 * (`delayAndroidKey`). A transaction dispatched meanwhile drops that key, so the app's own
 * dispatches wait. `observer` is not public API; where it is missing this is false.
 */
export function androidKeyPending(view: EditorView): boolean {
	const o = (view as unknown as { observer?: { delayedAndroidKey?: unknown } }).observer;
	return !!o?.delayedAndroidKey;
}

export interface KeyTimers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

const globalTimers: KeyTimers = {
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

/**
 * Runs `fn` at once when `held()` is false, else once it is (checked every `ANDROID_RETRY_MS`), or
 * after `ANDROID_MAX_RETRIES` checks anyway. Returns a function that cancels a wait (no-op after
 * `fn` ran).
 */
export function afterAndroidKey(
	held: () => boolean,
	fn: () => void,
	timers: KeyTimers = globalTimers,
): () => void {
	if (!held()) {
		fn();
		return () => undefined;
	}
	let tries = 0;
	let handle: unknown = null;
	const retry = (): void => {
		handle = null;
		if (held() && ++tries < ANDROID_MAX_RETRIES) {
			handle = timers.setTimeout(retry, ANDROID_RETRY_MS);
			return;
		}
		fn();
	};
	handle = timers.setTimeout(retry, ANDROID_RETRY_MS);
	return () => {
		if (handle !== null) timers.clearTimeout(handle);
		handle = null;
	};
}
