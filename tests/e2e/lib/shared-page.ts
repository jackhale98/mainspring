// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A page that a worker boots once and its read-only tests share (ADR-0016 change 4, the trial in
 * docs/decisions/0016-trial-shared-page.md). Booting the app costs seconds of ruby.wasm start-up
 * per test; this loads the next plan through the app's own sample chooser, which keeps the engine
 * worker. With `E2E_SHARED_PAGE=1` the `test` exported here gives each test the worker's one page;
 * without it the stock one-page-per-test, so a spec can be timed both ways from one source.
 *
 * Isolation (what a test may rely on): before each test the page is reset: dialogs closed,
 * `localStorage` and `sessionStorage` emptied (the chosen mode written back), the viewport and
 * colour scheme back to the project's, and the plan reloaded through the chooser (another plan
 * first when the same one is asked for again, because choosing the open plan does nothing), so
 * the text, history, selection, filter, zoom and scroll start from the sample. `assertPristine`
 * checks it; a spec that cannot pass it must not share a page.
 */
import { expect, test as base, type Page, type TestInfo } from '@playwright/test';

export const SHARED = process.env['E2E_SHARED_PAGE'] === '1';
const READY_TIMEOUT_MS = 120_000;

interface State {
	page: Page;
	sample: string | null;
}

export const test = base.extend<{ page: Page }, { shared: State }>({
	shared: [
		async ({ browser }, use, workerInfo) => {
			const u = workerInfo.project.use;
			const context = await browser.newContext({
				baseURL: u.baseURL,
				viewport: u.viewport,
				userAgent: u.userAgent,
				deviceScaleFactor: u.deviceScaleFactor,
				isMobile: u.isMobile,
				hasTouch: u.hasTouch,
			});
			await use({ page: await context.newPage(), sample: null });
			await context.close();
		},
		{ scope: 'worker' },
	],
	page: async ({ page, shared }, use) => {
		await use(SHARED ? shared.page : page);
	},
});
export { expect };

async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

const lastOpened = new WeakMap<Page, string>();

/**
 * Opens a plan as `page.goto('/app?sample=…')` would, with the default layout for the project
 * (no `mode`), booting only the first time on a shared page.
 */
export async function openShared(page: Page, info: TestInfo, sample: string): Promise<void> {
	const viewport = info.project.use.viewport;
	const current = lastOpened.get(page);
	if (!SHARED || current === undefined) {
		await page.goto(`/app?sample=${sample}&hooks=edits`);
		lastOpened.set(page, sample);
		await ready(page);
		return;
	}
	// Reset what the last test may have left.
	await page.keyboard.press('Escape');
	if (viewport) await page.setViewportSize(viewport);
	await page.emulateMedia({ colorScheme: null, reducedMotion: null });
	await page.evaluate(() => {
		localStorage.clear();
		sessionStorage.clear();
	});
	const chooser = page.getByRole('combobox', { name: 'Sample plan' });
	if (current === sample) {
		// A small plan to switch away to, when the same plan is asked for again.
		await chooser.selectOption(sample === 'poc-sample' ? 'upstream-tutorial' : 'poc-sample');
		await ready(page);
	}
	await chooser.selectOption(sample);
	lastOpened.set(page, sample);
	await ready(page);
	await page.evaluate(() => window.scrollTo(0, 0));
}

/** The proof that nothing of the last test is left: the text is the sample's, nothing is dirty. */
export async function assertPristine(page: Page, expectedText: string): Promise<void> {
	const text = await page.evaluate(() => {
		const h = (window as unknown as { __mainspringEdits?: { text(): string | null } })
			.__mainspringEdits;
		return h?.text() ?? null;
	});
	if (text !== null) expect(text).toBe(expectedText);
	expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
	await expect(page.getByTestId('toast')).toHaveCount(0);
}
