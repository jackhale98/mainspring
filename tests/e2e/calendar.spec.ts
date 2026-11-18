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
// - a desktop's month fills the view (1280x720 and 1920x1080); Previous, Next, Page Up and Page Down
//   change the month and keep the selection, Shift and the arrows go on into the next month, a
//   crowded day shows what fits (all of it inside the day, never a hidden chip that fits) and then
//   "+N more", which opens the day's details with the focus there, a Shift-click extends across
//   months, a month of four weeks fills the view, Today shows today's month, and the wheel turns the
//   month once per gesture, taking the focus with it;
// - axe passes in light and dark, and a finger's days are 44 px.
// Over 400 lines on purpose: one spec file for one view, each test a user path.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import {
	CROWD,
	FEBRUARY_PLAN,
	FIVE_DAY,
	SAM_DAY,
	SAM_TEXT,
	TWO_DAY,
	appendText,
	caughtUp,
	changed,
	day,
	drag,
	openDetails,
	openCalendar,
	redo,
	reachPast,
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
	expect(t3).toBe(
		t2.replace(
			'holiday 2026-12-07 - 2026-12-11',
			'holiday 2026-12-07 - 2026-12-08, holiday 2026-12-09 - 2026-12-11',
		),
	);
	await expect(day(page, '2026-12-08')).not.toHaveAccessibleName(/Holiday/);
	await caughtUp(page);

	// Erase Mon 7 Dec: the first item goes; Thu 10 Dec: the second is trimmed.
	const t4 = await stroke(page, info, 'erase', '2026-12-07', '2026-12-07');
	expect(t4).toBe(
		t3.replace(
			'holiday 2026-12-07 - 2026-12-08, holiday 2026-12-09 - 2026-12-11',
			'holiday 2026-12-09 - 2026-12-11',
		),
	);
	await caughtUp(page);
	const t5 = await stroke(page, info, 'erase', '2026-12-10', '2026-12-10');
	expect(t5).toBe(t4.replace('holiday 2026-12-09 - 2026-12-11', 'holiday 2026-12-09 - 2026-12-10'));

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
	const JACK = 'resource jack "Jack"';
	expect(t1).toBe(t0.replace(JACK, `${JACK} {\n    leaves sick 2026-12-14 - 2026-12-17\n  }`));
	await expect(day(page, '2026-12-14')).toHaveAccessibleName(/Sick leave/);
	await caughtUp(page);

	// W5: the details of the selected days list the leave with its fields.
	await openDetails(page, info, '2026-12-14');
	await expect(page.getByTestId('cal-details')).toBeVisible();
	const card = page.getByTestId('cal-leave').first();
	await expect(card).toContainText('Sick leave');
	await card.getByTestId('cal-leave-type').selectOption({ label: 'Annual leave' });
	const t2 = await changed(page, t1);
	expect(t2).toBe(t1.replace('leaves sick 2026-12-14', 'leaves annual 2026-12-14'));
	await caughtUp(page);
	await page.getByTestId('cal-leave-name').first().fill('Ski trip');
	await page.getByTestId('cal-leave-name').first().press('Enter');
	const t3 = await changed(page, t2);
	expect(t3).toBe(t2.replace('leaves annual 2026-12-14', 'leaves annual "Ski trip" 2026-12-14'));
	await caughtUp(page);
	await page.getByTestId('cal-leave-end').first().fill('2026-12-18');
	const t4 = await changed(page, t3);
	expect(t4).toBe(t3.replace('2026-12-14 - 2026-12-17', '2026-12-14 - 2026-12-19'));
	await caughtUp(page);
	await page.getByTestId('cal-leave-remove').first().click();
	const t5 = await changed(page, t4);
	// The only item goes with its statement; the body it opened stays.
	expect(t5).toBe(t4.replace('    leaves annual "Ski trip" 2026-12-14 - 2026-12-19\n', ''));
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
	// Erase it: the planner says text only, and nothing changes in the text. (On a phone the details
	// sheet covers the mode row: close it first.)
	if (phone) await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Close' }).tap();
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
	const ANA = 'resource ana "Ana"';
	expect(t1).toBe(t0.replace(ANA, `${ANA} {\n    leaves special 2026-12-02 - 2026-12-05\n  }`));
	await expect(picker).toBeHidden();
	await expect(day(page, '2026-12-04')).toBeFocused();
	await caughtUp(page);
	await page.keyboard.press('Delete');
	// The only item goes with its statement; the body stays.
	await expect
		.poll(() => text(page))
		.toBe(t1.replace('    leaves special 2026-12-02 - 2026-12-05\n', ''));
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
	expect(tji1).toBe(
		tji0.replace(
			'leaves annual "annual leave" 2013-06-10 - 2013-06-14',
			'leaves annual "annual leave" 2013-06-10 - 2013-06-14, sick 2013-06-17 - 2013-06-18',
		),
	);
	expect(await text(page)).toBe(entry0);
	await undo(page);
	await expect.poll(() => textOf(page, 'mainspring-load.tji')).toBe(tji0);
	expect(await text(page)).toBe(entry0);
	await redo(page);
	await expect.poll(() => textOf(page, 'mainspring-load.tji')).toBe(tji1);
});

const DESKTOP_ONLY = 'a desktop: its month fills the view';

/** The boxes that say whether the month fills the view. */
async function fit(page: Page) {
	return page.evaluate(() => {
		const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
		const scroller = document.querySelector<HTMLElement>('[data-testid="cal-scroller"]');
		const root = box('[data-testid="calendar"]');
		const bar = box('[data-testid="cal-bar-top"]');
		const line = box('[data-testid="cal-line"]');
		const grid = box('[data-testid="cal-month"] [role="grid"]');
		const cell = box('[data-testid="cal-day"]');
		return {
			root: root?.height ?? 0,
			bar: bar?.height ?? 0,
			line: line?.height ?? 0,
			grid: grid?.height ?? 0,
			gridW: grid?.width ?? 0,
			scroller: scroller?.clientWidth ?? 0,
			cell: cell?.height ?? 0,
			overflow: scroller ? scroller.scrollHeight - scroller.clientHeight : 0,
			months: document.querySelectorAll('[data-testid="cal-month"]').length,
		};
	});
}

for (const [w, h] of [
	[1280, 720],
	[1920, 1080],
] as const) {
	test(`desktop: one month fills the view at ${w}x${h}, with tall days and nothing to scroll`, async ({
		page,
	}, info) => {
		test.skip(isTouch(info), DESKTOP_ONLY);
		await page.setViewportSize({ width: w, height: h });
		await openCalendar(page, info);
		await showDay(page, '2026-11-26');
		await expect(page.getByTestId('calendar')).toHaveAttribute('data-layout', 'fill');
		const f = await fit(page);
		expect(f.months, 'only the month shown is mounted').toBe(1);
		// The grid takes the height the toolbar and the status line leave (its own 4 px of room above
		// and below, and a border).
		const room = f.root - f.bar - f.line;
		expect(Math.abs(f.grid - room), `grid ${f.grid}, room ${room}`).toBeLessThanOrEqual(12);
		expect(f.overflow).toBeLessThanOrEqual(1);
		// And its width: the whole width of the view, less the two gutters (24 px).
		expect(f.scroller - f.gridW).toBeLessThanOrEqual(56);
		// A day is tall (November has six weeks): over 60 px at 720, over 110 at 1080.
		expect(f.cell).toBeGreaterThan(h === 720 ? 60 : 110);
	});
}

test('desktop: with the details docked the month shrinks to fit beside them', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	await showDay(page, '2026-11-26');
	const before = await fit(page);
	await tapDay(page, info, day(page, '2026-11-26'));
	await expect(page.getByTestId('cal-details')).toBeVisible();
	const after = await fit(page);
	expect(after.scroller).toBeLessThan(before.scroller - 300);
	expect(after.grid).toBeGreaterThan(before.grid - 12);
	expect(after.months).toBe(1);
});

test('desktop: Previous and Next change the month and keep the selection', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	await showDay(page, '2026-12-10');
	await tapDay(page, info, day(page, '2026-12-10'));
	await expect(day(page, '2026-12-10')).toHaveAttribute('aria-selected', 'true');
	await page.getByTestId('cal-next').click();
	await expect.poll(month).toBe('2027-1');
	await expect(day(page, '2027-01-06')).toBeVisible();
	await expect(day(page, '2026-12-10')).toHaveCount(0);
	// The selection is the app's: it is still there, and the line says so.
	await expect(page.getByTestId('cal-line')).toContainText('Dec 10, 2026');
	await page.getByTestId('cal-prev').click();
	await expect.poll(month).toBe('2026-12');
	await expect(day(page, '2026-12-10')).toHaveAttribute('aria-selected', 'true');
	await page.getByTestId('cal-prev').click();
	await expect.poll(month).toBe('2026-11');
	await expect(page.getByTestId('cal-month')).toHaveCount(1);
});

test('desktop: Page Up and Page Down move a month, with Shift they extend the selection', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	const start = await showDay(page, '2026-12-09');
	await start.focus();
	await page.keyboard.press('PageDown');
	await expect.poll(month).toBe('2027-1');
	// Focus goes to the same date of the next month, and the selection follows focus.
	await expect(day(page, '2027-01-09')).toBeFocused();
	await expect(day(page, '2027-01-09')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('PageUp');
	await expect.poll(month).toBe('2026-12');
	await expect(day(page, '2026-12-09')).toBeFocused();
	// With Shift: Dec 9 to Jan 9 is selected, in either month.
	await page.keyboard.press('Shift+PageDown');
	await expect.poll(month).toBe('2027-1');
	await expect(page.getByTestId('cal-line')).toContainText('32 days');
	await expect(day(page, '2027-01-01')).toHaveAttribute('aria-selected', 'true');
	await expect(day(page, '2027-01-09')).toHaveAttribute('aria-selected', 'true');
	await expect(day(page, '2027-01-10')).toHaveAttribute('aria-selected', 'false');
	await page.keyboard.press('Shift+PageUp');
	await expect.poll(month).toBe('2026-12');
	await expect(page.getByTestId('cal-line')).not.toContainText('days');
});

test('desktop: Shift and the arrows go on past the edge of the month into the next', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	const d = await showDay(page, '2026-12-30');
	await d.focus();
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
	await expect.poll(month).toBe('2027-1');
	await expect(day(page, '2027-01-02')).toBeFocused();
	await expect(page.getByTestId('cal-line')).toContainText('4 days');
	await expect(day(page, '2027-01-01')).toHaveAttribute('aria-selected', 'true');
	// And back: the run shrinks, then the month turns again.
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
	await expect.poll(month).toBe('2026-12');
	await expect(page.getByTestId('cal-line')).not.toContainText('days');
});

/** A wheel swipe: `n` small events in one task (so none is a gap), the way a trackpad sends them. */
const swipe = (page: Page, dy: number, n = 40) =>
	page.getByTestId('cal-scroller').evaluate(
		(el, [d, count]) => {
			for (let i = 0; i < (count as number); i++) {
				el.dispatchEvent(
					new WheelEvent('wheel', {
						deltaY: (d as number) / (count as number) + (i < 10 ? 1 : 0),
						bubbles: true,
						cancelable: true,
					}),
				);
			}
		},
		[dy, n],
	);

test('desktop: a wheel swipe turns the month once; a pause and another turns it again', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	await showDay(page, '2026-12-10');
	await swipe(page, 200);
	await expect.poll(month).toBe('2027-1');
	// Exactly one month for the whole swipe: look again after the inertia would have run.
	await page.waitForTimeout(500);
	expect(await month()).toBe('2027-1');
	// A pause longer than the wheel's stillness (180 ms), then the swipe back.
	await swipe(page, -200);
	await expect.poll(month).toBe('2026-12');
	await page.waitForTimeout(500);
	expect(await month()).toBe('2026-12');
	// A nudge is not enough, and a notch in lines is a full step.
	await swipe(page, 15, 3);
	await page.waitForTimeout(500);
	expect(await month()).toBe('2026-12');
	await page.getByTestId('cal-scroller').evaluate((el) => {
		el.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true }));
	});
	await expect.poll(month).toBe('2027-1');
});

test('desktop: the wheel takes the focus in the grid to the same date of the new month', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	const d = await showDay(page, '2026-12-09');
	await d.focus();
	await swipe(page, 200);
	await expect.poll(month).toBe('2027-1');
	await expect(day(page, '2027-01-09')).toBeFocused();
	// The wheel moves the view and the focus, not the selection.
	await expect(page.getByTestId('cal-line')).toHaveText('No days selected.');
});

test('desktop: a Shift-click extends the selection from the anchor, in a month and across months', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	await showDay(page, '2026-12-10');
	await tapDay(page, info, day(page, '2026-12-10'));
	// In the month: Dec 10 to Dec 12.
	const box = await day(page, '2026-12-12').boundingBox();
	if (!box) throw new Error('no box');
	await page.keyboard.down('Shift');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await page.keyboard.up('Shift');
	await expect(page.getByTestId('cal-line')).toContainText('(3 days)');
	await expect(day(page, '2026-12-10')).toHaveAttribute('aria-selected', 'true');
	await expect(day(page, '2026-12-12')).toHaveAttribute('aria-selected', 'true');
	// Across months: a plain click on Dec 10, Next, Shift-click Jan 6: Dec 10 to Jan 6 (28 days).
	await tapDay(page, info, day(page, '2026-12-10'));
	await page.getByTestId('cal-next').click();
	await expect.poll(month).toBe('2027-1');
	const jan = await day(page, '2027-01-06').boundingBox();
	if (!jan) throw new Error('no box');
	await page.keyboard.down('Shift');
	await page.mouse.click(jan.x + jan.width / 2, jan.y + jan.height / 2);
	await page.keyboard.up('Shift');
	await expect(page.getByTestId('cal-line')).toContainText('(28 days)');
	await expect(day(page, '2027-01-01')).toHaveAttribute('aria-selected', 'true');
	await expect(day(page, '2027-01-06')).toHaveAttribute('aria-selected', 'true');
	await page.getByTestId('cal-prev').click();
	await expect(day(page, '2026-12-10')).toHaveAttribute('aria-selected', 'true');
	await expect(day(page, '2026-12-31')).toHaveAttribute('aria-selected', 'true');
});

test('desktop: Today shows the month of today, with today marked', async ({ page }, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await page.clock.setFixedTime(new Date('2026-12-15T12:00:00-05:00'));
	await openCalendar(page, info);
	const month = () => page.getByTestId('cal-month').getAttribute('data-month');
	// The view starts on today's month.
	await expect.poll(month).toBe('2026-12');
	await expect(day(page, '2026-12-15')).toHaveAttribute('aria-current', 'date');
	await page.getByTestId('cal-prev').click();
	await expect.poll(month).toBe('2026-11');
	await page.getByRole('button', { name: 'Today' }).click();
	await expect.poll(month).toBe('2026-12');
	await expect(day(page, '2026-12-15')).toHaveAttribute('aria-current', 'date');
});

test('desktop: a crowded day shows what fits, then "+N more", which opens the day', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info, { mode: 'text' });
	await appendText(page, info, SAM_TEXT);
	await setScope(page, 'Sam');
	const crowd = await showDay(page, SAM_DAY);
	const chips = crowd.locator('.chip');
	const more = crowd.getByTestId('cal-more');
	// At 1280x720 the row has room for three chips: two of the nine and "+7 more".
	await expect(more).toHaveCount(1);
	const shown = await chips.count();
	expect(shown).toBeGreaterThanOrEqual(1);
	expect(shown).toBeLessThan(CROWD);
	await expect(more).toHaveText(`+${CROWD - shown} more`);
	// What is shown and the button end inside the day.
	expect(await reachPast(crowd)).toBeLessThanOrEqual(0.5);
	// Every leave is in the day's name, shown or not (WCAG 1.4.1).
	for (const t of ['A1', 'A2', 'S1', 'S2', 'P1', 'P2', 'U1', 'U2', 'E1']) {
		await expect(crowd).toHaveAccessibleName(new RegExp(t));
	}
	// A day with no crowd shows its chips and no button.
	await expect(day(page, '2026-12-17').getByTestId('cal-more')).toHaveCount(0);
	// The button selects the day and opens its details, in Paint mode too: it paints nothing. The
	// focus goes to the details, so Escape closes them and the focus comes back to the day.
	const t0 = await text(page);
	await setMode(page, 'paint');
	await more.click();
	await expect(page.getByTestId('cal-details')).toBeVisible();
	await expect(page.getByTestId('cal-details')).toContainText('Dec 14, 2026');
	await expect(crowd).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('cal-leave')).toHaveCount(CROWD);
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest('.details')))
		.toBe(true);
	expect(await text(page)).toBe(t0);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('cal-details')).toBeHidden();
	await expect(crowd).toBeFocused();
});

test('desktop: on a short row two chips that fit are both shown, with no button', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info, { mode: 'text' });
	await appendText(page, info, SAM_TEXT);
	await setScope(page, 'Sam');
	// November has six weeks: the shortest rows at 1280x720.
	const two = await showDay(page, TWO_DAY);
	await expect(two.locator('.chip')).toHaveCount(2);
	await expect(two.getByTestId('cal-more')).toHaveCount(0);
	expect(await reachPast(two)).toBeLessThanOrEqual(0.5);
	// Five chips on a December row (about 80 px): some and the button, inside the day.
	const five = await showDay(page, FIVE_DAY);
	await expect(five.getByTestId('cal-more')).toHaveCount(1);
	expect(await reachPast(five)).toBeLessThanOrEqual(0.5);
});

test('desktop: a taller view shows more of the crowd, every chip and the button inside the day', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await page.setViewportSize({ width: 1920, height: 1080 });
	await openCalendar(page, info, { mode: 'text' });
	await appendText(page, info, SAM_TEXT);
	await setScope(page, 'Sam');
	// Five chips fit whole on a tall row: no button.
	const five = await showDay(page, FIVE_DAY);
	await expect(five.locator('.chip')).toHaveCount(5);
	await expect(five.getByTestId('cal-more')).toHaveCount(0);
	expect(await reachPast(five)).toBeLessThanOrEqual(0.5);
	// Nine do not: more than at 720, fewer than nine, and the last line is "+N more".
	const crowd = day(page, SAM_DAY);
	const shown = await crowd.locator('.chip').count();
	expect(shown).toBeGreaterThan(5);
	expect(shown).toBeLessThan(CROWD);
	await expect(crowd.getByTestId('cal-more')).toHaveText(`+${CROWD - shown} more`);
	expect(await reachPast(crowd)).toBeLessThanOrEqual(0.5);
	// The tall day does not leave a line empty that the next chip would have fitted in: showing one
	// more chip would not have fitted with the button, and all nine do not fit without it.
	const row = await crowd.evaluate((el) => el.getBoundingClientRect().height);
	expect(row).toBeLessThan(21 + CROWD * 18 - 1);
});

test('desktop: a month of four weeks is as tall as the view, with taller days', async ({
	page,
}, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await openCalendar(page, info, { mode: 'text' });
	await appendText(page, info, FEBRUARY_PLAN, true);
	const jan = await showDay(page, '2027-01-27');
	const janH = (await jan.boundingBox())?.height ?? 0;
	const rows = () => page.locator('[data-testid="cal-month"] .row:not(.dow)').count();
	expect(await rows()).toBe(5);
	const feb = await showDay(page, '2027-02-10');
	await expect.poll(rows).toBe(4);
	const f = await fit(page);
	const room = f.root - f.bar - f.line;
	expect(Math.abs(f.grid - room), `grid ${f.grid}, room ${room}`).toBeLessThanOrEqual(12);
	expect(f.overflow).toBeLessThanOrEqual(1);
	// Four rows share the height that five had: the days are taller.
	await expect.poll(async () => (await feb.boundingBox())?.height ?? 0).toBeGreaterThan(janH + 10);
});

test('a view too short for tall days keeps the fixed rows', async ({ page }, info) => {
	test.skip(isTouch(info), DESKTOP_ONLY);
	await page.setViewportSize({ width: 1280, height: 480 });
	await openCalendar(page, info);
	await showDay(page, '2026-11-26');
	await expect(page.getByTestId('calendar')).toHaveAttribute('data-layout', 'month');
	await expect(day(page, '2026-11-26')).toBeVisible();
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
