// SPDX-License-Identifier: GPL-2.0-or-later
// A short drag of a bar's size handle, from a bar whose end is near the chart's right edge (the
// bug found while repairing gantt-perf: 48 px at week zoom made an edit only now and then). The
// edge auto-scroll ran toward the edge while the pointer moved away from it, the chart ran under
// the pointer, and the two cancelled out: the drag ended on the day it began on, and nothing was
// written. A drag that begins in the edge band now scrolls only once the pointer goes toward the
// edge. Every try must change the text, and undo puts it back; a drag that does go toward the edge
// still scrolls the chart. Desktop, Pixel 7 (real touch) and iPhone 14 (dispatched pointers).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, deviceName, type Point } from './lib/gantt-rig';
import { frames } from './lib/settle';

/** Write code: effort 6d for two people, starting after the design gate, so the chart scrolls to it. */
const TASK = 'build.code';
/** The file that holds the task (the edit is written there). */
const FILE = 'lib/build.tji';
const TRIES = 8;
/** Three days at week zoom (16 px a day): short enough to stay inside the band's depth of 48 px twice over. */
const DROP_PX = -48;
/** How far inside the right edge the handle starts. */
const DEPTH = 24;

const SHOTS = path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-3');

const scrollLeft = (page: Page): Promise<number> =>
	page.evaluate(
		() => (document.querySelector('[data-testid="gantt"] .scroller') as HTMLElement).scrollLeft,
	);

/**
 * Scrolls the chart until the task's size handle is `depth` px inside its visible right edge. After
 * an undo the chart can still move for a moment (the selection is revealed again), so the handle is
 * measured and the scroll corrected until the two agree.
 */
async function handleInBand(rig: Rig, depth: number, select = true): Promise<Point> {
	const { page } = rig;
	// A second tap on a selected bar opens a phone's details sheet: select once.
	if (select) await rig.select(TASK);
	const right = await page.evaluate(
		() =>
			(
				window as unknown as { __mainspringGantt: { scroller(): { right: number } } }
			).__mainspringGantt.scroller().right,
	);
	const want = right - depth;
	let at: Point = { x: 0, y: 0 };
	await expect
		.poll(
			async () => {
				await rig.layoutSettled();
				at = (await rig.peek(TASK)).endEdge;
				if (Math.abs(at.x - want) < 2) return 0;
				await page.evaluate(
					(by) =>
						void (
							document.querySelector('[data-testid="gantt"] .scroller') as HTMLElement
						).scrollBy(by, 0),
					at.x - want,
				);
				return at.x - want;
			},
			{ message: 'the size handle is scrolled to where the test wants it' },
		)
		.toBe(0);
	return at;
}

/** Presses `from`, moves by `dx` in 18 steps, one a frame, holds for `hold` frames, and releases. */
async function drag(rig: Rig, from: Point, dx: number, hold = 3, shot?: string): Promise<void> {
	const { page } = rig;
	const steps = 18;
	const at = (i: number): Point => ({ x: from.x + (dx * i) / steps, y: from.y });
	if (rig.touch) {
		await rig.touches('touchStart', [from]);
		for (let i = 1; i <= steps; i++) {
			await rig.touches('touchMove', [at(i)]);
			await frames(page, 1);
		}
		await frames(page, hold);
		if (shot) await page.screenshot({ path: shot });
		await rig.touches('touchEnd', []);
	} else {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= steps; i++) {
			await page.mouse.move(at(i).x, at(i).y);
			await frames(page, 1);
		}
		await frames(page, hold);
		if (shot) await page.screenshot({ path: shot });
		await page.mouse.up();
	}
}

test.describe('the size handle near the chart edge', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test(`a ${-DROP_PX} px drag from inside the band writes what it writes elsewhere (${TRIES} tries)`, async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info, 'week');
		const original = await rig.text(FILE);
		let shotTaken = false;
		/** One drag with the handle `depth` px inside the edge; the text it wrote, and the text put back. */
		const dragged = async (depth: number, select: boolean): Promise<string> => {
			const rev = await rig.revision();
			// With SCREENSHOTS=1 the first drag from inside the band is photographed at its end, before the drop.
			const shot =
				process.env['SCREENSHOTS'] === '1' && depth === DEPTH && select === false && !shotTaken
					? path.join(SHOTS, `gantt-resize-near-edge-${deviceName(info)}-light.png`)
					: undefined;
			if (shot) shotTaken = true;
			await drag(rig, await handleInBand(rig, depth, select), DROP_PX, 3, shot);
			await expect
				.poll(() => rig.text(FILE), { message: `the drag at ${depth} px changed the text` })
				.not.toBe(original);
			const wrote = await rig.text(FILE);
			await rig.rescheduled(rev);
			const after = await rig.revision();
			await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => rig.text(FILE)).toBe(original);
			await rig.rescheduled(after);
			return wrote;
		};
		// Clear of the band: the edit the drag asks for.
		const expected = await dragged(120, true);
		for (let n = 1; n <= TRIES; n++) {
			expect(await dragged(DEPTH, false), `try ${n} at ${DEPTH} px from the edge`).toBe(expected);
		}
	});

	test('a drag from the band toward the edge still scrolls the chart', async ({ page }, info) => {
		const rig = await Rig.open(page, info, 'week');
		const from = await handleInBand(rig, DEPTH + 8);
		const before = await scrollLeft(page);
		// 36 px takes the pointer from 32 px inside the edge to 4 px inside it, then it stays for a while.
		await drag(rig, from, 36, 30);
		expect(await scrollLeft(page)).toBeGreaterThan(before + 20);
	});
});
