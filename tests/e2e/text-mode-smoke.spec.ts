// SPDX-License-Identifier: GPL-2.0-or-later
// Text mode smoke test (phase-1.md 8, T15): the app loads a sample, a typed edit reschedules it,
// a syntax error is marked, and the page has no axe violations in either colour scheme. The full
// end-to-end suite is T20's (tests/e2e/text-mode.spec.ts).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
const SAMPLE = 'syn-18-structure-include-macro';

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
const finish = (page: Page) => page.getByRole('group', { name: 'Plan status' }).locator('time');

/** The Plan panel on a phone, where the outline lives; a no-op on wider layouts. */
async function showOutline(page: Page): Promise<void> {
	const tab = page.getByRole('tab', { name: 'Plan', exact: true });
	if (await tab.isVisible()) await tab.click();
}

test.describe('text mode', () => {
	// A cold engine boot is several seconds; CI is slower still.
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('opens a sample and shows its finish date and outline', async ({ page }) => {
		await openApp(page);
		await expect(page.getByRole('heading', { level: 1, name: 'Mainspring' })).toBeVisible();
		await expect(finish(page)).toContainText('2026');
		await showOutline(page);
		const tree = page.getByRole('tree', { name: 'Tasks' });
		await expect(tree.getByRole('treeitem', { name: /Rollout/ })).toBeVisible();
		await expect(page.getByRole('tree', { name: 'Resources' }).getByRole('treeitem')).toHaveCount(
			2,
		);
	});

	test('an edit reschedules the plan and updates the outline', async ({ page }) => {
		await openApp(page);
		const before = await finish(page).textContent();
		await editor(page).click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText(
			'task late "Late work" {\n  effort 15d\n  depends rollout.go\n  allocate lena\n}\n',
		);
		// Typing waits 300 ms, then the scheduler runs again.
		await expect(finish(page)).not.toHaveText(before ?? '', { timeout: READY_TIMEOUT_MS });
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('later');
		await showOutline(page);
		await expect(
			page.getByRole('tree', { name: 'Tasks' }).getByRole('treeitem', { name: /Late work/ }),
		).toBeVisible();
	});

	test('a syntax error is marked in the text and counted', async ({ page }, info) => {
		await openApp(page);
		await editor(page).click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText('}\n');
		await expect(page.locator('.cm-lintRange-error').first()).toBeVisible({ timeout: 10_000 });
		const strip = page.getByRole('group', { name: 'Plan status' });
		// The counts are a button in the strip; a phone has the top bar's status button, whose name
		// says them (the strip's own group is hidden there, with no controls).
		if (info.project.name === 'desktop') {
			await expect(strip.getByRole('button', { name: /error/ })).toBeVisible();
		} else {
			await expect(page.getByTestId('status-button')).toHaveAccessibleName(/1 error/);
		}
		// The last good finish stays visible and is labelled.
		await expect(strip).toContainText('last good', { timeout: READY_TIMEOUT_MS });
		await page.keyboard.press('ControlOrMeta+z');
		await expect(page.locator('.cm-lintRange-error')).toHaveCount(0, { timeout: 10_000 });
		await expect(strip).toContainText('No problems', { timeout: READY_TIMEOUT_MS });
	});

	test('selecting an outline item puts the cursor on its declaration', async ({
		page,
		hasTouch,
	}) => {
		await openApp(page);
		await showOutline(page);
		await page
			.getByRole('tree', { name: 'Tasks' })
			.getByRole('treeitem', { name: /Rollout/ })
			.click();
		await expect(page.locator('.cm-activeLine')).toBeVisible();
		await expect(page.locator('.cm-activeLine')).toContainText('task rollout');
		// A mouse or keyboard user gets the editor; on touch, focus would raise the keyboard.
		if (hasTouch) await expect(editor(page)).not.toBeFocused();
		else await expect(editor(page)).toBeFocused();
	});

	test('selecting items in other files scrolls the declaration into view', async ({
		page,
		viewport,
	}) => {
		test.skip(viewport?.width !== 1280, 'needs the outline beside a short editor (desktop)');
		await page.setViewportSize({ width: 1280, height: 380 });
		await openApp(page);
		const tree = page.getByRole('tree', { name: 'Tasks' });
		const visibleActiveLine = () =>
			page.evaluate(() => {
				const scroller = document.querySelector('.cm-scroller')?.getBoundingClientRect();
				const line = document.querySelector('.cm-activeLine')?.getBoundingClientRect();
				return (
					!!scroller && !!line && line.top >= scroller.top - 1 && line.bottom <= scroller.bottom + 1
				);
			});
		// `prep` is declared in lib/tasks.tji; `go` is far down plan.tjp, and the window is short.
		await tree.getByRole('treeitem', { name: /Vorbereitung/ }).click();
		await expect(page.getByRole('tab', { name: 'lib/tasks.tji' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.locator('.cm-activeLine')).toContainText('task prep');
		await tree.getByRole('treeitem', { name: /^Go/ }).click();
		await expect(page.locator('.cm-activeLine')).toContainText('task go');
		// A scroll restore after the reveal used to leave the declaration off screen.
		await page.waitForTimeout(300);
		expect(await visibleActiveLine()).toBe(true);
	});

	test('the strip announces a settled run once, in a hidden live region', async ({
		page,
	}, info) => {
		await openApp(page);
		const strip = page.getByRole('group', { name: 'Plan status' });
		await expect(strip).not.toHaveAttribute('role', 'status');
		if (info.project.name === 'desktop') {
			// The visible strip holds buttons, so the live region is outside it.
			await expect(strip.locator('[aria-live]')).toHaveCount(0);
		} else {
			// A phone's group is hidden and has no control: the live region is inside it.
			await expect(strip.locator('[aria-live]')).toHaveCount(1);
			await expect(strip.locator('button, a, input, [tabindex]')).toHaveCount(0);
		}
		const live = page.locator('[role="status"][aria-live="polite"][aria-atomic="true"]');
		await expect(live).toContainText('Scheduled');
		await expect(live).toContainText('Finish');
		await expect(live).toContainText('No problems');
	});

	test('the outline is an ARIA tree with arrow keys', async ({ page, viewport }) => {
		test.skip((viewport?.width ?? 0) < 1024, 'the outline sits beside the editor on desktop');
		await openApp(page);
		const tree = page.getByRole('tree', { name: 'Tasks' });
		const items = tree.getByRole('treeitem');
		await items.first().focus();
		await page.keyboard.press('ArrowDown');
		const rollout = tree.getByRole('treeitem', { name: /Rollout/ });
		await expect(rollout).toBeFocused();
		await expect(rollout).toHaveAttribute('aria-expanded', 'true');
		await expect(rollout).toHaveAttribute('aria-level', '1');
		await page.keyboard.press('ArrowRight'); // into the first child
		await expect(tree.getByRole('treeitem', { name: /Ready/ })).toBeFocused();
		await page.keyboard.press('ArrowLeft'); // back to the parent
		await expect(rollout).toBeFocused();
		await page.keyboard.press('ArrowLeft'); // collapse
		await expect(rollout).toHaveAttribute('aria-expanded', 'false');
		await expect(items).toHaveCount(2);
		await page.keyboard.press('Enter');
		await expect(page.locator('.cm-activeLine')).toContainText('task rollout');
	});

	test('the outline opens in a drawer on a tablet', async ({ page, viewport }) => {
		test.skip(viewport?.width !== 1280, 'resized below, from the desktop project');
		await page.setViewportSize({ width: 820, height: 1100 });
		await openApp(page);
		await expect(page.getByRole('tree', { name: 'Tasks' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Outline' }).click();
		const drawer = page.getByRole('dialog', { name: 'Outline' });
		await expect(drawer).toBeVisible();
		await drawer.getByRole('treeitem', { name: /Rollout/ }).click();
		await expect(drawer).toBeHidden();
		await expect(page.locator('.cm-activeLine')).toContainText('task rollout');
		// The dialog closes first, then the editor takes the focus (a modal makes it inert).
		await expect(editor(page)).toBeFocused();
	});

	test('the docs button shows the keyword at the cursor', async ({ page }) => {
		await openApp(page);
		await editor(page).click();
		// Click the first characters of the `project` line: the keyword.
		await page.locator('.cm-line', { hasText: /^project / }).click({ position: { x: 4, y: 4 } });
		await page.getByRole('button', { name: 'Docs' }).click();
		const sheet = page.getByRole('dialog', { name: 'Documentation' });
		await expect(sheet).toBeVisible();
		// On screen, not only rendered: Safari once placed it below the viewport.
		await expect(sheet.getByRole('heading', { name: 'Documentation' })).toBeInViewport();
		await expect(sheet).toBeInViewport({ ratio: 0.9 });
		await expect(sheet).toContainText('project');
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
	});

	test('has no horizontal scroll', async ({ page }) => {
		await openApp(page);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`has no axe violations (${scheme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: scheme });
			await openApp(page);
			const run = () =>
				new AxeBuilder({ page })
					.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
					.analyze();
			expect((await run()).violations, 'text panel').toEqual([]);
			await showOutline(page);
			expect((await run()).violations, 'plan panel').toEqual([]);
		});
	}
});
