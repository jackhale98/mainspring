// SPDX-License-Identifier: GPL-2.0-or-later
// A drag that begins inside an edge band must not scroll toward that edge while the pointer stays
// where it is or moves away from it (src/lib/gesture/autoscroll.ts `AxisScroll`; the Gantt bar
// handles have their own spec, gantt-resize-near-edge.spec.ts). Each caller of the edge
// auto-scroll: the task list's row drag, the workload plot's cell drag, the Calendar's month. The
// pointer presses 20 px inside the edge, moves 8 px away from it (still inside the band), holds
// for a while, and lets go: the scroll position has not changed, and the drop is where the
// pointer is, which is where it began, so nothing is edited.
import { expect, test, type Page } from '@playwright/test';
import { openCalendar } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, Rig, isTouch, type Point } from './lib/gantt-rig';
import { frames } from './lib/settle';
import { movableCell, pointOf, text, type Win } from './lib/workload-heat';
import { openHeatmap } from './lib/workload-rig';

/** Frames the pointer is held in the band: at 600 px/s the chart would run 300 px in 30. */
const HOLD_FRAMES = 30;

const scrollLeft = (page: Page, sel: string): Promise<number> =>
	page.evaluate((s) => (document.querySelector(s) as HTMLElement).scrollLeft, sel);

const scrollTop = (page: Page, sel: string): Promise<number> =>
	page.evaluate((s) => (document.querySelector(s) as HTMLElement).scrollTop, sel);

test.describe('a drag that begins in an edge band does not scroll toward it', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);

	test('the task list: a row dragged from the bottom band', async ({ page }, info) => {
		const rig = await Rig.open(page, info, 'week', 'visual', 'gantt-500');
		const SCROLLER = '[data-testid="gantt"] .scroller';
		const key = 'task:p0.p0k3.t27';
		const row = rig.row(key);
		// Select the row (its grip shows), then scroll it to 20 px above the chart's bottom edge.
		await rig.bar('p0.p0k3.t27');
		await row.locator('.label').click();
		await expect(row).toHaveAttribute('aria-selected', 'true');
		const bottom = await page.evaluate(
			(s) => (document.querySelector(s) as HTMLElement).getBoundingClientRect().bottom,
			SCROLLER,
		);
		let grip: Point = { x: 0, y: 0 };
		await expect
			.poll(async () => {
				await rig.layoutSettled();
				await row.hover();
				const b = await row.getByTestId('row-grip').boundingBox();
				if (!b) return Infinity;
				grip = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
				const off = grip.y - (bottom - 20);
				if (Math.abs(off) < 2) return 0;
				await page.evaluate(
					([s, by]) =>
						void (document.querySelector(s as string) as HTMLElement).scrollBy(0, by as number),
					[SCROLLER, off] as const,
				);
				return off;
			})
			.toBe(0);
		const before = await rig.text();
		const top = await scrollTop(page, SCROLLER);
		let held = -1;
		await rig.drag(
			grip,
			{ x: grip.x, y: grip.y - 8 },
			{
				hold: rig.hold,
				steps: 4,
				pause: async () => {
					await frames(page, HOLD_FRAMES);
					held = await scrollTop(page, SCROLLER);
				},
			},
		);
		expect(held, 'the list did not scroll toward the edge it began at').toBe(top);
		expect(await scrollTop(page, SCROLLER)).toBe(top);
		await frames(page, 10);
		expect(await rig.text(), 'the row was dropped where it began').toBe(before);
	});

	test('the workload plot: a cell dragged from the left band (beside the names)', async ({
		page,
	}, info) => {
		await openHeatmap(page, info);
		const SCROLLER = '[data-testid="workload"] .scroller';
		const { person, col } = await movableCell(page);
		await pointOf(page, person, col);
		// The plot's visible part begins where the sticky names column ends.
		const names = await page.locator('[data-testid="workload"] .names').boundingBox();
		if (!names) throw new Error('no names column');
		const edge = names.x + names.width;
		const rig = new Rig(page, info);
		// Scroll the plot until the cell is 20 px inside its left edge.
		let at: Point = { x: 0, y: 0 };
		await expect
			.poll(async () => {
				await frames(page, 3);
				const c = await page.evaluate(
					([p, c]) =>
						(window as unknown as Win).__mainspringWorkload.cell(p as string, c as number),
					[person, col] as const,
				);
				if (!c) return Infinity;
				at = c;
				const off = c.x - (edge + 20);
				if (Math.abs(off) < 2) return 0;
				await page.evaluate(
					([s, by]) =>
						void (document.querySelector(s as string) as HTMLElement).scrollBy(by as number, 0),
					[SCROLLER, off] as const,
				);
				return off;
			})
			.toBe(0);
		const before = await text(page);
		const left = await scrollLeft(page, SCROLLER);
		let held = -1;
		try {
			await rig.drag(
				at,
				{ x: at.x + 8, y: at.y },
				{
					hold: rig.hold,
					steps: 4,
					pause: async () => {
						await frames(page, HOLD_FRAMES);
						held = await scrollLeft(page, SCROLLER);
					},
				},
			);
		} finally {
			await rig.detach();
		}
		expect(held, 'the plot did not scroll toward the edge it began at').toBe(left);
		expect(await scrollLeft(page, SCROLLER)).toBe(left);
		await frames(page, 10);
		expect(await text(page), 'the cell was dropped where it began').toBe(before);
	});

	test('the Calendar month: a day dragged from the top band', async ({ page }, info) => {
		// A month that fits the view has nothing to scroll: this view is short (a landscape phone's).
		const size = page.viewportSize();
		if (size) await page.setViewportSize({ width: size.width, height: isTouch(info) ? 520 : 360 });
		await openCalendar(page, info);
		const SCROLLER = '[data-testid="cal-scroller"]';
		await expect
			.poll(() =>
				page.evaluate((s) => {
					const el = document.querySelector(s) as HTMLElement;
					return el.scrollHeight - el.clientHeight;
				}, SCROLLER),
			)
			.toBeGreaterThan(100);
		// Scrolled to the end, a day in the month's top band (the end of a month can be
		// padded with days of the next one, which are not days of the plan).
		const at = await page.evaluate((s) => {
			const el = document.querySelector(s) as HTMLElement;
			el.scrollTop = el.scrollHeight;
			const r = el.getBoundingClientRect();
			// A point in the band (a drag moves down from it, away from the edge) that is on a day.
			for (let y = r.top + 12; y < r.top + 36; y += 4) {
				for (let x = r.left + 10; x < r.right; x += 10) {
					if (document.elementFromPoint(x, y)?.closest('[data-day]')) return { x, y };
				}
			}
			return null;
		}, SCROLLER);
		await frames(page, 3);
		if (!at) throw new Error('no day in the top band');
		const rig = new Rig(page, info);
		const before = await scrollTop(page, SCROLLER);
		let held = -1;
		try {
			await rig.drag(
				at,
				{ x: at.x, y: at.y + 14 },
				{
					hold: rig.hold,
					steps: 4,
					pause: async () => {
						await frames(page, HOLD_FRAMES);
						held = await scrollTop(page, SCROLLER);
					},
				},
			);
		} finally {
			await rig.detach();
		}
		expect(held, 'the month did not scroll toward the edge it began at').toBe(before);
		expect(await scrollTop(page, SCROLLER)).toBe(before);
	});
});
