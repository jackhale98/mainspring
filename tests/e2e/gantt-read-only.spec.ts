// SPDX-License-Identifier: GPL-2.0-or-later
// The read-only Gantt (phase-2.md T10, T11): it draws from the engine's result, selects a task on a
// click or a tap and puts the editor cursor on its declaration, zooms, collapses, never changes
// the text, and passes axe in every view and both colour schemes. Desktop Chrome and Pixel 7.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const READY_TIMEOUT_MS = 120_000;
const TUTORIAL = 'upstream-tutorial';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function open(page: Page, query = ''): Promise<void> {
	await page.goto(`/app?sample=${TUTORIAL}${query}`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByTestId('gantt')).toBeVisible();
}

const rows = (page: Page) => page.getByTestId('gantt').getByRole('treeitem');

/** Whether the overlay canvas holds painted pixels (the bars canvas sits under it). */
async function barsPainted(page: Page): Promise<boolean> {
	return page.getByTestId('gantt').evaluate((g) => {
		const canvases = [...g.querySelectorAll('.plot canvas')] as HTMLCanvasElement[];
		const bars = canvases[1];
		const ctx = bars?.getContext('2d');
		if (!bars || !ctx) return false;
		const data = ctx.getImageData(0, 0, bars.width, bars.height).data;
		for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) return true;
		return false;
	});
}

test.describe('gantt', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('draws the schedule, with the tasks listed beside it', async ({ page }, info) => {
		await open(page);
		const labelled = page.getByTestId('gantt').getByRole('tree', { name: 'Tasks' });
		await expect(labelled).toBeVisible();
		await expect(rows(page).first()).toBeVisible();
		await expect.poll(() => barsPainted(page)).toBe(true);
		// The default view differs by layout: Split on a desktop, the Gantt tab on a phone.
		if (info.project.name === 'desktop') {
			await expect(page.getByRole('button', { name: 'Split' })).toHaveAttribute(
				'aria-pressed',
				'true',
			);
			await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeVisible();
		} else {
			await expect(page.getByRole('tab', { name: 'Gantt' })).toHaveAttribute(
				'aria-selected',
				'true',
			);
		}
	});

	test('selecting a task puts the editor cursor on its declaration and leaves the text alone', async ({
		page,
	}, info) => {
		await open(page);
		const phone = info.project.name !== 'desktop';
		await rows(page).filter({ hasText: 'Specification' }).first().click();
		await expect(rows(page).filter({ hasText: 'Specification' }).first()).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByRole('status').filter({ hasText: 'Specification:' })).toBeVisible();
		if (phone) {
			// The editor is on the Text tab: a phone stays on its Gantt tab, and the cursor moved.
			await expect(page.getByRole('tab', { name: 'Gantt' })).toHaveAttribute(
				'aria-selected',
				'true',
			);
			await page.getByRole('tab', { name: 'Text', exact: true }).click();
		}
		// The tutorial's own declaration: task spec "Specification" { ... }
		await expect(page.locator('.cm-activeLine')).toContainText('Specification');
		// Selecting is not editing: the plan was not rescheduled or marked as changed.
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled');
		await expect(page.getByRole('group', { name: 'Plan status' })).not.toContainText('Scheduling');
	});

	test('a click on a bar selects its task', async ({ page }) => {
		await open(page);
		const overlay = page.getByTestId('gantt-overlay');
		const box = await overlay.boundingBox();
		if (!box) throw new Error('no plot');
		// Row 1 is Specification; the first day sits after the left padding.
		const row = (await rows(page).nth(1).boundingBox())?.height ?? 28;
		await page.mouse.click(box.x + 40, box.y + row * 1.5);
		await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
	});

	test('zooms from week to day and out to the quarter', async ({ page }) => {
		await open(page);
		const gantt = page.getByTestId('gantt');
		await expect(gantt).toHaveAttribute('data-zoom', 'week');
		await page.getByRole('button', { name: 'Zoom in' }).click();
		await expect(gantt).toHaveAttribute('data-zoom', 'day');
		await expect(page.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
		for (const level of ['week', 'month', 'quarter']) {
			await page.getByRole('button', { name: 'Zoom out' }).click();
			await expect(gantt).toHaveAttribute('data-zoom', level);
		}
		await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
		await expect.poll(() => barsPainted(page)).toBe(true);
	});

	test('collapses and expands a summary task', async ({ page }) => {
		await open(page);
		const before = await rows(page).count();
		const summary = rows(page).filter({ hasText: 'Software Development' }).first();
		await expect(summary).toHaveAttribute('aria-expanded', 'true');
		await summary.locator('.twisty').click();
		await expect(summary).toHaveAttribute('aria-expanded', 'false');
		expect(await rows(page).count()).toBeLessThan(before);
		await summary.locator('.twisty').click();
		await expect(rows(page)).toHaveCount(before);
	});

	test('the task list works by keyboard', async ({ page }) => {
		await open(page);
		await rows(page).first().focus();
		await page.keyboard.press('ArrowDown');
		await expect(rows(page).nth(1)).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('End');
		await expect(rows(page).last()).toBeFocused();
	});

	test('keeps the dimmed last good schedule when the plan stops scheduling', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'needs the editor beside the Gantt');
		await open(page);
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText('\n}\n');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('last good', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByText('Showing the last good schedule')).toBeVisible();
		await expect.poll(() => barsPainted(page)).toBe(true);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe in every view (${scheme})`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page);
			const check = async (state: string): Promise<void> => {
				const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
				const detail = r.violations.map(
					(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
				);
				expect(detail, `${state} (${scheme})`).toEqual([]);
			};
			await check('default view');
			await rows(page).nth(1).click();
			await check('a task selected');
			if (info.project.name === 'desktop') {
				await page.getByRole('button', { name: 'Visual', exact: true }).click();
				await check('gantt only');
				await page.getByRole('button', { name: 'Text', exact: true }).click();
				await check('text');
			} else {
				await page.getByRole('tab', { name: 'Text', exact: true }).click();
				await check('text tab');
			}
		});
	}
});
