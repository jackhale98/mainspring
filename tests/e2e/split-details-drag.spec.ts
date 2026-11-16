// SPDX-License-Identifier: GPL-2.0-or-later
// Polish item 14: dragging the Split divider with the task details open must not make the panel
// open and close. The details dock beside the chart only while the chart keeps its room; the
// divider's ratio is a share of a width that docking changes, so a drag across that threshold
// used to dock and undock the panel on every frame. Now the panel's mode is held during the drag
// and settles once on release, and an open panel that loses its room becomes the open drawer.
// Desktop only; with SCREENSHOTS=1 also the polish-14-*.png pictures.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

async function open(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto('/app?sample=gantt-manipulation&mode=split');
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
	await page.waitForTimeout(500);
}

const divider = (page: Page) => page.locator('[role="separator"][data-axis="col"]').first();
const details = (page: Page) => page.getByRole('complementary', { name: 'Details' });

interface Frame {
	/** The details are on screen: the docked panel or the drawer. */
	readonly open: boolean;
	readonly mode: 'docked' | 'drawer' | 'none';
	readonly ratio: number;
}

/** Samples the panel's state on every animation frame, until `stop` is called. */
async function startSampling(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __frames: Frame[]; __stop: boolean };
		w.__frames = [];
		w.__stop = false;
		const tick = (): void => {
			const aside = document.querySelector<HTMLElement>('aside[data-testid="inspector"]');
			const box = aside?.getBoundingClientRect();
			const sep = document.querySelector('[role="separator"][data-axis="col"]');
			w.__frames.push({
				open: !!aside && !!box && box.width > 200 && box.height > 100,
				mode: !aside ? 'none' : aside.hasAttribute('data-drawer') ? 'drawer' : 'docked',
				ratio: Number(sep?.getAttribute('aria-valuenow')),
			});
			if (!w.__stop) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

async function stopSampling(page: Page): Promise<Frame[]> {
	return page.evaluate(() => {
		const w = window as unknown as { __frames: Frame[]; __stop: boolean };
		w.__stop = true;
		return w.__frames;
	});
}

const frame = (page: Page) =>
	page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Drags the divider by `dx` px in small steps, one frame apart, and returns the frames of the drag and after it. */
async function drag(
	page: Page,
	dx: number,
): Promise<{ during: Frame[]; after: Frame[]; all: Frame[] }> {
	const h = await divider(page).boundingBox();
	if (!h) throw new Error('no divider');
	const y = h.y + 200;
	let x = h.x + h.width / 2;
	await startSampling(page);
	await frame(page);
	await page.mouse.move(x, y);
	await page.mouse.down();
	const steps = Math.ceil(Math.abs(dx) / 8);
	for (let i = 0; i < steps; i++) {
		x += Math.sign(dx) * 8;
		await page.mouse.move(x, y);
		await frame(page);
	}
	await frame(page);
	const mark = await page.evaluate(
		() => (window as unknown as { __frames: Frame[] }).__frames.length,
	);
	await page.mouse.up();
	await page.waitForTimeout(400);
	const all = await stopSampling(page);
	return { during: all.slice(0, mark), after: all.slice(mark), all };
}

const changes = (frames: readonly Frame[]): number =>
	frames.filter((f, i) => i > 0 && f.mode !== frames[i - 1]?.mode).length;

test.describe('the details while the Split divider moves', () => {
	test.setTimeout(READY_TIMEOUT_MS + 90_000);

	for (const selected of [false, true]) {
		test(`stay open and change mode once across the threshold (${selected ? 'a task selected' : 'nothing selected'})`, async ({
			page,
		}, info) => {
			test.skip(info.project.name !== 'desktop');
			await open(page);
			if (selected) {
				await page
					.locator('[role="treegrid"] [role="row"][data-key]')
					.filter({ hasText: 'Research' })
					.first()
					.click();
			}
			await expect(details(page)).toBeVisible();
			await expect(page.locator('aside[data-testid="inspector"]')).not.toHaveAttribute(
				'data-drawer',
			);

			// Right: the chart's share shrinks until the panel has no room to dock.
			const right = await drag(page, 360);
			expect(right.all.length).toBeGreaterThan(30);
			expect(
				right.all.every((f) => f.open),
				'open on every frame, drag right',
			).toBe(true);
			// The mode is held while the pointer is down, and changes once after it.
			expect(changes(right.during), 'no change during the drag').toBe(0);
			expect(changes(right.all), 'at most one change').toBeLessThanOrEqual(1);
			expect(right.all.at(-1)?.mode).toBe('drawer');
			await expect(details(page)).toBeVisible();

			// Left again: the room is back and the panel docks, once.
			const left = await drag(page, -360);
			expect(
				left.all.every((f) => f.open),
				'open on every frame, drag left',
			).toBe(true);
			expect(changes(left.during), 'no change during the drag').toBe(0);
			expect(changes(left.all), 'at most one change').toBeLessThanOrEqual(1);
			expect(left.all.at(-1)?.mode).toBe('docked');
		});
	}

	test('keyboard steps across the threshold keep the panel open, one change each way', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		await expect(details(page)).toBeVisible();
		await divider(page).focus();
		await startSampling(page);
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('Shift+ArrowRight');
			await frame(page);
		}
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('Shift+ArrowLeft');
			await frame(page);
		}
		const frames = await stopSampling(page);
		expect(frames.every((f) => f.open)).toBe(true);
		expect(changes(frames)).toBeLessThanOrEqual(2);
	});

	// Pictures for the polish list: Split with the details open after a divider drag (device scale 2).
	test.describe('polish-14 pictures', () => {
		test.use({ deviceScaleFactor: 2 });
		for (const scheme of ['light', 'dark'] as const) {
			test(`polish-14 pictures (${scheme})`, async ({ page }, info) => {
				test.skip(!process.env['SCREENSHOTS'] || info.project.name !== 'desktop');
				await page.emulateMedia({ colorScheme: scheme });
				await open(page);
				await page
					.locator('[role="treegrid"] [role="row"][data-key]')
					.filter({ hasText: 'Research' })
					.first()
					.click();
				await expect(details(page)).toBeVisible();
				// A drag that stays within the room: the panel stays docked beside the chart.
				await drag(page, 56);
				await expect(page.locator('aside[data-testid="inspector"]')).not.toHaveAttribute(
					'data-drawer',
				);
				await page.screenshot({ path: path.join(DIR, `polish-14-split-docked-${scheme}.png`) });
				// A drag that leaves no room: the same panel, open as a drawer over the chart.
				await drag(page, 240);
				await expect(page.locator('aside[data-testid="inspector"]')).toHaveAttribute(
					'data-drawer',
					'',
				);
				await page.screenshot({ path: path.join(DIR, `polish-14-split-drawer-${scheme}.png`) });
			});
		}
	});
});
