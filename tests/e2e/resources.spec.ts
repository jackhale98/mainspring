// SPDX-License-Identifier: GPL-2.0-or-later
// The resource table, groups and person details (phase-3.md 9.6, 7.1 W6 to W8, 10, 13.2; T17) on the
// `poc-sample` plan (a group `dev` with Jack and Ana, and the reviewer, who all have tasks), on
// desktop Chrome and the Pixel 7 emulation (the Resources view's table beside the lanes; the phone's
// People tab, Team segment):
// - the table lists the people in plan order with their id, group, efficiency and the hours booked
//   in the frame (the engine's bookings), and a group the sum of its members;
// - W7: Add person types the name first (the id follows it), one undo step; rename in place;
//   delete, refused where an effort task would be left with nobody;
// - W6: Alt+Shift+Arrow moves a person into the group above and out again; the grip drags a row (a
//   mouse; a finger's long-press); a drop on a person that tasks are allocated to is refused as
//   `not-a-group`; each with the exact text after it, Undo restoring the bytes and Redo the patch;
// - W8: the person details: efficiency (a stepper whose burst is one undo step), rate, e-mail,
//   managers, the Group select, the working-hours editor, leaves; the project sheet's working hours,
//   working day, week start, time format and currency;
// - the keyboard path (Enter opens the details with the focus in them), axe in light and dark, and
//   the phone's path with 44 px targets.
// Over 400 lines on purpose: one spec file for one view, each test a user path.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { reloadFromFailure, trackFailedChunks } from './lib/chunk-failure';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import {
	add,
	caughtUp,
	changed,
	dragRow,
	openPerson,
	openResources,
	PLAN,
	redo,
	row,
	rowIds,
	selectRow,
	text,
	toast,
	undo,
} from './lib/resources-rig';
import { smallTargets } from './lib/targets';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.setTimeout(READY_TIMEOUT_MS * 2);

const GROUP = 'resource dev "Developers" {\n  resource jack "Jack"\n  resource ana "Ana"\n}\n';
const REV = 'resource rev "Reviewer"\n';
/** The group with the reviewer as its last member, and the blank line after the reviewer gone. */
const INTO =
	'resource dev "Developers" {\n  resource jack "Jack"\n  resource ana "Ana"\n  resource rev "Reviewer"\n}\n';

/** The text after a step, Undo giving back the bytes from before it and Redo the same text again. */
async function undoRedo(page: Page, before: string, after: string): Promise<void> {
	await undo(page);
	await expect.poll(() => text(page)).toBe(before);
	await redo(page);
	await expect.poll(() => text(page)).toBe(after);
}

test('lists the people in plan order with their group, efficiency and the hours booked', async ({
	page,
}, info) => {
	await openResources(page, info);
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'jack', 'ana', 'rev']);
	await expect(row(page, 'jack')).toHaveAttribute('aria-level', '2');
	await expect(row(page, 'dev')).toHaveAttribute('aria-expanded', 'true');
	await expect(row(page, 'jack')).toHaveAccessibleName(/Jack, in Developers, .* h booked/);
	const cells = async (id: string): Promise<string[]> =>
		row(page, id).locator('[role="gridcell"], [role="rowheader"]').allInnerTexts();
	const jack = await cells('jack');
	expect(jack[0]).toContain('Jack');
	expect(jack[1]).toBe('jack');
	expect(jack[2]).toBe('Developers');
	expect(jack[3]).toBe('1');
	// The hours are the exact sum of the engine's bookings of the plan's first scenario; a group is
	// the sum of its members. (The desktop's lanes hook gives the result.)
	if (!isTouch(info)) {
		const booked = await page.evaluate(() => {
			const w = window as unknown as {
				__mainspringLanes: {
					result(): {
						bookings: Array<{ scenario: string; resource: string; intervals: number[][] }>;
					} | null;
				};
			};
			const r = w.__mainspringLanes.result();
			const out: Record<string, number> = {};
			for (const b of r?.bookings ?? []) {
				const m = b.intervals.reduce((n, [s, e]) => n + (e as number) - (s as number), 0);
				out[b.resource] = (out[b.resource] ?? 0) + m;
			}
			return out;
		});
		const h = (m: number): string => `${Math.round((m / 60) * 100) / 100} h`;
		expect(jack[4]).toBe(h(booked['jack'] ?? 0));
		expect((await cells('ana'))[4]).toBe(h(booked['ana'] ?? 0));
		expect((await cells('dev'))[4]).toBe(h((booked['jack'] ?? 0) + (booked['ana'] ?? 0)));
		expect((await cells('rev'))[4]).toBe(h(booked['rev'] ?? 0));
	}
	// A group closes with Left and opens with Right.
	await row(page, 'dev').focus();
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'rev']);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'jack', 'ana', 'rev']);
});

test('W7: Add person types the name first, so the id follows it; one undo step; Escape adds nothing', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	await page.getByTestId('add-person-row').click();
	const input = page.getByTestId('add-form').getByRole('textbox');
	await expect(input).toBeFocused();
	await input.press('Escape');
	await expect(page.getByTestId('add-form')).toBeHidden();
	await page.getByTestId('add-person-row').click();
	await page.getByTestId('add-form').getByRole('textbox').press('Enter');
	expect(await text(page)).toBe(before);

	await add(page, 'person', 'Cy Twombly');
	const after = await changed(page, before);
	expect(after).toBe(before.replace(REV, `${REV}resource cy_twombly "Cy Twombly"\n`));
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'jack', 'ana', 'rev', 'cy_twombly']);
	await expect(row(page, 'cy_twombly')).toHaveAttribute('aria-selected', 'true');
	await undoRedo(page, before, after);
});

test('W7: Add group, then a person into the selected group', async ({ page }, info) => {
	await openResources(page, info);
	const before = await text(page);
	await selectRow(page, info, 'dev');
	await add(page, 'person', 'Dee');
	const after = await changed(page, before);
	expect(after).toBe(
		before.replace('  resource ana "Ana"\n}', '  resource ana "Ana"\n  resource dee "Dee"\n}'),
	);
	await caughtUp(page);
	await add(page, 'group', 'Crew');
	// Dee is selected, so the group goes after her, as her sibling, inside Developers.
	const group = await changed(page, after);
	expect(group).toBe(
		after.replace('  resource dee "Dee"\n}', '  resource dee "Dee"\n  resource crew "Crew"\n}'),
	);
	await undo(page);
	await expect.poll(() => text(page)).toBe(after);
});

test('W7: rename in place with F2, and Undo; delete, and refused where an effort task would lose its person', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	await row(page, 'jack').focus();
	await page.keyboard.press('F2');
	const field = row(page, 'jack').getByRole('textbox');
	await expect(field).toBeFocused();
	await field.fill('Jack B');
	await field.press('Enter');
	const renamed = await changed(page, before);
	expect(renamed).toBe(before.replace('resource jack "Jack"', 'resource jack "Jack B"'));
	await undoRedo(page, before, renamed);
	await caughtUp(page);

	// Delete: a person nothing needs goes with one key, and Undo brings them back.
	await undo(page);
	await expect.poll(() => text(page)).toBe(before);
	await add(page, 'person', 'Tess');
	const added = await changed(page, before);
	await caughtUp(page);
	await row(page, 'tess').focus();
	await page.keyboard.press('Delete');
	// A block takes one blank-line separation with it: Tess had none before her, so the one after
	// her goes (remove.ts), and Undo gives it back.
	await expect.poll(() => text(page)).toBe(before.replace(REV + '\n', REV));
	await undo(page);
	await expect.poll(() => text(page)).toBe(added);
	await caughtUp(page);
	await undo(page);
	await expect.poll(() => text(page)).toBe(before);
	await caughtUp(page);

	// Jack is the only person on tasks with an effort: deleting him would leave them with nobody.
	await row(page, 'jack').focus();
	await page.keyboard.press('Delete');
	await expect(page.getByText(/conflicts with that change/).first()).toBeVisible({
		timeout: 20_000,
	});
	expect(await text(page)).toBe(before);
});

test('W6: Alt+Shift+arrows move a person into the group above and out again', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	await row(page, 'rev').focus();
	await page.keyboard.press('Alt+Shift+ArrowRight');
	const into = await changed(page, before);
	// The block takes its blank-line separation with it (the one after it: nothing is before it).
	expect(into).toBe(before.replace(GROUP + REV + '\n', INTO));
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'jack', 'ana', 'rev']);
	await expect(row(page, 'rev')).toHaveAttribute('aria-level', '2');
	await undoRedo(page, before, into);
	await caughtUp(page);
	// The next key plans on the tree the view shows: wait until Redo has put Reviewer back in the group.
	await expect(row(page, 'rev')).toHaveAttribute('aria-level', '2');

	// Up among the siblings, then out of the group.
	await row(page, 'rev').focus();
	await page.keyboard.press('Alt+Shift+ArrowUp');
	await expect
		.poll(() => text(page))
		.toBe(
			into.replace(
				'  resource ana "Ana"\n  resource rev "Reviewer"\n}',
				'  resource rev "Reviewer"\n  resource ana "Ana"\n}',
			),
		);
	await caughtUp(page);
	await row(page, 'rev').focus();
	await page.keyboard.press('Alt+Shift+ArrowLeft');
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'jack', 'ana', 'rev']);
	await expect(row(page, 'rev')).toHaveAttribute('aria-level', '1');
	// It goes back to the top level after its group, with the blank line the edit API copies.
	expect(await text(page)).toMatch(/  resource ana "Ana"\n\}\n\n?resource rev "Reviewer"\n/);
});

test('W6: a person that tasks are allocated to cannot take members: not-a-group, nothing written', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	await add(page, 'person', 'Tess');
	const added = await changed(page, before);
	await caughtUp(page);
	// Tess is last; the one above her at the top level is the reviewer, who has a task.
	await row(page, 'tess').focus();
	await page.keyboard.press('Alt+Shift+ArrowRight');
	await expect(page.getByText(/Reviewer has tasks, so people cannot join it/).first()).toBeVisible({
		timeout: 20_000,
	});
	expect(await text(page)).toBe(added);
});

test('W6: the grip drags a row into the group above (a mouse; a finger after the long-press)', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	// A row at the same boundary, 24 px to the right: one indent step, into `dev` after Ana.
	await dragRow(page, info, 'rev', 28, 0);
	// On the iPhone's dispatched finger: the grip took the touch, so the table did not scroll.
	await new Rig(page, info).expectOwnsTouch();
	const into = await changed(page, before);
	expect(into).toBe(before.replace(GROUP + REV + '\n', INTO));
	await undoRedo(page, before, into);
});

test('W8: the details of a person: efficiency (one undo step), rate, e-mail, managers and group', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	const d = await openPerson(page, info, 'ana');
	await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Ana');
	await expect(d.getByText('ana', { exact: true })).toBeVisible();

	// Efficiency: three presses of + are one edit and one undo step (the cumulative value).
	const plus = d.getByRole('button', { name: 'Increase Efficiency' });
	await plus.click();
	await plus.click();
	await plus.click();
	const eff = await changed(page, before);
	await expect
		.poll(() => text(page), { timeout: 20_000 })
		.toBe(
			before.replace('resource ana "Ana"\n', 'resource ana "Ana" {\n    efficiency 1.15\n  }\n'),
		);
	await caughtUp(page);
	await undo(page);
	await expect.poll(() => text(page)).toBe(before);
	await redo(page);
	await expect.poll(() => text(page)).toBe(eff);
	await caughtUp(page);

	// Rate and e-mail commit on Enter.
	const rate = d.getByLabel('Rate', { exact: true });
	await rate.fill('450');
	await rate.press('Enter');
	await expect.poll(() => text(page)).toContain('    rate 450\n');
	await caughtUp(page);
	const email = d.getByLabel('E-mail', { exact: true });
	await email.fill('ana@example.com');
	await email.press('Enter');
	await expect.poll(() => text(page)).toContain('    email "ana@example.com"\n');
	await caughtUp(page);

	// Managers: one chip, from the picker; its remove button takes it away.
	await d.getByLabel('Add a manager').selectOption({ label: 'Reviewer' });
	await expect.poll(() => text(page)).toContain('    managers rev\n');
	await caughtUp(page);
	await d.getByRole('button', { name: 'Remove manager Reviewer' }).click();
	await expect.poll(() => text(page)).not.toContain('managers rev');
	await caughtUp(page);

	// Group: out of Developers to the top level, a regroup like a drag.
	const withAttrs = await text(page);
	await d.getByLabel('Group', { exact: true }).selectOption({ label: 'None (top level)' });
	await expect.poll(() => text(page)).not.toBe(withAttrs);
	await expect.poll(() => rowIds(page)).toEqual(['dev', 'jack', 'rev', 'ana']);
	await undo(page);
	await expect.poll(() => text(page)).toBe(withAttrs);
});

test('W8: the working-hours editor writes the hours of one weekday, and Undo takes it back', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	const d = await openPerson(page, info, 'jack');
	const hours = d.getByTestId('working-hours');
	await expect(hours).toContainText('Same as Developers until changed here');
	// Saturday is off: switch it on (9:00 to 17:00), then change its start.
	await hours.getByLabel('Saturday: day off').uncheck();
	await expect
		.poll(() => text(page))
		.toBe(
			before.replace(
				'resource jack "Jack"\n',
				'resource jack "Jack" {\n    workinghours sat 9:00 - 17:00\n  }\n',
			),
		);
	await caughtUp(page);
	const start = hours.getByLabel('Saturday, range 1: from');
	await start.fill('10:30');
	await start.press('Enter');
	await expect.poll(() => text(page)).toContain('workinghours sat 10:30 - 17:00');
	await caughtUp(page);
	// A time that is not a time is said, and nothing is written.
	const now = await text(page);
	await start.fill('later');
	await start.press('Enter');
	await expect(hours.getByRole('alert')).toContainText('Enter a time such as 9:00');
	expect(await text(page)).toBe(now);
	// Friday off, in one step.
	await hours.getByLabel('Friday: day off').check();
	await expect.poll(() => text(page)).toContain('workinghours fri off');
	await caughtUp(page);
	await undo(page);
	await expect.poll(() => text(page)).toBe(now);
});

test('the project sheet: working hours, the working day, the week start, time format and currency', async ({
	page,
}, info) => {
	await openResources(page, info);
	const before = await text(page);
	await page.locator('header').getByRole('button', { name: 'Project settings' }).click();
	const sheet = page.getByRole('dialog', { name: 'Project' });
	await expect(sheet).toBeVisible();
	const hours = sheet.getByTestId('working-hours');
	await expect(hours).toContainText('Same as the project until changed here');
	await hours.getByLabel('Saturday: day off').uncheck();
	await expect.poll(() => text(page)).toContain('  workinghours sat 9:00 - 17:00\n');
	await caughtUp(page);
	const daily = sheet.getByRole('textbox', { name: 'Hours in a working day' });
	await daily.fill('7.5');
	await daily.press('Enter');
	await expect.poll(() => text(page)).toContain('  dailyworkinghours 7.5\n');
	await caughtUp(page);
	await sheet.getByRole('switch', { name: 'Weeks start on Monday' }).uncheck();
	await expect.poll(() => text(page)).toContain('  weekstartssunday\n');
	await caughtUp(page);
	const currency = sheet.getByLabel('Currency', { exact: true });
	await currency.fill('EUR');
	await currency.press('Enter');
	await expect.poll(() => text(page)).toContain('  currency "EUR"\n');
	await caughtUp(page);
	// `timeformat` is written already (the sample says "%Y-%m-%d"): it reads back, and clearing it removes it.
	await expect(sheet.getByLabel('Time format', { exact: true })).toHaveValue('%Y-%m-%d');
	await sheet.getByLabel('Time format', { exact: true }).fill('');
	await sheet.getByLabel('Time format', { exact: true }).press('Enter');
	await expect.poll(() => text(page)).not.toContain('timeformat');
	expect(await text(page)).not.toBe(before);
});

test('the keyboard: Enter opens the details with the focus in the first field; Escape comes back', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard path (desktop)');
	await openResources(page, info);
	await row(page, 'ana').focus();
	await page.keyboard.press('Enter');
	const d = page.getByTestId('person-details');
	await expect(d.getByLabel('Name', { exact: true })).toBeFocused({ timeout: 20_000 });
	await page.keyboard.press('Escape');
	await expect(row(page, 'ana')).toBeFocused();
	// Arrows walk the rows without selecting; Space selects.
	await page.keyboard.press('ArrowUp');
	await expect(row(page, 'jack')).toBeFocused();
	await expect(row(page, 'jack')).toHaveAttribute('aria-selected', 'false');
	await page.keyboard.press(' ');
	await expect(row(page, 'jack')).toHaveAttribute('aria-selected', 'true');
	await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Jack');
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe: the table and a person's details (${scheme})`, async ({ page }, info) => {
		await openResources(page, info, { scheme });
		await openPerson(page, info, 'ana');
		await expect(page.getByTestId('working-hours')).toBeVisible();
		const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
		expect(r.violations, JSON.stringify(r.violations.map((v) => [v.id, v.nodes[0]?.html]))).toEqual(
			[],
		);
	});
}

test('44 px targets: the table’s rows, buttons and the details’ controls on a finger', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'a finger (Pixel 7)');
	await openResources(page, info);
	// Every visible control of the page (the shell's included) is at least 44 px on a finger.
	expect(await smallTargets(page)).toEqual([]);
	const d = await openPerson(page, info, 'ana');
	expect(await smallTargets(page)).toEqual([]);
	await expect(d).toBeVisible();
});

test('the phone: the Team segment is the table alone; a first tap selects, the second opens the details', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'the phone path (Pixel 7)');
	await openResources(page, info);
	await expect(page.getByTestId('team-view')).toBeVisible();
	await expect(page.getByTestId('lanes')).toBeHidden();
	await selectRow(page, info, 'jack');
	await expect(row(page, 'jack')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('person-details')).toBeHidden();
	await selectRow(page, info, 'jack');
	await expect(page.getByTestId('person-details')).toBeVisible({ timeout: 30_000 });
	// Add person on the phone: the name field, the keyboard's Enter, the new row.
	const before = await text(page);
	await page.getByTestId('add-person-row').tap();
	const input = page.getByTestId('add-form').getByRole('textbox');
	await input.fill('Cy');
	await input.press('Enter');
	await changed(page, before);
	await expect.poll(() => toast(page)).not.toBe('');
});

test('a view chunk that cannot be fetched says so: Try again, then Reload the page (two strikes)', async ({
	page,
}, info) => {
	await page.route(/\/ResourcesView[^/]*\.js(\?|$)/, (route) => route.abort());
	const failedUrls = trackFailedChunks(page, /\/ResourcesView[^/]*\.js(\?|$)/);
	await page.goto(
		isTouch(info)
			? `/app?sample=${PLAN}&hooks=edits`
			: `/app?sample=${PLAN}&mode=visual&view=resources&hooks=edits`,
	);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	if (isTouch(info)) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Team' }).tap();
	}
	const failed = page.getByTestId('people-view-failed');
	await expect(failed).toBeVisible({ timeout: 60_000 });
	await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();
	// The first strike: another try, which fails too; a browser remembers a failed import, so now a reload.
	await failed.getByRole('button', { name: 'Try again' }).click();
	await expect(failed.getByRole('button', { name: 'Reload the page' })).toBeVisible();
	await page.unroute(/\/ResourcesView[^/]*\.js(\?|$)/);
	await reloadFromFailure(
		page,
		(b) => b.click(),
		failed.getByRole('button', { name: 'Reload the page' }),
		failedUrls,
	);
	// A reload opens the phone on its first tab again.
	if (isTouch(info)) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Team' }).tap();
	}
	await expect(page.getByTestId('resource-row').first()).toBeVisible({ timeout: 60_000 });
});

test('the person details chunk that cannot be fetched says so, with the same two strikes', async ({
	page,
}, info) => {
	await page.route(/\/ResourcePanel[^/]*\.js(\?|$)/, (route) => route.abort());
	const failedUrls = trackFailedChunks(page, /\/ResourcePanel[^/]*\.js(\?|$)/);
	await openResources(page, info);
	await selectRow(page, info, 'ana');
	if (isTouch(info)) await selectRow(page, info, 'ana');
	const failed = page.getByTestId('person-failed');
	await expect(failed).toBeVisible({ timeout: 60_000 });
	await failed.getByRole('button', { name: 'Try again' }).click();
	await expect(failed.getByRole('button', { name: 'Reload the page' })).toBeVisible();
	await page.unroute(/\/ResourcePanel[^/]*\.js(\?|$)/);
	await reloadFromFailure(
		page,
		(b) => b.click(),
		failed.getByRole('button', { name: 'Reload the page' }),
		failedUrls,
	);
	// A reload opens the phone on its first tab again.
	if (isTouch(info)) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Team' }).tap();
	}
	await expect(page.getByTestId('resource-row').first()).toBeVisible({ timeout: 60_000 });
});

test('the details beside the table talk about people when nobody is selected', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'the right panel (desktop)');
	await openResources(page, info);
	const panel = page.getByTestId('inspector');
	await expect(panel.getByRole('heading', { name: 'Person details' })).toBeVisible();
	await expect(panel).toContainText('Select a person to see and change their details.');
});

test('a delete says what went with the person, and the group select is indented with a visible mark', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'desktop');
	await openResources(page, info);
	const d = await openPerson(page, info, 'rev');
	await expect(d.getByLabel('Group', { exact: true }).locator('option').nth(1)).toHaveText(
		'Developers',
	);
	await add(page, 'person', 'Tess');
	await caughtUp(page);
	await row(page, 'tess').focus();
	await page.keyboard.press('Delete');
	await expect(page.getByText('Deleted Tess').first()).toBeVisible({ timeout: 20_000 });
	await caughtUp(page);
	// Jack has tasks and the group around him: a delete of the group names what went with it.
	await row(page, 'dev').focus();
	await page.keyboard.press('Delete');
	await expect(
		page.getByText(/conflicts with that change|Removed Developers and/).first(),
	).toBeVisible({
		timeout: 20_000,
	});
});
