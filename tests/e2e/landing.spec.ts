// SPDX-License-Identifier: GPL-2.0-or-later
// The public landing page at the site root (ADR-0011): it renders in light and dark, links to the
// app under the base path, marks planned features as coming, fits the screen without sideways
// scrolling and passes axe. Runs on desktop Chrome and Pixel 7 (and WebKit in CI).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SCHEMES = ['light', 'dark'] as const;

/** The colour of the page ground, as the browser computes it. */
const ground = (page: Page): Promise<string> =>
	page.evaluate(() => getComputedStyle(document.querySelector('.lp') as Element).backgroundColor);

test.describe('landing page', () => {
	for (const scheme of SCHEMES) {
		test(`renders in ${scheme}`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('./');
			await expect(page.getByRole('heading', { level: 1 })).toContainText('Version it like code');
			for (const name of [
				/Why your plan belongs in your repository/,
				/No syntax to learn/,
				/A scheduler that does the hard part/,
				/For people who already live in git/,
				/What works today/,
				/in your pocket/,
				/Questions, answered/,
				/Built on TaskJuggler/,
				/Try a plan in your browser/,
			]) {
				await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
			}
			// Enamel in light mode, a midnight dial in dark mode.
			const bg = await ground(page);
			expect(bg).toBe(scheme === 'light' ? 'rgb(248, 245, 238)' : 'rgb(13, 17, 23)');
			await expect(page.getByRole('contentinfo')).toContainText('GNU GPL, version 2 or');
		});

		test(`has no axe violations (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('./');
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect(results.violations).toEqual([]);
		});
	}

	test('the app links go to the app under the base path', async ({ page }) => {
		await page.goto('./');
		const base = new URL('./', page.url()).pathname;
		const links = page.getByRole('link', { name: /^Open (the )?app$/ });
		expect(await links.count()).toBeGreaterThanOrEqual(3);
		for (const link of await links.all()) {
			expect(await link.getAttribute('href')).toBe(`${base}app`);
		}
		await page.getByRole('link', { name: 'Open the app' }).first().click();
		await expect(page).toHaveURL(new RegExp(`${base}app/?$`));
	});

	test('the secondary hero button is an anchor to the repository section', async ({ page }) => {
		await page.goto('./');
		const link = page.getByRole('link', { name: 'Why plain text' }).last();
		await expect(link).toHaveAttribute('href', '#repo');
		await expect(page.locator('#repo')).toBeAttached();
	});

	test('does not claim that visual editing is available', async ({ page }) => {
		await page.goto('./');
		// The hero says plainly that dragging is the next step.
		await expect(page.locator('.hero')).toContainText('Drag-and-drop editing is coming next.');
		// Every drag-related point in "No syntax to learn" carries the tag, and so does the diff note.
		const syntax = page.locator('#syntax');
		await expect(syntax).toContainText('Visual editing is the next step.');
		await expect(syntax.locator('.lp-tag')).toHaveCount(3);
		await expect(page.locator('#repo .lp-tag')).toHaveCount(1);
		// "What works today" does not list it.
		const available = await page.locator('#features li.card:not(.ahead)').allInnerTexts();
		expect(available.join(' ')).not.toMatch(/drag/i);
	});

	test('marks every planned feature as coming, and nothing available as coming', async ({
		page,
	}) => {
		await page.goto('./');
		const features = page.locator('#features');
		const planned = features.locator('li.ahead');
		await expect(planned).toHaveCount(6);
		for (const card of await planned.all()) await expect(card).toContainText('Coming');
		const available = features.locator('li.card:not(.ahead)');
		await expect(available).toHaveCount(6);
		for (const card of await available.all()) await expect(card).not.toContainText('Coming');
	});

	test('links to the source and credits TaskJuggler', async ({ page }) => {
		await page.goto('./');
		const footer = page.getByRole('contentinfo');
		await expect(footer.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute(
			'href',
			'https://github.com/jackhale98/mainspring',
		);
		await expect(footer.getByRole('link', { name: 'TaskJuggler' })).toHaveAttribute(
			'href',
			'https://taskjuggler.org/',
		);
	});

	test('product mocks are images with a description, and ship no raster pictures', async ({
		page,
	}) => {
		await page.goto('./');
		await expect(page.getByRole('img', { name: /Split view/ })).toBeVisible();
		await expect(page.getByRole('img', { name: /pull request/ })).toBeVisible();
		await expect(page.getByRole('img', { name: /on a phone/ })).toBeVisible();
		expect(await page.locator('img').count()).toBe(0);
		expect(await page.locator('script').count()).toBe(0);
	});

	for (const scheme of SCHEMES) {
		test(`has no horizontal scroll (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('./');
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}

	test('shows a focus ring on keyboard focus', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'keyboard focus is checked on desktop');
		await page.goto('./');
		await page.keyboard.press('Tab'); // the skip link
		await page.keyboard.press('Tab'); // the logo
		const outline = await page.evaluate(() => {
			const style = getComputedStyle(document.activeElement as Element);
			return { width: style.outlineWidth, style: style.outlineStyle };
		});
		expect(outline).toEqual({ width: '3px', style: 'solid' });
	});

	test('respects reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('./');
		const duration = await page
			.getByRole('link', { name: 'Open the app' })
			.first()
			.evaluate((el) => getComputedStyle(el).transitionDuration);
		expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
	});
});

// Landing-page screenshots, written only when SCREENSHOTS=1 so that normal runs leave the repo alone.
test.describe('landing screenshots', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to refresh docs/phases/screenshots');

	for (const scheme of SCHEMES) {
		test(`landing-${scheme}`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('./');
			await page.evaluate(() => document.fonts.ready);
			const name = info.project.name === 'desktop' ? 'desktop' : 'phone';
			const dir = 'docs/phases/screenshots/landing';
			await page.screenshot({ path: `${dir}/${name}-${scheme}-full.png`, fullPage: true });
			await page.screenshot({ path: `${dir}/${name}-${scheme}-top.png` });
		});
	}
});
