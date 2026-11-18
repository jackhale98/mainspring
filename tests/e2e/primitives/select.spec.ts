// SPDX-License-Identifier: GPL-2.0-or-later
// The Select primitive's contract (ADR-0016 #3; src/components/ui/Select.svelte), on /dev/primitives
// without the engine, on desktop, Pixel 7 and iPhone 14, in light and dark:
// - every variant draws its own arrow (an element of its own, on screen), turns the native look off,
//   and keeps it when a stylesheet gives the select a `background` or `padding` shorthand (the bug
//   that took the arrow off seven selects);
// - 16 px text on a finger (iOS zooms into a smaller field);
// - a choice is reported, and a refused one puts the plan's value back;
// - the overlay variant covers its parent invisibly, so a tap anywhere on the chip is a tap on it;
// - forced colors: the browser draws the select;
// - axe: every select has a name.
// Consumers whose specs run on every change here: select-arrows, inspector, inspector-depends,
// new-plan, health-fixes, calendar, workload, people-shell.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { isTouch } from '../lib/gantt-rig';
import { box, openPrimitives } from '../lib/primitives-rig';

const SELECTS = [
	'#sel-field',
	'#sel-sm',
	'#sel-pill',
	'#sel-inline',
	'#sel-disabled',
	'#sel-invalid',
];

interface Look {
	appearance: string;
	backgroundImage: string;
	fontSize: number;
	caret: { left: number; right: number; width: number; display: string } | null;
	select: { left: number; right: number };
	box: { left: number; right: number };
}

function look(page: Page, sel: string): Promise<Look> {
	return page.evaluate((s) => {
		const el = document.querySelector<HTMLSelectElement>(s);
		if (!el) throw new Error(`no ${s}`);
		const wrap = el.closest<HTMLElement>('[data-select]') as HTMLElement;
		const caret = wrap.querySelector<HTMLElement>('.caret');
		const cs = getComputedStyle(el);
		const r = (e: Element): { left: number; right: number; width: number } => {
			const b = e.getBoundingClientRect();
			return { left: b.left, right: b.right, width: b.width };
		};
		// An inline select's arrow is the chip's: its owner draws the box.
		const chip = wrap.dataset['variant'] === 'inline' ? (el.closest('.chip') ?? el) : el;
		return {
			appearance: cs.appearance,
			backgroundImage: cs.backgroundImage,
			fontSize: parseFloat(cs.fontSize),
			caret: caret ? { ...r(caret), display: getComputedStyle(caret).display } : null,
			select: r(el),
			box: r(chip),
		};
	}, sel);
}

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`Select (${scheme})`, () => {
		test.beforeEach(async ({ page }) => {
			await openPrimitives(page, scheme);
		});

		test('every variant draws its own arrow, on screen, with the native look off', async ({
			page,
		}) => {
			for (const sel of SELECTS) {
				const l = await look(page, sel);
				expect(l.appearance, `${sel}: native look off`).toBe('none');
				expect(l.caret, `${sel}: has an arrow`).not.toBeNull();
				expect(l.caret?.width, `${sel}: the arrow has a size`).toBeGreaterThan(2);
				expect(l.caret?.right, `${sel}: the arrow is inside`).toBeLessThanOrEqual(l.box.right + 1);
				expect(l.caret?.left, `${sel}: the arrow is inside`).toBeGreaterThanOrEqual(l.box.left);
			}
		});

		test('the arrow has room: the text stops before it', async ({ page }) => {
			// The long choice is cut with an ellipsis, not run under the arrow.
			await page.locator('#sel-field').selectOption('c');
			const l = await look(page, '#sel-field');
			const padding = await page.evaluate(() =>
				parseFloat(getComputedStyle(document.querySelector('#sel-field') as Element).paddingRight),
			);
			expect(padding).toBeGreaterThanOrEqual(24);
			expect((l.caret?.left ?? 0) - l.select.left).toBeGreaterThan(40);
		});

		test('a stylesheet’s background or padding shorthand cannot take the arrow away', async ({
			page,
		}) => {
			await page.addStyleTag({
				content:
					'select { background: none !important; padding: 0 !important; border: 1px solid red !important; }',
			});
			for (const sel of ['#sel-field', '#sel-pill']) {
				const l = await look(page, sel);
				expect(l.caret?.width, `${sel}: the arrow is still drawn`).toBeGreaterThan(2);
				expect(l.appearance, sel).toBe('none');
			}
		});

		test('a choice is reported; a refused one puts the plan’s value back', async ({ page }) => {
			await page.locator('#sel-field').selectOption('c');
			await expect(page.locator('#sel-field')).toHaveValue('c');
			await page.locator('#sel-refused').selectOption('c');
			await expect(page.locator('#sel-refused')).toHaveValue('a');
			// The pill reports and clears itself.
			await page.locator('#sel-pill').selectOption('ben');
			await expect(page.getByTestId('sel-picked')).toHaveText('ben');
			await expect(page.locator('#sel-pill')).toHaveValue('');
		});

		test('a disabled select does not change and is dimmed', async ({ page }) => {
			await expect(page.locator('#sel-disabled')).toBeDisabled();
			const o = await page.evaluate(
				() => getComputedStyle(document.querySelector('#sel-disabled') as Element).opacity,
			);
			expect(Number(o)).toBeLessThan(1);
		});

		test('the overlay variant covers its chip invisibly', async ({ page }) => {
			const chip = await box(page.getByTestId('sel-overlay'));
			const sel = await box(page.getByLabel('Replace', { exact: true }));
			expect(sel.width).toBeGreaterThanOrEqual(chip.width - 2);
			expect(sel.height).toBeGreaterThanOrEqual(chip.height - 2);
			const opacity = await page.evaluate(
				() =>
					getComputedStyle(document.querySelector('[data-variant="overlay"] select') as Element)
						.opacity,
			);
			expect(opacity).toBe('0');
			await page.getByLabel('Replace', { exact: true }).selectOption('c');
			await expect(page.getByLabel('Replace', { exact: true })).toHaveValue('c');
		});

		test('text is at least 16 px on a finger (iOS zooms into a smaller field)', async ({
			page,
		}, info) => {
			test.skip(!isTouch(info), 'a finger’s floor');
			for (const sel of SELECTS) {
				const l = await look(page, sel);
				expect(l.fontSize, `${sel}: font size`).toBeGreaterThanOrEqual(16);
			}
		});

		test('a finger’s target is 44 px high where the select stands alone', async ({
			page,
		}, info) => {
			test.skip(!isTouch(info), 'a finger’s target');
			for (const sel of ['#sel-field', '#sel-pill']) {
				const b = await box(page.locator(sel));
				expect(b.height, `${sel}: height`).toBeGreaterThanOrEqual(43.5);
			}
		});

		test('has no axe violations (every select has a name)', async ({ page }) => {
			await page.waitForTimeout(200);
			const r = await new AxeBuilder({ page })
				.include('[data-testid="prim-select"]')
				.withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
				.analyze();
			expect(
				r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
			).toEqual([]);
		});
	});
}

test('forced colors: the browser draws the select and its arrow', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'forced-colors emulation is Chromium’s');
	await openPrimitives(page);
	await page.emulateMedia({ forcedColors: 'active' });
	const l = await look(page, '#sel-field');
	expect(l.appearance).not.toBe('none');
	expect(l.caret?.display).toBe('none');
});
