// SPDX-License-Identifier: GPL-2.0-or-later
// The health panel (phase-3.md 9.2, 9.7, 10, 12; T18), desktop Chrome, the Pixel 7 emulation and the
// iPhone 14 (WebKit). What depends on the size of the plan (the counts of the health golden, the
// windowed list, the list holding still while it is scrolled) runs on `fedora-res`; the rest runs on
// the small plan `ui-basic` (ADR-0016 change 4), whose report is the unit oracle's over the engine
// run in the spec's own process (lib/small-plan.ts), or on a health fixture whose golden is native:
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
import { panelSettled } from './lib/settle';
import { reportOfText, smallReport } from './lib/small-plan';
import {
	SMALL,
	SMALL_SETTINGS_KEY,
	TAGS,
	fixtureText,
	openSmall,
	setPlan,
	driveList,
	scrollStops,
	expectTotal,
	expected,
	findings,
	heading,
	openHealth,
	openPlan,
	panelOf,
	phoneOf,
	sizes,
	storedPlanKey,
	storedSettings,
} from './lib/health-rig';

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
		}
		// Each list says how many findings it has, though it mounts only the rows near the view.
		await expect
			.poll(() => sizes(panel))
			.toEqual(
				Object.fromEntries(
					CHECK_IDS.filter((c) => want.counts[c] > 0).map((c) => [c, want.counts[c]]),
				),
			);
		const mounted = await findings(panel, 'work-without-people').count();
		expect(mounted).toBeGreaterThan(0);
		expect(mounted).toBeLessThan(want.counts['work-without-people']);
		// Every finding has a sentence, and a severity word for a screen reader.
		const first = findings(panel, 'no-predecessor').first();
		await expect(first).toContainText('Nothing comes before it');
		await expect(first.locator('.sr-only').first()).toHaveText('Warning: ');
	});

	test('can be filtered by severity', async ({ page }, info) => {
		await openSmall(page, info);
		const panel = await openHealth(page, info);
		const want = await smallReport(SMALL);
		const total = want.findings.length;
		const notes = want.findings.filter((f) => f.severity === 'info').length;
		const warnings = want.findings.filter((f) => f.severity === 'warning').length;
		expect([notes, warnings, total]).toEqual([3, 6, 9]);

		await panel.getByTestId('severity-info').click();
		await expect(panel.getByTestId('severity-info')).toHaveAttribute('aria-checked', 'true');
		await expect(panel.getByRole('heading', { level: 3 })).toHaveText([
			`Hard constraint, ${want.counts['hard-constraint']}`,
		]);
		await expect
			.poll(async () => Object.values(await sizes(panel)).reduce((a, b) => a + b, 0))
			.toBe(notes);
		await panel.getByTestId('severity-warning').click();
		await expect
			.poll(async () => Object.values(await sizes(panel)).reduce((a, b) => a + b, 0))
			.toBe(warnings);
		await expect(heading(panel, `Hard constraint, ${want.counts['hard-constraint']}`)).toHaveCount(
			0,
		);
		await panel.getByTestId('severity-all').click();
		await expect
			.poll(async () => Object.values(await sizes(panel)).reduce((a, b) => a + b, 0))
			.toBe(total);
		// The filter is a radio group with a roving tab stop: the arrows move and choose.
		await panel.getByTestId('severity-all').focus();
		await page.keyboard.press('ArrowRight');
		await expect(panel.getByTestId('severity-warning')).toBeFocused();
		await expect(panel.getByTestId('severity-warning')).toHaveAttribute('aria-checked', 'true');
		await expect(panel.getByTestId('severity-all')).toHaveAttribute('tabindex', '-1');
		await page.keyboard.press('Home');
		await expect(panel.getByTestId('severity-all')).toHaveAttribute('aria-checked', 'true');
	});
});

test.describe('the settings', () => {
	test('milestones in H1 and H2 are a per-plan setting that changes the counts and is kept', async ({
		page,
	}, info) => {
		// The health fixture H1 (pass) with a milestone in the middle of the plan that nothing leads
		// to or from. The start milestone (Kickoff) and the finish milestone are exempt; with the
		// setting on, Midpoint is reported in H1 (nothing before it) and Done, which now ends
		// before the finish, in H2 (the oracle: the report over the engine run in this process).
		const plan = `${fixtureText('h1-no-predecessor', 'pass')}
task mid "Midpoint" {
  milestone
  start 2026-02-02-09:00
}
`;
		const off = await reportOfText(plan);
		const on = await reportOfText(plan, withLinkMilestones(DEFAULT_HEALTH_SETTINGS, true));
		expect(on.counts['no-predecessor']).toBe(off.counts['no-predecessor'] + 1);
		expect(on.counts['no-successor']).toBe(off.counts['no-successor'] + 1);

		await openSmall(page, info);
		await setPlan(page, info, plan);
		// The change stored the sample's copy, whose settings are its own (phase-4.md 18.7).
		const key = await storedPlanKey(page, 'mainspring.health');
		let panel = await openHealth(page, info);
		expect(await storedSettings(page, key)).toBeNull();
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
		expect(await storedSettings(page, key)).toBe('{"linkMilestones":true}');
		expect(await storedSettings(page, SMALL_SETTINGS_KEY)).toBeNull();

		// A new visit reads it again: the reload opens the copy, with its text.
		await page.reload();
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
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
		expect(await storedSettings(page, key)).toBe('{}');
	});

	test('thresholds and checks change what is reported; a bad threshold is refused', async ({
		page,
	}, info) => {
		const base = await smallReport(SMALL);
		const long = await smallReport(SMALL, { ...DEFAULT_HEALTH_SETTINGS, longTaskDays: 2 });
		const noConstraints = await smallReport(SMALL, {
			...withCheck(DEFAULT_HEALTH_SETTINGS, 'hard-constraint', false),
			longTaskDays: 2,
		});
		expect(long.counts['long-task']).toBeGreaterThan(base.counts['long-task']);
		expect(noConstraints.counts['hard-constraint']).toBe(0);
		expect(base.counts['hard-constraint']).toBeGreaterThan(0);

		await openSmall(page, info);
		const panel = await openHealth(page, info);
		await panel.getByTestId('health-settings-button').click();

		const days = panel.getByTestId('health-task-days');
		await expect(days).toHaveValue('20');
		await days.fill('2');
		await days.press('Enter');
		await panel.getByRole('button', { name: H.settings.back }).click();
		await expectTotal(page, info, panel, long.findings.length);
		expect(await storedSettings(page, SMALL_SETTINGS_KEY)).toBe('{"longTaskDays":2}');

		// A value that is not a whole number of days is refused with a sentence, and nothing changes.
		await panel.getByTestId('health-settings-button').click();
		await days.fill('0');
		await days.press('Enter');
		await expect(panel.getByRole('alert')).toHaveText(H.settings.invalid);
		await expect(days).toHaveAttribute('aria-invalid', 'true');
		expect(await storedSettings(page, SMALL_SETTINGS_KEY)).toBe('{"longTaskDays":2}');
		// The stepper works from the value shown.
		await days.fill('2');
		await days.press('Enter');
		await panel.getByRole('button', { name: /^More days: Long task/ }).click();
		await expect(days).toHaveValue('3');
		await panel.getByRole('button', { name: /^Fewer days: Long task/ }).click();
		await expect(days).toHaveValue('2');

		// A check turned off has no group.
		await expect(panel.locator('input[data-check="hard-constraint"]')).toBeChecked();
		await panel.locator('input[data-check="hard-constraint"]').uncheck();
		await panel.getByRole('button', { name: H.settings.back }).click();
		await expect(heading(panel, /^Hard constraint/)).toHaveCount(0);
		await expectTotal(page, info, panel, noConstraints.findings.length);
		const stored = JSON.parse((await storedSettings(page, SMALL_SETTINGS_KEY)) ?? '{}');
		expect(stored).toEqual({ longTaskDays: 2, enabled: { 'hard-constraint': false } });
		expect(SMALL_SETTINGS_KEY).toBe('mainspring.health.ui-basic');
	});
});

test.describe('the keyboard path', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(phoneOf(info), 'a keyboard (desktop)');
	});

	test('the button, the tabs and Escape', async ({ page }) => {
		const want = await smallReport(SMALL);
		await page.goto(`/app?sample=${SMALL}&mode=visual&hooks=edits`);
		await expect(page.getByTestId('health-button')).toHaveAttribute(
			'data-count',
			`${want.findings.length}`,
			{
				timeout: READY_TIMEOUT_MS,
			},
		);
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

test.describe('the details take the focus', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(phoneOf(info), 'the desktop tab (a phone has a separate sheet)');
	});

	test('Add task with the Health tab showing leaves it for the details, with the name focused', async ({
		page,
	}, info) => {
		await openSmall(page, info);
		const panel = await openHealth(page, info);
		await expect(panel).toBeVisible();
		await page.getByRole('button', { name: 'Add task' }).first().click();
		const details = page.getByRole('complementary', { name: 'Details' });
		await expect(details).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(details.getByLabel('Name', { exact: true })).toBeFocused();
		await expect(page.getByTestId('health-button')).toHaveAttribute('aria-expanded', 'false');
	});
});

test.describe('a windowed list', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(phoneOf(info), 'a keyboard (desktop)');
	});

	test('Tab walks on through rows that are mounted as the focus reaches them', async ({
		page,
	}, info) => {
		await openPlan(page, info);
		const panel = await openHealth(page, info);
		await panel.locator('[data-group="no-predecessor"] h3').scrollIntoViewIfNeeded();
		const first = findings(panel, 'no-predecessor').first().locator('button').first();
		await first.focus();
		let far = 0;
		for (let i = 0; i < 90; i++) {
			await page.keyboard.press('Tab');
			far = Math.max(
				far,
				await page.evaluate(() =>
					Number(
						document.activeElement?.closest('li[aria-posinset]')?.getAttribute('aria-posinset') ??
							0,
					),
				),
			);
		}
		// Past the rows that were mounted when it began: the window followed the focus.
		expect(far).toBeGreaterThan(14);
		// And the list never mounted the whole group.
		expect(await findings(panel, 'no-predecessor').count()).toBeLessThan(26);
	});
});

test.describe('the list holds still while it is scrolled', () => {
	test.setTimeout(READY_TIMEOUT_MS * 3);

	test('a swipe down the whole list moves no row beyond the scroll, and the app writes no scrollTop', async ({
		page,
	}, info) => {
		await openPlan(page, info);
		const panel = await openHealth(page, info);
		// 90 px a frame to the end: each frame is checked inside driveList, and at the end the first
		// row and the scroller's height hold for 12 frames (the end used to cycle on WebKit).
		const end = await driveList(panel, 90, 600);
		expect(end.key).not.toBe('');
		// Rows are measured as they are, not rounded, so what is above never moves what is shown.
		expect(end.writesDuring).toBe(0);
	});

	test('a swipe up into rows never seen, after "jump to a check", writes scrollTop only once it stops', async ({
		page,
	}, info) => {
		await openPlan(page, info);
		const panel = await openHealth(page, info);
		// This plan's rows of one check are all about as tall, so an estimate is nearly right. Make
		// some rows taller, by their place in the list and a fractional height: the rows above the
		// view then change when they are mounted.
		await page.addStyleTag({
			content:
				'[data-testid="finding"][data-i$="3"], [data-testid="finding"][data-i$="4"], [data-testid="finding"][data-i$="5"] { padding-block-end: 87.5px; }',
		});
		await panel.getByRole('list', { name: 'Findings' }).getByRole('button').last().click();
		await scrollStops(panel);
		// Up through the rows above the check, which were never mounted: their heights are estimates
		// until they are, and the row in view must not move (checked every frame in driveList).
		const up = await driveList(panel, -70, 40);
		expect(up.writesDuring).toBe(0);
		// What the list held with its spacer while the finger scrolled it gives back to the scroller
		// in one step when the scrolling stops, with no row moving (driveList checks that frame too).
		expect(up.writesAfter).toBeGreaterThan(0);
		expect(up.writesAfter).toBeLessThanOrEqual(10);
	});
});

test.describe('the phone path', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(!phoneOf(info), 'a phone');
	});

	test('the status card leads to a full-height sheet whose targets are 44 px', async ({
		page,
	}, info) => {
		await openSmall(page, info);
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
		await openSmall(page, info);
		const button = page.getByTestId('health-button');
		await expect(button).toHaveAttribute(
			'data-count',
			`${(await smallReport(SMALL)).findings.length}`,
			{
				timeout: READY_TIMEOUT_MS,
			},
		);
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
			await openSmall(page, info, scheme);
			const panel = await openHealth(page, info);
			await expect(findings(panel, 'no-predecessor').first()).toBeVisible();
			// A phone's sheet still sliding in lies partly over the toolbar: scan it at rest.
			await panelSettled(panel);
			const scan = () => new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect((await scan()).violations).toEqual([]);
			await panel.getByTestId('health-settings-button').click();
			await expect(panel.getByTestId('health-settings')).toBeVisible();
			await panelSettled(panel);
			expect((await scan()).violations).toEqual([]);
			// The panel as it is named: a region with its title.
			await expect(panelOf(page, info)).toBeVisible();
		});
	}
});
