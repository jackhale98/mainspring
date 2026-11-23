// SPDX-License-Identifier: GPL-2.0-or-later
// The helpers of the workload heatmap specs (workload.spec.ts and workload-edits.spec.ts), on the
// `fedora-res` sample and the small plan `ui-people`: the text of both files, a tap, the busy and movable cells, a move's outcome,
// a cell's point, the zoom and unit controls and an axe check.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { isTouch } from './gantt-rig';
import { animationsDone, settledValue } from './settle';
import { oracle, resultOf, shape } from './workload-rig';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export type Hook = {
	tasks(p: string, c: number): Array<{ kind: string; movable: boolean }>;
	scrollTo(person: string, col: number): boolean;
	cell(person: string, col: number): { x: number; y: number } | null;
};
export type Win = {
	__mainspringWorkload: Hook;
	__mainspringEdits: { text(path?: string): string | null };
};

/** The entry file and the generated people file, where fedora-res writes its allocations. */
export const text = (page: Page) =>
	page.evaluate(() => {
		const e = (window as unknown as Win).__mainspringEdits;
		return `${e.text() ?? ''}\n--\n${e.text('mainspring-load.tji') ?? ''}`;
	});

export async function tapAt(
	page: Page,
	info: TestInfo,
	at: { x: number; y: number },
): Promise<void> {
	if (isTouch(info)) await page.touchscreen.tap(at.x, at.y);
	else await page.mouse.click(at.x, at.y);
}

/** A person with booked time and the first week they have it, from the independent oracle. */
export async function busyCell(page: Page): Promise<{ person: string; col: number }> {
	const result = await resultOf(page);
	if (!result) throw new Error('no result');
	const o = oracle(result);
	const s = await shape(page);
	for (const person of s?.rows ?? []) {
		if (result.resources.find((r) => r.id === person)?.group) continue;
		const row = o.booked.get(person) ?? [];
		const col = row.findIndex((m) => m > 0);
		if (col >= 0) return { person, col };
	}
	throw new Error('nobody is booked');
}

/**
 * Runs a move and says what became of it: the text changed (one undo step: Undo restores the bytes)
 * or a refusal toast with its sentence is up and the text is as it was.
 */
export async function moved(page: Page, act: () => Promise<void>): Promise<'applied' | 'refused'> {
	const before = await text(page);
	await act();
	const stuck = async () =>
		console.log(
			'no outcome of',
			act.name,
			'; live:',
			await page.getByTestId('heat-live').textContent(),
			'; which:',
			await page.getByTestId('which-task').count(),
			'; toasts:',
			(await page.getByTestId('toast').allTextContents()).join(' | '),
		);
	await expect
		.poll(
			async () => {
				// The first move of a plan asks how to move (ADR-0008 #2): answer with the suggestion.
				const ask = page.getByTestId('move-question');
				if (await ask.isVisible()) await ask.locator('button.primary').click();
				return (await text(page)) !== before || (await page.getByTestId('toast').count()) > 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
		.catch(async (e) => {
			await stuck();
			throw e;
		});
	if ((await text(page)) === before) {
		console.log('refused:', (await page.getByTestId('toast').allTextContents()).join(' | '));
		return 'refused';
	}
	await page.getByRole('button', { name: 'Undo' }).first().click();
	await expect.poll(() => text(page)).toBe(before);
	return 'applied';
}

/**
 * A booked cell from which a drag may start (a task the text declares and can edit). On a big plan
 * (the default) it is well down the list and well along the plot, clear of the edges that
 * auto-scroll a drag; on a small plan (`small`) every row and every week after the first is clear
 * of them, but the last person is left for a drag to have someone below.
 */
export async function movableCell(
	page: Page,
	small = false,
): Promise<{ person: string; col: number }> {
	const result = await resultOf(page);
	if (!result) throw new Error('no result');
	const o = oracle(result);
	const s = await shape(page);
	for (const person of (s?.rows ?? []).slice(small ? 0 : 8, small ? -1 : -4)) {
		if (result.resources.find((r) => r.id === person)?.group) continue;
		const row = o.booked.get(person) ?? [];
		for (let col = small ? 1 : 8; col < row.length; col++) {
			if ((row[col] ?? 0) === 0) continue;
			const tasks = await page.evaluate(
				([p, c]) => (window as unknown as Win).__mainspringWorkload.tasks(p as string, c as number),
				[person, col] as const,
			);
			if (tasks.some((t) => t.kind === 'booked' && t.movable)) return { person, col };
		}
	}
	throw new Error('no cell has a movable task');
}

export async function pointOf(page: Page, person: string, col: number) {
	await page.evaluate(
		([p, c]) => (window as unknown as Win).__mainspringWorkload.scrollTo(p as string, c as number),
		[person, col] as const,
	);
	// A little into the cell, clear of the name column and the header. The scroll has settled when
	// the cell is where it was on the frames before (a tap on a cell that still moves misses).
	const at = await settledValue(
		page,
		([p, c]) => (window as unknown as Win).__mainspringWorkload.cell(p as string, c as number),
		6,
		[person, col] as const,
	);
	if (!at) throw new Error('no such cell');
	return at;
}

export const zoomRadio = (page: Page, name: string) =>
	page.getByRole('radiogroup', { name: 'Zoom' }).getByRole('radio', { name });
export async function chooseZoom(page: Page, name: string): Promise<void> {
	const radio = zoomRadio(page, name);
	if (await radio.isVisible()) await radio.click();
	else await page.getByRole('combobox', { name: 'Zoom' }).selectOption({ label: name });
}
export async function chooseUnit(page: Page, name: 'Hours' | '%'): Promise<void> {
	const radio = page.getByRole('radiogroup', { name: 'Unit' }).getByRole('radio', { name });
	if (await radio.isVisible()) await radio.click();
	else {
		const toggle = page.getByTestId('heat-unit-toggle');
		if ((await toggle.textContent())?.trim() !== name) await toggle.tap();
	}
}

export async function axe(page: Page, state: string): Promise<void> {
	await animationsDone(page, 3);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect.soft(detail, state).toEqual([]);
}
