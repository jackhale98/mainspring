// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Helpers for the heatmap's rebalance specs and pictures (rebalance.spec.ts,
 * phase3-screenshots.spec.ts): opening a cell's details, finding a task in them, and a drag from a
 * cell (a mouse, or a finger's long-press and drag; dispatched events on WebKit).
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { Rig, isTouch } from './gantt-rig';
import { animationsDone } from './settle';
import { pointOf, tapAt } from './workload-heat';

/** Opens the details of a cell: a click, or a tap and a second tap (7.2). */
export async function openCell(
	page: Page,
	info: TestInfo,
	person: string,
	col: number,
): Promise<Locator> {
	const at = await pointOf(page, person, col);
	await tapAt(page, info, at);
	if (isTouch(info)) await tapAt(page, info, at);
	const details = page.getByTestId('cell-details');
	await expect(details).toBeVisible();
	return details;
}
export const taskIn = (details: Locator, id: string): Locator =>
	details.locator(`[data-testid="detail-task"][data-task="${id}"]`);

/** A drag from a cell: a mouse, or a finger's long-press and drag (dispatched events on WebKit). */
export async function dragCell(
	page: Page,
	info: TestInfo,
	from: { person: string; col: number },
	to: (at: { x: number; y: number }, cellW: number, cellH: number) => { x: number; y: number },
	/** The cell scrolled to the plot's corner first, when the target is above `from` (a group row). */
	anchor: { person: string; col: number } = from,
): Promise<void> {
	const rig = new Rig(page, info);
	try {
		await pointOf(page, anchor.person, anchor.col);
		const a = await page.evaluate(
			([p, c]) =>
				(
					window as unknown as {
						__mainspringWorkload: { cell(p: string, c: number): { x: number; y: number } | null };
					}
				).__mainspringWorkload.cell(p as string, c as number),
			[from.person, from.col] as const,
		);
		if (!a) throw new Error('no cell to drag from');
		await expect
			.poll(() =>
				page.evaluate(
					({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null,
					a,
				),
			)
			.toBe('heat-overlay');
		const size = await page.evaluate(
			() =>
				(
					window as unknown as {
						__mainspringWorkload: { shape(): { cell: { w: number; h: number } } | null };
					}
				).__mainspringWorkload.shape()?.cell,
		);
		await rig.drag(a, to(a, size?.w ?? 56, size?.h ?? 28), { hold: rig.hold, steps: 8 });
		await rig.expectOwnsTouch();
	} finally {
		await rig.detach();
	}
	await animationsDone(page, 2);
}
