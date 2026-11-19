// SPDX-License-Identifier: GPL-2.0-or-later
// The fixes of the health panel (phase-3.md 9.7, section 12; T18) on `fedora-res`, desktop Chrome, the
// Pixel 7 emulation and the iPhone 14 (WebKit). Each kind of fix is pressed in the real panel and what it did is read from
// the plan's text, exactly: the patch is the text before with one change, one Undo restores every
// byte, and the finding goes and comes back with the schedule. The kinds:
// - "Remove start" (H3): `removeAttr`; "Convert gap to task" and "Edit gap" (H5): `gapToTask`,
//   `setDependsGap`; "Replace Desktop 01…" (H8): `replaceAllocation`; "Add predecessor…" (H1): the
//   dependency picker of the details, ending in `addDepends`;
// - a refusal shows the dispatcher's toast and changes nothing (a gap that is not a gap);
// - a fix whose text is written with a macro is disabled, with the reason.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { refusalStrings } from '../../src/lib/strings';
import { READY_TIMEOUT_MS } from './lib/gantt-rig';
import {
	changedLines,
	expected,
	findings,
	rowOf,
	openHealth,
	openPlan,
	settled,
	textOf,
	undo,
} from './lib/health-rig';

test.setTimeout(READY_TIMEOUT_MS * 3);
test.use({ actionTimeout: 20_000 });

/** Waits until the plan's text is not `before`, and returns it. */
async function changedFrom(page: Page, before: string): Promise<string> {
	await expect.poll(() => textOf(page), { timeout: 30_000 }).not.toBe(before);
	return textOf(page);
}

/**
 * Undo restores every byte. The toast says the edit is scheduled and keeps its Undo for 6 s after
 * that, so a caller that waits for something else first does it between `settled` and this.
 */
async function undone(page: Page, info: Parameters<typeof undo>[1], before: string): Promise<void> {
	await settled(page);
	await undo(page, info);
	await expect.poll(() => textOf(page), { timeout: 30_000 }).toBe(before);
}

const NAMING = 'f20.naming';
const WIKI = 'f20.PlanningPhase.clean_market_wiki';
const LICENSE = 'f20.supplement_wallpaper.supplement_license_review';
const DESIGN = 'f20.PlanningPhase.design_concept';

/** The plan open with its health panel, the text before any fix, and a row's fix button by kind. */
async function ready(page: Page, info: Parameters<typeof undo>[1]) {
	await openPlan(page, info);
	const panel = await openHealth(page, info);
	const start = await textOf(page);
	const fix = (row: Locator, kind: string) => row.locator(`[data-fix="${kind}"]`);
	return { panel, start, fix };
}

// One test per kind of fix (each was a step of one long test that could outlast its timeout on a
// busy WebKit runner); each opens the plan afresh, so none depends on another's Undo.
test.describe('every fix kind makes an exact patch that Undo takes back', () => {
	test('H3 "Remove start": the date goes, the comment after it stays', async ({ page }, info) => {
		const { panel, start, fix } = await ready(page, info);
		const h3 = await rowOf(panel, 'hard-constraint', NAMING);
		await expect(h3).toHaveCount(1);
		await expect(h3).toContainText('Its start is fixed');
		await expect(fix(h3, 'removeAttr')).toHaveText(/^Remove start \(.*2013\)$/);
		await fix(h3, 'removeAttr').click();
		const removed = await changedFrom(page, start);
		expect(removed).toBe(start.replace('start 2013-09-17   # manually', '# manually'));
		// The finding goes with the result that includes the edit, and comes back with Undo.
		await settled(page);
		await expect(findings(panel, 'hard-constraint', NAMING)).toHaveCount(0, { timeout: 5_000 });
		await undone(page, info, start);
		await expect(findings(panel, 'hard-constraint', NAMING)).toHaveCount(1, {
			timeout: READY_TIMEOUT_MS,
		});
	});

	test('H5 "Convert gap to task": a waiting task takes the gap, as one edit', async ({
		page,
	}, info) => {
		const { panel, start, fix } = await ready(page, info);
		await rowOf(panel, 'long-gap', WIKI);
		const gap = () => findings(panel, 'long-gap', WIKI);
		await expect(gap()).toHaveCount(1);
		await expect(gap()).toContainText('Waits 25 working days after Start Feature Submission');
		await fix(gap(), 'gapToTask').click();
		const converted = await changedFrom(page, start);
		const at = start.indexOf('    task clean_market_wiki') - 1;
		const inserted =
			'\n    task wait_after_start_feature_submission "Wait after Start Feature Submission" {\n      length 25d\n      depends !start_features_cal\n    }\n';
		expect(converted).toBe(
			start.slice(0, at) +
				inserted +
				start
					.slice(at)
					.replace(
						'depends !start_features_cal {gaplength 25d}',
						'depends !wait_after_start_feature_submission',
					),
		);
		await undone(page, info, start);
		await expect(gap()).toHaveCount(1, { timeout: READY_TIMEOUT_MS });
	});

	test('H5 "Edit gap": a gap that is no gap is refused; a good one changes only that value', async ({
		page,
	}, info) => {
		const { panel, start, fix } = await ready(page, info);
		await rowOf(panel, 'long-gap', WIKI);
		const gap = () => findings(panel, 'long-gap', WIKI);
		await expect(gap()).toHaveCount(1);
		// The field starts from the gap written; the refusal is the dispatcher's toast, and nothing
		// changes.
		await fix(gap(), 'setDependsGap').click();
		const field = gap().getByRole('textbox', { name: 'Gap', exact: true });
		await expect(field).toHaveValue('25d');
		await field.fill('soon');
		await field.press('Enter');
		const toast = page.getByTestId('toast').last();
		await expect(toast).toContainText(refusalStrings['invalid-value']);
		expect(await textOf(page)).toBe(start);
		await field.fill('10d');
		await field.press('Enter');
		const edited = await changedFrom(page, start);
		expect(changedLines(start, edited)).toEqual([
			[
				'      depends !start_features_cal {gaplength 25d}',
				'      depends !start_features_cal {gaplength 10d}',
			],
		]);
		await expect(gap().getByRole('textbox', { name: 'Gap', exact: true })).toHaveCount(0);
		await undone(page, info, start);
	});

	test('H8 "Replace Desktop 01…": the chip\'s own edit, to a person chosen from the list', async ({
		page,
	}, info) => {
		const { panel, start } = await ready(page, info);
		const h8 = await rowOf(panel, 'work-without-people', LICENSE);
		await expect(h8).toHaveCount(1);
		await expect(h8).toContainText('Runs without Desktop 01 for 56 hours');
		const choose = h8.locator('select[data-fix="replace-person"]');
		await expect(choose.locator('option').first()).toHaveText('Replace Desktop 01…');
		await choose.selectOption({ label: 'Desktop 02' });
		const replaced = await changedFrom(page, start);
		const lines = changedLines(start, replaced);
		expect(lines).toHaveLength(1);
		expect(lines[0]?.[1]).toBe(lines[0]?.[0].replace('desk01', 'desk02'));
		await undone(page, info, start);
	});

	test('H1 "Add predecessor…": the picker\'s choice is one addDepends, and Undo restores the report', async ({
		page,
	}, info) => {
		const { panel, start, fix } = await ready(page, info);
		// The details open on the dependency picker; choosing a task is one `addDepends`; and the way
		// back is the same Undo.
		const h1 = await rowOf(panel, 'no-predecessor', DESIGN);
		await expect(h1).toHaveCount(1);
		await fix(h1, 'pick').click();
		const picker = page.getByTestId('depends-picker');
		await expect(picker).toBeVisible();
		await picker
			.locator('[role="option"][data-task="f20.PlanningPhase.start_features_cal"]')
			.click();
		const linked = await changedFrom(page, start);
		expect(linked.split('\n').length).toBe(start.split('\n').length + 1);
		expect(linked).toMatch(/depends !start_features_cal\n/);
		await undone(page, info, start);
		// The panel left for the details; opened again, the report as a whole is the golden's.
		const again = await openHealth(page, info);
		await expect(again.getByTestId('health-summary')).toHaveText(
			`${expected().findings.length} problems in 7 checks`,
			{ timeout: READY_TIMEOUT_MS },
		);
	});
});

test('a fix whose text is written with a macro is disabled, and says why', async ({
	page,
}, info) => {
	await openPlan(page, info);
	const panel = await openHealth(page, info);
	// Fedora's root has `start ${start_work}`: the constraint is reported, and cannot be removed here.
	const root = await rowOf(panel, 'hard-constraint', 'f20');
	await expect(root).toHaveCount(1);
	await expect(root).toContainText('applies to 273 tasks');
	await expect(root.locator('[data-fix="removeAttr"]')).toBeDisabled();
	await expect(root.getByTestId('fix-off')).toHaveText(
		'Written with a macro. Edit it in the text.',
	);
	// The way to the text stays: "Why here?" is not an edit.
	await expect(root.locator('[data-fix="why"]')).toBeEnabled();
	// And no text changed.
	const before = await textOf(page);
	await root.locator('[data-fix="removeAttr"]').click({ force: true, trial: true });
	expect(await textOf(page)).toBe(before);
});
