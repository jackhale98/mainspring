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
	/**
	 * The full title path: the describe blocks and the test title joined with ` › `, as Playwright
	 * lists it without the file and project (`info.titlePath` after the file). A test in a loop has
	 * the title it gets for each value, so one entry names one test, not the loop.
	 */
	title: string;
	reason: WebKitSkipReason;
	/** One line: what exactly WebKit cannot do here. */
	detail: string;
}

export const MAX_WEBKIT_ALLOWLIST = 6;

export const WEBKIT_ALLOWLIST: readonly WebKitAllowEntry[] = [
	{
		file: 'gantt-frozen.spec.ts',
		title:
			'frozen header and name column › a touch scroll gesture moves header and bars rigidly (Pixel 7)',
		reason: 'cdp-touch',
		detail:
			"the browser's own touch scroll (compositor pan with a fling); a dispatched event does not scroll, and a wheel or a scripted scrollTo is not what a finger does. The frozen-header checks run on WebKit through a scripted scroll (the first test) and a stepped long pan to the far right and back (the long-pan test), without the fling's momentum",
	},
	{
		file: 'gantt-perf.spec.ts',
		title: 'gantt perf (gantt-500) › scroll, pan, zoom, drag and a result during a scroll',
		reason: 'chromium-performance-api',
		detail:
			'Chromium DevTools only: Emulation.setCPUThrottlingRate, Input.synthesizeScrollGesture and the trace categories of lib/perf.ts; the drag part of the iPhone is recorded by gantt-gesture-frames.spec.ts',
	},
	{
		file: 'gantt-perf.spec.ts',
		title: 'gantt perf (gantt-500) › phone scroll with the touchmove listener',
		reason: 'chromium-performance-api',
		detail:
			'compares native touch scrolls at 4x CPU throttling, both Chromium DevTools only; WebKit has neither CPU throttling nor a touch scroll',
	},
	{
		file: 'gantt-perf.spec.ts',
		title: 'gantt perf (gantt-500) › phone scroll without the touchmove listener',
		reason: 'chromium-performance-api',
		detail: 'the same comparison with the listener dropped by an init script',
	},
	{
		file: 'workload-perf.spec.ts',
		title: 'Pixel 7: the frame times of a swipe are recorded',
		reason: 'chromium-performance-api',
		detail:
			"records the frame times of the browser's own touch scroll with Chromium's trace (browser.startTracing); WebKit has no trace and Playwright has no touch scroll there. The mounted-DOM cap of the same view runs on the iPhone (the test above it)",
	},
];

export const TITLE_SEPARATOR = ' › ';

/** The entry that allows the test with this title path in `file` to skip on WebKit, if any. */
export function findAllowEntry(
	file: string,
	titlePath: readonly string[] | string,
	list: readonly WebKitAllowEntry[] = WEBKIT_ALLOWLIST,
): WebKitAllowEntry | undefined {
	const title = typeof titlePath === 'string' ? titlePath : titlePath.join(TITLE_SEPARATOR);
	return list.find((e) => e.file === file && e.title === title);
}

/**
 * Call in a spec's `beforeEach` (or at the top of a test) with its `TestInfo`. Skips the test on
 * the iPhone 14 project only when it is on the allowlist; everywhere else it does nothing.
 */
export function skipOnWebKitIfAllowlisted(info: TestInfo): void {
	if (info.project.name !== 'iphone-14') return;
	// `titlePath` is the file, the describe blocks, then the title.
	const [file = '', ...titles] = info.titlePath;
	const entry = findAllowEntry(file.split(/[\\/]/).pop() ?? file, titles);
	if (entry) test.skip(true, `WebKit cannot: ${entry.reason} (${entry.detail})`);
}
