// SPDX-License-Identifier: GPL-2.0-or-later
// The edges of the gestures (phase-2.md 7.2; T16 review): Escape in the middle of a drag, a pinch
// during a drag, the touch rules (slop, the 350 ms long-press, native panning), a person dropped
// where no bar is on screen or on a container, a burst of key presses that a result interrupts,
// the details sheet's peek while a link is made, and the keyboard shortcuts' labels. Each asserts
// the text, which only the gesture's own edit may change. Desktop Chrome and Pixel 7.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch, minute } from './lib/gantt-rig';

const SHOTS = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const CONTAINER_MESSAGE =
	'People are booked on subtasks. Drop them on a subtask, or assign them in the text.';

test.describe('the edges of the gestures', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T16)');
	});

	test('Escape in the middle of a drag cancels it: no edit, no toast', async ({ page }, info) => {
		test.skip(isTouch(info), 'a keyboard and a mouse');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.select('design.research');
		const to = { x: await rig.x(minute('2026-03-06', 17)), y: b.endEdge.y };
		await rig.drag(b.endEdge, to, {
			pause: async () => {
				await page.keyboard.press('Escape');
				await page.waitForTimeout(150);
			},
		});
		await page.waitForTimeout(800);
		expect(await rig.text()).toBe(before);
		await expect(rig.toast).toHaveCount(0);
	});

	test('a second finger during a drag ends it and pinches the chart: no edit', async ({
		page,
	}, info) => {
		test.skip(!isTouch(info), 'a finger');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.select('design.research');
		const perDay = (): Promise<number> =>
			page.evaluate(() => {
				const h = (window as unknown as { __mainspringGantt: { x(m: number): number } })
					.__mainspringGantt;
				return h.x(1440) - h.x(0);
			});
		const zoom0 = await perDay();
		await rig.touches('touchStart', [b.endEdge]);
		for (let i = 1; i <= 6; i++) {
			await rig.touches('touchMove', [{ x: b.endEdge.x + i * 8, y: b.endEdge.y }]);
		}
		const f1 = { x: b.endEdge.x + 48, y: b.endEdge.y };
		const f2 = { x: f1.x - 60, y: f1.y + 80 };
		await rig.touches('touchStart', [f1, f2]);
		for (let i = 1; i <= 10; i++) {
			await rig.touches('touchMove', [
				{ x: f1.x + i * 10, y: f1.y },
				{ x: f2.x - i * 10, y: f2.y + i * 4 },
			]);
		}
		await rig.touches('touchEnd', []);
		await page.waitForTimeout(1500);
		expect(await rig.text()).toBe(before);
		await expect(rig.toast).toHaveCount(0);
		expect(await perDay()).toBeGreaterThan(zoom0);
	});

	test('touch rules: a swipe or a quick move pans; a hold of 350 ms then a drag lifts', async ({
		page,
	}, info) => {
		test.skip(!isTouch(info), 'a finger');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const ask = page.getByTestId('move-question');
		const swipe = async (
			b: { x: number; y: number },
			o: { first?: number; hold: number; steps: number },
		): Promise<void> => {
			await rig.touches('touchStart', [b]);
			if (o.first) await rig.touches('touchMove', [{ x: b.x + o.first, y: b.y }]);
			await page.waitForTimeout(o.hold);
			for (let i = 1; i <= o.steps; i++) {
				await rig.touches('touchMove', [{ x: b.x + (o.first ?? 0) - i * 12, y: b.y }]);
			}
			await rig.touches('touchEnd', []);
			await page.waitForTimeout(500);
		};
		// An unselected bar, pressed and swiped at once: the chart scrolls, nothing lifts.
		let bar = await rig.bar('design.sketch');
		let at = await rig.scrollPos();
		await swipe(bar.body, { hold: 0, steps: 10 });
		await expect.poll(async () => (await rig.scrollPos())[0]).toBeGreaterThan(at[0]);
		await expect(ask).not.toBeVisible();
		// Held for 250 ms, under the timer, then moved: still a pan.
		bar = await rig.bar('design.sketch');
		at = await rig.scrollPos();
		await swipe(bar.body, { hold: 250, steps: 10 });
		await expect.poll(async () => (await rig.scrollPos())[0]).toBeGreaterThan(at[0]);
		await expect(ask).not.toBeVisible();
		// Moved 12 px (over the 8 px slop) before the timer: a pan, and no lift after the timer.
		bar = await rig.bar('design.sketch');
		at = await rig.scrollPos();
		await swipe(bar.body, { first: -12, hold: 450, steps: 8 });
		await expect.poll(async () => (await rig.scrollPos())[0]).toBeGreaterThan(at[0]);
		await expect(ask).not.toBeVisible();
		// Moved 6 px (inside the slop), held to 450 ms, then dragged: the bar lifts and moves, and
		// the move question is asked (nothing is stored yet). Cancel changes nothing.
		bar = await rig.bar('design.sketch');
		at = await rig.scrollPos();
		await rig.touches('touchStart', [bar.body]);
		await rig.touches('touchMove', [{ x: bar.body.x + 6, y: bar.body.y }]);
		await page.waitForTimeout(450);
		for (let i = 1; i <= 8; i++) {
			await rig.touches('touchMove', [{ x: bar.body.x + 6 + i * 8, y: bar.body.y }]);
		}
		await rig.touches('touchEnd', []);
		await expect(ask).toBeVisible();
		expect(await rig.scrollPos()).toEqual(at);
		await ask.getByRole('button', { name: 'Cancel' }).click();
		await page.waitForTimeout(300);
		expect(await rig.text()).toBe(before);
	});

	test('a long-press on a task written with macros opens its source', async ({ page }, info) => {
		test.skip(!isTouch(info), 'a finger');
		const rig = await Rig.open(page, info);
		const b = await rig.bar('build.check_unit');
		await rig.touches('touchStart', [b.body]);
		await page.waitForTimeout(500);
		await rig.touches('touchEnd', []);
		await expect(
			page
				.getByRole('dialog')
				.filter({ hasText: /check_unit/ })
				.first(),
		).toBeVisible();
	});

	test('a person dropped on a container is refused with the message; the key does the same', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'the palette is for a mouse');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const design = await rig.bar('design');
		const chip = await page.locator('[data-person="dev3"]').boundingBox();
		if (!chip) throw new Error('no chip');
		// Near the start of the summary bar, which is wider than the chart.
		const onDesign = { x: design.box.x + 24, y: design.box.y + design.box.h / 2 };
		await rig.drag({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, onDesign, {
			pause: async () => {
				await expect(page.getByTestId('gantt-overlay')).toBeVisible();
				if (process.env['SCREENSHOTS'] === '1') {
					await page.screenshot({
						path: path.join(SHOTS, 'gesture-people-container-desktop-light.png'),
					});
				}
			},
		});
		await expect(rig.toast.last()).toContainText(CONTAINER_MESSAGE);
		expect(await rig.text()).toBe(before);
		// The key path: a container selected, Enter on a person.
		await rig.row('task:design').locator('.label').click();
		await page.locator('[data-person="dev3"]').focus();
		await page.keyboard.press('Enter');
		await expect(rig.toast.last()).toContainText(CONTAINER_MESSAGE);
		expect(await rig.text()).toBe(before);
	});

	test('a person released over the time header, where a bar is hidden, assigns nothing', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'the palette is for a mouse');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		// Scroll the rows up under the sticky header: Research's bar is behind it.
		await page.evaluate(() => {
			(document.querySelector('[data-testid="gantt"] .scroller') as HTMLElement).scrollTop = 70;
		});
		await page.waitForTimeout(300);
		const b = await rig.peek('design.research');
		const scroller = await page.getByTestId('gantt').locator('.scroller').boundingBox();
		if (!scroller) throw new Error('no chart');
		// The bar's own place is above the first visible row: inside the header's band.
		expect(b.box.y).toBeLessThan(scroller.y + 64);
		const chip = await page.locator('[data-person="dev3"]').boundingBox();
		if (!chip) throw new Error('no chip');
		await rig.drag(
			{ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 },
			{ x: b.box.x + 10, y: b.box.y + 6 },
		);
		await page.waitForTimeout(800);
		expect(await rig.text()).toBe(before);
	});

	test('a burst of Alt+Right keeps counting from the schedule it began on', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		await page.addInitScript(() => localStorage.setItem('mainspring.gantt.move', 'start'));
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const rev = await rig.revision();
		await rig.row('task:design.research').focus();
		for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowRight');
		await rig.patched(
			before.replace(
				'    effort 3d\n    allocate dev1\n',
				'    start 2026-03-05\n    effort 3d\n    allocate dev1\n',
			),
		);
		await rig.rescheduled(rev);
		// One more press, with the engine's answer to the first three already in: four working
		// days from Monday 2 March, not four from where the answer put the task.
		await page.keyboard.press('Alt+ArrowRight');
		await rig.patched(
			before.replace(
				'    effort 3d\n    allocate dev1\n',
				'    start 2026-03-06\n    effort 3d\n    allocate dev1\n',
			),
		);
	});

	test('a link made on a phone shrinks the details sheet to a peek, and gives its height back', async ({
		page,
	}, info) => {
		test.skip(!isTouch(info), 'a phone sheet');
		const rig = await Rig.open(page, info, 'week');
		await rig.select('design.research');
		const sheet = page.locator('dialog.sheet[data-detent]');
		await expect(sheet).toHaveAttribute('data-detent', 'half');
		const from = await rig.peek('design.research');
		await rig.tap(from.dot);
		await expect(sheet).toHaveAttribute('data-detent', 'peek');
		await page.waitForTimeout(400);
		// Most of the chart is in reach: more rows than the half sheet leaves.
		const rows = await page.evaluate(() => {
			const s = document.querySelector('[data-testid="gantt"] .scroller') as HTMLElement;
			const top = s.getBoundingClientRect().top + 70;
			const sheetTop =
				document.querySelector('dialog.sheet[open]')?.getBoundingClientRect().top ?? innerHeight;
			return [...document.querySelectorAll('[role="row"][data-key]')].filter((e) => {
				const r = e.getBoundingClientRect();
				return r.top >= top && r.bottom <= sheetTop;
			}).length;
		});
		expect(rows).toBeGreaterThanOrEqual(8);
		if (process.env['SCREENSHOTS'] === '1') {
			await page.screenshot({ path: path.join(SHOTS, 'gesture-link-peek-pixel-7-light.png') });
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.waitForTimeout(250);
			await page.screenshot({ path: path.join(SHOTS, 'gesture-link-peek-pixel-7-dark.png') });
			await page.emulateMedia({ colorScheme: 'light' });
		}
		await page
			.getByTestId('link-banner')
			.getByRole('button', { name: /Cancel/ })
			.click();
		await expect(sheet).toHaveAttribute('data-detent', 'half');
	});

	test('the keys are labelled: aria-keyshortcuts on the grid and the menu, and a list of them', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		await expect(page.getByRole('treegrid')).toHaveAttribute(
			'aria-keyshortcuts',
			/Alt\+Shift\+ArrowRight.*Control\+Alt\+ArrowRight|Control\+Alt\+ArrowRight.*Alt\+Shift\+ArrowRight/,
		);
		await expect(page.getByRole('treegrid')).toHaveAccessibleDescription(
			/Shortcuts: .*Alt\+Shift\+→/,
		);
		await rig.row('task:design.research').locator('.label').click();
		await page.getByTestId('row-menu').click();
		await expect(page.getByRole('menuitem', { name: /^Indent/ })).toHaveAttribute(
			'aria-keyshortcuts',
			'Alt+Shift+ArrowRight',
		);
		await expect(page.getByRole('menuitem', { name: /^Longer by one unit/ })).toHaveAttribute(
			'aria-keyshortcuts',
			'Control+Alt+ArrowRight',
		);
		await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
		const list = page.getByTestId('shortcuts');
		await expect(list).toBeVisible();
		await expect(list).toContainText('Alt+Shift+→ / ←');
		await page.keyboard.press('Escape');
		await expect(list).not.toBeVisible();
	});

	test('the row menu does what the keys do: a task one level in', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		// Hotfix is Support's only child: it cannot go further in, and the item says so.
		await rig.row('task:support.hotfix').locator('.label').click();
		await page.getByTestId('row-menu').click();
		await expect(page.getByRole('menuitem', { name: /^Indent/ })).toBeDisabled();
		await page.keyboard.press('Escape');
		expect(await rig.text()).toBe(before);
	});
});
