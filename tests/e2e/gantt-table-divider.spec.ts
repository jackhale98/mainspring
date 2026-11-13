// SPDX-License-Identifier: GPL-2.0-or-later
// The divider between the Gantt's task table and its chart (polish item 10; ADR-0008 amendment
// 2026-11-13): it moves the table pane by pointer and by keyboard and remembers its place per
// sample; the table keeps natural column widths and scrolls sideways inside its pane without
// moving the chart, with the name column frozen at the pane's left and a focused cell scrolled
// into view; rows stay level with the bars through fast vertical scrolling; a phone has the name
// column and no divider; axe passes with the divider and a scrolled table. Desktop Chrome and
// Pixel 7 (phone), with SCREENSHOTS=1 also the polish-10-*.png pictures.
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const FEDORA = 'upstream-fedora-20';

async function open(page: Page, sample = FEDORA): Promise<void> {
	await page.goto(`/app?sample=${sample}&mode=visual`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
	await page.waitForTimeout(500);
}

const divider = (page: Page) => page.getByRole('separator', { name: /task table/i });
const names = (page: Page) => page.getByTestId('gantt').locator('.names');
const widthOf = async (page: Page): Promise<number> =>
	(await names(page).boundingBox())?.width ?? 0;
const valueOf = async (page: Page): Promise<number> =>
	Number(await divider(page).getAttribute('aria-valuenow'));

test.describe('the table divider', () => {
	test.setTimeout(READY_TIMEOUT_MS + 90_000);

	test('moves the table pane by pointer and by keyboard, and is remembered per sample', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		const start = await widthOf(page);
		const handle = await divider(page).boundingBox();
		expect(handle).not.toBeNull();
		// 44 px is the coarse target; a fine pointer has 24 px: the box itself is the visible gap.
		await expect(divider(page)).toHaveAttribute('aria-orientation', 'vertical');

		// A drag 150 px to the left narrows the table by about that much and widens the chart.
		const plotBefore = (await page.getByTestId('gantt-overlay').boundingBox())?.width ?? 0;
		if (handle) {
			const x = handle.x + handle.width / 2;
			const y = handle.y + handle.height / 2;
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x - 150, y, { steps: 6 });
			await page.mouse.up();
		}
		await page.waitForTimeout(300);
		const dragged = await widthOf(page);
		expect(start - dragged).toBeGreaterThan(130);
		expect(start - dragged).toBeLessThan(170);
		expect(
			((await page.getByTestId('gantt-overlay').boundingBox())?.width ?? 0) - plotBefore,
		).toBeGreaterThan(100);

		// The keys: arrows, Shift for a bigger step, Home and End for the limits.
		const at = await valueOf(page);
		await divider(page).focus();
		await page.keyboard.press('ArrowRight');
		expect(await valueOf(page)).toBe(at + 2);
		await page.keyboard.press('Shift+ArrowLeft');
		expect(await valueOf(page)).toBe(at + 2 - 10);
		await page.keyboard.press('Home');
		expect(await valueOf(page)).toBe(20);
		await page.keyboard.press('End');
		expect(await valueOf(page)).toBe(80);
		await page.keyboard.press('ArrowLeft');
		const kept = await widthOf(page);

		// Reloaded, the same plan has the same divider; another plan has its own (the default).
		await page.reload();
		await expect(page.locator('[role="row"][data-key]').first()).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		await page.waitForTimeout(500);
		expect(Math.abs((await widthOf(page)) - kept)).toBeLessThanOrEqual(1);
		await open(page, 'upstream-tutorial');
		expect(Math.abs((await widthOf(page)) - kept)).toBeGreaterThan(20);
	});

	test('the default shows Task, Start, End and Effort at natural widths', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		const pane = await names(page).boundingBox();
		const rowBox = page.locator('[role="row"][data-key]').first();
		const cellBox = async (col: string) => rowBox.locator(`[data-col="${col}"]`).boundingBox();
		for (const col of ['start', 'end', 'effort']) {
			const b = await cellBox(col);
			expect(b?.width ?? 0).toBeGreaterThan(90);
			expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(
				(pane?.x ?? 0) + (pane?.width ?? 0) + 1,
			);
		}
		// The chart keeps at least 40% of the width.
		const gantt = await page.getByTestId('gantt').boundingBox();
		const chart = await page.getByTestId('gantt-overlay').boundingBox();
		expect((chart?.width ?? 0) / (gantt?.width ?? 1)).toBeGreaterThan(0.4);
		// The rest are drawn too, at their natural widths, past the pane's edge.
		for (const col of ['people', 'float', 'critical', 'status']) {
			expect((await cellBox(col))?.width ?? 0, col).toBeGreaterThan(90);
		}
	});

	test('the table scrolls inside its pane, the chart does not move, and the name stays', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		const scroller = page.getByTestId('gantt').locator('.scroller');
		const body = page.getByTestId('gantt-treegrid').locator('.body-scroll');
		const firstRow = page.locator('[role="row"][data-key]').first();
		const nameCell = firstRow.locator('[data-col="name"]');
		const state = async () => ({
			chartX: await scroller.evaluate((el) => el.scrollLeft),
			plotX: (await page.getByTestId('gantt-overlay').boundingBox())?.x ?? 0,
			name: await nameCell.boundingBox(),
			start: await firstRow.locator('[data-col="start"]').boundingBox(),
			head: await page
				.getByTestId('gantt-treegrid')
				.locator('[data-col-head="start"]')
				.boundingBox(),
			paneLeft: (await names(page).boundingBox())?.x ?? 0,
			table: await body.evaluate((el) => ({
				left: el.scrollLeft,
				max: el.scrollWidth - el.clientWidth,
			})),
		});
		const before = await state();
		expect(before.table.max).toBeGreaterThan(100);
		await body.evaluate((el) => (el.scrollLeft = 120));
		await page.waitForTimeout(300);
		const after = await state();
		expect(after.table.left).toBe(120);
		// The columns moved with the table's scroll, and the header with them.
		expect((before.start?.x ?? 0) - (after.start?.x ?? 0)).toBeCloseTo(120, 0);
		expect((before.head?.x ?? 0) - (after.head?.x ?? 0)).toBeCloseTo(120, 0);
		// The name column stayed at the pane's left, the chart where it was.
		expect(after.name?.x).toBeCloseTo(before.name?.x ?? 0, 0);
		expect(after.chartX).toBe(before.chartX);
		expect(after.plotX).toBeCloseTo(before.plotX, 0);

		// The pane's own bar is there, and dragging its thumb scrolls the table (not the chart).
		const bar = page.getByTestId('gantt-table-scrollbar');
		await expect(bar).toBeVisible();
		const thumb = await bar.locator('.thumb').boundingBox();
		if (thumb) {
			await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
			await page.mouse.down();
			await page.mouse.move(thumb.x + thumb.width / 2 + 30, thumb.y + thumb.height / 2, {
				steps: 4,
			});
			await page.mouse.up();
		}
		expect((await state()).table.left).toBeGreaterThan(120);
		expect((await state()).chartX).toBe(before.chartX);
	});

	test('a cell that gets the keyboard focus is scrolled into view', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		const firstRow = page.locator('[role="row"][data-key]').first();
		await page.locator('[tabindex="0"][data-key]').first().focus();
		// Into the cells and along them to the last column, which the default hides past the pane.
		// One key at a time: a move is finished (scrolled, focused) before the next key reads it.
		const cols = ['name', 'start', 'end', 'effort', 'people', 'float', 'critical', 'status'];
		for (const col of cols) {
			await page.keyboard.press('ArrowRight');
			await expect(firstRow.locator(`[data-col="${col}"]`)).toBeFocused();
		}
		const status = firstRow.locator('[data-col="status"]');
		const [cell, pane, name] = await Promise.all([
			status.boundingBox(),
			names(page).boundingBox(),
			firstRow.locator('[data-col="name"]').boundingBox(),
		]);
		expect((cell?.x ?? 0) + (cell?.width ?? 0)).toBeLessThanOrEqual(
			(pane?.x ?? 0) + (pane?.width ?? 0) + 1,
		);
		expect(cell?.x ?? 0).toBeGreaterThanOrEqual((name?.x ?? 0) + (name?.width ?? 0) - 1);
		// And back to the start: Home goes to the name, the next cell is scrolled back into view.
		await page.keyboard.press('Home');
		await expect(firstRow.locator('[data-col="name"]')).toBeFocused();
		await page.keyboard.press('ArrowRight');
		const start = firstRow.locator('[data-col="start"]');
		await expect(start).toBeFocused();
		const back = await start.boundingBox();
		expect(back?.x ?? 0).toBeGreaterThanOrEqual((name?.x ?? 0) + (name?.width ?? 0) - 1);
	});

	test('rows stay level with the bars through fast vertical scrolling', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page, 'gantt-500');
		await page.evaluate(() => {
			(window as unknown as { __drift: number[] }).__drift = [];
			const q = (s: string): HTMLElement => {
				const el = document.querySelector<HTMLElement>(s);
				if (!el) throw new Error(s);
				return el;
			};
			const plot = q('[data-testid="gantt"] .plot');
			const tick = (): void => {
				const top = plot.getBoundingClientRect().top;
				const rows = document.querySelectorAll<HTMLElement>(
					'[data-testid="gantt-treegrid"] [role="row"][data-key]',
				);
				let worst = 0;
				for (const r of rows) {
					const index = Number(r.getAttribute('aria-rowindex')) - 2;
					const h = r.getBoundingClientRect().height;
					worst = Math.max(worst, Math.abs(r.getBoundingClientRect().top - top - index * h));
				}
				(window as unknown as { __drift: number[] }).__drift.push(worst);
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const box = await page.getByTestId('gantt-overlay').boundingBox();
		if (!box) throw new Error('no chart');
		await page.mouse.move(box.x + box.width / 2, box.y + 200);
		// Hard flings down, then back up, over the table and over the chart.
		for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 700);
		await page.mouse.move(box.x - 150, box.y + 200);
		for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -900);
		await page.waitForTimeout(300);
		const drift = await page.evaluate(() => (window as unknown as { __drift: number[] }).__drift);
		expect(drift.length).toBeGreaterThan(30);
		expect(Math.max(...drift)).toBeLessThanOrEqual(0.5);
	});

	test('has no axe violations with the divider, a scrolled table and a focused cell', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		await page
			.getByTestId('gantt-treegrid')
			.locator('.body-scroll')
			.evaluate((el) => (el.scrollLeft = 150));
		await page.locator('[tabindex="0"][data-key]').first().focus();
		await page.keyboard.press('ArrowRight');
		const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
		expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual(
			[],
		);
	});

	test('a phone has the name column alone and no divider', async ({ page }, info) => {
		test.skip(info.project.name !== 'pixel-7');
		await open(page);
		await expect(divider(page)).toHaveCount(0);
		const first = page.locator('[role="row"][data-key]').first();
		expect((await first.locator('[data-col="name"]').boundingBox())?.width ?? 0).toBeGreaterThan(
			100,
		);
		for (const col of ['start', 'end', 'effort']) {
			expect(
				(await first.locator(`[data-col="${col}"]`).boundingBox())?.width ?? 0,
			).toBeLessThanOrEqual(1);
		}
		await expect(page.getByTestId('gantt-table-scrollbar')).toHaveCount(0);
	});

	// Pictures for the polish list: the default, and the divider moved both ways.
	for (const scheme of ['light', 'dark'] as const) {
		test(`polish-10 pictures (${scheme})`, async ({ page }, info) => {
			test.skip(!process.env['SCREENSHOTS']);
			await page.emulateMedia({ colorScheme: scheme });
			const shot = (name: string) => page.screenshot({ path: path.join(DIR, name) });
			if (info.project.name === 'pixel-7') {
				await open(page);
				await shot(`polish-10-pixel7-${scheme}.png`);
				return;
			}
			await page.setViewportSize({ width: 1440, height: 860 });
			await open(page);
			await shot(`polish-10-desktop-default-${scheme}.png`);
			await divider(page).focus();
			for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
			await page.waitForTimeout(300);
			await shot(`polish-10-desktop-narrow-${scheme}.png`);
			for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
			await page.waitForTimeout(300);
			await shot(`polish-10-desktop-wide-${scheme}.png`);
			await page.setViewportSize({ width: 820, height: 1180 });
			await page.evaluate(() => localStorage.clear());
			await page.reload();
			await expect(page.locator('[role="row"][data-key]').first()).toBeVisible({
				timeout: READY_TIMEOUT_MS,
			});
			await page.waitForTimeout(900);
			await shot(`polish-10-tablet-${scheme}.png`);
		});
	}
});
