// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The app's error path for a failure that must not stop the caller: the error is rethrown outside
 * the current call stack (a microtask), so the caller carries on and the error still reaches the
 * browser's error reporting (the console, `window.onerror`) and fails a test run.
 */
export function report(error: unknown): void {
	queueMicrotask(() => {
		throw error;
	});
}
