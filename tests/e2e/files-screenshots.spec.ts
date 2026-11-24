// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of the "which plan?" question (SCREENSHOTS=1; phase-4.md 18.22, T5), light and dark, on
// desktop, Pixel 7 and iPhone 14, when opened files hold two plans (through the files hook: the
// controls are T15's). docs/phases/screenshots/phase-4/t5-which-plan-<device>-<scheme>.png. Without
// SCREENSHOTS=1 the tests are skipped (each boots the engine).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { filesInput, fixturePath, openWithHooks } from './lib/folder-rig';
import { deviceName } from './lib/gantt-rig';
import { pictureReady } from './lib/settle';
import { READY_TIMEOUT_MS } from './lib/text-mode';

const DIR = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-4');
test.setTimeout(READY_TIMEOUT_MS * 2 + 60_000);
test.skip(!process.env['SCREENSHOTS'], 'pictures only on request');

const file = (what: string, info: TestInfo, scheme: string): string =>
	path.join(DIR, `t5-${what}-${deviceName(info)}-${scheme}.png`);

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`files and folders (${scheme})`, () => {
		test.beforeEach(async ({ page }) => {
			fs.mkdirSync(DIR, { recursive: true });
			await page.emulateMedia({ colorScheme: scheme });
		});

		test('the question when opened files hold two plans', async ({ page }, info) => {
			await openWithHooks(page);
			await filesInput(page).setInputFiles([
				fixturePath('several', 'alpha.tjp'),
				fixturePath('several', 'beta.tjp'),
			]);
			await expect(page.getByTestId('plan-question')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('which-plan', info, scheme) });
		});
	});
}
