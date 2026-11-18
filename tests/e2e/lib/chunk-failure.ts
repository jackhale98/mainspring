// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The specs that abort a lazy chunk's script (`page.route(..., route.abort())`) and then press
 * "Reload the page". Playwright's WebKit keeps the aborted request ("Blocked by Web Inspector")
 * as the page cache's answer for that URL across the reload: the reloaded page asks for the chunk
 * and fails again without a request reaching the server (seen: the request log has no entry after
 * the reload; a plain `fetch` of the URL from the page clears it). That is the harness, not the app
 * (a browser that cannot reach the network keeps no such entry), so on WebKit the specs refetch the
 * URLs that failed once the page has reloaded and before they go on.
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
