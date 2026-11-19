// SPDX-License-Identifier: GPL-2.0-or-later
// Edits made while the index lags the text (ADR-0018, T27c). `?hooks=edits` gives the page
// `holdIndex()` and `releaseIndex()`: while held the runner's idle tasks wait, so the outline, the
// calendar and every card keep showing the plan as it was, whatever the text says (the text is
// current: `ensureIndex` is synchronous). Each case holds the index, edits through the real
// keyboard, menu, drag or card, and asserts on the text (`__mainspringEdits.text()`), not on copy.
// Desktop Chrome, Pixel 7 and iPhone 14 (a finger uses the row menu and the Undo and Redo keys).
//
// Until T27d (the views plan on the text now) these cases FAIL on purpose: each is marked
// `test.fail` (the `t27d` helper) with the reason (ADR-0018 "Context"), so the merge tier stays
// green and CI flags the case when it starts to pass. Remove the mark with T27d.
// STALE_INDEX_REPRO=1 runs the cases unmarked, to see each failing assertion. A case that already
// passes today has no mark.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import { modKey } from './lib/keys';
import { frames } from './lib/settle';
import {
	caughtUp,
	openCalendar,
	showCalendar,
	setScope,
	showDay,
	tapDay,
	text,
} from './lib/calendar-rig';
import { openResources, row, selectRow } from './lib/resources-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);

/**
 * Marks the case as failing until T27d (`test.fail`: a pass before then is reported, so the mark
 * gets removed). STALE_INDEX_REPRO=1 runs the cases unmarked, to see the failing assertions.
 */
const t27d = (why: string): void => test.fail(process.env['STALE_INDEX_REPRO'] !== '1', why);

/** How long a wanted text change may take; a case that must stay unchanged fails by assertion, not by this. */
const CHANGE_MS = 10_000;

type Hooks = { __mainspringEdits: { holdIndex(): void; releaseIndex(): void } };
const holdIndex = (page: Page): Promise<void> =>
	page.evaluate(() => (window as unknown as Hooks).__mainspringEdits.holdIndex());

/** Undo and Redo with the keyboard (the global keys, the focus off any text field). */
async function history(page: Page, which: 'undo' | 'redo'): Promise<void> {
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.keyboard.press(which === 'undo' ? 'ControlOrMeta+z' : 'ControlOrMeta+Shift+z');
}

// ---------------------------------------------------------------------------------------------
// The Gantt: steps and drops on the manipulation sample.

/** The ids of the top-level tasks of plan.tjp, in text order. */
const topLevel = (t: string): string[] => [...t.matchAll(/^task (\w+) /gm)].map((m) => m[1] ?? '');
/** The ids of the children of `design`, in text order. */
const designChildren = (t: string): string[] => {
	const body = /^task design "Design" \{\n([\s\S]*?)\n\}$/m.exec(t)?.[1] ?? '';
	return [...body.matchAll(/^ {2}task (\w+) /gm)].map((m) => m[1] ?? '');
};
const shownChildren = (rig: Rig): Promise<string[]> =>
	rig.page
		.locator('[role="row"][data-key^="task:design."]')
		.evaluateAll((rows) =>
			rows.map((r) => (r.getAttribute('data-key') ?? '').replace('task:design.', '')),
		);

/** The top-level rows of the plan's own four tasks, as the screen shows them. */
const shownTop = (rig: Rig): Promise<string[]> =>
	rig.page
		.locator('[role="row"][aria-level="1"]')
		.evaluateAll((rows) =>
			rows
				.map((r) => (r.getAttribute('data-key') ?? '').replace('task:', ''))
				.filter((k) => ['design', 'spike', 'launch', 'support'].includes(k)),
		);

/** One step up: Alt+Shift+Up on the focused row, or a finger's row menu. */
async function stepUp(rig: Rig, key: string): Promise<void> {
	const r = rig.row(`task:${key}`);
	if (rig.touch) {
		if ((await r.getAttribute('aria-selected')) !== 'true') await r.locator('.label').tap();
		await rig.page.getByTestId('row-menu').tap();
		await rig.page.getByRole('menuitem', { name: /^Move up/ }).tap();
	} else {
		await r.focus();
		await rig.page.keyboard.press('Alt+Shift+ArrowUp');
	}
}

/** Drags a row by its grip to the top edge of another (the same level: a slot before it). */
async function dropBefore(rig: Rig, key: string, target: string): Promise<void> {
	const r = rig.row(`task:${key}`);
	if (rig.touch) {
		await r.locator('.label').tap();
		await expect(r).toHaveAttribute('aria-selected', 'true');
		await rig.layoutSettled();
	} else {
		await r.hover();
	}
	const grip = await r.getByTestId('row-grip').boundingBox();
	const at = await rig.row(`task:${target}`).boundingBox();
	if (!grip || !at) throw new Error('no grip or row');
	const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
	await rig.drag(from, { x: from.x, y: at.y + 3 }, { hold: rig.hold });
	await rig.detach();
	// The runner's status stays pending while the index is held: wait for frames, not for "Scheduled".
	await frames(rig.page, 20);
}

test.describe('the Gantt on an index that lags', () => {
	test('Alt+Shift+Up right after Redo ends one place above where the text had it', async ({
		page,
	}, info) => {
		// T27d: the step is planned on the shown outline (the order before the Undo and Redo).
		t27d('T27d: reorder plans on app.outline, which lags (ADR-0018 position targets)');
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		expect(topLevel(before)).toEqual(['design', 'spike', 'launch', 'support']);
		await holdIndex(page);
		await stepUp(rig, 'launch');
		await expect
			.poll(async () => topLevel(await rig.text()), { timeout: CHANGE_MS })
			.toEqual(['design', 'launch', 'spike', 'support']);
		const moved = await rig.text();
		await history(page, 'undo');
		await expect.poll(() => rig.text()).toBe(before);
		await history(page, 'redo');
		await expect.poll(() => rig.text()).toBe(moved);
		await stepUp(rig, 'launch');
		await expect
			.poll(async () => topLevel(await rig.text()), { timeout: CHANGE_MS })
			.toEqual(['launch', 'design', 'spike', 'support']);
	});

	test('three quick presses make three places', async ({ page }, info) => {
		t27d('T27d: the 2nd and 3rd press plan on the outline from before the 1st');
		const rig = await Rig.open(page, info);
		expect(designChildren(await rig.text())).toEqual([
			'research',
			'sketch',
			'review',
			'docs',
			'gate',
		]);
		await holdIndex(page);
		for (let i = 0; i < 3; i++) await stepUp(rig, 'design.gate');
		await expect
			.poll(async () => designChildren(await rig.text()), { timeout: CHANGE_MS })
			.toEqual(['research', 'gate', 'sketch', 'review', 'docs']);
	});

	/** An edit in the Gantt, the shown tree catching up with it, then the index held and the edit undone. */
	async function undoneWhileShown(
		rig: Rig,
		edit: () => Promise<void>,
		shown: () => Promise<unknown>,
		after: unknown,
	): Promise<void> {
		const before = await rig.text();
		await edit();
		await expect.poll(shown, { timeout: CHANGE_MS }).toEqual(after);
		await holdIndex(rig.page);
		await history(rig.page, 'undo');
		await expect.poll(() => rig.text()).toBe(before);
	}

	test('a row drop right after an Undo that reordered its parent is refused', async ({
		page,
	}, info) => {
		// No mark since T27b: the dispatcher's position check refuses the drop (its parent's
		// children changed), though moveTo still passes the shown tree's slot.
		const rig = await Rig.open(page, info);
		await undoneWhileShown(
			rig,
			() => stepUp(rig, 'design.gate'),
			() => shownChildren(rig),
			['research', 'sketch', 'review', 'gate', 'docs'],
		);
		const afterUndo = await rig.text();
		// The screen still shows `gate` above `docs`; the text has it last again. Drop `research`
		// before `gate`: the shown neighbours are `review` and `gate`, the text's `docs` and `gate`.
		await dropBefore(rig, 'design.research', 'design.gate');
		expect(await rig.text()).toBe(afterUndo);
	});

	test('a row drop right after an Undo that changed another part lands in the shown slot', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await undoneWhileShown(
			rig,
			() => stepUp(rig, 'launch'),
			() => shownTop(rig),
			['design', 'launch', 'spike', 'support'],
		);
		expect(await rig.text()).toBe(before);
		await dropBefore(rig, 'design.docs', 'design.sketch');
		await expect
			.poll(async () => designChildren(await rig.text()), { timeout: CHANGE_MS })
			.toEqual(['research', 'docs', 'sketch', 'review', 'gate']);
	});
});

// ---------------------------------------------------------------------------------------------
// The resource table.

const resourceIds = (t: string): string[] =>
	[...t.matchAll(/^resource (\w+) /gm)].map((m) => m[1] ?? '');

test('Alt+Shift+Up in the resource table right after an Undo moves what the text has', async ({
	page,
}, info) => {
	t27d('T27d: the table steps on the shown outline (ADR-0018 position targets)');
	await openResources(page, info);
	const before = await text(page);
	expect(resourceIds(before)).toEqual(['dev', 'rev']);
	if (isTouch(info)) {
		await selectRow(page, info, 'rev');
		await page.getByTestId('resource-menu').tap();
		await page.getByRole('menuitem', { name: /^Into the group above/ }).tap();
	} else {
		await row(page, 'rev').focus();
		await page.keyboard.press('Alt+Shift+ArrowRight');
	}
	// The table shows the reviewer inside the group once the index has caught up.
	await expect(row(page, 'rev')).toHaveAttribute('aria-level', '2', { timeout: CHANGE_MS });
	await expect.poll(async () => resourceIds(await text(page))).toEqual(['dev']);
	await holdIndex(page);
	await history(page, 'undo');
	await expect.poll(() => text(page)).toBe(before);
	// Still shown inside the group: Up there means above Ana. In the text it means above the group.
	await expect(row(page, 'rev')).toHaveAttribute('aria-level', '2');
	if (isTouch(info)) {
		await selectRow(page, info, 'rev');
		await page.getByTestId('resource-menu').tap();
		await page.getByRole('menuitem', { name: /^Move up/ }).tap();
	} else {
		await row(page, 'rev').focus();
		await page.keyboard.press('Alt+Shift+ArrowUp');
	}
	await expect
		.poll(async () => resourceIds(await text(page)), { timeout: CHANGE_MS })
		.toEqual(['rev', 'dev']);
});

// ---------------------------------------------------------------------------------------------
// Leave cards in the Calendar: two equal-length items of one resource.

const ITEM1 = 'annual 2026-12-14 - 2026-12-16';
const ITEM2 = 'annual 2026-12-21 - 2026-12-23';
const LEAVE_PLAN = [
	'project lv "Leaves" 2026-12-07 +6w {',
	'  timezone "America/New_York"',
	'  now 2026-12-07',
	'}',
	'resource sam "Sam" {',
	`  leaves ${ITEM1}, ${ITEM2}`,
	'}',
	'task t "T" {',
	'  start 2026-12-07',
	'  effort 2d',
	'  allocate sam',
	'}',
	'',
].join('\n');

/**
 * Runs `typing` in the editor (the Text tab of a phone, the Text mode of a desktop) and comes back
 * to the Calendar.
 */
async function inEditor(
	page: Page,
	info: TestInfo,
	typing: (mod: string) => Promise<void>,
): Promise<void> {
	if (isTouch(info)) await page.getByRole('tab', { name: 'Text', exact: true }).tap();
	else await page.getByRole('button', { name: 'Text', exact: true }).click();
	await page.getByRole('textbox', { name: /^Editor for / }).click();
	await typing(await modKey(page));
	if (!isTouch(info)) await page.getByRole('button', { name: 'Visual', exact: true }).click();
	await showCalendar(page, info);
}

/** The details of a day on screen: a click on it (a finger: two taps, the second opens them). */
async function openDetails(page: Page, info: TestInfo, date: string): Promise<void> {
	const d = await showDay(page, date);
	await tapDay(page, info, d);
	const details = page.getByTestId('cal-details');
	// A finger's first tap selects; on some devices it already opens the details, and the second would miss.
	if (
		isTouch(info) &&
		!(await details.waitFor({ timeout: 2000 }).then(
			() => true,
			() => false,
		))
	) {
		await tapDay(page, info, d);
	}
	await expect(details).toBeVisible();
}

/** The leave plan open in the Calendar, the index current; then the index is held. */
async function openLeaves(page: Page, info: TestInfo): Promise<void> {
	await openCalendar(page, info);
	await inEditor(page, info, async (mod) => {
		await page.keyboard.press(`${mod}+A`);
		await page.keyboard.insertText(LEAVE_PLAN);
	});
	await caughtUp(page);
	// The Calendar lists Sam's leave on the 14th: the index has caught up with the new plan.
	await expect(page.getByTestId('cal-scope').locator('option', { hasText: 'Sam' })).toHaveCount(1, {
		timeout: READY_TIMEOUT_MS,
	});
	await setScope(page, 'Sam');
	await openDetails(page, info, '2026-12-14');
	await expect(page.getByTestId('cal-leave')).toHaveCount(1, { timeout: READY_TIMEOUT_MS });
	await holdIndex(page);
}

/** Types `n` letters into Sam's name (`resource sam "Sam"`): the items move right by exactly one item and its ", ". */
async function renameSam(page: Page, info: TestInfo, n: number): Promise<void> {
	await inEditor(page, info, async () => {
		// The caret goes before the closing quote of "Sam" (the editor's own state: no key can miss).
		await page.evaluate(() => {
			type View = {
				state: { doc: { toString(): string } };
				dispatch(t: { selection: { anchor: number } }): void;
				focus(): void;
			};
			const el = document.querySelector('.cm-content') as unknown as {
				cmTile: { root: { view: View } };
			};
			const view = el.cmTile.root.view;
			view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('"Sam"') + 4 } });
			view.focus();
		});
		await page.keyboard.insertText('n'.repeat(n));
	});
}

test.describe('a leave card on an index that lags', () => {
	test('an edit after a rename rewrites the item it shows, and that one only', async ({
		page,
	}, info) => {
		t27d('T27d: the card plans on a stale range, which names another item (or waits)');
		await openLeaves(page, info);
		const shift = LEAVE_PLAN.indexOf(ITEM2) - LEAVE_PLAN.indexOf(ITEM1);
		expect(shift).toBe(ITEM1.length + 2);
		await renameSam(page, info, shift);
		const renamed = LEAVE_PLAN.replace('"Sam"', `"Sam${'n'.repeat(shift)}"`);
		await expect.poll(() => text(page)).toBe(renamed);
		await openDetails(page, info, '2026-12-21');
		await page.getByTestId('cal-leave-end').first().fill('2026-12-24');
		await expect
			.poll(() => text(page), { timeout: CHANGE_MS })
			.toBe(renamed.replace(ITEM2, 'annual 2026-12-21 - 2026-12-25'));
	});

	test('two quick changes to one leave both land', async ({ page }, info) => {
		t27d('T27d: the card holds changes while the index lags, and drops a queued one');
		await openLeaves(page, info);
		await openDetails(page, info, '2026-12-21');
		await page.getByTestId('cal-leave-type').first().selectOption({ label: 'Sick leave' });
		await page.getByTestId('cal-leave-end').first().fill('2026-12-24');
		await expect
			.poll(() => text(page), { timeout: CHANGE_MS })
			.toBe(LEAVE_PLAN.replace(ITEM2, 'sick 2026-12-21 - 2026-12-25'));
	});

	test('Remove removes the right item while the index lags', async ({ page }, info) => {
		t27d('T27d: Remove is disabled while the index lags, and a stale range is refused');
		await openLeaves(page, info);
		// The first item gets a longer type word, so the second moves one character right.
		await openDetails(page, info, '2026-12-14');
		await page.getByTestId('cal-leave-type').first().selectOption({ label: 'Special leave' });
		const first = LEAVE_PLAN.replace(ITEM1, 'special 2026-12-14 - 2026-12-16');
		await expect.poll(() => text(page), { timeout: CHANGE_MS }).toBe(first);
		await openDetails(page, info, '2026-12-21');
		await page.getByTestId('cal-leave-remove').first().click({ timeout: CHANGE_MS });
		await expect
			.poll(() => text(page), { timeout: CHANGE_MS })
			.toBe(first.replace(`, ${ITEM2}`, ''));
	});
});
