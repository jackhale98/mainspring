// SPDX-License-Identifier: GPL-2.0-or-later
// Accessibility audit of Text mode (T21; WCAG 2.2 AA): axe in every state that matters, in both
// colour schemes, and a keyboard-only walkthrough. States: the desktop layout, the tablet drawer,
// the phone tabs (Text, Plan) and the Docs sheet, the diagnostics popover, the completion popup, a
// marked problem with its tooltip. Phone states run in the pixel-7 project, the rest on desktop.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
const SAMPLE = 'syn-18-structure-include-macro';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function openApp(page: Page, sample = SAMPLE): Promise<void> {
	await page.goto(`/app?sample=${sample}&mode=text`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

const editor = (page: Page) => page.getByRole('textbox', { name: /^Editor for / });

async function axe(page: Page, state: string): Promise<void> {
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect(detail, state).toEqual([]);
}

/** A syntax error at the end of the file, drawn and counted. */
async function addError(page: Page): Promise<void> {
	await editor(page).click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('}\n');
	await expect(page.locator('.cm-lintRange-error').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('axe', () => {
	test.setTimeout(READY_TIMEOUT_MS + 120_000);

	for (const scheme of ['light', 'dark'] as const) {
		test(`desktop states (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.emulateMedia({ colorScheme: scheme });
			await openApp(page);
			await axe(page, 'text and outline');
			// A problem, its gutter marker and its tooltip.
			await addError(page);
			await axe(page, 'with a problem marked');
			await page.locator('.cm-lintRange-error').first().hover();
			await expect(page.locator('.cm-tooltip-lint')).toBeVisible();
			await axe(page, 'lint tooltip open');
			await page.mouse.move(0, 0);
			// The diagnostics panel (a listbox at the bottom of the editor).
			await page.keyboard.press('Control+Shift+KeyM');
			await expect(page.getByRole('listbox', { name: 'Diagnostics' })).toBeVisible();
			await axe(page, 'diagnostics panel open');
			await page.keyboard.press('Escape');
			// The completion popup.
			await page.keyboard.press('ControlOrMeta+End');
			await page.keyboard.insertText('ta');
			await page.keyboard.press('Control+Space');
			await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
			await axe(page, 'completion popup open');
			await page.keyboard.press('Escape');
			// The unlocated-problems popover: a plan with no task gives a message without a place.
			await page.keyboard.press('ControlOrMeta+a');
			await page.keyboard.insertText('project p "P" 2026-01-05 +1m\n');
			const more = page
				.getByRole('group', { name: 'Plan status' })
				.getByRole('button', { name: /without a place/ });
			await expect(more).toBeVisible({ timeout: READY_TIMEOUT_MS });
			await more.click();
			await expect(page.locator('#unlocated-popover')).toBeVisible();
			await axe(page, 'diagnostics popover open');
			await page.keyboard.press('Escape');
		});

		test(`tablet drawer (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'desktop');
			await page.emulateMedia({ colorScheme: scheme });
			await page.setViewportSize({ width: 820, height: 1100 });
			await openApp(page);
			await axe(page, 'tablet, drawer closed');
			await page.getByRole('button', { name: 'Outline' }).click();
			await expect(page.getByRole('dialog', { name: 'Outline' })).toBeVisible();
			await axe(page, 'tablet, drawer open');
		});

		test(`phone tabs and docs (${scheme})`, async ({ page }, info) => {
			test.skip(info.project.name !== 'pixel-7');
			await page.emulateMedia({ colorScheme: scheme });
			await openApp(page);
			await axe(page, 'phone, Text tab');
			await page.getByRole('tab', { name: 'Plan', exact: true }).click();
			await axe(page, 'phone, Plan tab');
			await page.getByRole('tab', { name: 'Text', exact: true }).click();
			await page.getByRole('button', { name: 'Docs' }).click();
			await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
			await axe(page, 'phone, Docs sheet');
		});
	}
});

test.describe('keyboard only', () => {
	test.setTimeout(READY_TIMEOUT_MS + 120_000);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'desktop', 'needs a hardware keyboard');
	});

	const live = (page: Page) => page.locator('.cm-tjp-announce');

	test('skip link, tab order and no keyboard trap', async ({ page }) => {
		await openApp(page);
		await page.evaluate(() => document.body.focus());
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
		// The editor is reachable by Tab and Tab leaves it again.
		await editor(page).focus();
		await page.keyboard.press('Tab');
		await expect(editor(page)).not.toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(editor(page)).toBeFocused();
		// A control that takes focus shows a ring.
		await page.getByRole('button', { name: 'Format' }).focus();
		const ring = await page.evaluate(() => {
			const s = getComputedStyle(document.activeElement as Element);
			return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
		});
		expect(ring.style).not.toBe('none');
		expect(ring.width).toBeGreaterThanOrEqual(2);
	});

	test('problems are reached and announced from the keyboard', async ({ page }) => {
		await openApp(page);
		await addError(page);
		await page.keyboard.press('ControlOrMeta+Home');
		await page.keyboard.press('F8');
		await expect(live(page)).toContainText('Error: This } has no matching {.');
		// The strip's button jumps to the same problem and announces it after the cursor left.
		await page.keyboard.press('ControlOrMeta+Home');
		await expect(live(page)).toHaveText('');
		const counts = page
			.getByRole('group', { name: 'Plan status' })
			.getByRole('button', { name: /error/ });
		await counts.focus();
		await page.keyboard.press('Enter');
		await expect(live(page)).toContainText('Error: This } has no matching {.');
		await expect(editor(page)).toBeFocused();
		// The panel lists them as a labelled listbox.
		await page.keyboard.press('Control+Shift+KeyM');
		await expect(page.getByRole('listbox', { name: 'Diagnostics' })).toBeVisible();
	});

	test('docs and format work from the keyboard and return focus', async ({ page }) => {
		await openApp(page);
		const docs = page.getByRole('button', { name: 'Docs' });
		await docs.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(docs).toBeFocused();
		await page.getByRole('button', { name: 'Format' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('.note')).not.toHaveText('');
	});
});
