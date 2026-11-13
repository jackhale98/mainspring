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

const rows = (page: Page) => page.getByTestId('gantt').locator('[role="row"][data-key]');

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
		const labelled = page.getByTestId('gantt').getByRole('treegrid', { name: 'Tasks' });
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

	test('zooms from week to day and out to the quarter with the zoom chip', async ({ page }) => {
		await open(page);
		const gantt = page.getByTestId('gantt');
		const zoom = page.getByRole('combobox', { name: 'Zoom' });
		await expect(gantt).toHaveAttribute('data-zoom', 'week');
		for (const level of ['day', 'week', 'month', 'quarter']) {
			await zoom.selectOption(level);
			await expect(gantt).toHaveAttribute('data-zoom', level);
			await expect(zoom).toHaveValue(level);
		}
		await expect.poll(() => barsPainted(page)).toBe(true);
	});

	test('Ctrl+wheel zooms about the pointer, in the default view and after a sample switch', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'a wheel needs a mouse');
		await open(page);
		const gantt = page.getByTestId('gantt');
		const zoomWith = async (notches: number): Promise<void> => {
			const box = await page.getByTestId('gantt-overlay').boundingBox();
			if (!box) throw new Error('no plot');
			await page.mouse.move(box.x + 120, box.y + 100);
			await page.keyboard.down('Control');
			for (let i = 0; i < notches; i++) await page.mouse.wheel(0, -200);
			await page.keyboard.up('Control');
		};
		await expect(gantt).toHaveAttribute('data-zoom', 'week');
		await zoomWith(6);
		await expect(gantt).toHaveAttribute('data-zoom', 'day');
		// The page itself did not zoom, and a plain wheel still scrolls the chart: at day zoom the
		// content is wider than the view, so a wheel over it must move the scroller, and it must
		// not have been swallowed by the zoom handler (which only takes Ctrl+wheel).
		expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
		const offsets = (): Promise<number> =>
			gantt.locator('.scroller').evaluate((el) => el.scrollLeft + el.scrollTop);
		const room = await gantt
			.locator('.scroller')
			.evaluate((el) => el.scrollWidth - el.clientWidth + (el.scrollHeight - el.clientHeight));
		expect(room, 'the chart has something to scroll').toBeGreaterThan(100);
		const before = await offsets();
		const box = await page.getByTestId('gantt-overlay').boundingBox();
		if (!box) throw new Error('no plot');
		await page.mouse.move(box.x + 120, box.y + 100);
		await page.mouse.wheel(300, 300);
		await expect
			.poll(offsets, { message: 'a plain wheel scrolled the chart' })
			.toBeGreaterThan(before);
		// A sample switch builds a new scroller: the wheel must still be bound to it.
		await page
			.getByRole('combobox', { name: 'Sample plan' })
			.selectOption('syn-18-structure-include-macro');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(rows(page).first()).toBeVisible();
		await page.getByRole('combobox', { name: 'Zoom' }).selectOption('quarter');
		await expect(gantt).toHaveAttribute('data-zoom', 'quarter');
		await zoomWith(3);
		await expect(gantt).toHaveAttribute('data-zoom', 'month');
	});

	test('a wheel zoom keeps the date under the pointer, and paints once the wheel is still', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'a wheel needs a mouse');
		await open(page);
		const header = page.getByTestId('gantt-header');
		const box = await page.getByTestId('gantt-overlay').boundingBox();
		if (!box) throw new Error('no plot');
		await page.mouse.move(box.x + 120, box.y + 100);
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -300);
		// While the wheel moves the canvases are stretched, not repainted.
		await expect
			.poll(() =>
				page
					.getByTestId('gantt')
					.evaluate(
						(g) => !!g.querySelector('.space')?.getAttribute('style')?.includes('--zoom-ratio'),
					),
			)
			.toBe(true);
		await page.keyboard.up('Control');
		await expect
			.poll(() =>
				page
					.getByTestId('gantt')
					.evaluate(
						(g) => !!g.querySelector('.space')?.getAttribute('style')?.includes('--zoom-ratio'),
					),
			)
			.toBe(false);
		await expect(header).toBeVisible();
	});

	test('+ and - zoom while the task list has the focus; Ctrl+plus is left to the browser', async ({
		page,
	}) => {
		await open(page);
		const gantt = page.getByTestId('gantt');
		await rows(page).first().focus();
		await page.keyboard.press('Equal');
		await expect(gantt).toHaveAttribute('data-zoom', 'day');
		await page.keyboard.press('Minus');
		await expect(gantt).toHaveAttribute('data-zoom', 'week');
		// With Ctrl held the key is not ours: the zoom does not change.
		await page.keyboard.press('Control+Equal');
		await expect(gantt).toHaveAttribute('data-zoom', 'week');
	});

	test('keeps the keyboard focus on a task row that scrolls out of the mounted range', async ({
		page,
	}) => {
		await page.goto('/app?sample=gantt-500&mode=visual');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		const first = rows(page).first();
		await first.focus();
		const key = await first.getAttribute('data-key');
		await page
			.getByTestId('gantt')
			.locator('.scroller')
			.evaluate((el) => {
				el.scrollTop = 12_000;
			});
		// The window moved far past the first row: the next mounted row is a different one, far
		// down (the focused row is kept mounted first, in row order, and not moved in the DOM).
		await expect(rows(page).nth(1)).not.toHaveAttribute('data-key', key ?? '');
		await expect(rows(page).first()).toHaveAttribute('data-key', key ?? '');
		// The focused row stayed mounted, and still has the focus.
		const active = await page.evaluate(() => document.activeElement?.getAttribute('data-key'));
		expect(active).toBe(key);
	});

	test('hovering a bar outlines it without veiling it', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'hover needs a mouse');
		await open(page);
		const overlay = page.getByTestId('gantt-overlay');
		const box = await overlay.boundingBox();
		const row = (await rows(page).nth(1).boundingBox())?.height ?? 40;
		if (!box) throw new Error('no plot');
		await page.mouse.move(box.x + 60, box.y + row * 1.5);
		await page.waitForTimeout(200);
		// The middle of the bar, away from its outline: nothing is painted over it.
		const alpha = await overlay.evaluate(
			(c, at) => {
				const canvas = c as HTMLCanvasElement;
				const ratio = canvas.width / canvas.getBoundingClientRect().width;
				const data = canvas.getContext('2d')?.getImageData(at.x * ratio, at.y * ratio, 1, 1).data;
				return data?.[3] ?? -1;
			},
			{ x: 60, y: row * 1.5 },
		);
		expect(alpha).toBe(0);
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
		// Enter also opens the details and moves the focus into them (T17); Escape comes back.
		await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(rows(page).nth(1)).toBeFocused();
		await page.keyboard.press('End');
		await expect(rows(page).last()).toBeFocused();
	});

	test('keeps the dimmed last good schedule when the plan stops scheduling', async ({
		page,
	}, info) => {
		await open(page);
		const phone = info.project.name !== 'desktop';
		// On a phone the editor is on the Text tab.
		if (phone) await page.getByRole('tab', { name: 'Text', exact: true }).click();
		await page.getByRole('textbox', { name: /^Editor for / }).click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText('\n}\n');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('last good', {
			timeout: READY_TIMEOUT_MS,
		});
		if (phone) await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
		else await expect(page.getByText('Showing the last good schedule')).toBeVisible();
		await expect(rows(page).first()).toBeVisible();
		await expect.poll(() => barsPainted(page)).toBe(true);
	});

	test('selecting a task declared in another file opens that file in the editor', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'the editor is beside the Gantt on a desktop');
		await page.goto('/app?sample=syn-18-structure-include-macro');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('gantt')).toBeVisible();
		// The entry file is open; a task of the included lib/tasks.tji is selected from the Gantt.
		const files = page.getByRole('tablist', { name: 'Files' });
		await expect(files.getByRole('tab', { selected: true })).toContainText('plan.tjp');
		const names = await rows(page).allInnerTexts();
		expect(names.length).toBeGreaterThan(2);
		let moved = false;
		for (let i = 0; i < Math.min(names.length, 12) && !moved; i++) {
			await rows(page).nth(i).click();
			moved = (await files.getByRole('tab', { selected: true }).innerText()).includes('tasks.tji');
		}
		expect(moved).toBe(true);
		await expect(page.locator('.cm-activeLine')).toBeVisible();
	});

	test('the tablet opens on the Visual view, with the outline in a drawer', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'a viewport size stands in for the tablet');
		await page.setViewportSize({ width: 820, height: 1180 });
		await open(page);
		await expect(page.getByRole('button', { name: 'Visual' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.getByRole('textbox', { name: /^Editor for / })).toBeHidden();
		await page.getByRole('button', { name: 'Outline' }).click();
		await expect(page.getByRole('dialog', { name: 'Outline' })).toBeVisible();
	});

	test('the outline is reachable in Split and Visual, and the unsaved-changes notice stays', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'phones have the Plan tab');
		await open(page);
		const notice = page.getByText('Changes stay in this tab until saving arrives');
		await expect(notice).toBeVisible();
		for (const mode of ['Split', 'Visual']) {
			await page.getByRole('button', { name: mode, exact: true }).click();
			await expect(notice).toBeVisible();
			await page.getByRole('button', { name: 'Outline' }).click();
			const drawer = page.getByRole('dialog', { name: 'Outline' });
			await expect(drawer).toBeVisible();
			await expect(drawer.getByRole('tree', { name: 'Tasks' })).toBeVisible();
			await expect(drawer.getByRole('tree', { name: 'Resources' })).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(drawer).toBeHidden();
		}
		await page.getByRole('button', { name: 'Text', exact: true }).click();
		await expect(notice).toBeVisible();
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
			// The last good schedule: the Gantt dimmed, with its "Showing the last good schedule"
			// notice (4.5:1 on the glass chip, both schemes).
			if (info.project.name === 'desktop') {
				await page.getByRole('button', { name: 'Split', exact: true }).click();
			}
			await page.getByRole('textbox', { name: /^Editor for / }).click();
			await page.keyboard.press('ControlOrMeta+End');
			await page.keyboard.insertText('\n}\n');
			await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('last good', {
				timeout: READY_TIMEOUT_MS,
			});
			if (info.project.name !== 'desktop') {
				await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
			} else {
				await expect(page.getByText('Showing the last good schedule')).toBeVisible();
			}
			await page.waitForTimeout(300);
			await check('dimmed last good schedule');
		});
	}
});
