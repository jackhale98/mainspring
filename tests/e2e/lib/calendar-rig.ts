// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the Calendar specs (phase-3.md 13.2): opens a plan in the Calendar view (the desktop's
 * view switcher, or the phone's People tab and its Calendar segment), finds days by their date,
 * moves to a month with the toolbar (a desktop shows one month that fills the view, as a phone
 * does, so a day outside it is not in the DOM), drags over days with a mouse or a finger (a
 * long-press, then a move: real touch events through the DevTools protocol on the Pixel 7,
 * dispatched touch pointers on the iPhone), reads the entry file's text, and presses Undo.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig, isTouch } from './gantt-rig';
import { modKey } from './keys';
import { boxStable, frames, resultAfter, resultRevision } from './settle';

type Win = { __mainspringEdits: { text(path?: string): string | null } };

/** The plan these specs use: `poc-sample`, one file, New York time, three global holidays. */
export const PLAN = 'poc-sample';

export async function openCalendar(
	page: Page,
	info: TestInfo,
	opts: { plan?: string; mode?: 'visual' | 'split' | 'text' } = {},
): Promise<void> {
	const phone = isTouch(info);
	const plan = opts.plan ?? PLAN;
	await page.goto(
		phone
			? `/app?sample=${plan}&hooks=edits`
			: `/app?sample=${plan}&mode=${opts.mode ?? 'visual'}&view=calendar&hooks=edits`,
	);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	if (opts.mode === 'text') return;
	await showCalendar(page, info);
}

/** The Calendar view of an open plan (the phone's People tab, its Calendar segment). */
export async function showCalendar(page: Page, info: TestInfo): Promise<void> {
	if (isTouch(info)) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Calendar' }).tap();
	} else {
		await page.getByRole('radio', { name: 'Calendar' }).first().click();
	}
	await expect(page.getByTestId('cal-day').first()).toBeVisible({ timeout: 60_000 });
}

export const day = (page: Page, date: string): Locator =>
	page.locator(`[data-testid="cal-day"][data-date="${date}"]`);

/** Moves the toolbar to the month holding `date` (`yyyy-mm-dd`) and waits for its day. */
export async function showDay(page: Page, date: string): Promise<Locator> {
	const month = date.slice(0, 7).replace(/-0/, '-');
	const target = day(page, date);
	for (let i = 0; i < 12 && !(await target.isVisible()); i++) {
		const shown = await page
			.locator('[data-testid="cal-month"]')
			.first()
			.getAttribute('data-month');
		const [y, m] = month.split('-').map(Number) as [number, number];
		const [sy, sm] = (shown ?? '').split('-').map(Number) as [number, number];
		const forward = y * 12 + m > sy * 12 + sm;
		await page.getByTestId(forward ? 'cal-next' : 'cal-prev').click();
		// The next read must be of the new month, not of the one that is leaving.
		await expect(page.locator('[data-testid="cal-month"]').first()).not.toHaveAttribute(
			'data-month',
			shown ?? '',
		);
	}
	await expect(target).toBeVisible();
	return target;
}

export async function setMode(page: Page, mode: 'select' | 'paint' | 'erase'): Promise<void> {
	await page.locator('label', { has: page.getByTestId(`cal-mode-${mode}`) }).click();
	await expect(page.getByTestId('calendar')).toHaveAttribute('data-mode', mode);
}

export async function setScope(page: Page, name: string): Promise<void> {
	await page.getByTestId('cal-scope').selectOption({ label: name });
}

export async function setType(page: Page, label: string): Promise<void> {
	await page.getByTestId('cal-type').selectOption({ label });
}

async function centre(l: Locator): Promise<{ x: number; y: number }> {
	// Centred in the list, clear of its edges (a drag near an edge scrolls it).
	await l.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
	await boxStable(l, 3);
	const b = await l.boundingBox();
	if (!b) throw new Error('no box');
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Drags from one day to another: a mouse presses and moves; a finger holds for a long-press
 * (450 ms, past the machine's 350) and then moves, as the phone rules say (7.2).
 */
export async function drag(page: Page, info: TestInfo, from: Locator, to: Locator): Promise<void> {
	const a = await centre(from);
	const b = await centre(to);
	const steps = 8;
	if (isTouch(info)) {
		// Real touch events on the Pixel 7, dispatched touch pointers on the iPhone (Rig.drag).
		const rig = new Rig(page, info);
		try {
			await rig.drag(a, b, { hold: 450, steps });
		} finally {
			await rig.detach();
		}
	} else {
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		for (let i = 1; i <= steps; i++) {
			await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
		}
		await page.mouse.up();
	}
}

/** A click, or a finger's tap. */
export async function tapDay(page: Page, info: TestInfo, d: Locator): Promise<void> {
	const p = await centre(d);
	if (isTouch(info)) await page.touchscreen.tap(p.x, p.y);
	else await page.mouse.click(p.x, p.y);
}

/**
 * Has the details of a day on screen. A mouse's click or drop has opened them; a finger selects on
 * the first tap and opens them on the second (7.2).
 */
export async function openDetails(page: Page, info: TestInfo, date: string): Promise<void> {
	const d = await showDay(page, date);
	if (isTouch(info)) {
		await tapDay(page, info, d);
		await tapDay(page, info, d);
	}
	await expect(page.getByTestId('cal-details')).toBeVisible();
}

/** The entry file's text now. */
export const text = (page: Page): Promise<string> =>
	page.evaluate(() => (window as unknown as Win).__mainspringEdits.text() ?? '');

/** Another file's text now (the entry by default). */
export const textOf = (page: Page, path: string): Promise<string> =>
	page.evaluate((p) => (window as unknown as Win).__mainspringEdits.text(p) ?? '', path);

/** Waits for the text to change from `before`, and returns it. */
export async function changed(page: Page, before: string): Promise<string> {
	await expect.poll(() => text(page), { timeout: 20_000 }).not.toBe(before);
	return text(page);
}

export async function undo(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Undo' }).first().click();
}
export async function redo(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Redo' }).first().click();
}

/** Lets the index and the schedule catch up with an edit (the next stroke plans on them). */
export async function caughtUp(page: Page): Promise<void> {
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	// The status may still read "Scheduled" from before the edit (the edit goes out after a defer
	// and a paint), so the frames give the dispatch its turn.
	await frames(page, 8);
}

/**
 * Sam has leaves on three days of the poc-sample plan: nine named leaves on Monday 14 Dec 2026 (a
 * crowd, more than a tall row holds), five of five types on Tuesday 15 Dec, and one on Thanksgiving
 * (Thursday 26 Nov: with the holiday, two chips).
 */
export const SAM_DAY = '2026-12-14';
export const CROWD = 9;
export const FIVE_DAY = '2026-12-15';
export const TWO_DAY = '2026-11-26';
const named = (type: string, names: string[], date: string): string =>
	names.map((n) => `${type} "${n}" ${date}`).join(', ');
export const SAM_TEXT = `
resource sam "Sam" {
  leaves ${[
		named('annual', ['A1', 'A2'], SAM_DAY),
		named('sick', ['S1', 'S2'], SAM_DAY),
		named('special', ['P1', 'P2'], SAM_DAY),
		named('unpaid', ['U1', 'U2'], SAM_DAY),
		named('unemployed', ['E1'], SAM_DAY),
		'annual 2026-12-15, sick 2026-12-15, special 2026-12-15, unpaid 2026-12-15, unemployed 2026-12-15',
		named('annual', ['Trip'], TWO_DAY),
	].join(',\n         ')}
}
`;

/** A plan whose frame holds February 2027, a month of four weeks when weeks start on Monday. */
export const FEBRUARY_PLAN = `project feb "February" 2027-01-25 +7w {
  timezone "America/New_York"
  now 2027-01-25
}
resource r "R"
task t "T" {
  start 2027-02-01
  effort 2d
  allocate r
}
`;

/** How far the chips and the "+N more" button of a day reach past its bottom edge, in px. */
export const reachPast = (cell: Locator): Promise<number> =>
	cell.evaluate((el) => {
		const bottom = el.getBoundingClientRect().bottom;
		let reach = Number.NEGATIVE_INFINITY;
		for (const c of el.querySelectorAll('.chip, .more')) {
			reach = Math.max(reach, c.getBoundingClientRect().bottom);
		}
		return reach - bottom;
	});

/**
 * Appends `snippet` to the plan's text (in Text mode), or replaces all of it, then comes back to
 * the Calendar. The plan must have been opened with `openCalendar(page, info, { mode: 'text' })`.
 */
export async function appendText(
	page: Page,
	info: TestInfo,
	snippet: string,
	replace = false,
): Promise<void> {
	const phone = isTouch(info);
	if (phone) await page.getByRole('tab', { name: 'Text', exact: true }).tap();
	const editor = page.getByRole('textbox', { name: /^Editor for / });
	await editor.click();
	const mod = await modKey(page);
	await page.keyboard.press(replace ? `${mod}+A` : `${mod}+End`);
	const rev = await resultRevision(page);
	await page.keyboard.insertText(snippet);
	// "Scheduled" still shows the plan before the edit until its run starts.
	await resultAfter(page, rev, READY_TIMEOUT_MS);
	await caughtUp(page);
	if (phone) {
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
		await page.getByRole('tab', { name: 'Calendar' }).tap();
	} else {
		await page.getByRole('button', { name: 'Visual', exact: true }).click();
		await page.getByRole('radio', { name: 'Calendar' }).first().click();
	}
	await expect(page.getByTestId('cal-day').first()).toBeVisible({ timeout: 60_000 });
}
