// SPDX-License-Identifier: GPL-2.0-or-later
// What the single-file rows of gantt-manipulation.spec.ts leave out (phase-2.md 7.1, 13.2): the
// extra row (add and delete a task) and the edits that reach into the included file lib/build.tji,
// on desktop Chrome (keys) and the Pixel 7 emulation (the row menu's buttons). Every test asserts
// the exact text of every file it changes, and that the other file is byte for byte as it was
// (hand-written expected text, as an exact replacement of original lines), then one Undo restores
// both files and one Redo gives the patch again. With SCREENSHOTS=1 it writes
// docs/phases/screenshots/phase-2/gesture-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';

const SHOTS = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');
const TJI = 'lib/build.tji';

type Files = { plan: string; tji: string };

test.describe('adding, deleting and the included file', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T21); iPhone is reported');
	});

	const files = async (rig: Rig): Promise<Files> => ({
		plan: await rig.text(),
		tji: await rig.text(TJI),
	});
	/** Both files, polled until they are exactly the expected text. */
	const expectFiles = async (rig: Rig, want: Files): Promise<void> => {
		await expect.poll(() => files(rig)).toEqual(want);
	};
	/** One Undo (the newest toast's, or a phone's top bar's), then one Redo with the keyboard: both files each time. */
	async function undoRedo(page: Page, rig: Rig, before: Files, after: Files): Promise<void> {
		await expect(rig.edited.last()).toBeAttached();
		await rig.undoNewest();
		await expectFiles(rig, before);
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('ControlOrMeta+Shift+z');
		await expectFiles(rig, after);
	}
	async function shoot(page: Page, info: TestInfo, what: string): Promise<void> {
		if (process.env['SCREENSHOTS'] !== '1') return;
		const device = isTouch(info) ? 'pixel-7' : 'desktop';
		await page.screenshot({ path: path.join(SHOTS, `gesture-${what}-${device}-light.png`) });
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.waitForTimeout(250);
		await page.screenshot({ path: path.join(SHOTS, `gesture-${what}-${device}-dark.png`) });
		await page.emulateMedia({ colorScheme: 'light' });
		await page.waitForTimeout(150);
	}
	/** A finger has no keys: select the row (a first tap opens no sheet) and press the row menu's item. */
	async function menu(page: Page, rig: Rig, key: string, item: string): Promise<void> {
		await rig.row(key).locator('.label').tap();
		await expect(rig.row(key)).toHaveAttribute('aria-selected', 'true');
		await page.getByTestId('row-menu').tap();
		await page.getByRole('menuitem', { name: item }).tap();
	}

	test('add: a task after the selected one is written as one line; undo, redo', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await files(rig);
		const rev = await rig.revision();
		if (isTouch(info)) await menu(page, rig, 'task:launch', 'Add a task after');
		else {
			await rig.row('task:launch').focus();
			await page.keyboard.press('Insert');
		}
		const after = {
			...before,
			plan: before.plan.replace(
				'  responsible dev1\n}\n\n',
				'  responsible dev1\n}\n\ntask new_task "New task"\n\n',
			),
		};
		expect(after.plan).not.toBe(before.plan);
		await expectFiles(rig, after);
		await rig.rescheduled(rev);
		await expect(rig.row('task:new_task')).toBeVisible();
		await shoot(page, info, 'add-task');
		await undoRedo(page, rig, before, after);
		await expect(rig.row('task:new_task')).toBeVisible();
	});

	test('delete: a task nobody waits for is cut with its comment; undo, redo', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await files(rig);
		const rev = await rig.revision();
		if (isTouch(info)) await menu(page, rig, 'task:spike', 'Delete');
		else {
			await rig.row('task:spike').focus();
			await page.keyboard.press('Delete');
		}
		const spike =
			'# Open-ended allocated leaf: a start and an allocation, no size.\ntask spike "Spike" {\n  start 2026-03-23\n  allocate dev3\n}\n\n';
		const after = { ...before, plan: before.plan.replace(spike, '') };
		expect(after.plan).not.toBe(before.plan);
		await expectFiles(rig, after);
		await rig.rescheduled(rev);
		await expect(rig.row('task:spike')).toHaveCount(0);
		await undoRedo(page, rig, before, after);
		await expect(rig.row('task:spike')).toHaveCount(0);
	});

	test('R1 in the included file: only lib/build.tji changes; undo, redo', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await files(rig);
		const rev = await rig.revision();
		const after = { ...before, tji: before.tji.replace('effort 6d', 'effort 7d') };
		expect(after.tji).not.toBe(before.tji);
		if (isTouch(info)) {
			await rig.openDetails('build.code');
			const more = page.getByRole('button', { name: 'Increase Effort' });
			await more.tap();
		} else {
			await rig.row('task:build.code').focus();
			await page.keyboard.press('Control+Alt+ArrowRight');
		}
		await expectFiles(rig, after);
		expect(after.plan).toBe(before.plan);
		await rig.rescheduled(rev);
		await rig.barOnEngine('build.code');
		await undoRedo(page, rig, before, after);
	});

	test('R5 across files: Design gate moves out of Design, and the references in both files follow', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await files(rig);
		const rev = await rig.revision();
		const gate0 = await rig.end('design.gate');
		expect(gate0).not.toBeNull();
		if (isTouch(info)) await menu(page, rig, 'task:design.gate', 'Outdent');
		else {
			await rig.row('task:design.gate').focus();
			await page.keyboard.press('Alt+Shift+ArrowLeft');
		}
		// The block leaves Design, is written one level out after it, and its own references to
		// the siblings become absolute; Hotfix (this file) and Build (the other) now name `gate`.
		const inside =
			'  task gate "Design gate" {\n    milestone\n    depends !review { onend }\n    depends !docs\n  }\n';
		const outside =
			'task gate "Design gate" {\n  milestone\n  depends design.review { onend }\n  depends design.docs\n}\n\n';
		const after = {
			plan: before.plan
				.replace(inside, '')
				.replace('# Open-ended allocated leaf', `${outside}# Open-ended allocated leaf`)
				.replace('    depends design.gate\n', '    depends gate\n'),
			tji: before.tji.replace('  depends design.gate\n', '  depends !gate\n'),
		};
		expect(after.plan).not.toBe(before.plan);
		expect(after.tji).not.toBe(before.tji);
		await expectFiles(rig, after);
		await rig.rescheduled(rev);
		// The milestone did not move: the references still point at it.
		await expect.poll(() => rig.end('gate')).toBe(gate0);
		await shoot(page, info, 'move-across-files');
		await undoRedo(page, rig, before, after);
	});
});
