// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The specs that abort a lazy chunk's script (`page.route(..., route.abort())`) and then press
 * "Reload the page". On Playwright's WebKit the reloaded page fails the same import again without
 * a request reaching the server (the request log has no entry after the reload); a plain `fetch`
 * of the URL from the page clears it. Answering the script with a 503 (`route.fulfill`) instead of
 * an abort did not change that, so the likely cause is WebKit's own memory of a failed load of
 * that URL surviving the reload, not the inspector's block and not the app. A browser that cannot
 * reach the network should not behave so, but that is not shown. On WebKit the specs therefore
 * refetch the URLs that failed once the page has reloaded; the limit: on WebKit they cannot catch
 * an app failure that sticks after a reload (they would pass on the refetch), and Chromium
 * (Pixel 7 and desktop) does check it without the refetch.
 */
import type { Locator, Page } from '@playwright/test';
import { isWebKit } from './finger';

/** The URLs of the requests that fail while `pattern` matches them (the aborted chunk). */
export function trackFailedChunks(page: Page, pattern: RegExp): string[] {
	const urls: string[] = [];
	page.on('requestfailed', (r) => {
		if (pattern.test(r.url())) urls.push(r.url());
	});
	return urls;
}

/** Presses the "Reload the page" button (with `press`), waits for the reload, and on WebKit clears the aborted chunks. */
export async function reloadFromFailure(
	page: Page,
	press: (button: Locator) => Promise<unknown>,
	button: Locator,
	failedUrls: readonly string[],
): Promise<void> {
	await Promise.all([page.waitForEvent('load'), press(button)]);
	if (isWebKit(page) && failedUrls.length > 0) {
		await page.evaluate(
			(urls) => Promise.all(urls.map((u) => fetch(u, { cache: 'reload' }))),
			[...new Set(failedUrls)],
		);
	}
}
