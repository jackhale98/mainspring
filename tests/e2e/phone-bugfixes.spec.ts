// SPDX-License-Identifier: GPL-2.0-or-later
// Six phone bugs found on a real iPhone in dark mode (2026-11-17), each with the test that would have
// caught it. Sheets slide in and out on `transform` only (the animation's keyframes are checked, the
// smoothness itself cannot be); the docs sheet waits for a touch keyboard to go before it opens (the
// keyboard is stood in for by a stubbed visual viewport) and the editor has its focus and cursor
// back after it; the Team segment starts under its tabs whatever segment came before; the row menu
// fits the viewport; and a chart that is hidden while the browser answers every custom property
// with "" (what WebKit does for a `display: none` panel) is not painted in the fallback colours when
// it comes back, in either scheme. The pictures (SCREENSHOTS=1) are
// docs/phases/screenshots/phase-3/bugfix-*.png, SHOT_TAG=before for those of the build before.
// The sheet's own state machine (closing mid slide, reopening, content that must not change while it
// goes, shrinking) is in sheet-states.spec.ts.
//
// Over 400 lines on purpose: one describe per bug, each with its device skips and its own setup
// (a plan, a stubbed keyboard, a blind `getComputedStyle`), and the six share nothing else; the
// recorder and the checks they use are in lib/sheet-rig.ts.
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { openCalendar, day, showDay, tapDay } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { openResources, selectRow } from './lib/resources-rig';
import {
	SPEEDS,
	nonDecreasing,
	nonIncreasing,
	record,
	recorded,
	settleMs,
	slowSheets,
	ready,
	steps,
	stopRecording,
} from './lib/sheet-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);
const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');
const TAG = process.env['SHOT_TAG'] ? `-${process.env['SHOT_TAG']}` : '';
/** The device in a picture's file name: the project's name without its hyphen (iphone14, pixel7). */
const device = (info: TestInfo): string => info.project.name.replace('-', '');
const shot = async (page: Page, name: string, info: TestInfo): Promise<void> => {
	if (!process.env['SCREENSHOTS']) return;
	await page.screenshot({ path: path.join(DIR, `bugfix-${name}-${device(info)}${TAG}.png`) });
};

test.describe('1. the task details sheet slides to full height and away', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info), 'the phone and tablet sheet');
	});
	const SHEET = 'dialog.sheet[data-modal="false"]';

	async function openDetails(page: Page): Promise<Locator> {
		await page.goto('/app?sample=gantt-manipulation&mode=visual&hooks=edits');
		await ready(page);
		const rowOf = page
			.locator('[role="treegrid"] [role="row"][data-key]')
			.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
			.first();
		await expect(rowOf).toBeVisible();
		await page.waitForTimeout(500);
		await rowOf.click();
		const panel = page.getByRole('dialog', { name: /Task details/ });
		if ((await panel.count()) === 0) await rowOf.click();
		await expect(panel.getByLabel('Name', { exact: true })).toHaveValue('Research');
		await expect(panel).toBeInViewport({ ratio: 1 });
		await page.waitForTimeout(500);
		return panel;
	}

	for (const { full, suffix, tag } of SPEEDS)
		test(
			`going to full height glides on transform; closing slides down before it goes${suffix}`,
			{ tag: [...tag] },
			async ({ page, browserName }, info) => {
				test.skip(
					full && browserName !== 'chromium',
					'the full-speed copy is a Chromium timing check',
				);
				await page.emulateMedia({ colorScheme: 'dark' });
				const panel = await openDetails(page);
				await shot(page, 'details-half', info);
				const grab = panel.getByRole('button', { name: /Details height/ });
				await slowSheets(page, full);

				await record(page, SHEET);
				await grab.click();
				await page.waitForTimeout(settleMs(full));
				const grow = await stopRecording(page);
				expect((await recorded(page)).props, 'only transform moves').toEqual(['transform']);
				// Pinned at the foot, the top edge travels up from where it was to its new place, in many frames.
				expect(steps(grow), 'the top edge moved in more than a jump').toBeGreaterThan(3);
				expect(nonIncreasing(grow)).toBe(true);
				const fullTop = grow.at(-1) ?? 0;
				expect(fullTop).toBeLessThan((grow[0] ?? 0) - 100);
				await shot(page, 'details-full', info);

				// Back to half, the same way (down).
				await record(page, SHEET);
				await grab.click();
				await page.waitForTimeout(settleMs(full));
				const shrink = await stopRecording(page);
				expect(steps(shrink)).toBeGreaterThan(3);
				expect(nonDecreasing(shrink)).toBe(true);

				// Closing: still there, marked, with a transform animation running; then gone.
				await record(page, SHEET);
				await panel.getByRole('button', { name: 'Close' }).click();
				await page.waitForTimeout(150);
				await shot(page, 'details-closing', info);
				await page.waitForTimeout(settleMs(full));
				const away = await stopRecording(page);
				const seen = await recorded(page);
				expect(seen.closing, 'the sheet was on screen, marked closing, while it slid away').toBe(
					true,
				);
				expect(seen.props).toContain('transform');
				expect(steps(away), 'it slid down in more than a jump').toBeGreaterThan(2);
				expect(nonDecreasing(away)).toBe(true);
				await expect
					.poll(() =>
						page.evaluate((s) => document.querySelector<HTMLDialogElement>(s)?.open, SHEET),
					)
					.toBe(false);
			},
		);

	test('Escape slides it away too, and the sheet opens again afterwards', async ({ page }) => {
		const panel = await openDetails(page);
		// A key goes to the focus, which the sheet leaves on the row until the person goes in.
		await panel.getByRole('button', { name: /Details height/ }).focus();
		await slowSheets(page);
		await record(page, SHEET);
		await page.keyboard.press('Escape');
		await expect(panel).toBeHidden();
		await stopRecording(page);
		expect((await recorded(page)).closing, 'it slid away first').toBe(true);
		await page
			.locator('[role="treegrid"] [role="row"][data-key]')
			.filter({ has: page.locator('[data-col="name"] .label', { hasText: 'Research' }) })
			.first()
			.click();
		await expect(page.getByRole('dialog', { name: /Task details/ })).toBeVisible();
	});

	test('the dependency picker works in the sheet, and the sheet still slides away with it open', async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		const panel = await openDetails(page);
		await page.getByRole('button', { name: 'Add a task this one waits for' }).click();
		const search = page.getByRole('combobox', { name: 'Find a task this one waits for' });
		await search.tap();
		await expect(search).toBeFocused();
		await expect(page.getByTestId('depends-picker').getByRole('option').first()).toBeVisible();
		// A keyboard is up over the sheet's search box: the sheet closes without opening or blurring anything else.
		await slowSheets(page);
		await record(page, SHEET);
		await panel.getByRole('button', { name: 'Close' }).click();
		await expect(panel).toBeHidden();
		await stopRecording(page);
		expect((await recorded(page)).closing, 'it slid away with the picker open').toBe(true);
	});

	test('with reduced motion nothing slides: it closes at once', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const panel = await openDetails(page);
		await panel.getByRole('button', { name: 'Close' }).click();
		const state = await page.evaluate((sel) => {
			const el = document.querySelector<HTMLDialogElement>(sel);
			return { open: el?.open, closing: el?.hasAttribute('data-closing') };
		}, SHEET);
		expect(state).toEqual({ open: false, closing: false });
	});
});

test.describe('2. the docs sheet opens at its final place', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info), 'the phone sheet');
	});

	test('it waits for the touch keyboard to go, then slides up from below, never down from above', async ({
		page,
	}, info) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/app?sample=syn-18-structure-include-macro&mode=text');
		await ready(page);
		await page.locator('.cm-line', { hasText: /^project / }).click({ position: { x: 4, y: 4 } });
		const cursor = (): Promise<string> =>
			page.evaluate(() => {
				const sel = getSelection();
				return `${sel?.anchorNode?.textContent ?? ''}@${sel?.anchorOffset ?? -1}`;
			});
		const cursorBefore = await cursor();
		expect(cursorBefore).toContain('project');
		// A keyboard: the visual viewport is 300 px shorter than the page, which a fixed sheet ignores.
		await page.evaluate(() => {
			const vv = Object.assign(new EventTarget(), {
				height: window.innerHeight - 300,
				scale: 1,
				width: window.innerWidth,
				offsetTop: 0,
				offsetLeft: 0,
			});
			Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
			(window as unknown as { __vv: typeof vv }).__vv = vv;
		});
		const SHEET = 'dialog.sheet[data-modal="true"] .inner';
		// Safari on iPhone does not focus a button that is tapped: the editor keeps the focus (and the keyboard).
		await page.evaluate(() =>
			document.addEventListener('mousedown', (e) => e.preventDefault(), true),
		);
		await slowSheets(page);
		await record(page, SHEET);
		await page.getByRole('button', { name: 'Docs' }).click();
		// The editor lets go of the focus (so the keyboard goes) as the press is handled; on a loaded
		// machine that is later than a fixed wait, so it is waited for, and the sheet is not open yet.
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.closest('.cm-editor') !== null), {
				message: 'the editor let go of the focus, so the keyboard goes',
				intervals: [20],
			})
			.toBe(false);
		expect(
			await page.evaluate(
				() => document.querySelector('dialog.sheet[data-modal="true"][open]') !== null,
			),
			'not open over the keyboard',
		).toBeFalsy();
		// The keyboard is gone.
		await page.evaluate(() => {
			const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv;
			vv.height = window.innerHeight;
			vv.dispatchEvent(new Event('resize'));
		});
		await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
		await page.waitForTimeout(settleMs());
		const tops = await stopRecording(page);
		const finalTop = tops.at(-1) ?? 0;
		// Never above its final place, and it came up from below it. (In WebKit it was: the dialog scrolled
		// to show the field that showModal() focuses, which is below it while the panel slides in, and
		// the panel appeared 75 px above the screen's top, then fell back. Sheet.svelte clips it now.)
		expect(Math.min(...tops)).toBeGreaterThanOrEqual(finalTop - 1);
		expect(nonIncreasing(tops)).toBe(true);
		expect((await recorded(page)).props).not.toContain('top');
		await shot(page, 'docs', info);

		// Closed again, the editor has the focus and the cursor back exactly where it was.
		await page
			.getByRole('dialog', { name: 'Documentation' })
			.getByRole('button', { name: 'Close' })
			.tap();
		await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeHidden();
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.closest('.cm-editor') !== null))
			.toBe(true);
		expect(await cursor()).toBe(cursorBefore);
	});

	test('without a keyboard it opens at once and only moves up', async ({ page }) => {
		await page.goto('/app?sample=syn-18-structure-include-macro&mode=text');
		await ready(page);
		await page.locator('.cm-line', { hasText: /^project / }).click({ position: { x: 4, y: 4 } });
		await slowSheets(page);
		await record(page, 'dialog.sheet[data-modal="true"] .inner');
		await page.getByRole('button', { name: 'Docs' }).click();
		await expect(page.getByRole('dialog', { name: 'Documentation' })).toBeVisible();
		await page.waitForTimeout(settleMs());
		const tops = await stopRecording(page);
		expect(nonIncreasing(tops)).toBe(true);
		const view = page.viewportSize()?.height ?? 0;
		expect(tops.at(-1) ?? 0).toBeLessThan(view);
	});
});

test.describe('3. the calendar day details slide up and down', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info), 'the phone bottom sheet');
	});
	// The day details are the shared non-modal bottom Sheet (the dialog moves), as the task details are.
	const SHEET = 'dialog.sheet[data-modal="false"][open]';

	for (const { full, suffix, tag } of SPEEDS)
		test(
			`a second tap on a day slides the sheet up on transform; closing slides it down${suffix}`,
			{ tag: [...tag] },
			async ({ page, browserName }, info) => {
				test.skip(
					full && browserName !== 'chromium',
					'the full-speed copy is a Chromium timing check',
				);
				await page.emulateMedia({ colorScheme: 'dark' });
				await openCalendar(page, info);
				const d = await showDay(page, '2026-11-26');
				await tapDay(page, info, d);
				await expect(day(page, '2026-11-26')).toHaveAttribute('aria-selected', 'true');
				await slowSheets(page, full);
				await record(page, SHEET);
				await tapDay(page, info, d);
				await expect(page.getByTestId('cal-details')).toBeVisible();
				await page.waitForTimeout(settleMs(full));
				const up = await stopRecording(page);
				expect((await recorded(page)).props, 'only transform moves').toEqual(['transform']);
				expect(steps(up), 'it slid up in more than a jump').toBeGreaterThan(3);
				expect(nonIncreasing(up)).toBe(true);
				await shot(page, 'calendar-sheet', info);

				await record(page, SHEET);
				await page.locator(SHEET).getByRole('button', { name: 'Close' }).tap();
				await expect(page.locator(SHEET)).toHaveCount(1);
				await page.waitForTimeout(settleMs(full));
				const down = await stopRecording(page);
				expect(steps(down), 'it slid down in more than a jump').toBeGreaterThan(2);
				expect(nonDecreasing(down)).toBe(true);
				await expect(page.locator(SHEET)).toHaveCount(0);
			},
		);
});

test.describe('4. the row menu fits the screen', () => {
	test('a finger gets a bottom sheet of whole, one-line items with no key hints', async ({
		page,
	}, info) => {
		test.skip(!isTouch(info), 'a finger');
		await openResources(page, info, { scheme: 'dark' });
		await selectRow(page, info, 'jack');
		await page.getByTestId('resource-menu').tap();
		const menu = page.getByTestId('resource-menu-sheet');
		await expect(menu).toBeVisible();
		await page.waitForTimeout(600);
		await shot(page, 'row-menu', info);
		const view = page.viewportSize();
		const items = menu.getByRole('menuitem');
		expect(await items.count()).toBeGreaterThanOrEqual(6);
		for (const item of await items.all()) {
			const box = await item.boundingBox();
			expect(box).not.toBeNull();
			if (!box || !view) continue;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
			expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
			expect(box.height, 'one line, a 44 px target').toBeGreaterThanOrEqual(44);
			expect(box.height).toBeLessThan(64);
			expect(await item.locator('kbd').isVisible(), 'no keyboard hint on a finger').toBe(false);
		}
		// Choosing an item runs it once the sheet is gone: Rename puts the name in a field.
		await menu.getByRole('menuitem', { name: 'Rename' }).tap();
		await expect(page.getByTestId('resource-menu-sheet')).toHaveCount(0);
		await expect(page.locator('[data-testid="resource-table"] input').first()).toBeFocused();
	});

	test('the sheet menu has its arrow keys, Home and End, and says it is a dialog', async ({
		page,
	}, info) => {
		test.skip(!isTouch(info), 'a finger');
		await openResources(page, info, { scheme: 'dark' });
		await selectRow(page, info, 'jack');
		const trigger = page.getByTestId('resource-menu');
		await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
		await trigger.tap();
		await expect(trigger).not.toHaveAttribute('aria-controls', /.+/);
		const items = page.getByTestId('resource-menu-sheet').getByRole('menuitem');
		await expect(items.first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(items.nth(1)).toBeFocused();
		await page.keyboard.press('End');
		await expect(items.last()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(items.first()).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(items.last()).toBeFocused();
		await page.keyboard.press('Home');
		await expect(items.first()).toBeFocused();
		// Escape is the dialog's: it slides away and gives the focus back.
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('resource-menu-sheet')).toHaveCount(0);
		await expect(trigger).toBeFocused();
	});

	test('the popover goes when something under it scrolls', async ({ page }, info) => {
		test.skip(isTouch(info), 'a mouse');
		await openResources(page, info);
		await selectRow(page, info, 'jack');
		await page.getByTestId('resource-menu').click();
		const pop = page.getByRole('menu', { name: 'Row actions' });
		await expect(pop).toBeVisible();
		// A scroll of the menu's own list does not close it, and neither does one that leaves its
		// button where it was (a late scroll event from elsewhere: the list is still beside it).
		await pop.evaluate((el) => el.dispatchEvent(new Event('scroll')));
		await expect(pop).toBeVisible();
		await page.evaluate(() => document.body.dispatchEvent(new Event('scroll')));
		await expect(pop).toBeVisible();
		// A scroll of the view under it that moves the button takes the list's place away.
		await page.getByTestId('resource-menu').evaluate((el) => {
			el.style.transform = 'translateY(40px)';
			document.body.dispatchEvent(new Event('scroll'));
		});
		await expect(pop).toBeHidden();
	});

	test('a mouse gets a popover inside the viewport, with the hints, flipping up when low', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'a mouse');
		await page.setViewportSize({ width: 1280, height: 420 });
		await openResources(page, info);
		await selectRow(page, info, 'jack');
		await page.getByTestId('resource-menu').click();
		const pop = page.getByRole('menu', { name: 'Row actions' });
		await expect(pop).toBeVisible();
		const box = await pop.boundingBox();
		const view = page.viewportSize();
		expect(box && view).toBeTruthy();
		if (box && view) {
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.y + box.height).toBeLessThanOrEqual(view.height);
			expect(box.x + box.width).toBeLessThanOrEqual(view.width);
		}
		await expect(pop.getByRole('menuitem').first().locator('kbd')).toBeVisible();
		for (const item of await pop.getByRole('menuitem').all()) {
			const b = await item.boundingBox();
			expect(b?.height ?? 0, 'labels stay on one line').toBeLessThan(48);
		}
		await page.keyboard.press('Escape');
		await expect(pop).toBeHidden();
		await expect(page.getByTestId('resource-menu')).toBeFocused();
	});
});

test.describe('5. each People segment starts right under the tabs', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info), 'the phone segments');
	});
	const seg = (page: Page, name: string): Promise<void> =>
		page.getByRole('tab', { name, exact: true }).tap();

	/** How far below the top of the People area the table's toolbar starts. */
	const gap = (page: Page): Promise<number> =>
		page.evaluate(() => {
			const host = document.querySelector('[data-testid="people-host"]');
			const first = document.querySelector('[data-testid="team-view"] [data-testid="add-group"]');
			if (!host || !first) return Number.NaN;
			return first.getBoundingClientRect().top - host.getBoundingClientRect().top;
		});

	for (const order of [
		['Load', 'Lanes', 'Team'],
		['Lanes', 'Team'],
		['Team', 'Lanes', 'Team'],
		['Calendar', 'Lanes', 'Calendar', 'Team'],
	]) {
		test(`${order.join(' to ')}`, async ({ page }, info) => {
			await openResources(page, info, { scheme: 'dark' });
			for (const name of order) {
				await seg(page, name);
				await page.waitForTimeout(400);
			}
			await expect(page.getByTestId('team-view')).toBeVisible();
			// The toolbar's first button is within a few px of the top (its own padding).
			expect(await gap(page)).toBeLessThan(24);
			expect(await gap(page)).toBeGreaterThanOrEqual(0);
			// The table fills the area, and nothing else is on screen beside it.
			const tops = await page.evaluate(() =>
				[...document.querySelectorAll('[data-testid="resources-view"]')]
					.filter((e) => e.getClientRects().length > 0)
					.map((e) => e.getBoundingClientRect().top),
			);
			expect(tops).toHaveLength(1);
			if (order.join() === 'Load,Lanes,Team') await shot(page, 'team-after-lanes', info);
		});
	}
});

test.describe('6. the Gantt keeps its colours after the People views', () => {
	/** WebKit answers custom properties of an element with no layout with "": the stand-in. */
	async function blindWhenHidden(page: Page): Promise<void> {
		await page.addInitScript(() => {
			const real = window.getComputedStyle.bind(window);
			window.getComputedStyle = (el: Element, pseudo?: string | null) => {
				const style = real(el, pseudo);
				if (!(el instanceof Element) || el.getClientRects().length > 0) return style;
				return new Proxy(style, {
					get(target, key) {
						if (key === 'getPropertyValue') {
							return (name: string) => (name.startsWith('--') ? '' : target.getPropertyValue(name));
						}
						const v = Reflect.get(target, key, target) as unknown;
						return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
					},
				});
			};
		});
	}

	/** The share of opaque canvas pixels in `root` that are light. A dark chart has a few, from its text. */
	const lightShare = (page: Page, root: string): Promise<{ opaque: number; share: number }> =>
		page.evaluate((sel) => {
			let opaque = 0;
			let light = 0;
			for (const c of document.querySelectorAll<HTMLCanvasElement>(`${sel} canvas`)) {
				if (!c.width || !c.height) continue;
				const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
				if (!d) continue;
				for (let i = 0; i < d.length; i += 4 * 61) {
					if ((d[i + 3] ?? 0) < 200) continue;
					opaque++;
					if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 600) light++;
				}
			}
			return { opaque, share: opaque === 0 ? 0 : light / opaque };
		}, root);

	const goPeople = async (page: Page, info: TestInfo, name: string) => {
		if (isTouch(info)) {
			await page
				.getByRole('tablist', { name: 'Panels' })
				.getByRole('tab', { name: 'People' })
				.tap();
			await page.getByRole('tab', { name, exact: true }).tap();
		} else {
			const view = { Load: 'Workload', Lanes: 'Resources', Calendar: 'Calendar' }[name] ?? name;
			const radio = page
				.getByRole('radiogroup', { name: 'Views' })
				.getByRole('radio', { name: view });
			if (await radio.isVisible()) await radio.click();
			else await page.getByRole('combobox', { name: 'Views' }).selectOption({ label: view });
		}
		await page.waitForTimeout(700);
	};
	const goGantt = async (page: Page, info: TestInfo) => {
		if (isTouch(info)) {
			await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'Gantt' }).tap();
		} else {
			const radio = page
				.getByRole('radiogroup', { name: 'Views' })
				.getByRole('radio', { name: 'Gantt' });
			if (await radio.isVisible()) await radio.click();
			else await page.getByRole('combobox', { name: 'Views' }).selectOption({ label: 'Gantt' });
		}
		await page.waitForTimeout(700);
	};

	for (const mode of ['system dark', 'chosen dark'] as const) {
		test(`Gantt to People and back stays dark (${mode}, tokens unreadable while hidden)`, async ({
			page,
		}, info) => {
			await blindWhenHidden(page);
			if (mode === 'system dark') await page.emulateMedia({ colorScheme: 'dark' });
			else {
				await page.emulateMedia({ colorScheme: 'light' });
				await page.addInitScript(() => localStorage.setItem('mainspring.theme', 'dark'));
			}
			await page.goto(
				`/app?sample=poc-sample&hooks=edits,lanes${isTouch(info) ? '' : '&mode=visual'}`,
			);
			await ready(page);
			await page.waitForTimeout(1000);
			await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
			const before = await lightShare(page, '[data-testid="gantt"]');
			expect(before.opaque).toBeGreaterThan(100);
			expect(before.share).toBeLessThan(0.1);
			const segments = isTouch(info)
				? ['Load', 'Lanes', 'Calendar', 'Team']
				: ['Load', 'Lanes', 'Calendar'];
			for (const name of segments) {
				await goPeople(page, info, name);
				// The theme is applied again while the Gantt is hidden (the scheme or the choice changed).
				await page.evaluate(() => {
					const root = document.documentElement;
					root.setAttribute('data-theme', root.getAttribute('data-theme') ?? 'dark');
				});
				await page.waitForTimeout(200);
				await goGantt(page, info);
				const after = await lightShare(page, '[data-testid="gantt"]');
				expect(after.opaque, `${name}: painted`).toBeGreaterThan(100);
				expect(after.share, `${name}: still dark`).toBeLessThan(0.1);
			}
			await shot(page, 'gantt-after-people', info);
		});
	}

	for (const [from, to] of [
		['dark', 'light'],
		['light', 'dark'],
	] as const) {
		test(`the scheme changes to ${to} while the Gantt is hidden: it comes back ${to}`, async ({
			page,
		}, info) => {
			await blindWhenHidden(page);
			await page.emulateMedia({ colorScheme: from });
			await page.goto(
				`/app?sample=poc-sample&hooks=edits,lanes${isTouch(info) ? '' : '&mode=visual'}`,
			);
			await ready(page);
			await page.waitForTimeout(1000);
			await expect(page.locator('html')).toHaveAttribute('data-theme', from);
			await goPeople(page, info, 'Load');
			await page.emulateMedia({ colorScheme: to });
			await expect(page.locator('html')).toHaveAttribute('data-theme', to);
			await page.waitForTimeout(300);
			await goGantt(page, info);
			await expect
				.poll(async () => (await lightShare(page, '[data-testid="gantt"]')).share, {
					message: `the chart is ${to}`,
				})
				[to === 'light' ? 'toBeGreaterThan' : 'toBeLessThan'](to === 'light' ? 0.5 : 0.1);
		});
	}

	test('the heatmap and the lanes are dark when they come back too', async ({ page }, info) => {
		await blindWhenHidden(page);
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto(
			`/app?sample=poc-sample&hooks=edits,lanes${isTouch(info) ? '' : '&mode=visual'}`,
		);
		await ready(page);
		await goPeople(page, info, 'Load');
		const heat = '[data-testid="workload"]';
		await expect(page.locator(heat)).toBeVisible();
		expect((await lightShare(page, heat)).share).toBeLessThan(0.1);
		await goGantt(page, info);
		await page.evaluate(() => {
			const root = document.documentElement;
			root.setAttribute('data-theme', root.getAttribute('data-theme') ?? 'dark');
		});
		await page.waitForTimeout(200);
		await goPeople(page, info, 'Load');
		const back = await lightShare(page, heat);
		expect(back.opaque).toBeGreaterThan(50);
		expect(back.share, 'heatmap').toBeLessThan(0.1);
		await goPeople(page, info, 'Lanes');
		await expect(page.locator('[data-testid="lanes"]')).toBeVisible();
		const lanes = await lightShare(page, '[data-testid="lanes"]');
		expect(lanes.share, 'lanes').toBeLessThan(0.1);
	});
});
