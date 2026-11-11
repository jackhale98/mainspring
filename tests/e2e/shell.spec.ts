// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
	test('shows the app name and engine status', async ({ page }) => {
		await page.goto('/app');
		await expect(page.getByRole('heading', { level: 1, name: 'Mainspring' })).toBeVisible();
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: not connected yet');
	});

	test('has no horizontal scroll', async ({ page }) => {
		await page.goto('/app');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`has no axe violations (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('/app');
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
				.analyze();
			expect(results.violations).toEqual([]);
		});
	}
});
