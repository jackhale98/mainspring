// SPDX-License-Identifier: GPL-2.0-or-later
// The site under a base path, as the GitHub Pages preview serves it (ADR-0006). Run by
// `npm run test:base-path`: a build with MAINSPRING_BASE=/mainspring/ and no dev pages, served by
// scripts/serve-pages.mjs, which answers only under the base, redirects directories to their
// trailing slash and sends the engine's .gz files as plain application/gzip.
import { expect, test, type Response } from '@playwright/test';

// A cold engine boot is several seconds; CI is slower still.
const READY_TIMEOUT_MS = 120_000;

test('the app boots, schedules a sample and requests nothing outside the base path', async ({
	page,
	context,
	baseURL,
}) => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);
	if (!baseURL) throw new Error('playwright.base-path.config.ts sets baseURL');
	const site = new URL(baseURL);
	const base = site.pathname;

	// Every request on the site's origin, from the page and from the engine worker.
	const requested = new Set<string>();
	const outside: string[] = [];
	const failed: string[] = [];
	const gzipped: Response[] = [];
	context.on('request', (request) => {
		const url = new URL(request.url());
		if (url.origin !== site.origin) return;
		requested.add(url.pathname);
		if (!url.pathname.startsWith(base)) outside.push(url.href);
	});
	context.on('response', (response) => {
		if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
		if (new URL(response.url()).pathname.endsWith('.gz')) gzipped.push(response);
	});
	context.on('requestfailed', (request) => {
		const error = request.failure()?.errorText ?? '';
		// A navigation aborts what the previous page still had in flight.
		if (!error.includes('ERR_ABORTED')) failed.push(`${error} ${request.url()}`);
	});

	// The home page links to the app under the base; Pages redirects app to app/.
	await page.goto('./');
	await page.getByRole('link', { name: 'Open the app' }).click();
	await expect(page).toHaveURL(new RegExp(`^${site.origin}${base}app/?$`));
	// Wait until the boot settles either way, so that a boot failure names its cause at once.
	const engine = page.getByTestId('engine-status');
	await expect(engine).toHaveAttribute('data-state', /^(idle|failed)$/, {
		timeout: READY_TIMEOUT_MS,
	});
	expect(outside, 'requests outside the base path').toEqual([]);
	expect(failed, 'failed requests').toEqual([]);
	await expect(engine).toHaveText('Engine: Ready');

	// Pick another sample: its text loads as a lazy chunk from <base>_astro/.
	await page.getByRole('combobox', { name: 'Sample plan' }).selectOption('upstream-tutorial');
	const strip = page.getByRole('group', { name: 'Plan status' });
	await expect(strip).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
	await expect(strip.locator('time')).toContainText('2002', { timeout: READY_TIMEOUT_MS });
	await expect(
		page
			.getByRole('tree', { name: 'Tasks' })
			.getByRole('treeitem', { name: /Accounting Software/ }),
	).toBeVisible();
	await page.evaluate(() => document.fonts.ready.then(() => undefined));

	// Files that only public/ provides are served under the base too.
	for (const path of ['fonts/NOTICES.txt', 'engine/NOTICES.txt', 'engine/manifest.json']) {
		expect((await page.request.get(path)).status(), path).toBe(200);
	}

	// The listeners saw the worker's requests, so an empty `outside` means something.
	expect(requested).toContain(`${base}engine/manifest.json`);
	const paths = [...requested];
	expect(
		paths.filter((p) => p.startsWith(`${base}engine/`) && p.endsWith('.wasm.gz')),
	).toHaveLength(1);
	expect(
		paths.filter((p) => p.startsWith(`${base}engine/`) && p.endsWith('.json.gz')),
	).toHaveLength(1);
	expect(paths.some((p) => p.startsWith(`${base}_astro/`) && p.endsWith('.woff2'))).toBe(true);

	// Served as plain files, as Pages does: the app gunzips them itself.
	expect(gzipped.length).toBeGreaterThanOrEqual(2);
	for (const response of gzipped) {
		const headers = await response.allHeaders();
		expect(headers['content-type'], response.url()).toBe('application/gzip');
		expect(headers['content-encoding'], response.url()).toBeUndefined();
	}

	expect(outside, 'requests outside the base path').toEqual([]);
	expect(failed, 'failed requests').toEqual([]);
});
