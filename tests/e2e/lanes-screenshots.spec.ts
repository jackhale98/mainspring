// SPDX-License-Identifier: GPL-2.0-or-later
// Screenshots of the Resources lanes (phase-3.md 13.2; CLAUDE.md "mobile counts"): desktop and
// Pixel 7 emulation, light and dark, to docs/phases/screenshots/phase-3/t15-*.png:
// - fedora-res: the groups' roll-ups, bars with names, a week of annual leave hatched;
// - gantt-manipulation: a text-only bar with its badge, the over strip, and a bar lifted mid-drag
//   to another person; the period details of a bar.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { READY_TIMEOUT_MS, deviceName } from './lib/gantt-rig';
import { LanesRig } from './lib/lanes-rig';

const DIR = path.join(process.cwd(), 'docs/phases/screenshots/phase-3');

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T15)');
});
test.setTimeout(READY_TIMEOUT_MS * 2);

for (const scheme of ['light', 'dark'] as const) {
	test(`lanes screenshots (${scheme})`, async ({ page }, info) => {
		fs.mkdirSync(DIR, { recursive: true });
		const device = deviceName(info);
		const shot = async (name: string): Promise<void> => {
			await page.waitForTimeout(500);
			await page.screenshot({ path: path.join(DIR, `t15-${name}-${device}-${scheme}.png`) });
		};

		// fedora-res: roll-ups, names and leave.
		let rig = await LanesRig.openLanes(page, info, 'fedora-res', scheme);
		const annual = (await rig.leaves('desk04')).find((l) => l.type === 'annual')?.runs[0];
		if (!annual) throw new Error('no annual leave');
		await rig.minutePoint('desk04', annual.from - 60 * 24 * 14);
		await rig.revealPerson('desk04');
		await shot('lanes-fedora-res');

		// gantt-manipulation: the badge, the over strip, a lifted bar mid-drag, the details.
		rig = await LanesRig.openLanes(page, info, 'gantt-manipulation', scheme);
		await rig.revealPerson('ops1');
		await expect
			.poll(async () => (await rig.bands('ops1')).includes('over'), { timeout: 60_000 })
			.toBe(true);
		await shot('lanes-badge-over');
		const from = await rig.barPoint('dev1', 'design.research', 0, 12);
		const to = await rig.lane('dev2', from.x);
		await rig.drag(from, to, {
			hold: rig.hold,
			steps: 6,
			pause: async () => {
				await shot('lanes-drag-to-person');
			},
		});
		// The drop edits the plan: take it back, then open the details of a period.
		await rig.undoNewest();
		await expect.poll(() => rig.text()).not.toContain('allocate dev2\n    complete 40');
		const bar = await rig.barPoint('dev3', 'spike', 0, 10);
		await rig.tap(bar);
		if (rig.touch) await rig.tap(bar);
		await expect(rig.root.getByTestId('cell-details')).toBeVisible();
		await shot('lanes-details');
	});
}
