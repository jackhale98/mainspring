// SPDX-License-Identifier: GPL-2.0-or-later
// Unified undo across typing and visual edits (phase-2.md 6.7, ADR-0008; the plan's "unified undo
// across text and visual edits"): a few characters typed in the editor and then a visual edit are
// two steps of one history. Mod-Z undoes the visual edit and then the typing, Mod-Shift-Z gives
// both back, in that order, and the text is exactly what it was at each step (hand-written
// expected text). Desktop Chrome (Split, the editor beside the Gantt) and Pixel 7 (the Text tab,
// then the Gantt tab). The keys go to the page's own binding, with the focus on the task list.
import { expect, test } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

test.describe('one history for typing and visual edits', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T21); iPhone is reported');
	});

	test('type, then edit on the chart: undo twice, redo twice', async ({ page }, info) => {
		const rig = await Rig.open(page, info, undefined, 'split');
		const original = await rig.text();
		const typed = original.replace('    effort 3d\n', '    effort 3d # note\n');
		const both = original.replace('    effort 3d\n', '    effort 4d # note\n');
		expect(typed).not.toBe(original);

		// The typing: at the end of the line `effort 3d` in the editor.
		if (isTouch(info)) await page.getByRole('tab', { name: 'Text', exact: true }).click();
		// The editor draws only the lines in or near its view: scroll until the line is there.
		const line = page.locator('.cm-content .cm-line').filter({ hasText: 'effort 3d' }).first();
		for (let i = 0; i < 60 && (await line.count()) === 0; i++) {
			await page.locator('.cm-scroller').evaluate((e) => void (e.scrollTop += e.clientHeight / 2));
			await page.waitForTimeout(40);
		}
		await line.scrollIntoViewIfNeeded({ timeout: 5000 });
		await line.click();
		await page.keyboard.press('End');
		await page.keyboard.insertText(' # note');
		await expect.poll(() => rig.text()).toBe(typed);

		// The edit on the chart: one more unit of effort, by the key on the task's row.
		if (isTouch(info)) {
			await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
			await rig.openDetails('design.research');
			await page.getByRole('button', { name: 'Increase Effort' }).tap();
		} else {
			await rig.row('task:design.research').focus();
			await page.keyboard.press('Control+Alt+ArrowRight');
		}
		await expect.poll(() => rig.text()).toBe(both);
		await expect(rig.toast.last()).toBeVisible();

		// Undo twice (the focus is on the chart, not in a text field), redo twice.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => rig.text()).toBe(typed);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => rig.text()).toBe(original);
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expect.poll(() => rig.text()).toBe(typed);
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expect.poll(() => rig.text()).toBe(both);
		// The engine caught up with the final text.
		await rig.barOnEngine('design.research');
	});
});
