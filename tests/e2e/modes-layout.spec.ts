// SPDX-License-Identifier: GPL-2.0-or-later
// Modes and layouts (phase-2.md 9.1, 9.2; ADR-0008 #3): the mode switch, Cmd or Ctrl and 1, 2, 3,
// the mode and the divider remembered per sample, the draggable and keyboard divider, the tablet's
// stacked Split, the theme toggle, and the CodeMirror chunk that a Visual-first load never fetches.
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
const A = 'upstream-tutorial';
const B = 'poc-sample';

async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
}

const pressed = (page: Page, name: string) =>
	page.getByRole('button', { name, exact: true }).and(page.locator('[aria-pressed="true"]'));

test.describe('modes', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('Ctrl or Cmd and 1, 2, 3 switch the mode, and the mode is remembered per sample', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await page.goto(`/app?sample=${A}`);
		await ready(page);
		await expect(pressed(page, 'Split')).toBeVisible();
		await page.keyboard.press('ControlOrMeta+3');
		await expect(pressed(page, 'Visual')).toBeVisible();
		await page.keyboard.press('ControlOrMeta+1');
		await expect(pressed(page, 'Text')).toBeVisible();
		await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
		// Also from inside the editor.
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		await page.keyboard.press('ControlOrMeta+3');
		await expect(pressed(page, 'Visual')).toBeVisible();
		await page.keyboard.press('ControlOrMeta+1');

		// Remembered for this sample on a reload (no ?mode in the link) ...
		await page.goto(`/app?sample=${A}`);
		await ready(page);
		await expect(pressed(page, 'Text')).toBeVisible();
		// ... and not for another sample, which starts from the layout's default.
		await page.getByRole('combobox', { name: 'Sample plan' }).selectOption(B);
		await expect(pressed(page, 'Split')).toBeVisible();
		await page.keyboard.press('ControlOrMeta+3');
		await page.getByRole('combobox', { name: 'Sample plan' }).selectOption(A);
		await expect(pressed(page, 'Text')).toBeVisible();
		await page.getByRole('combobox', { name: 'Sample plan' }).selectOption(B);
		await expect(pressed(page, 'Visual')).toBeVisible();
	});

	test('a Visual-first load does not fetch CodeMirror; the first editor does', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		const chunks: string[] = [];
		page.on('request', (r) => {
			if (/\/_astro\/editor-controller\.[^/]+\.js/.test(r.url())) chunks.push(r.url());
		});
		await page.goto(`/app?sample=${A}&mode=visual`);
		await ready(page);
		await expect(page.getByTestId('gantt')).toBeVisible();
		expect(chunks).toEqual([]);
		await page.getByRole('button', { name: 'Text', exact: true }).click();
		await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
		expect(chunks.length).toBe(1);
	});

	test('the divider moves by keyboard and by pointer, and is remembered', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await page.goto(`/app?sample=${A}&mode=split`);
		await ready(page);
		const divider = page.getByRole('separator');
		await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
		await expect(divider).toHaveAttribute('aria-valuenow', '40');
		await divider.focus();
		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		await expect(divider).toHaveAttribute('aria-valuenow', '50');
		await page.keyboard.press('Shift+ArrowLeft');
		await expect(divider).toHaveAttribute('aria-valuenow', '40');
		await page.keyboard.press('End');
		await expect(divider).toHaveAttribute('aria-valuenow', '80');
		await page.keyboard.press('Home');
		await expect(divider).toHaveAttribute('aria-valuenow', '20');

		// A drag with the pointer.
		const box = await divider.boundingBox();
		if (!box) throw new Error('no divider');
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + box.width / 2, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 260, y, { steps: 6 });
		await page.mouse.up();
		const dragged = Number(await divider.getAttribute('aria-valuenow'));
		expect(dragged).toBeGreaterThan(30);

		// Remembered per sample.
		await page.goto(`/app?sample=${A}&mode=split`);
		await ready(page);
		await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', String(dragged));
	});

	test('a tablet stacks Split with the Gantt above the editor and a horizontal divider', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await page.setViewportSize({ width: 820, height: 1180 });
		await page.goto(`/app?sample=${A}&mode=split`);
		await ready(page);
		const divider = page.getByRole('separator');
		await expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
		const chart = await page.getByTestId('gantt').boundingBox();
		const editor = await page.getByRole('textbox', { name: /^Editor for / }).boundingBox();
		const bar = await divider.boundingBox();
		if (!chart || !editor || !bar) throw new Error('boxes');
		expect(chart.y).toBeLessThan(bar.y);
		expect(bar.y).toBeLessThan(editor.y);
		// The Gantt's share grows with Down.
		await divider.focus();
		await page.keyboard.press('ArrowDown');
		await expect(divider).toHaveAttribute('aria-valuenow', '52');
		const after = await page.getByTestId('gantt').boundingBox();
		expect(after?.height ?? 0).toBeGreaterThan(chart.height);
	});

	test('the theme toggle cycles, is remembered, and the page follows it', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto(`/app?sample=${A}&mode=visual`);
		await ready(page);
		const html = page.locator('html');
		const toggle = page.getByTestId('theme-toggle');
		await expect(html).toHaveAttribute('data-theme', 'light');
		await expect(html).toHaveAttribute('data-theme-pref', 'system');
		await toggle.click(); // light
		await toggle.click(); // dark
		await expect(html).toHaveAttribute('data-theme', 'dark');
		await expect(html).toHaveAttribute('data-theme-pref', 'dark');
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(bg).toBe('rgb(8, 11, 16)');
		await page.reload();
		await expect(html).toHaveAttribute('data-theme', 'dark');
		await toggle.click(); // system again, which is light here
		await expect(html).toHaveAttribute('data-theme-pref', 'system');
		await expect(html).toHaveAttribute('data-theme', 'light');
		// The system choice follows the system.
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(html).toHaveAttribute('data-theme', 'dark');
	});

	test('a phone remembers the tab as the mode', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await page.goto(`/app?sample=${A}`);
		await ready(page);
		await expect(page.getByRole('tab', { name: 'Gantt', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await page.getByRole('tab', { name: 'Text', exact: true }).click();
		await page.goto(`/app?sample=${A}`);
		await ready(page);
		await expect(page.getByRole('tab', { name: 'Text', exact: true })).toHaveAttribute(
			'aria-selected',
			'true',
		);
	});
});
