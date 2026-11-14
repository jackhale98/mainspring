// SPDX-License-Identifier: GPL-2.0-or-later
// An edit that applies but breaks scheduling (phase-2.md 11.2, 13.2; the edit API does not refuse
// errors that only the scheduler finds). A size of 900 days typed in the inspector cannot fit the
// project's time frame: the toast says the plan no longer schedules, the Gantt keeps the last good
// schedule (its bar is where it was, the chart is marked as the last good one), the status says
// "not scheduled", and Undo gives back the text and a schedule. Redo breaks it again, and one more
// Undo mends it. Desktop Chrome and Pixel 7. With SCREENSHOTS=1 it writes
// docs/phases/screenshots/phase-2/not-scheduled-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

const SHOTS = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');

test.describe('an edit that stops the plan scheduling', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T21); iPhone is reported');
	});

	test('keeps the last good schedule, and Undo and Redo go through it', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		const status = page.getByRole('group', { name: 'Plan status' });
		const before = await rig.text();
		const patched = before.replace('    effort 3d\n', '    effort 900d\n');
		const end0 = await rig.end('design.research');
		const rev0 = await rig.revision();
		expect(end0).not.toBeNull();

		await rig.select('design.research');
		const size = page.getByRole('group', { name: 'Effort' }).getByRole('textbox');
		await size.fill('900d');
		await size.press('Enter');
		await expect.poll(() => rig.text()).toBe(patched);

		// The first result that includes the edit is an error: the toast settles as such, with Undo.
		await expect(rig.toast.last()).toHaveAttribute('data-status', 'not-scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(status).toContainText('Not scheduled');
		await expect(status).toContainText('last good');
		// The Gantt did not move: the newest good result is still the old one.
		expect(await rig.revision()).toBe(rev0);
		expect(await rig.end('design.research')).toBe(end0);
		await rig.barOnEngine('design.research');
		if (process.env['SCREENSHOTS'] === '1') {
			const device = isTouch(info) ? 'pixel-7' : 'desktop';
			await page.screenshot({ path: path.join(SHOTS, `not-scheduled-${device}-light.png`) });
			await page.emulateMedia({ colorScheme: 'dark' });
			await page.waitForTimeout(250);
			await page.screenshot({ path: path.join(SHOTS, `not-scheduled-${device}-dark.png`) });
			await page.emulateMedia({ colorScheme: 'light' });
			await page.waitForTimeout(150);
		}

		// Undo: the text is back, and the engine schedules it again.
		await rig.toast.last().getByRole('button', { name: 'Undo' }).click();
		await expect.poll(() => rig.text()).toBe(before);
		await expect(status).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
		await expect(status).not.toContainText('Not scheduled');
		await expect(status).not.toContainText('last good');
		expect(await rig.end('design.research')).toBe(end0);

		// Redo breaks it again, with the same last good schedule showing; Undo mends it once more.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expect.poll(() => rig.text()).toBe(patched);
		await expect(status).toContainText('Not scheduled', { timeout: READY_TIMEOUT_MS });
		expect(await rig.end('design.research')).toBe(end0);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => rig.text()).toBe(before);
		await expect(status).toContainText('Scheduled', { timeout: READY_TIMEOUT_MS });
		await expect(status).not.toContainText('Not scheduled');
	});
});
