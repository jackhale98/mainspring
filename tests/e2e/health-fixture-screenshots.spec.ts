// SPDX-License-Identifier: GPL-2.0-or-later
// The pictures of gate criterion 2 (phase-3.md 16.2): the health panel on each failing fixture, on a
// desktop for all nine checks and on the phones for two of them (H1 and H7). Each fixture's text
// (tests/fixtures/health/<check>/fail/plan.tjp) is typed into the small `ui-people` plan, as
// health-fixtures.spec.ts does; before each picture the panel must list exactly the findings the
// unit oracle gives for that fixture's committed golden (one finding, of the fixture's own check),
// so the picture is evidence of the right result. Light only. Run with SCREENSHOTS=1; it writes
// `t24-health-<check>-fail-<device>-light.png` to docs/phases/screenshots/phase-3/.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { goldenReport } from '../../src/lib/health/testing';
import type { CheckId } from '../../src/lib/health/types';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, deviceName, isTouch } from './lib/gantt-rig';
import { fixtureText, openHealth, panelOf, setPlan } from './lib/health-rig';
import { panelSettled, pictureReady } from './lib/settle';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

const FIXTURES: ReadonlyArray<{ dir: string; id: string; check: CheckId; phone: boolean }> = [
	{ dir: 'h1-no-predecessor', id: 'h1', check: 'no-predecessor', phone: true },
	{ dir: 'h2-no-successor', id: 'h2', check: 'no-successor', phone: false },
	{ dir: 'h3-hard-constraint', id: 'h3', check: 'hard-constraint', phone: false },
	{ dir: 'h4-constraint-warning', id: 'h4', check: 'constraint-warning', phone: false },
	{ dir: 'h5-long-gap', id: 'h5', check: 'long-gap', phone: false },
	{ dir: 'h6-long-task', id: 'h6', check: 'long-task', phone: false },
	{ dir: 'h7-held-by-people', id: 'h7', check: 'held-by-people', phone: true },
	{ dir: 'h8-work-without-people', id: 'h8', check: 'work-without-people', phone: false },
	{ dir: 'h9-resource-warnings', id: 'h9', check: 'resource-warning', phone: false },
];

/** The checks of the findings the panel lists, one entry per finding. */
function listed(page: Page, info: TestInfo): Promise<string[]> {
	return panelOf(page, info)
		.locator('[data-testid="finding"]')
		.evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset['check'] ?? '').sort());
}

test.describe('health panel on the failing fixtures (16.2)', () => {
	test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1 to write docs/phases/screenshots');
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.use({ actionTimeout: 20_000 });

	for (const f of FIXTURES) {
		test(`${f.id} (${f.check}): the panel shows its one finding`, async ({ page }, info) => {
			test.skip(isTouch(info) && !f.phone, 'the phones picture H1 and H7 only (16.2)');
			const want = goldenReport(`health-${f.id}-fail`).findings;
			expect(want).toHaveLength(1);
			expect(want[0]?.check).toBe(f.check);

			await page.emulateMedia({ colorScheme: 'light' });
			await Rig.open(page, info, undefined, 'visual', 'ui-people');
			await setPlan(page, info, fixtureText(f.dir, 'fail'));
			const panel = await openHealth(page, info);
			await panelSettled(panel);
			await expect.poll(() => listed(page, info), { timeout: READY_TIMEOUT_MS }).toEqual([f.check]);
			await expect(panel.getByTestId('health-summary')).toContainText('1 problem');
			await pictureReady(page);
			await page.screenshot({
				path: path.join(DIR, `t24-health-${f.dir}-fail-${deviceName(info)}-light.png`),
			});
		});
	}
});
