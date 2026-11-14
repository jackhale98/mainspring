// SPDX-License-Identifier: GPL-2.0-or-later
// Accessibility audit of the Gantt and its sheets (phase-2.md 10; T23; WCAG 2.2 AA).
// - axe in light and dark, on desktop and the Pixel 7, in every state of the audit scope: Text,
//   Split and Visual; the treegrid; the details panel, drawer and sheet; the project and source
//   sheets; the phone's status popover; the row menu; the shortcuts dialog; the move question;
//   link mode; the people palette; the toasts.
// - 44 px targets on a coarse pointer (10.3): every interactive element of those states, measured.
// - reduced motion, forced colours, and the accessible names read from the a11y tree.
// - the keyboard walkthrough of 10.2: focus order, the visible ring, no trap, Escape returns.
// Chromium only (desktop and pixel-7 projects).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import { smallTargets } from './lib/targets';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T23)');
});

async function axe(page: Page, state: string): Promise<void> {
	// A moment for the transitions of a sheet or a popover to end (contrast is read mid-fade otherwise).
	await page.waitForTimeout(500);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect.soft(detail, state).toEqual([]);
}

async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}

test.describe('axe', () => {
	test.setTimeout(READY_TIMEOUT_MS * 3);

	for (const scheme of ['light', 'dark'] as const) {
		test(`modes: Text, Split, Visual (${scheme})`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			for (const mode of isTouch(info) ? ['text', 'visual'] : ['text', 'split', 'visual']) {
				await page.goto(`/app?sample=gantt-manipulation&mode=${mode}`);
				await ready(page);
				await axe(page, `${mode} (${scheme})`);
			}
		});

		test(`Visual states (${scheme})`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			const rig = await Rig.open(page, info);
			const touch = rig.touch;
			await axe(page, `visual, treegrid (${scheme})`);

			// The treegrid with a cell focused.
			await rig.row('task:design.research').focus();
			await axe(page, `treegrid focused row (${scheme})`);

			// Details: the side panel on a desktop, the bottom sheet on the phone.
			await rig.select('design.research');
			await axe(page, `details ${touch ? 'sheet' : 'panel'} (${scheme})`);

			// The source sheet.
			await page.getByRole('button', { name: 'Show source' }).click();
			await expect(page.getByRole('dialog', { name: 'Source of Research' })).toBeVisible();
			await axe(page, `source sheet (${scheme})`);
			await page
				.getByRole('dialog', { name: 'Source of Research' })
				.getByRole('button', { name: 'Close' })
				.click();

			// The project sheet.
			await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
			await expect(page.getByRole('dialog', { name: 'Project' })).toBeVisible();
			await axe(page, `project sheet (${scheme})`);
			await page
				.getByRole('dialog', { name: 'Project' })
				.getByRole('button', { name: 'Close' })
				.click();

			// The row menu, and the shortcuts dialog from it.
			if (touch) {
				// A phone's details sheet is over the toolbar's row; it is closed first.
				const sheet = page.getByRole('dialog', { name: /Task details/ });
				if (await sheet.isVisible())
					await sheet.getByRole('button', { name: 'Close', exact: true }).click();
			}
			await page.getByTestId('row-menu').click();
			await expect(page.getByRole('menu', { name: 'Row actions' })).toBeVisible();
			await axe(page, `row menu (${scheme})`);
			await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
			await expect(page.getByTestId('shortcuts')).toBeVisible();
			await axe(page, `shortcuts dialog (${scheme})`);
			await page.keyboard.press('Escape');
			await expect(page.getByTestId('shortcuts')).not.toBeVisible();
		});

		test(`link mode, palette, move question and toast (${scheme})`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			const rig = await Rig.open(page, info);

			// Link mode: the key on a desktop, the row menu's item for a finger.
			if (rig.touch) {
				await rig.row('task:design.research').locator('.label').tap();
				const sheet = page.getByRole('dialog', { name: /Task details/ });
				if (await sheet.isVisible())
					await sheet.getByRole('button', { name: 'Close', exact: true }).click();
				await page.getByTestId('row-menu').tap();
				await page.getByRole('menuitem', { name: /^Link from this task/ }).tap();
			} else {
				await rig.row('task:design.research').focus();
				await page.keyboard.press('l');
			}
			await expect(page.getByTestId('link-banner')).toBeVisible();
			await axe(page, `link mode (${scheme})`);
			await page.keyboard.press('Escape');
			await expect(page.getByTestId('link-banner')).not.toBeVisible();

			// The people palette (a mouse's: a finger books people in the details sheet).
			if (!rig.touch) {
				await page.getByRole('button', { name: 'People', exact: true }).click();
				await expect(page.getByTestId('people-palette')).toBeVisible();
				await axe(page, `people palette (${scheme})`);
				await page.getByRole('button', { name: 'People', exact: true }).click();
			}

			// The move question: a first move of a bar asks where to write it.
			const b = await rig.bar('design.sketch');
			const to = { x: b.body.x + 60, y: b.body.y };
			await rig.drag(b.body, to, { hold: rig.hold, steps: 8 });
			await expect(page.getByTestId('move-question')).toBeVisible();
			await axe(page, `move question (${scheme})`);
			await page.getByTestId('move-question').getByRole('button', { name: 'Cancel' }).click();

			// A toast: an edit, while its toast is on screen.
			await rig.select('design.research');
			const name = page.getByLabel('Name', { exact: true });
			await name.fill('Research again');
			await name.press('Enter');
			await expect(rig.toast.last()).toBeVisible();
			await axe(page, `toast (${scheme})`);
		});
	}

	test('the phone status popover and the engine details', async ({ page }, info) => {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('/app?sample=gantt-manipulation&mode=visual');
			await ready(page);
			const button = isTouch(info)
				? page.getByTestId('status-button')
				: page.getByTestId('engine-info');
			await button.click();
			await expect(page.getByTestId('engine-info-details')).toBeVisible();
			await axe(page, `${isTouch(info) ? 'status popover' : 'engine details'} (${scheme})`);
		}
	});

	test('the tablet details sheet and the desktop drawer', async ({ page }, info) => {
		test.skip(isTouch(info), 'a desktop browser at tablet width and in Split');
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.setViewportSize({ width: 820, height: 1100 });
			const rig = await Rig.open(page, info);
			await rig.select('design.research');
			await axe(page, `tablet details sheet (${scheme})`);
			await page.setViewportSize({ width: 1100, height: 800 });
			await page.goto('/app?sample=gantt-manipulation&mode=split&hooks=edits,gantt');
			await ready(page);
			const toggle = page.getByRole('button', { name: /^Details/ });
			if (await toggle.isVisible()) {
				await toggle.click();
				await axe(page, `desktop details drawer (${scheme})`);
			}
		}
	});
});

/** What has the focus, in words: the tag, role, accessible name and the region it is in. */
async function focused(page: Page): Promise<{
	what: string;
	region: string;
	outlineWidth: number;
	outlineStyle: string;
	boxShadow: string;
}> {
	return page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		if (!el)
			return { what: 'none', region: '', outlineWidth: 0, outlineStyle: 'none', boxShadow: 'none' };
		const cs = getComputedStyle(el);
		const region = el.closest('header')
			? 'header'
			: el.closest('[data-testid="gantt-treegrid"]')
				? 'treegrid'
				: el.closest('[role="complementary"], [role="dialog"]')
					? 'details'
					: el.closest('[role="group"][aria-label]')
						? 'toolbar'
						: 'other';
		const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		return {
			what: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${name.slice(0, 30)}"`,
			region,
			outlineWidth: parseFloat(cs.outlineWidth),
			outlineStyle: cs.outlineStyle,
			boxShadow: cs.boxShadow,
		};
	});
}

test.describe('keyboard (10.2)', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(isTouch(info), 'a keyboard walkthrough runs on the desktop');
	});

	test('Tab order, a visible ring at every stop, no trap, Enter into the details and Escape back', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		const stops: Awaited<ReturnType<typeof focused>>[] = [];
		let gridAt = -1;
		// From the top of the page: the top bar and the mode switch, the Gantt's toolbar, then the
		// treegrid (one stop: the roving row).
		for (let i = 0; i < 40; i++) {
			await page.keyboard.press('Tab');
			const f = await focused(page);
			stops.push(f);
			if (f.region === 'treegrid') {
				gridAt = i;
				break;
			}
		}
		const regions = stops.map((s) => s.region);
		expect(gridAt, `the treegrid is reached (${regions.join(', ')})`).toBeGreaterThan(0);
		const first = (r: string) => regions.indexOf(r);
		expect(first('header')).toBeGreaterThanOrEqual(0);
		expect(first('header')).toBeLessThan(first('toolbar'));
		expect(first('toolbar')).toBeLessThan(gridAt);
		// Every stop shows a ring: an outline of at least 2 px, or a shadow standing in for one.
		for (const s of stops) {
			const ring = (s.outlineStyle !== 'none' && s.outlineWidth >= 2) || s.boxShadow !== 'none';
			expect
				.soft(ring, `focus ring on ${s.what} (${s.region}): ${s.outlineStyle} ${s.outlineWidth}px`)
				.toBe(true);
		}
		// Exactly one tab stop in the treegrid (roving tabindex).
		await expect(page.getByTestId('gantt-treegrid').locator('[tabindex="0"]')).toHaveCount(1);
		// No trap: Tab keeps going and leaves the treegrid within a few presses.
		let left = false;
		for (let i = 0; i < 12 && !left; i++) {
			await page.keyboard.press('Tab');
			left = (await focused(page)).region !== 'treegrid';
		}
		expect(left, 'Tab leaves the treegrid').toBe(true);
		// Enter opens the details and moves the focus into them; Escape returns to the row.
		await rig.row('task:design.research').focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
		expect((await focused(page)).region).toBe('details');
		await page.keyboard.press('Escape');
		await expect(rig.row('task:design.research')).toBeFocused();
	});

	test('the row menu opens and closes by keyboard and returns the focus', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		await rig.row('task:design.research').focus();
		const button = page.getByTestId('row-menu');
		await button.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('menu', { name: 'Row actions' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu', { name: 'Row actions' })).not.toBeVisible();
		await expect(button).toBeFocused();
	});

	test('the shortcuts dialog: Escape closes it and the focus returns to the row menu', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		await rig.row('task:design.research').focus();
		await page.getByTestId('row-menu').click();
		await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
		await expect(page.getByTestId('shortcuts')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('shortcuts')).not.toBeVisible();
		await expect(page.getByTestId('row-menu')).toBeFocused();
	});

	test('link mode is operable by keyboard and Escape leaves it', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		await rig.row('task:design.research').focus();
		await page.keyboard.press('l');
		await expect(page.getByTestId('link-banner')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('link-banner')).not.toBeVisible();
		await expect(rig.row('task:design.research')).toBeFocused();
	});
});

// Target sizes on a coarse pointer (10.3): 44 x 44 CSS px. Every state is probed and the elements
// under the minimum are listed in the failure message; `EXEMPT` holds the justified ones.
const EXEMPT: ReadonlyArray<RegExp> = [];

test.describe('target sizes on a coarse pointer', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!isTouch(info) || info.project.name !== 'pixel-7', 'the Pixel 7 emulation is coarse');
	});

	test('every interactive element in the Gantt states is at least 44 x 44', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const probe = async (state: string): Promise<void> => {
			await page.waitForTimeout(400);
			const small = (await smallTargets(page, 44)).filter(
				(t) => !EXEMPT.some((re) => re.test(t.what)),
			);
			expect
				.soft(
					small.map((t) => `${t.what} ${t.width}x${t.height}`),
					`under 44 px in ${state}`,
				)
				.toEqual([]);
		};
		await probe('the Gantt tab');
		await rig.select('design.research');
		await probe('the details sheet');
		await page.getByRole('button', { name: 'Show source' }).click();
		await probe('the source sheet');
		await page
			.getByRole('dialog', { name: 'Source of Research' })
			.getByRole('button', { name: 'Close' })
			.click();
		await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
		await probe('the project sheet');
		await page
			.getByRole('dialog', { name: 'Project' })
			.getByRole('button', { name: 'Close' })
			.click();
		const sheet = page.getByRole('dialog', { name: /Task details/ });
		if (await sheet.isVisible())
			await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await page.getByTestId('row-menu').tap();
		await probe('the row menu');
		await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).tap();
		await probe('the shortcuts dialog');
		await page.keyboard.press('Escape');
		await page.getByTestId('status-button').tap();
		await probe('the status popover');
		await page.keyboard.press('Escape');
		for (const tab of ['Text', 'Plan']) {
			const t = page.getByRole('tab', { name: tab, exact: true });
			if (await t.count()) {
				await t.click();
				await probe(`the ${tab} tab`);
			}
		}
	});
});

test.describe('reduced motion', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('nothing animates or transitions, and the chart jumps', async ({ page }, info) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const rig = await Rig.open(page, info);
		await rig.select('design.research');
		const moving = async (): Promise<string[]> =>
			page.evaluate(() => {
				const out: string[] = [];
				for (const el of document.querySelectorAll('body *')) {
					const cs = getComputedStyle(el);
					const secs = (v: string): number =>
						Math.max(...v.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 0.001 : 1)));
					const anim = cs.animationName !== 'none' && secs(cs.animationDuration) > 0.05;
					const trans = secs(cs.transitionDuration) > 0.05;
					if (anim || trans) {
						out.push(
							`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]} ${anim ? `animation ${cs.animationName} ${cs.animationDuration}` : ''} ${trans ? `transition ${cs.transitionProperty} ${cs.transitionDuration}` : ''}`,
						);
					}
				}
				return out;
			});
		expect.soft(await moving(), 'selected').toEqual([]);
		await page.getByTestId('row-menu').click();
		expect.soft(await moving(), 'row menu').toEqual([]);
		await page.keyboard.press('Escape');
		await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
		await page.waitForTimeout(400);
		expect.soft(await moving(), 'project sheet').toEqual([]);
		// The Today button scrolls at once, not by a smooth scroll.
		await page
			.getByRole('dialog', { name: 'Project' })
			.getByRole('button', { name: 'Close' })
			.click();
		const smooth = await page.evaluate(() => {
			const s = document.querySelector('[data-testid="gantt"] .scroller') as HTMLElement;
			return getComputedStyle(s).scrollBehavior;
		});
		expect(smooth).not.toBe('smooth');
	});
});

test.describe('forced colours', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(isTouch(info), 'a desktop high contrast mode');
	});

	test('controls keep an outline, state is not carried by a background alone', async ({
		page,
	}, info) => {
		await page.emulateMedia({ forcedColors: 'active' });
		const rig = await Rig.open(page, info);
		await rig.select('design.research');
		await page.screenshot({ path: 'test-results/gantt-forced-colors.png' });
		// Pressed and unpressed chips (Critical path, People, the mode switch) must differ in
		// something other than a background, which forced colours replaces.
		const diff = await page.evaluate(() => {
			const sig = (el: Element): string => {
				const cs = getComputedStyle(el);
				const after = getComputedStyle(el, '::after');
				return [
					cs.borderTopWidth,
					cs.borderTopStyle,
					cs.outlineStyle,
					cs.textDecorationLine,
					cs.fontWeight,
					after.content,
					after.display,
					after.borderTopWidth,
					after.height,
				].join('|');
			};
			const out: string[] = [];
			for (const group of document.querySelectorAll('[role="group"]')) {
				const on = group.querySelector('button[aria-pressed="true"]');
				const off = group.querySelector('button[aria-pressed="false"]');
				if (on && off && sig(on) === sig(off))
					out.push(
						`${group.getAttribute('aria-label')}: pressed looks like unpressed (${sig(on)})`,
					);
			}
			return out;
		});
		expect.soft(diff).toEqual([]);
		// The focus ring is an outline, which forced colours keeps.
		await rig.row('task:design.research').focus();
		const ring = await focused(page);
		expect(ring.outlineStyle).not.toBe('none');
		expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
	});
});

test.describe('accessible names', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('the a11y tree names the chart, its controls and its rows; canvases are hidden', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		// Canvases carry no information of their own: the treegrid is their mirror.
		const canvases = await page
			.locator('[data-testid="gantt"] canvas')
			.evaluateAll((els) =>
				els.map(
					(e) =>
						e.closest('[aria-hidden="true"]') !== null || e.getAttribute('aria-hidden') === 'true',
				),
			);
		expect(canvases.length).toBeGreaterThan(0);
		expect(canvases.every(Boolean), 'every canvas is aria-hidden').toBe(true);
		await expect(page.getByRole('treegrid', { name: 'Tasks' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Gantt controls' })).toBeVisible();
		await expect(page.getByRole('combobox', { name: 'Zoom' })).toBeVisible();
		await expect(page.getByRole('button', { name: /Critical path/ })).toBeVisible();
		// A row's name says what the bar says: the task, its dates, its people, its float.
		await expect(rig.row('task:design.research')).toHaveAccessibleName(/^Research: .+ to .+\./);
		// The toast is in a polite live region.
		await rig.select('design.research');
		const name = page.getByLabel('Name', { exact: true });
		await name.fill('Research again');
		await name.press('Enter');
		await expect(rig.toast.last()).toBeVisible();
		await expect(
			page.locator('[role="status"][aria-live="polite"]').filter({ has: rig.toast }),
		).toHaveCount(1);
		// The whole tree, for the findings file.
		const tree = await page.locator('body').ariaSnapshot();
		const fs = await import('node:fs');
		fs.mkdirSync('test-results', { recursive: true });
		fs.writeFileSync(`test-results/gantt-a11y-tree-${info.project.name}.txt`, tree);
	});
});
