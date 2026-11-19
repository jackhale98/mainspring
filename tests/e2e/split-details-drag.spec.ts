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
import {
	animationsDone,
	appSettled,
	frames as drawn,
	ganttSettled,
	settledValue,
} from './lib/settle';

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
	await appSettled(page);
}

/**
 * The details panel and the divider hold still: the panel's mode and box and the divider's value are
 * the same for several frames, and no animation runs. What follows a release or a lost capture.
 */
async function panelHolds(page: Page): Promise<void> {
	await settledValue(
		page,
		() => {
			const aside = document.querySelector<HTMLElement>('aside[data-testid="inspector"]');
			const b = aside?.getBoundingClientRect();
			const sep = document.querySelector('[role="separator"][data-axis="col"]');
			return [
				aside ? (aside.hasAttribute('data-drawer') ? 'drawer' : 'docked') : 'none',
				b ? [b.x, b.y, b.width, b.height].map((v) => v.toFixed(1)).join(',') : '-',
				sep?.getAttribute('aria-valuenow'),
			].join('|');
		},
		6,
	);
	await animationsDone(page, 2);
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
	await panelHolds(page);
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

	test('a narrow Split opens with no drawer, and Text to Split does not open one', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		// Here the chart has under 640 px beside the panel: a rail, and the drawer only when asked for.
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/app?sample=gantt-manipulation&mode=split');
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.locator('[role="row"][data-key]').first()).toBeVisible();
		await appSettled(page);
		await ganttSettled(page);
		await expect(page.getByRole('button', { name: 'Show details' })).toBeVisible();
		await expect(page.locator('aside[data-testid="inspector"]')).toHaveCount(0);

		await page.getByRole('button', { name: 'Text', exact: true }).click();
		await expect(page.locator('#panel-gantt')).toBeHidden();
		await page.getByRole('button', { name: 'Split', exact: true }).click();
		await expect(page.locator('#panel-gantt')).toBeVisible();
		// A positive sync point for the "no drawer" check: the layout holds still, then some frames.
		await ganttSettled(page);
		await drawn(page, 8);
		await expect(page.getByRole('button', { name: 'Show details' })).toBeVisible();
		await expect(page.locator('aside[data-testid="inspector"]')).toHaveCount(0);
	});

	test('a collapsed panel stays collapsed across the threshold', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		// Select a task first: a click sets the drawer's own flag, which must not matter once collapsed.
		await page
			.locator('[role="treegrid"] [role="row"][data-key]')
			.filter({ hasText: 'Research' })
			.first()
			.click();
		await page.getByRole('button', { name: 'Hide details' }).click();
		await expect(page.locator('aside[data-testid="inspector"]')).toHaveCount(0);
		for (const dx of [360, -360]) {
			const run = await drag(page, dx);
			expect(
				run.all.every((f) => f.mode === 'none'),
				`closed on every frame (${dx})`,
			).toBe(true);
		}
		await expect(page.getByRole('button', { name: 'Show details' })).toBeVisible();
	});

	test('a key during a drag keeps the mode held, and a lost pointer capture ends the drag', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page);
		await expect(details(page)).toBeVisible();
		await divider(page).focus();
		const h = await divider(page).boundingBox();
		if (!h) throw new Error('no divider');
		const y = h.y + 200;
		let x = h.x + h.width / 2;
		await startSampling(page);
		await divider(page).evaluate((el) =>
			el.addEventListener(
				'pointerdown',
				(e) => ((window as unknown as { __pid: number }).__pid = (e as PointerEvent).pointerId),
			),
		);
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let i = 0; i < 30; i++) {
			x += 8;
			await page.mouse.move(x, y);
			await frame(page);
			// Part-way, a key: it moves the divider, it does not end the drag and its hold.
			if (i === 15) await page.keyboard.press('ArrowRight');
		}
		await frame(page);
		const held = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
		expect(held.every((f) => f.open)).toBe(true);
		expect(changes(held), 'no change while the pointer is down').toBe(0);
		// The capture is lost (the pointer is gone, the element was taken away): the drag ends there.
		await divider(page).evaluate((el) =>
			el.releasePointerCapture((window as unknown as { __pid: number }).__pid),
		);
		// (Chrome delivers the lost capture with the next pointer event.)
		await page.mouse.move(x + 2, y);
		await expect(page.locator('aside[data-testid="inspector"]')).toHaveAttribute(
			'data-drawer',
			/.*/,
		);
		await panelHolds(page);
		const after = await stopSampling(page);
		expect(after.every((f) => f.open)).toBe(true);
		expect(changes(after), 'settles once').toBe(1);
		expect(after.at(-1)?.mode).toBe('drawer');
		await page.mouse.up();
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
