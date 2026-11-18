// SPDX-License-Identifier: GPL-2.0-or-later
// The sheet's state machine (Sheet.svelte), on the phone (Pixel 7 and iPhone 14), recorded frame by
// frame (lib/sheet-rig.ts):
// - a sheet that shrinks (full to half, a drag let go lower) keeps its bottom edge where it was: no
//   gap opens between it and the tab bar while its top edge comes down;
// - closing while it slides in goes on from where it is, and does not jump to rest first;
// - the owner is told at once, so that a tap that opens the sheet again during its slide away is
//   heard, and the sheet stays;
// - what a sheet shows does not change while it slides away (the source sheet's title, the History
//   list that an accepted rewind empties).
// The pictures (SCREENSHOTS=1) are docs/phases/screenshots/phase-3/bugfix-*.png.
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { holdFinger } from './lib/finger';
import { animationsDone, appSettled, frames, panelSettled } from './lib/settle';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import {
	SPEEDS,
	nonDecreasing,
	ready,
	record,
	recorded,
	slowSheets,
	stopRecording,
} from './lib/sheet-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);
test.beforeEach(({ browserName: _b }, info) => {
	test.skip(!isTouch(info), 'the phone sheets');
});
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
const TAG = process.env['SHOT_TAG'] ? `-${process.env['SHOT_TAG']}` : '';
const shot = async (page: Page, name: string, info: TestInfo): Promise<void> => {
	if (!process.env['SCREENSHOTS']) return;
	const device = info.project.name.replace('-', '');
	await page.screenshot({ path: path.join(DIR, `bugfix-${name}-${device}${TAG}.png`) });
};

const SHEET = 'dialog.sheet[data-modal="false"]';
const rowOf = (page: Page): Locator =>
	page
		.locator('[role="treegrid"] [role="row"][data-key]')
		.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
		.first();

async function openDetails(page: Page): Promise<Locator> {
	await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
	await ready(page);
	await expect(rowOf(page)).toBeVisible();
	await appSettled(page);
	await rowOf(page).click();
	const panel = page.getByRole('dialog', { name: /Task details/ });
	if ((await panel.count()) === 0) await rowOf(page).click();
	await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
	await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
	await panelSettled(panel);
	return panel;
}

for (const { full, suffix, tag } of SPEEDS)
	test(
		`a sheet that shrinks keeps its bottom edge: no gap opens under it${suffix}`,
		{ tag: [...tag] },
		async ({ page, browserName }, info) => {
			test.skip(
				full && browserName !== 'chromium',
				'the full-speed copy is a Chromium timing check',
			);
			await page.emulateMedia({ colorScheme: 'dark' });
			const panel = await openDetails(page);
			const grab = panel.getByRole('button', { name: /Details height/ });
			await slowSheets(page, full);
			await grab.click();
			// The grow has to be over (and the slow glide needs its late first frame) before the shrink is recorded.
			await animationsDone(page);
			// Full to half: the top edge comes down; the bottom edge may go below its place, never above it.
			await record(page, SHEET);
			await grab.click();
			await frames(page, 2);
			await shot(page, 'details-shrinking', info);
			await animationsDone(page);
			const tops = await stopRecording(page);
			const { bottoms } = await recorded(page);
			const rest = bottoms.at(-1) ?? 0;
			expect(
				Math.min(...bottoms),
				'the bottom edge never rises off the tab bar',
			).toBeGreaterThanOrEqual(rest - 1);
			expect(nonDecreasing(tops), 'the top edge only comes down').toBe(true);
			const bar = await page.locator('.tabbar').boundingBox();
			expect(rest, 'it ends above the tab bar').toBeLessThanOrEqual((bar?.y ?? 9999) + 1);

			// The same for a drag from full height, let go lower down: it settles at half and the top edge
			// comes down from where the finger left it.
			await grab.click();
			await panelSettled(panel);
			const g = await grab.boundingBox();
			if (!g) throw new Error('no grabber');
			const x = g.x + g.width / 2;
			const y = g.y + g.height / 2;
			await page.mouse.move(x, y);
			await page.mouse.down();
			for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + 12 * i);
			await record(page, SHEET);
			await page.mouse.up();
			await animationsDone(page);
			await stopRecording(page);
			const dragged = (await recorded(page)).bottoms;
			const settled = dragged.at(-1) ?? 0;
			expect(Math.min(...dragged), 'a drag let go leaves no gap either').toBeGreaterThanOrEqual(
				settled - 1,
			);
		},
	);

for (const { full, suffix, tag } of SPEEDS)
	test(
		`closing while it slides in goes on from where it is${suffix}`,
		{ tag: [...tag] },
		async ({ page, browserName }) => {
			test.skip(
				full && browserName !== 'chromium',
				'the full-speed copy is a Chromium timing check',
			);
			// The shape test slows the sheets to 6 s, so that a close 250 ms into the slide in is caught on
			// every browser, headless WebKit's late first frame included (the curve is front-loaded: at 2 s a
			// sheet is nearly there). The full-speed copy (timing tier, Chromium) closes 70 ms into the
			// production 200 ms. The speed is not what the shape test checks: the edge must go on down from
			// where it is, not jump to rest first.
			const SLOW_MS = 6000;
			const closeAfter = full ? 70 : 250;
			const wait = full ? 5000 : SLOW_MS * 2;
			const panel = await openDetails(page);
			// Where it rests, open: a close cut short never gets there, so the lowest edge seen is not it.
			const rest = (await panel.boundingBox())?.y ?? 0;
			await slowSheets(page, full, SLOW_MS);
			await panel.getByRole('button', { name: 'Close' }).click();
			await expect(panel).toBeHidden({ timeout: wait });
			let midSlide = false;
			for (let attempt = 0; attempt < 4 && !midSlide; attempt++) {
				await record(page, SHEET);
				await rowOf(page).click();
				// Part way into the slide in, close it, in the page (a click from here would wait for it to stop).
				await page.evaluate(
					(after) =>
						new Promise<void>((done) => {
							const look = (): void => {
								const el = document.querySelector<HTMLDialogElement>(
									'dialog.sheet[data-modal="false"]',
								);
								const a = el?.getAnimations()[0];
								if (el?.open && a && Number(a.currentTime) > after) {
									el.querySelector<HTMLButtonElement>('button.close')?.click();
									done();
								} else requestAnimationFrame(look);
							};
							look();
						}),
					closeAfter,
				);
				await expect(panel).toBeHidden({ timeout: wait });
				const tops = await stopRecording(page);
				const seen = await recorded(page);
				const at = seen.closeAt;
				// Was it really mid slide? (Under load the close can be late: try again.) It has come into
				// view, and has a way to go still.
				const shown = (tops[at - 1] ?? 0) < (page.viewportSize()?.height ?? 0) - 5;
				midSlide = at > 0 && shown && (tops[at - 1] ?? 0) > rest + 30;
				if (!midSlide) continue;
				const before = tops[at - 1] ?? 0;
				// From the frame it began to go, the edge only goes down from where it was.
				expect(Math.min(...tops.slice(at)), 'no jump up to rest').toBeGreaterThanOrEqual(
					before - 3,
				);
				expect(nonDecreasing(tops.slice(at))).toBe(true);
			}
			expect(midSlide, 'the close landed in the slide in at least once').toBe(true);
		},
	);

test('a tap that opens it again during its slide away is not lost', async ({ page }) => {
	const panel = await openDetails(page);
	await panel.getByRole('button', { name: 'Close' }).click();
	await rowOf(page).click();
	// The slide away runs to its end; a tap that was lost leaves the sheet closed after it.
	await animationsDone(page);
	await expect(panel).toBeVisible();
	await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
	expect(
		await page.evaluate((s) => document.querySelector(s)?.hasAttribute('data-closing'), SHEET),
	).toBe(false);
});

test('the source sheet keeps its title while it slides away', async ({ page }) => {
	const panel = await openDetails(page);
	await panel.getByRole('button', { name: 'Show source' }).click();
	const sheet = page.getByRole('dialog', { name: 'Source of Research' });
	await expect(sheet).toBeVisible();
	await sheet.evaluate((el) =>
		Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
	);
	await record(page, 'dialog.sheet[data-modal="true"]');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
	await stopRecording(page);
	const seen = await recorded(page);
	expect(seen.closing, 'it was seen sliding away').toBe(true);
	expect(seen.titles.length).toBeGreaterThan(0);
	for (const t of seen.titles) expect(t).toBe('Source of Research');
});

test('the History sheet keeps its list while it slides away after a rewind', async ({ page }) => {
	await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
	await ready(page);
	await expect(page.getByTestId('gantt-overlay')).toBeVisible();
	for (const a of [
		{ type: 'size-step', task: 'design.research', steps: 1 },
		{ type: 'size-step', task: 'design.docs', steps: 1 },
	]) {
		await page.evaluate(
			(x) =>
				(
					window as unknown as { __mainspringEdits: { action(a: unknown): Promise<unknown> } }
				).__mainspringEdits.action(x),
			a,
		);
	}
	// Press and hold Undo: a finger held (real touch on Chromium, dispatched pointer events on WebKit).
	await holdFinger(page, page.getByTestId('undo'), 700);
	const sheet = page.getByRole('dialog', { name: 'History' });
	await expect(sheet).toBeVisible();
	await sheet.getByTestId('history-entry').nth(1).click();
	await page.evaluate(() => {
		const w = window as unknown as { __empty: boolean; __stop: boolean };
		w.__empty = false;
		w.__stop = false;
		const look = (): void => {
			if (document.querySelector('[data-testid="history-empty"]')) w.__empty = true;
			if (!w.__stop) requestAnimationFrame(look);
		};
		look();
	});
	await page.getByRole('button', { name: 'Undo 2' }).click();
	await expect(sheet).toBeHidden();
	const empty = await page.evaluate(() => {
		const w = window as unknown as { __empty: boolean; __stop: boolean };
		w.__stop = true;
		return w.__empty;
	});
	expect(empty, 'it never said "nothing to undo" while it slid away').toBe(false);
});

test('the motion tokens are 200 ms in and 180 ms out, and nothing with reduced motion', async ({
	page,
}) => {
	// The production speed (the specs above slow it on WebKit to see every frame): the tokens the CSS
	// and Sheet.svelte read, the duration the sheet's animations really have, and the closing one.
	const panel = await openDetails(page);
	const tokens = (): Promise<{ inMs: string; outMs: string }> =>
		page.evaluate(() => {
			const cs = getComputedStyle(document.documentElement);
			return {
				inMs: cs.getPropertyValue('--sheet-ms').trim(),
				outMs: cs.getPropertyValue('--sheet-out-ms').trim(),
			};
		});
	expect(await tokens()).toEqual({ inMs: '200', outMs: '180' });
	// The duration a closing sheet is given, read as the mark goes on (a frame loop may miss it).
	await page.evaluate((sel) => {
		const w = window as unknown as { __out: string };
		const el = document.querySelector(sel);
		if (!el) return;
		new MutationObserver(() => {
			if (el.hasAttribute('data-closing')) w.__out = getComputedStyle(el).animationDuration;
		}).observe(el, { attributes: true, attributeFilter: ['data-closing'] });
	}, SHEET);
	await panel.getByRole('button', { name: 'Close' }).click();
	await expect(panel).toBeHidden();
	expect(await page.evaluate(() => (window as unknown as { __out: string }).__out)).toBe('0.18s');
	// Opened again: the slide in is 200 ms.
	await rowOf(page).click();
	await expect(page.getByRole('dialog', { name: /Task details/ })).toBeVisible();
	expect(
		await page.evaluate((sel) => {
			const el = document.querySelector(sel);
			return el ? getComputedStyle(el).animationDuration : '';
		}, SHEET),
	).toBe('0.2s');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	expect(await tokens()).toEqual({ inMs: '0', outMs: '0' });
});
