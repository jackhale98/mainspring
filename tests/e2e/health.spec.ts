// SPDX-License-Identifier: GPL-2.0-or-later
// The health panel (phase-3.md 9.2, 9.7, 10, 12; T18) on `fedora-res`, desktop Chrome and the Pixel 7
// emulation:
// - the findings are grouped by check and the counts per check are the health golden's (241 in all,
//   milestones exempt: 26 without a predecessor, 61 without a successor);
// - the severity filter; the settings (thresholds, each check, and milestones in H1 and H2), which
//   are kept per plan on this device and change the counts as `checkPlan` says;
// - the keyboard path on a desktop (the button, the tabs, Escape) and the phone path (the status
//   button's card, the full-height sheet, 44 px targets);
// - axe in light and dark, with the list and with the settings open.
// The fixes are health-fixes.spec.ts, and "Why here?" is why-here.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { healthStrings } from '../../src/lib/strings-health-panel';
import { CHECK_IDS, DEFAULT_HEALTH_SETTINGS } from '../../src/lib/health/types';
import { withCheck, withLinkMilestones } from '../../src/lib/health/settings';
import { READY_TIMEOUT_MS } from './lib/gantt-rig';
import {
	SETTINGS_KEY,
	TAGS,
	expectTotal,
	expected,
	findings,
	heading,
	openHealth,
	openPlan,
	panelOf,
	phoneOf,
	storedSettings,
} from './lib/health-rig';

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T18); iPhone is reported');
});
test.setTimeout(READY_TIMEOUT_MS * 2);
test.use({ actionTimeout: 20_000 });

const H = healthStrings;

test.describe('the findings', () => {
	test('are grouped by check, with the counts of the health golden', async ({ page }, info) => {
		// The numbers the plan's golden gives, before they are compared with the screen.
		const want = expected();
		expect(want.findings).toHaveLength(241);
		expect(want.counts['no-predecessor']).toBe(26);
		expect(want.counts['no-successor']).toBe(61);

		await openPlan(page, info);
		if (phoneOf(info)) {
			// The card's row says the count before the sheet is open.
			await page.getByTestId('status-button').click();
			await expect(page.getByTestId('open-health')).toHaveText('Plan health: 241', {
				timeout: READY_TIMEOUT_MS,
			});
			await page.keyboard.press('Escape');
		} else {
			await expect(page.getByTestId('health-button')).toHaveAttribute(
				'aria-label',
				'Plan health: 241 problems',
				{ timeout: READY_TIMEOUT_MS },
			);
		}
		const panel = await openHealth(page, info);
		await expect(panel.getByTestId('health-summary')).toHaveText('241 problems in 7 checks');
		for (const check of CHECK_IDS) {
			const n = want.counts[check];
			if (n === 0) {
				await expect(findings(panel, check)).toHaveCount(0);
				continue;
			}
			await expect(heading(panel, `${H.check[check]}, ${n}`)).toHaveCount(1);
			await expect(findings(panel, check)).toHaveCount(n);
		}
		// Every finding has a sentence, and a severity word for a screen reader.
		const first = findings(panel, 'no-predecessor').first();
		await expect(first).toContainText('Nothing comes before it');
		await expect(first.locator('.sr-only').first()).toHaveText('Warning: ');
	});

	test('can be filtered by severity', async ({ page }, info) => {
		await openPlan(page, info);
		const panel = await openHealth(page, info);
		const want = expected();
		const notes = want.findings.filter((f) => f.severity === 'info').length;
		const warnings = want.findings.filter((f) => f.severity === 'warning').length;
		expect([notes, warnings]).toEqual([17, 224]);

		await panel.getByTestId('severity-info').click();
		await expect(panel.getByTestId('severity-info')).toHaveAttribute('aria-checked', 'true');
		await expect(panel.getByTestId('finding')).toHaveCount(notes);
		await expect(panel.getByRole('heading', { level: 3 })).toHaveText([
			`Hard constraint, ${want.counts['hard-constraint']}`,
			`Long task, ${want.counts['long-task']}`,
		]);
		await panel.getByTestId('severity-warning').click();
		await expect(panel.getByTestId('finding')).toHaveCount(warnings);
		await expect(heading(panel, `Hard constraint, 7`)).toHaveCount(0);
		await panel.getByTestId('severity-all').click();
		await expect(panel.getByTestId('finding')).toHaveCount(241);
	});
});

test.describe('the settings', () => {
	test('milestones in H1 and H2 are a per-plan setting that changes the counts and is kept', async ({
		page,
	}, info) => {
		const off = expected();
		const on = expected(withLinkMilestones(DEFAULT_HEALTH_SETTINGS, true));
		expect(on.counts['no-predecessor']).toBeGreaterThan(off.counts['no-predecessor']);
		expect(on.counts['no-successor']).toBeGreaterThan(off.counts['no-successor']);

		await openPlan(page, info);
		let panel = await openHealth(page, info);
		expect(await storedSettings(page)).toBeNull();
		await panel.getByTestId('health-settings-button').click();
		const toggle = panel.getByTestId('health-link-milestones');
		await expect(toggle).not.toBeChecked();
		await toggle.check();

		// Back to the findings: the counts are the milestones-included report's.
		await panel.getByRole('button', { name: H.settings.back }).click();
		await expectTotal(page, info, panel, on.findings.length);
		await expect(heading(panel, `No predecessor, ${on.counts['no-predecessor']}`)).toHaveCount(1);
		await expect(heading(panel, `No successor, ${on.counts['no-successor']}`)).toHaveCount(1);
		// What is kept is only what differs from the defaults, under the plan's own key.
		expect(await storedSettings(page)).toBe('{"linkMilestones":true}');

		// A new visit reads it again.
		await page.reload();
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		panel = await openHealth(page, info);
		await expectTotal(page, info, panel, on.findings.length);
		await panel.getByTestId('health-settings-button').click();
		await expect(panel.getByTestId('health-link-milestones')).toBeChecked();

		// Reset puts the defaults back, and the key holds nothing.
		await panel.getByTestId('health-reset').click();
		await expect(panel.getByTestId('health-link-milestones')).not.toBeChecked();
		await panel.getByRole('button', { name: H.settings.back }).click();
		await expectTotal(page, info, panel, off.findings.length);
		expect(await storedSettings(page)).toBe('{}');
	});

	test('thresholds and checks change what is reported; a bad threshold is refused', async ({
		page,
	}, info) => {
		const base = expected();
		const long = expected({ ...DEFAULT_HEALTH_SETTINGS, longTaskDays: 40 });
		const noGaps = expected(withCheck(DEFAULT_HEALTH_SETTINGS, 'long-gap', false));
		expect(long.counts['long-task']).toBeLessThan(base.counts['long-task']);
		expect(noGaps.counts['long-gap']).toBe(0);

		await openPlan(page, info);
		const panel = await openHealth(page, info);
		await panel.getByTestId('health-settings-button').click();

		const days = panel.getByTestId('health-task-days');
		await expect(days).toHaveValue('20');
		await days.fill('40');
		await days.press('Enter');
		await panel.getByRole('button', { name: H.settings.back }).click();
		await expectTotal(page, info, panel, long.findings.length);
		expect(await storedSettings(page)).toBe('{"longTaskDays":40}');

		// A value that is not a whole number of days is refused with a sentence, and nothing changes.
		await panel.getByTestId('health-settings-button').click();
		await days.fill('0');
		await days.press('Enter');
		await expect(panel.getByRole('alert')).toHaveText(H.settings.invalid);
		await expect(days).toHaveAttribute('aria-invalid', 'true');
		expect(await storedSettings(page)).toBe('{"longTaskDays":40}');
		// The stepper works from the value shown.
		await days.fill('40');
		await days.press('Enter');
		await panel.getByRole('button', { name: /^More days: Long task/ }).click();
		await expect(days).toHaveValue('41');
		await panel.getByRole('button', { name: /^Fewer days: Long task/ }).click();
		await expect(days).toHaveValue('40');

		// A check turned off has no group.
		await panel.locator('input[data-check="long-gap"]').uncheck();
		await panel.getByRole('button', { name: H.settings.back }).click();
		await expect(heading(panel, /^Long gap/)).toHaveCount(0);
		await expectTotal(
			page,
			info,
			panel,
			expected({ ...withCheck(DEFAULT_HEALTH_SETTINGS, 'long-gap', false), longTaskDays: 40 })
				.findings.length,
		);
		const stored = JSON.parse((await storedSettings(page)) ?? '{}');
		expect(stored).toEqual({ longTaskDays: 40, enabled: { 'long-gap': false } });
		expect(SETTINGS_KEY).toBe('mainspring.health.fedora-res');
	});
});

test.describe('the keyboard path', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(phoneOf(info), 'a keyboard (desktop)');
	});

	test('the button, the tabs and Escape', async ({ page }) => {
		await page.goto('/app?sample=fedora-res&mode=visual&hooks=edits');
		await expect(page.getByTestId('health-button')).toHaveAttribute('data-count', '241', {
			timeout: READY_TIMEOUT_MS,
		});
		const button = page.getByTestId('health-button');
		await button.focus();
		await page.keyboard.press('Enter');
		const panel = page.getByRole('complementary', { name: 'Plan health' });
		await expect(panel).toBeVisible();
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		// From the keyboard the focus moves in, to the summary.
		await expect(panel.getByTestId('health-summary')).toBeFocused();

		// The tabs are a tab list: the arrows move and select.
		// The tabs belong to the right panel, which is named for the tab that shows.
		const aside = page.getByTestId('inspector');
		const health = aside.getByRole('tab', { name: /^Health/ });
		const details = aside.getByRole('tab', { name: 'Details' });
		await expect(health).toHaveAttribute('aria-selected', 'true');
		await health.focus();
		await page.keyboard.press('ArrowLeft');
		await expect(details).toBeFocused();
		await expect(details).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await expect(health).toBeFocused();
		await expect(health).toHaveAttribute('aria-selected', 'true');

		// Tab reaches the settings button, then the filters; Enter on a finding's button acts.
		await panel.getByTestId('health-summary').focus();
		await page.keyboard.press('Tab');
		await expect(panel.getByTestId('health-settings-button')).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(panel.getByTestId('health-settings')).toBeVisible();
		// Escape leaves the settings first, and then closes the panel and returns to the button.
		await page.keyboard.press('Escape');
		await expect(panel.getByTestId('health-settings')).toHaveCount(0);
		await expect(panel).toBeVisible();
		await panel.getByTestId('health-summary').focus();
		await page.keyboard.press('Escape');
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		await expect(button).toBeFocused();
	});
});

test.describe('the phone path', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!phoneOf(info), 'a phone');
	});

	test('the status card leads to a full-height sheet whose targets are 44 px', async ({
		page,
	}, info) => {
		await openPlan(page, info);
		const panel = await openHealth(page, info);
		await expect(panel).toBeVisible();
		// Full height: the sheet stops below the top bar, which keeps Undo and Redo in reach.
		const box = await panel.boundingBox();
		const view = page.viewportSize();
		const bar = await page.getByTestId('undo').boundingBox();
		expect(box && view && bar).toBeTruthy();
		if (box && view && bar) {
			expect(box.height).toBeGreaterThan(view.height * 0.7);
			expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
		}
		await expect(page.getByTestId('undo')).toBeVisible();

		// Every control the sheet shows is a 44 px target (text links inside a sentence are exempt).
		const small = await panel
			.locator('button, input:not([type="hidden"]), select, [role="tab"], [role="radio"], summary')
			.evaluateAll((els) =>
				els.flatMap((el) => {
					const r = el.getBoundingClientRect();
					if (r.width === 0 || r.height === 0) return [];
					const inView = r.bottom > 0 && r.top < innerHeight;
					return inView && (r.width < 43.5 || r.height < 43.5)
						? [
								`${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${r.width}x${r.height}`,
							]
						: [];
				}),
			);
		expect(small).toEqual([]);

		// Closing it returns to the plan.
		await page.getByRole('button', { name: 'Close plan health' }).click();
		await expect(panel).toHaveCount(0);
	});
});

test.describe('the tablet sheet', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(phoneOf(info), 'the desktop project, resized to a tablet');
	});

	test('opens from the Health button and gives the focus back to it when it closes', async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 820, height: 1180 });
		await openPlan(page, info);
		const button = page.getByTestId('health-button');
		await expect(button).toHaveAttribute('data-count', '241', { timeout: READY_TIMEOUT_MS });
		await button.focus();
		await page.keyboard.press('Enter');
		const sheet = page.getByRole('dialog', { name: 'Plan health' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByTestId('health-summary')).toBeFocused();
		// Not modal: the top bar is still there, and the button says the sheet is open.
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		await sheet.getByRole('button', { name: 'Close plan health' }).click();
		await expect(sheet).toHaveCount(0);
		await expect(button).toBeFocused();
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		// And again, from the button.
		await button.click();
		await expect(sheet).toBeVisible();
		await button.click();
		await expect(sheet).toHaveCount(0);
	});
});

test.describe('accessibility', () => {
	for (const scheme of ['light', 'dark'] as const) {
		test(`axe finds nothing in ${scheme}: the list and the settings`, async ({ page }, info) => {
			await openPlan(page, info, scheme);
			const panel = await openHealth(page, info);
			await expect(findings(panel, 'no-predecessor').first()).toBeVisible();
			const scan = () => new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect((await scan()).violations).toEqual([]);
			await panel.getByTestId('health-settings-button').click();
			await expect(panel.getByTestId('health-settings')).toBeVisible();
			expect((await scan()).violations).toEqual([]);
			// The panel as it is named: a region with its title.
			await expect(panelOf(page, info)).toBeVisible();
		});
	}
});
