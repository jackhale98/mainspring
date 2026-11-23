// SPDX-License-Identifier: GPL-2.0-or-later
// Gate criterion 2 in the app (phase-3.md 16.2): "health.spec.ts opens two pairs in the app (H1 and
// H7) and shows the panel's results match the unit results". Each fixture's text
// (tests/fixtures/health/<check>/{pass,fail}/plan.tjp) is typed into the Text editor of the small
// `ui-people` plan, which replaces the plan; the panel (a desktop's right panel, a phone's sheet)
// then lists exactly the findings the unit oracle gives for that fixture's committed golden
// (`checkPlan` over the golden, src/lib/health): the failing fixture has the check's findings on
// its tasks and the passing one has none of that check. The Health button (or the status card on a
// phone) carries the same total. The file is named for its job; health.spec.ts has the rest.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { goldenReport } from '../../src/lib/health/testing';
import type { CheckId } from '../../src/lib/health/types';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import { fixtureText, openHealth, setPlan } from './lib/health-rig';
import { panelSettled } from './lib/settle';

test.setTimeout(READY_TIMEOUT_MS * 2);
test.use({ actionTimeout: 20_000 });

const PAIRS: ReadonlyArray<{ dir: string; id: string; check: CheckId }> = [
	{ dir: 'h1-no-predecessor', id: 'h1', check: 'no-predecessor' },
	{ dir: 'h7-held-by-people', id: 'h7', check: 'held-by-people' },
];

/** The findings the panel lists, as `check:task` strings (a finding without a task has none). */
async function listed(page: Page, info: TestInfo): Promise<string[]> {
	const panel = isTouch(info)
		? page.getByRole('dialog', { name: 'Plan health' })
		: page.getByRole('complementary', { name: 'Plan health' });
	return panel
		.locator('[data-testid="finding"]')
		.evaluateAll((rows) =>
			rows
				.map(
					(r) =>
						`${(r as HTMLElement).dataset['check']}:${(r as HTMLElement).dataset['task'] ?? ''}`,
				)
				.sort(),
		);
}

for (const pair of PAIRS) {
	test(`${pair.id}: the pass and fail fixtures list what the unit oracle says (${pair.check})`, async ({
		page,
	}, info) => {
		const touch = isTouch(info);
		await Rig.open(page, info, undefined, 'visual', 'ui-people');
		for (const side of ['pass', 'fail'] as const) {
			const want = goldenReport(`health-${pair.id}-${side}`);
			const expected = want.findings
				.map((f) => `${f.check}:${f.subject.kind === 'task' ? f.subject.id : ''}`)
				.sort();
			// The failing fixture fails this check; the passing one has none of it.
			const ofCheck = expected.filter((e) => e.startsWith(`${pair.check}:`));
			if (side === 'fail') expect(ofCheck.length).toBeGreaterThan(0);
			else expect(ofCheck).toEqual([]);

			await setPlan(page, info, fixtureText(pair.dir, side));
			const panel = await openHealth(page, info);
			await panelSettled(panel);
			// The list is the unit oracle's, finding for finding (the plans are far under a window's rows).
			await expect.poll(() => listed(page, info), { timeout: READY_TIMEOUT_MS }).toEqual(expected);
			// The total in the button's data (desktop) or the card's row (phone) is the same number.
			if (touch) {
				await page.getByRole('button', { name: 'Close plan health' }).tap();
				await page.getByTestId('status-button').tap();
				await expect(page.getByTestId('open-health')).toHaveText(`Plan health: ${expected.length}`);
				await page.keyboard.press('Escape');
				await expect(page.getByTestId('open-health')).toBeHidden();
			} else {
				await expect(page.getByTestId('health-button')).toHaveAttribute(
					'data-count',
					String(expected.length),
				);
				await page.getByTestId('health-button').click();
			}
		}
	});
}
