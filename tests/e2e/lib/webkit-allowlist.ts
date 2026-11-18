// SPDX-License-Identifier: GPL-2.0-or-later
// The only tests that may skip on the iPhone 14 project (WebKit), one entry per test (ADR-0016
// section 2). A skip hides a bug that the user then finds on a real phone, so an entry is for what
// WebKit cannot do, never for a test that fails:
//   - 'cdp-touch': the test needs Chromium's DevTools Protocol touch input and the same gesture
//     cannot be sent with Playwright's `tap()` or with events dispatched in the page.
//   - 'chromium-performance-api': it reads an API only Chromium has (a trace, `performance.memory`).
//   - 'android-editcontext': it tests Android's EditContext keyboard path.
// At most 6 entries across the suite. `scripts/ci/webkit-skips.mjs` fails the `check` job on any
// `iphone-14`, `isIphone` or `webkit` skip in a spec that does not go through this list.
import { test, type TestInfo } from '@playwright/test';

export type WebKitSkipReason = 'cdp-touch' | 'chromium-performance-api' | 'android-editcontext';

export interface WebKitAllowEntry {
	/** The spec file name, e.g. `gantt-gestures-edge.spec.ts`. */
	file: string;
	/** The full test title as Playwright reports it (`info.title`). */
	title: string;
	reason: WebKitSkipReason;
	/** One line: what exactly WebKit cannot do here. */
	detail: string;
}

export const MAX_WEBKIT_ALLOWLIST = 6;

export const WEBKIT_ALLOWLIST: readonly WebKitAllowEntry[] = [];

/** The entry that allows `title` in `file` to skip on WebKit, if there is one. */
export function findAllowEntry(
	file: string,
	title: string,
	list: readonly WebKitAllowEntry[] = WEBKIT_ALLOWLIST,
): WebKitAllowEntry | undefined {
	return list.find((e) => e.file === file && e.title === title);
}

/**
 * Call in a spec's `beforeEach` (or at the top of a test) with its `TestInfo`. Skips the test on
 * the iPhone 14 project only when it is on the allowlist; everywhere else it does nothing.
 */
export function skipOnWebKitIfAllowlisted(info: TestInfo): void {
	if (info.project.name !== 'iphone-14') return;
	const file = info.file.split(/[\\/]/).pop() ?? info.file;
	const entry = findAllowEntry(file, info.title);
	if (entry) test.skip(true, `WebKit cannot: ${entry.reason} (${entry.detail})`);
}
