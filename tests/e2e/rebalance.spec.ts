// SPDX-License-Identifier: GPL-2.0-or-later
// Rebalance from a heatmap cell (phase-3.md 7.1 W1 and W2, 13.2 `rebalance`), on the small
// `ui-people` plan (one group of five people) instead of fedora-res. Phase 2's rig for every step:
// the exact text after the edit, Undo gives the bytes back, Redo the same patch again, and the
// heatmap's cell, read from the ARIA mirror, equals an oracle that walks the live result's
// bookings (tests/e2e/lib/workload-rig.ts) after the result, after the Undo and after the Redo.
// - W1 from the cell details' "Move to person…" menu, and by the keys (Alt+Down twice and Enter is
//   one cumulative edit, one undo step);
// - W2 from "Move to week…" (the move preference is asked once and answered) and by the keys;
// - the drags (a mouse, a long-press and drag with a finger): a cell with two movable tasks asks
//   "Move which task?" and the drop is the chosen task's one patch; a drag along the row is W2;
// - the refusals: `via-group` (the task is booked through the group), `not-a-person` (a drop on
//   a group row, which shows the refusal toast) and `unsupported-form` (an allocation with alternatives, written in Text first).
// The lanes' W1 and W2 are in lanes.spec.ts, from a bar. The pictures are in
// phase3-screenshots.spec.ts. Over 400 lines on purpose: one spec for one gesture family.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { modKey } from './lib/keys';
import { dragCell, openCell, taskIn } from './lib/rebalance-rig';
import { redo } from './lib/calendar-rig';
import { quietAfter } from './lib/settle';
import { pointOf, text } from './lib/workload-heat';
import { mirrorCells, openHeatmap, oracle, resultOf } from './lib/workload-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);
test.use({ actionTimeout: 20_000 });

const open = (page: Page, info: TestInfo): Promise<void> => openHeatmap(page, info, 'ui-people');

/** The text of the plan with `from` replaced by `to` once; the text must hold `from` once. */
const swap = (source: string, from: string, to: string): string => {
	expect(source.split(from).length - 1, `the text holds "${from}" once`).toBe(1);
	return source.replace(from, to);
};

/**
 * Waits for the text to be exactly `expected`. The first move of a plan asks how to move (ADR-0008
 * #2): the question is answered with its suggestion, as a person would.
 */
async function becomes(page: Page, expected: string): Promise<void> {
	await expect
		.poll(
			async () => {
				const ask = page.getByTestId('move-question');
				if (await ask.isVisible()) await ask.locator('button.primary').click();
				return text(page);
			},
			{ timeout: 30_000 },
		)
		.toBe(expected);
}

/** The newest good result's revision (the `edits` hook). */
const revisionOf = (page: Page): Promise<number> =>
	page.evaluate(
		() =>
			(
				window as unknown as { __mainspringEdits: { revision(): number | null } }
			).__mainspringEdits.revision() ?? 0,
	);

/** The oracle's booked minutes of a person in a column, from the live result. */
async function bookedOf(page: Page, person: string, col: number): Promise<number> {
	const result = await resultOf(page);
	if (!result) throw new Error('no result');
	return oracle(result).booked.get(person)?.[col] ?? -1;
}

/** The heatmap's mirror cell for each of these equals the oracle on the newest result. */
async function matchesEngine(page: Page, cells: ReadonlyArray<readonly [string, number]>) {
	for (const [person, col] of cells) {
		await expect
			.poll(
				async () => {
					await pointOf(page, person, col);
					const cell = (await mirrorCells(page)).find((c) => c.person === person && c.col === col);
					const want = await bookedOf(page, person, col);
					return cell?.booked === want ? 'match' : `view ${cell?.booked}, engine ${want}`;
				},
				{ timeout: READY_TIMEOUT_MS, message: `${person} column ${col} follows the engine` },
			)
			.toBe('match');
	}
}

/** Undo gives the bytes back and the heatmap follows; Redo gives the patch again. */
async function undoRedo(
	page: Page,
	before: string,
	after: string,
	cells: ReadonlyArray<readonly [string, number]>,
): Promise<void> {
	await page.getByRole('button', { name: 'Undo' }).first().click();
	await expect.poll(() => text(page)).toBe(before);
	await matchesEngine(page, cells);
	await redo(page);
	await expect.poll(() => text(page)).toBe(after);
	await matchesEngine(page, cells);
}

const INTERVIEWS = 'effort 6d\n    allocate ana\n    complete 100';
const SURVEY = 'task survey "Survey" {\n    effort 4d';
const FINDINGS = 'allocate ana, dee';

test('W1 from the details: Move to person… is one exact patch; Undo, Redo, and the heatmap follows', async ({
	page,
}, info) => {
	await open(page, info);
	const before = await text(page);
	const was = await bookedOf(page, 'ana', 0);
	expect(was).toBeGreaterThan(0);
	const details = await openCell(page, info, 'ana', 0);
	await taskIn(details, 'discover.interviews').getByRole('combobox').first().selectOption({
		label: 'Ben',
	});
	// Interviews is `allocate ana`, written once: the one id token changes, nothing else.
	const after = swap(before, INTERVIEWS, INTERVIEWS.replace('allocate ana', 'allocate ben'));
	await becomes(page, after);
	await matchesEngine(page, [
		['ana', 0],
		['ben', 0],
	]);
	// The engine moved the work: Ana's first week has none of it, Ben's has some.
	await expect.poll(() => bookedOf(page, 'ana', 0)).toBe(0);
	expect(await bookedOf(page, 'ben', 0)).toBeGreaterThan(0);
	await undoRedo(page, before, after, [
		['ana', 0],
		['ben', 0],
	]);
	expect(await bookedOf(page, 'ana', 0)).toBe(0);
});

test('W1 by the keys: Alt+Down twice and Enter is one cumulative edit, one undo step', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'the keys of a keyboard');
	await open(page, info);
	const before = await text(page);
	const details = await openCell(page, info, 'ana', 0);
	const task = taskIn(details, 'discover.interviews');
	await task.focus();
	// Ana, Ben, Cy: two presses are two people down, written once on Enter.
	await page.keyboard.press('Alt+ArrowDown');
	await page.keyboard.press('Alt+ArrowDown');
	await page.keyboard.press('Enter');
	const after = swap(before, INTERVIEWS, INTERVIEWS.replace('allocate ana', 'allocate cy'));
	await becomes(page, after);
	await matchesEngine(page, [
		['ana', 0],
		['cy', 0],
	]);
	await undoRedo(page, before, after, [
		['ana', 0],
		['cy', 0],
	]);
});

test('W2 from the details: Move to week… asks the preference once, then writes the start', async ({
	page,
}, info) => {
	await open(page, info);
	const before = await text(page);
	const details = await openCell(page, info, 'dee', 0);
	await taskIn(details, 'discover.survey').getByRole('combobox').nth(1).selectOption('2');
	// Monday 2 March to Monday 16 March: ten working days later, written as `start` above the effort.
	const after = swap(before, SURVEY, 'task survey "Survey" {\n    start 2026-03-16\n    effort 4d');
	await becomes(page, after);
	// Answered once: the question is gone.
	await expect(page.getByTestId('move-question')).toBeHidden();
	await matchesEngine(page, [
		['dee', 0],
		['dee', 2],
	]);
	await expect.poll(() => bookedOf(page, 'dee', 0)).toBe(0);
	expect(await bookedOf(page, 'dee', 2)).toBeGreaterThan(0);
	await undoRedo(page, before, after, [
		['dee', 0],
		['dee', 2],
	]);
});

test('W2 by the keys: Alt+Right twice and Enter is one edit, one undo step', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'the keys of a keyboard');
	await open(page, info);
	const before = await text(page);
	const details = await openCell(page, info, 'dee', 0);
	const task = taskIn(details, 'discover.survey');
	await task.focus();
	await page.keyboard.press('Alt+ArrowRight');
	await page.keyboard.press('Alt+ArrowRight');
	await page.keyboard.press('Enter');
	const after = swap(before, SURVEY, 'task survey "Survey" {\n    start 2026-03-16\n    effort 4d');
	await becomes(page, after);
	await matchesEngine(page, [
		['dee', 0],
		['dee', 2],
	]);
	await undoRedo(page, before, after, [
		['dee', 0],
		['dee', 2],
	]);
});

test('W1 by a drag: a cell with two tasks asks "Move which task?", the choice is one patch', async ({
	page,
}, info) => {
	await open(page, info);
	const before = await text(page);
	// Ana's second week has Findings and Interviews, both movable: the drop asks which.
	await dragCell(page, info, { person: 'ana', col: 1 }, (a, _w, h) => ({ x: a.x, y: a.y + h }));
	const which = page.getByTestId('which-task');
	await expect(which).toBeVisible();
	await expect(which).toContainText('Move which task?');
	const options = which.locator('button[data-task]');
	await expect(options).toHaveCount(2);
	expect(
		(await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-task')))).sort(),
	).toEqual(['discover.findings', 'discover.interviews']);
	await which.locator('button[data-task="discover.findings"]').click();
	const after = swap(before, FINDINGS, 'allocate ben, dee');
	await becomes(page, after);
	await matchesEngine(page, [
		['ana', 1],
		['ben', 1],
	]);
	await undoRedo(page, before, after, [
		['ana', 1],
		['ben', 1],
	]);
});

test('W2 by a drag: along the row two weeks is the same patch as the menu', async ({
	page,
}, info) => {
	await open(page, info);
	const before = await text(page);
	await dragCell(page, info, { person: 'dee', col: 0 }, (a, w) => ({ x: a.x + 2 * w, y: a.y }));
	const after = swap(before, SURVEY, 'task survey "Survey" {\n    start 2026-03-16\n    effort 4d');
	await becomes(page, after);
	await matchesEngine(page, [
		['dee', 0],
		['dee', 2],
	]);
	await undoRedo(page, before, after, [
		['dee', 0],
		['dee', 2],
	]);
});

/** The refusal's sentence is on screen and the text did not change. */
async function refused(page: Page, sentence: string, before: string): Promise<void> {
	const toast = page.getByTestId('toast').filter({ hasText: sentence });
	await expect(toast).toBeVisible({ timeout: 30_000 });
	expect(await text(page)).toBe(before);
}

test('refusals: a task booked through a group, and a drop on a group row', async ({
	page,
}, info) => {
	await open(page, info);
	const before = await text(page);
	// Team training is `allocate team`: Ben works on it through the group, so it is not his to move.
	const details = await openCell(page, info, 'ben', 5);
	await taskIn(details, 'rollout.train').getByRole('combobox').first().selectOption({
		label: 'Eli',
	});
	await refused(page, "Booked through Team. Change the task's people in its details.", before);
	// The menu lists people only: a group is no target there (the planner's `not-a-person` is for a
	// drop, and the ghost refuses that before it happens, below).
	await expect(
		taskIn(details, 'rollout.train')
			.getByRole('combobox')
			.first()
			.locator('option', { hasText: /^Team$/ }),
	).toHaveCount(0);
	await page.getByRole('button', { name: 'Close' }).first().click();
	// A drop on the Team row goes through the same planner as any drop: the standard refusal toast
	// says work moves to a person, and the drop changes nothing and starts no edit.
	const rev = await revisionOf(page);
	await dragCell(page, info, { person: 'ana', col: 0 }, (a, _w, h) => ({ x: a.x, y: a.y - h }), {
		person: 'team',
		col: 0,
	});
	await refused(page, 'Work moves to a person, not to a group.', before);
	await quietAfter(page);
	expect(await text(page)).toBe(before);
	expect(await revisionOf(page)).toBe(rev);
});

test('refusal: an allocation with alternatives cannot be edited here, and says so', async ({
	page,
}, info) => {
	await open(page, info);
	const phone = isTouch(info);
	// Write the alternative in Text, as a person would, then come back to the heatmap.
	const source = await text(page);
	const entry = source.split('\n--\n')[0] ?? '';
	const edited = swap(
		entry,
		'allocate dee\n    complete 60',
		'allocate dee { alternative eli }\n    complete 60',
	);
	if (phone) await page.getByRole('tab', { name: 'Text', exact: true }).tap();
	else await page.getByRole('button', { name: 'Text', exact: true }).click();
	const editor = page.getByRole('textbox', { name: /^Editor for / });
	await editor.click();
	await page.keyboard.press(`${await modKey(page)}+A`);
	await page.keyboard.insertText(edited);
	await expect.poll(async () => (await text(page)).split('\n--\n')[0]).toBe(edited);
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	if (phone) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Load', exact: true }).tap();
	} else {
		await page.getByRole('button', { name: 'Visual', exact: true }).click();
		await page.getByRole('radio', { name: 'Workload' }).first().click();
	}
	await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: 60_000 });
	const before = await text(page);
	// With an alternative the engine may book someone else on Survey: find who has it in week one.
	const names: Record<string, string> = {
		ana: 'Ana',
		ben: 'Ben',
		cy: 'Cy',
		dee: 'Dee',
		eli: 'Eli',
	};
	let who = '';
	for (const id of Object.keys(names)) {
		const tasks = await page.evaluate(
			([p, c]) =>
				(
					window as unknown as {
						__mainspringWorkload: {
							tasks(p: string, c: number): Array<{ task: string; kind: string }>;
						};
					}
				).__mainspringWorkload.tasks(p as string, c as number),
			[id, 0] as const,
		);
		if (tasks.some((t) => t.task === 'discover.survey' && t.kind === 'booked')) who = id;
	}
	expect(who, 'someone is booked on Survey in the first week').not.toBe('');
	const details = await openCell(page, info, who, 0);
	await taskIn(details, 'discover.survey')
		.getByRole('combobox')
		.first()
		.selectOption({
			label: who === 'ben' ? 'Cy' : 'Ben',
		});
	await refused(page, 'The plan uses a form of this setting that cannot be edited here.', before);
});
