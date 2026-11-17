// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar view and leave painting (phase-3.md 9.5, 7.1 W3 to W5, 10, 13.2; T16), on the
// `poc-sample` plan (one file, New York time, three global holidays; Jack, Ana and a reviewer), on
// desktop Chrome and the Pixel 7 emulation:
// - each day shows the holiday with its name from the text, a person's leaves, non-working days and
//   the milestone;
// - W3, paint: Everyone and a person, a stroke over days (a mouse drag; a finger's long-press, then
//   a drag), merging with a touching leave; W4, erase: removing, trimming and splitting; W5, the
//   details: type, name, dates and Remove; each with the exact text after it, Undo restoring the
//   bytes and Redo the patch;
// - a leave no text item names (a macro) says so and is refused with "Edit as text";
// - the keyboard: Shift and the arrows select, L opens the type picker, Enter paints, Delete erases;
// - axe passes in light and dark, and a finger's days are 44 px.
// Over 400 lines on purpose: one spec file for one view, each test a user path.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import {
	caughtUp,
	changed,
	day,
	drag,
	openDetails,
	openCalendar,
	redo,
	setMode,
	setScope,
	setType,
	showDay,
	tapDay,
	text,
	textOf,
	undo,
} from './lib/calendar-rig';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T16); iPhone is reported');
});
test.setTimeout(READY_TIMEOUT_MS * 2);

const HOLIDAYS = [
	'leaves holiday "Thanksgiving" 2026-11-26 +2d,',
	'       holiday "Winter break" 2026-12-24 +2d,',
	'       holiday "New Year" 2027-01-01',
].join('\n');

/** A stroke over days, in Paint or Erase mode, and the text it leaves. */
async function stroke(
	page: Page,
	info: TestInfo,
	mode: 'paint' | 'erase',
	from: string,
	to: string,
): Promise<string> {
	const before = await text(page);
	await setMode(page, mode);
	const a = await showDay(page, from);
	await drag(page, info, a, day(page, to));
	return changed(page, before);
}

test('shows the holidays with their names, the weekends, the milestone and the legend', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	await showDay(page, '2026-11-26');
	// "Thanksgiving" is `+2d`: the 26th and the 27th.
	for (const d of ['2026-11-26', '2026-11-27']) {
		await expect(day(page, d)).toHaveAccessibleName(/Thanksgiving.*Holiday/);
	}
	await expect(day(page, '2026-11-28')).toHaveAccessibleName(/Non-working day/);
	await expect(day(page, '2026-11-30')).not.toHaveAccessibleName(/Holiday|Non-working/);
	await expect(day(page, '2026-11-26')).toHaveAttribute('aria-selected', 'false');
	await expect(page.getByTestId('cal-line')).toHaveText('No days selected.');
	// The release milestone is a diamond with its name. On a desktop a click on it selects the task;
	// a phone's day shows a mark only, so its details list the milestone with "Show in Gantt".
	const release = await showDay(page, '2027-01-06');
	await expect(release).toHaveAccessibleName(/v0\.1 on GitHub Pages/);
	if (isTouch(info)) {
		await tapDay(page, info, release);
		await tapDay(page, info, release);
		await page.getByRole('button', { name: 'Show in Gantt' }).tap();
	} else {
		await page.getByTestId('cal-milestone').first().click();
	}
	await expect
		.poll(() =>
			page.evaluate(() =>
				(
					window as unknown as { __mainspringEdits: { selection(): unknown } }
				).__mainspringEdits.selection(),
			),
		)
		.toMatchObject({ kind: 'task', id: 'release' });
});

test('W3 paint, merge; W4 erase: trim and split; Undo and Redo (Everyone)', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	const t0 = await text(page);
	expect(t0).toContain(HOLIDAYS);

	// Paint Mon 7 to Wed 9 Dec as a holiday for everyone.
	const t1 = await stroke(page, info, 'paint', '2026-12-07', '2026-12-09');
	expect(t1).toBe(
		t0.replace(
			'holiday "New Year" 2027-01-01',
			'holiday "New Year" 2027-01-01, holiday 2026-12-07 - 2026-12-10',
		),
	);
	for (const d of ['2026-12-07', '2026-12-08', '2026-12-09']) {
		await expect(day(page, d)).toHaveAccessibleName(/Holiday/);
		await expect(day(page, d)).toHaveAttribute('aria-selected', 'true');
	}
	await caughtUp(page);

	// Paint Thu 10 Dec: it touches the leave, so the same item grows.
	const t2 = await stroke(page, info, 'paint', '2026-12-10', '2026-12-10');
	expect(t2).toBe(t1.replace('holiday 2026-12-07 - 2026-12-10', 'holiday 2026-12-07 - 2026-12-11'));
	await caughtUp(page);

	// Erase Tue 8 Dec: the item splits in two.
	const t3 = await stroke(page, info, 'erase', '2026-12-08', '2026-12-08');
	expect(t3).toContain('holiday 2026-12-07 - 2026-12-08');
	expect(t3).toContain('holiday 2026-12-09 - 2026-12-11');
	await expect(day(page, '2026-12-08')).not.toHaveAccessibleName(/Holiday/);
	await caughtUp(page);

	// Erase Mon 7 Dec: the first item goes; Thu 10 Dec: the second is trimmed.
	const t4 = await stroke(page, info, 'erase', '2026-12-07', '2026-12-07');
	expect(t4).not.toContain('2026-12-07 - 2026-12-08');
	await caughtUp(page);
	const t5 = await stroke(page, info, 'erase', '2026-12-10', '2026-12-10');
	expect(t5).toContain('holiday 2026-12-09 - 2026-12-10');
	expect(t5).not.toContain('2026-12-11');

	// Undo walks back through every step to the bytes we began with; Redo replays one.
	for (const before of [t4, t3, t2, t1, t0]) {
		await undo(page);
		await expect.poll(() => text(page)).toBe(before);
	}
	await redo(page);
	await expect.poll(() => text(page)).toBe(t1);
});

test('W3 and W4 for a person: a leave in their declaration, painted, then changed (W5) and removed', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	const t0 = await text(page);
	await setScope(page, 'Jack');
	await setType(page, 'Sick leave');
	const t1 = await stroke(page, info, 'paint', '2026-12-14', '2026-12-16');
	// Jack had no body: the leave opens one.
	expect(t1).toMatch(/resource jack "Jack" \{\s*leaves sick 2026-12-14 - 2026-12-17\s*\}/);
	await expect(day(page, '2026-12-14')).toHaveAccessibleName(/Sick leave/);
	await caughtUp(page);

	// W5: the details of the selected days list the leave with its fields.
	await openDetails(page, info, '2026-12-14');
	await expect(page.getByTestId('cal-details')).toBeVisible();
	const card = page.getByTestId('cal-leave').first();
	await expect(card).toContainText('Sick leave');
	await card.getByTestId('cal-leave-type').selectOption({ label: 'Annual leave' });
	const t2 = await changed(page, t1);
	expect(t2).toContain('leaves annual 2026-12-14 - 2026-12-17');
	await caughtUp(page);
	await page.getByTestId('cal-leave-name').first().fill('Ski trip');
	await page.getByTestId('cal-leave-name').first().press('Enter');
	const t3 = await changed(page, t2);
	expect(t3).toContain('leaves annual "Ski trip" 2026-12-14 - 2026-12-17');
	await caughtUp(page);
	await page.getByTestId('cal-leave-end').first().fill('2026-12-18');
	const t4 = await changed(page, t3);
	expect(t4).toContain('annual "Ski trip" 2026-12-14 - 2026-12-19');
	await caughtUp(page);
	await page.getByTestId('cal-leave-remove').first().click();
	const t5 = await changed(page, t4);
	expect(t5).not.toContain('Ski trip');
	await caughtUp(page);

	for (const before of [t4, t3, t2, t1, t0]) {
		await undo(page);
		await expect.poll(() => text(page)).toBe(before);
	}
});

test('a type change and a bad date: the last day before the first is refused in the details', async ({
	page,
}, info) => {
	await openCalendar(page, info);
	await setScope(page, 'Ana');
	const t1 = await stroke(page, info, 'paint', '2026-12-21', '2026-12-22');
	await caughtUp(page);
	await openDetails(page, info, '2026-12-21');
	const end = page.getByTestId('cal-leave-end').first();
	await end.fill('2026-12-20');
	await expect(page.getByRole('alert').filter({ hasText: 'cannot be before' })).toBeVisible();
	expect(await text(page)).toBe(t1);
});

test('a leave of a macro is text only: the day says so and an erase is refused', async ({
	page,
}, info) => {
	await openCalendar(page, info, { mode: 'text' });
	const phone = isTouch(info);
	if (phone) await page.getByRole('tab', { name: 'Text', exact: true }).tap();
	const editor = page.getByRole('textbox', { name: /^Editor for / });
	await editor.click();
	await page.keyboard.press('Control+End');
	await page.keyboard.insertText(
		'\nmacro away [2026-12-14 - 2026-12-16]\nresource sam "Sam" {\n  leaves annual ${away}\n}\n',
	);
	await caughtUp(page);
	const before = await text(page);
	if (phone) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Calendar' }).tap();
	} else {
		await page.getByRole('button', { name: 'Visual', exact: true }).click();
		await page.getByRole('radio', { name: 'Calendar' }).first().click();
	}
	await setScope(page, 'Sam');
	const d = await showDay(page, '2026-12-14');
	await expect(d).toHaveAccessibleName(/Annual leave.*From a shift or macro\. Edit as text\./);
	await tapDay(page, info, d);
	if (phone) await tapDay(page, info, d);
	await expect(page.getByTestId('cal-textonly')).toContainText(
		'From a shift or macro. Edit as text.',
	);
	// Erase it: the planner says text only, and nothing changes in the text.
	await setMode(page, 'erase');
	await tapDay(page, info, d);
	if (phone) await drag(page, info, d, d);
	await expect(page.getByText('From a shift or macro. Edit as text.').last()).toBeVisible();
	expect(await text(page)).toBe(before);
});

test('the keyboard: Shift and the arrows select, L picks a type, Enter paints, Delete clears', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	await openCalendar(page, info);
	const t0 = await text(page);
	await setScope(page, 'Ana');
	const start = await showDay(page, '2026-12-01');
	await start.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(day(page, '2026-12-02')).toHaveAttribute('aria-selected', 'true');
	await expect(day(page, '2026-12-04')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('cal-line')).toContainText('3 days');
	await page.keyboard.press('l');
	const picker = page.getByRole('dialog', { name: 'Leave type' });
	await expect(picker).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	const t1 = await changed(page, t0);
	// The second type of a person's list is "Special leave".
	expect(t1).toMatch(/resource ana "Ana" \{\s*leaves special 2026-12-02 - 2026-12-05\s*\}/);
	await expect(picker).toBeHidden();
	await expect(day(page, '2026-12-04')).toBeFocused();
	await caughtUp(page);
	await page.keyboard.press('Delete');
	await expect.poll(() => text(page)).not.toBe(t1);
	expect(await text(page)).not.toContain('leaves special');
	await undo(page);
	await expect.poll(() => text(page)).toBe(t1);
	await undo(page);
	await expect.poll(() => text(page)).toBe(t0);
});

test('a person declared in an included file: the leave is written there, and Undo restores both files', async ({
	page,
}, info) => {
	// fedora-res keeps its people in mainspring-load.tji. It is included once, so no question is
	// asked (a declaration read in several places asks first: run.test.ts covers that flow).
	await openCalendar(page, info, { plan: 'fedora-res' });
	await setScope(page, 'Desktop 04');
	const entry0 = await text(page);
	const tji0 = await textOf(page, 'mainspring-load.tji');
	// Desktop 04's own leave, with its name from the text.
	const own = await showDay(page, '2013-06-10');
	await expect(own).toHaveAccessibleName(/Annual leave: annual leave/);
	await setMode(page, 'paint');
	await setType(page, 'Sick leave');
	const d = await showDay(page, '2013-06-17');
	// A click paints one day; a finger long-presses and lets go.
	if (isTouch(info)) await drag(page, info, d, d);
	else await tapDay(page, info, d);
	await expect.poll(() => textOf(page, 'mainspring-load.tji')).not.toBe(tji0);
	const tji1 = await textOf(page, 'mainspring-load.tji');
	expect(tji1).toContain('sick 2013-06-17 - 2013-06-18');
	expect(await text(page)).toBe(entry0);
	await undo(page);
	await expect.poll(() => textOf(page, 'mainspring-load.tji')).toBe(tji0);
	expect(await text(page)).toBe(entry0);
	await redo(page);
	await expect.poll(() => textOf(page, 'mainspring-load.tji')).toBe(tji1);
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe: the calendar, with days selected and the details open (${scheme})`, async ({
		page,
	}, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await openCalendar(page, info);
		await showDay(page, '2026-11-26');
		const scan = async (label: string): Promise<void> => {
			const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect(
				r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`),
				label,
			).toEqual([]);
		};
		await scan(`calendar (${scheme})`);
		const d = day(page, '2026-11-26');
		await tapDay(page, info, d);
		if (isTouch(info)) await tapDay(page, info, d);
		await expect(page.getByTestId('cal-details')).toBeVisible();
		await scan(`details (${scheme})`);
	});
}

test('a finger: every day and control of the calendar is 44 px', async ({ page }, info) => {
	test.skip(!isTouch(info), 'a finger');
	await openCalendar(page, info);
	await showDay(page, '2026-11-26');
	const small = await page.evaluate(() => {
		const out: string[] = [];
		const sel = '[data-testid="cal-day"], .bar button, .bar select, .modes label';
		for (const el of document.querySelectorAll<HTMLElement>(sel)) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && (r.width < 43.5 || r.height < 43.5)) {
				out.push(
					`${el.tagName} ${el.getAttribute('data-testid') ?? el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`,
				);
			}
		}
		return out;
	});
	expect(small).toEqual([]);
});
