// SPDX-License-Identifier: GPL-2.0-or-later
// The direct-manipulation rows R1 to R10 of phase-2.md 7.1 with real input (T16, gate criterion 1)
// on the gantt-manipulation sample, on desktop Chrome (a mouse) and the Pixel 7 emulation (a
// finger: taps, and long-presses that are touches held for 450 ms). Each row performs the gesture
// on the canvas or in the task list, asserts the exact text patch (written by hand here from the
// plan's "Text change" column, as a replacement of exact original lines), waits for the engine's
// reschedule, and asserts that one undo restores the text byte for byte. The keyboard path of each
// row (10.2) is exercised on desktop. `?hooks=edits,gantt` only reads: the text, the revision, and
// where the bars are on the screen. With SCREENSHOTS=1 it writes
// docs/phases/screenshots/phase-2/gesture-<what>-<device>-<light|dark>.png.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch, minute } from './lib/gantt-rig';

const SHOTS = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2');

test.describe('direct manipulation (R1 to R10)', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T16); iPhone is reported');
	});

	/** Both themes of the current screen, when asked for. */
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

	test('R1 change effort: drag the end handle (a selected bar), then undo', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.select('design.research');
		const rev = await rig.revision();
		// Friday's end: effort 3d over Mon 2 to Wed 4 March, scaled to the span of five days.
		const to = { x: await rig.x(minute('2026-03-06', 17)), y: b.endEdge.y };
		await rig.drag(b.endEdge, to, {
			pause: async () => {
				await expect(page.getByTestId('gantt-overlay')).toBeVisible();
				await shoot(page, info, 'drag-preview');
			},
		});
		const after = before.replace('    effort 3d\n', '    effort 5d\n');
		await expect.poll(() => rig.text()).toBe(after);
		await expect(rig.toast.last()).toContainText('Effort of Research: 3d to about 5d');
		await rig.rescheduled(rev);
		await expect.poll(() => rig.end('design.research')).toBe(minute('2026-03-06', 17));
		await rig.undoTo(before);
		await rig.redoTo(after);
		await rig.rescheduled(rev + 1);
		// Redo is the history's own apply, with no toast: undo with the key.
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => rig.text()).toBe(before);
	});

	test('R1 by key: Shift+Alt+Right twice is one undo step', async ({ page }, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.row('task:design.research').focus();
		await page.keyboard.press('Shift+Alt+ArrowRight');
		await page.keyboard.press('Shift+Alt+ArrowRight');
		await expect.poll(() => rig.text()).toBe(before.replace('    effort 3d\n', '    effort 5d\n'));
		await expect(rig.toast).toHaveCount(1);
		await rig.undoTo(before);
	});

	test('R2 move: long-press and drag the bar, answer the question once, undo', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.bar('design.research');
		const rev = await rig.revision();
		// Three working days later: Thursday 5 March. The preference is asked, `start` is chosen.
		const to = { x: b.body.x + (await rig.x(minute('2026-03-05', 9))) - b.box.x, y: b.body.y };
		await rig.drag(b.body, to, { hold: rig.hold });
		const ask = page.getByTestId('move-question');
		await expect(ask).toBeVisible();
		await shoot(page, info, 'move-question');
		await ask.getByRole('radio', { name: /fixed start date/ }).check();
		await ask.getByRole('button', { name: 'Move' }).click();
		const after = before.replace(
			'    effort 3d\n    allocate dev1\n',
			'    start 2026-03-05\n    effort 3d\n    allocate dev1\n',
		);
		await expect.poll(() => rig.text()).toBe(after);
		await rig.rescheduled(rev);
		await expect.poll(() => rig.end('design.research')).toBe(minute('2026-03-09', 17));
		await rig.undoTo(before);
	});

	test('R2 by key: Alt+Right three times, the same patch, one undo step', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.row('task:design.research').focus();
		for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowRight');
		const ask = page.getByTestId('move-question');
		await expect(ask).toBeVisible();
		await ask.getByRole('radio', { name: /fixed start date/ }).check();
		await ask.getByRole('button', { name: 'Move' }).click();
		await expect
			.poll(() => rig.text())
			.toBe(
				before.replace(
					'    effort 3d\n    allocate dev1\n',
					'    start 2026-03-05\n    effort 3d\n    allocate dev1\n',
				),
			);
		await rig.undoTo(before);
	});

	test('R3 link: drag from the end dot onto a task (mouse); tap the dot, then the task (touch)', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, 'week');
		const before = await rig.text();
		await rig.select('design.research');
		const rev = await rig.revision();
		// Scroll to the target first, then read both: the chart moves with the scroll.
		await rig.bar('design.review');
		const from = await rig.peek('design.research');
		const target = await rig.peek('design.review');
		if (rig.touch) {
			await rig.tap(from.dot);
			const banner = page.getByTestId('link-banner');
			await expect(banner).toContainText('Linking from Research');
			await shoot(page, info, 'link-mode');
			await rig.tap(target.body);
		} else {
			await rig.drag(from.dot, target.body, {
				pause: async () => {
					await expect(page.getByTestId('gantt-overlay')).toBeVisible();
					await shoot(page, info, 'link-mode');
				},
			});
		}
		// review already depends on sketch: the new one is appended, written as a sibling.
		const after = before.replace(
			'depends !sketch { onstart }',
			'depends !sketch { onstart }, !research',
		);
		await expect.poll(() => rig.text()).toBe(after);
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R3 by key: L, Down to the task, Enter', async ({ page }, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.row('task:design.research').focus();
		await page.keyboard.press('l');
		// Research is row 1; Review is two rows further down.
		await expect(page.getByTestId('link-banner')).toContainText('Linking from Research');
		for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(300);
		await page.keyboard.press('Enter');
		await expect
			.poll(() => rig.text())
			.toBe(
				before.replace('depends !sketch { onstart }', 'depends !sketch { onstart }, !research'),
			);
		await rig.undoTo(before);
	});

	test('R3 shows why a target is not allowed, and a drop there is refused with no change', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'the dry run label is checked on desktop');
		const rig = await Rig.open(page, info, 'month');
		const before = await rig.text();
		// From the gate back to Research: Research is before the gate, so this would close a loop.
		await rig.row('task:design.gate').locator('.label').click();
		await expect(rig.row('task:design.gate')).toHaveAttribute('aria-selected', 'true');
		await rig.bar('design.research');
		const from = await rig.peek('design.gate');
		const research = await rig.peek('design.research');
		await rig.drag(from.dot, research.body, {
			pause: async () => {
				await expect(page.getByTestId('gantt-overlay')).toBeVisible();
				await shoot(page, info, 'link-refused');
			},
		});
		await expect(rig.toast.last()).toContainText(/loop|cycle|circular|depend/i);
		expect(await rig.text()).toBe(before);
	});

	test('R4 remove a link: select the line, then Delete (mouse) or Remove (touch)', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, 'week');
		const before = await rig.text();
		await rig.bar('design.review');
		const rev = await rig.revision();
		const at = await page.evaluate(() =>
			(
				window as unknown as {
					__mainspringGantt: { link(a: string, b: string): { x: number; y: number } | null };
				}
			).__mainspringGantt.link('design.review', 'design.gate'),
		);
		if (!at) throw new Error('no link to select');
		await rig.tap(at);
		if (rig.touch) {
			await page.getByRole('button', { name: 'Remove', exact: true }).click();
		} else {
			await expect(page.getByTestId('inspector')).toContainText('Review');
			await page.keyboard.press('Delete');
		}
		await expect.poll(() => rig.text()).toBe(before.replace('    depends !review { onend }\n', ''));
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R5 reorder: drag a row by its grip to the top level, references fixed; undo', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const rev = await rig.revision();
		const sketch = rig.row('task:design.sketch');
		if (rig.touch) {
			// The grip shows on the selected row; close the sheet so that every row is in reach.
			await sketch.locator('.label').tap();
			await expect(sketch).toHaveAttribute('aria-selected', 'true');
			await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
			await page.waitForTimeout(400);
		} else {
			await sketch.hover();
		}
		const grip = await sketch.getByTestId('row-grip').boundingBox();
		const top = await rig.row('task:design').boundingBox();
		if (!grip || !top) throw new Error('no grip or row');
		const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
		// Above the first row and a step left: first at the top level.
		const to = { x: from.x - 20, y: top.y + 3 };
		await rig.drag(from, to, {
			hold: rig.hold,
			pause: async () => {
				await expect(page.getByTestId('row-drop-line')).toBeVisible();
				await shoot(page, info, 'row-drag');
			},
		});
		const block =
			'  task sketch "Sketch" {\n    length 4d\n    allocate dev2\n    depends !research { gaplength 2d }\n  }\n';
		const first =
			'task sketch "Sketch" {\n  length 4d\n  allocate dev2\n  depends design.research { gaplength 2d }\n}\n\n';
		const after = before
			.replace(block, '')
			.replace('depends !sketch { onstart }', 'depends sketch { onstart }')
			.replace('# Container with ASAP leaves', `${first}# Container with ASAP leaves`);
		await expect.poll(() => rig.text()).toBe(after);
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R5 by key: Alt+Shift+Up swaps the task with the one above; the row menu does the same', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const spike =
			'# Open-ended allocated leaf: a start and an allocation, no size.\ntask spike "Spike" {\n  start 2026-03-23\n  allocate dev3\n}\n\n';
		const launch =
			'# Start and end on one task, and a responsible person.\ntask launch "Launch" {\n  start 2026-05-04\n  end 2026-05-08\n  responsible dev1\n}\n\n';
		const after = before.replace(spike + launch, launch + spike);
		expect(after).not.toBe(before);
		if (rig.touch) {
			// A finger has no keys: the row menu's button (WCAG 2.5.7).
			await rig.row('task:launch').locator('.label').tap();
			await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
			await page.getByTestId('row-menu').tap();
			await page.getByRole('menuitem', { name: 'Move up' }).tap();
		} else {
			await rig.row('task:launch').focus();
			await page.keyboard.press('Alt+Shift+ArrowUp');
		}
		await expect.poll(() => rig.text()).toBe(after);
		await rig.undoTo(before);
	});

	test('R6 assign a person: drag a chip onto a bar (mouse); the sheet adds one (touch)', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.bar('design.research');
		const rev = await rig.revision();
		if (rig.touch) {
			await rig.select('design.research');
			// A finger books people in the details sheet: its people are the palette's twin here.
			await shoot(page, info, 'people-palette');
			await page.getByRole('combobox', { name: /Add a person/ }).selectOption({ label: 'Dev 2' });
		} else {
			const chip = await page.locator('[data-person="dev2"]').boundingBox();
			if (!chip) throw new Error('no chip');
			await rig.drag({ x: chip.x + chip.width / 2, y: chip.y + chip.height / 2 }, b.body, {
				pause: async () => {
					await expect(page.getByTestId('gantt-overlay')).toBeVisible();
					await shoot(page, info, 'people-palette');
				},
			});
		}
		await expect
			.poll(() => rig.text())
			.toBe(
				before.replace(
					'    allocate dev1\n    complete 40\n',
					'    allocate dev1, dev2\n    complete 40\n',
				),
			);
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R6 by key: Enter on a person books them on the selected task, and again releases them', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.select('design.research');
		await page.locator('[data-person="dev2"]').focus();
		await page.keyboard.press('Enter');
		const booked = before.replace(
			'    allocate dev1\n    complete 40\n',
			'    allocate dev1, dev2\n    complete 40\n',
		);
		await expect.poll(() => rig.text()).toBe(booked);
		await expect(page.locator('[data-person="dev2"]')).toHaveAttribute('aria-pressed', 'true');
		await rig.undoTo(before);
	});

	test('R7 replace a person: the inspector chip menu rewrites one id token', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.select('design.research');
		const rev = await rig.revision();
		await page.getByRole('combobox', { name: /Replace Dev 1/ }).selectOption({ label: 'Dev 3' });
		await expect
			.poll(() => rig.text())
			.toBe(
				before.replace(
					'    allocate dev1\n    complete 40\n',
					'    allocate dev3\n    complete 40\n',
				),
			);
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R8 rename: double-click the name (mouse); the name field in the sheet (touch)', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const rev = await rig.revision();
		if (rig.touch) {
			await rig.select('design.research');
			const name = page.getByRole('textbox', { name: 'Name' });
			await name.fill('Investigate');
			await name.press('Enter');
		} else {
			await rig.row('task:design.research').locator('.label').dblclick();
			const field = page.getByRole('textbox', { name: 'Rename Research' });
			await expect(field).toBeFocused();
			await field.fill('Investigate');
			await field.press('Enter');
		}
		await expect
			.poll(() => rig.text())
			.toBe(before.replace('task research "Research"', 'task research "Investigate"'));
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R8 by key: F2 renames in place; Escape leaves the name alone', async ({ page }, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.row('task:design.research').focus();
		await page.keyboard.press('F2');
		const field = page.getByRole('textbox', { name: 'Rename Research' });
		await field.fill('Nope');
		await field.press('Escape');
		await expect(field).toHaveCount(0);
		expect(await rig.text()).toBe(before);
		await expect(rig.row('task:design.research')).toBeFocused();
	});

	test('R9 mark progress: drag the knob to 75 %, then undo', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.select('design.research');
		const rev = await rig.revision();
		const to = { x: b.box.x + b.box.w * 0.75, y: b.knob.y };
		await rig.drag(b.knob, to, { steps: 6 });
		await expect
			.poll(() => rig.text())
			.toBe(before.replace('    complete 40\n', '    complete 75\n'));
		await rig.rescheduled(rev);
		await rig.undoTo(before);
	});

	test('R9 by key: P, Right seven times, Enter is one undo step', async ({ page }, info) => {
		test.skip(isTouch(info), 'the keyboard path is checked on desktop');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.row('task:design.research').focus();
		await page.keyboard.press('p');
		for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');
		await expect
			.poll(() => rig.text())
			.toBe(before.replace('    complete 40\n', '    complete 75\n'));
		await expect(rig.toast).toHaveCount(1);
		await rig.undoTo(before);
	});

	test('R10 navigate: scroll and zoom change the view and never the text', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, 'week');
		const before = await rig.text();
		const gantt = page.getByTestId('gantt');
		const scroller = page.getByTestId('gantt').locator('.scroller');
		const left0 = await scroller.evaluate((el) => el.scrollLeft);
		const box = await scroller.boundingBox();
		if (!box) throw new Error('no chart');
		if (rig.touch) {
			const y = box.y + 140;
			// One finger pans natively.
			await rig.drag({ x: box.x + box.width - 40, y }, { x: box.x + 160, y }, { steps: 12 });
			await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(left0);
		} else {
			// Over the chart itself (the middle of the overlay is under the task list).
			await page.mouse.move(box.x + box.width - 200, box.y + 200);
			await page.mouse.wheel(300, 0);
			await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(left0);
			await page.keyboard.down('Control');
			await page.mouse.wheel(0, -400);
			await page.keyboard.up('Control');
			await expect(gantt).not.toHaveAttribute('data-zoom', 'week');
		}
		await page.getByLabel('Zoom').selectOption('quarter');
		await expect(gantt).toHaveAttribute('data-zoom', 'quarter');
		expect(await rig.text()).toBe(before);
		// Nothing was done, so there is nothing to undo.
		// (A phone's top bar has no undo button; its text is unchanged and no toast came up.)
		if (!rig.touch)
			await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeDisabled();
		await expect(rig.toast).toHaveCount(0);
	});
});
