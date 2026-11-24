// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures of T5's temporary file entries (SCREENSHOTS=1; phase-4.md 7.2, 18.22), light and dark,
// on desktop, Pixel 7 and iPhone 14: the chooser with its "Files" group (drawn as a list box: a
// native picker is not in a screenshot), and the "which plan?" question when opened files hold two
// plans. docs/phases/screenshots/phase-4/t5-<what>-<device>-<scheme>.png. Without SCREENSHOTS=1 the
// tests are skipped (each boots the engine).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { strings } from '../../src/lib/strings';
import { REPO } from '../golden/corpus';
import { chooser, fixturePath } from './lib/folder-rig';
import { deviceName } from './lib/gantt-rig';
import { pictureReady } from './lib/settle';
import { READY_TIMEOUT_MS, openApp } from './lib/text-mode';

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

		test('the chooser with its Files group', async ({ page }, info) => {
			await openApp(page, 'ui-basic');
			await expect(
				chooser(page).locator(`optgroup[label="${strings.planFiles.group}"]`),
			).toHaveCount(1);
			await chooser(page).evaluate((select: HTMLSelectElement) => {
				const box = select.closest('label')?.getBoundingClientRect();
				select.size = 22;
				Object.assign(select.style, {
					position: 'fixed',
					inset: 'auto',
					left: `${Math.max(8, Math.min(box?.left ?? 0, window.innerWidth - 312))}px`,
					top: `${(box?.bottom ?? 0) + 6}px`,
					width: '19rem',
					height: 'auto',
					opacity: '1',
					zIndex: '100',
					border: '1px solid var(--color-border-strong)',
					borderRadius: '10px',
					background: 'var(--color-surface)',
					color: 'var(--color-text)',
					fontSize: '15px',
					padding: '4px',
					boxShadow: 'var(--shadow-raised)',
				});
				select.scrollTop = select.scrollHeight;
			});
			await pictureReady(page);
			await page.screenshot({ path: file('chooser', info, scheme) });
		});

		test('the question when opened files hold two plans', async ({ page }, info) => {
			await openApp(page, 'ui-basic');
			await page
				.getByTestId('open-files-input')
				.setInputFiles([fixturePath('several', 'alpha.tjp'), fixturePath('several', 'beta.tjp')]);
			await expect(page.getByTestId('plan-question')).toBeVisible();
			await pictureReady(page);
			await page.screenshot({ path: file('which-plan', info, scheme) });
		});
	});
}
