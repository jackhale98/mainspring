// SPDX-License-Identifier: GPL-2.0-or-later
// The people picker (polish item 17): the toolbar's Assign button and its searchable list replace
// the rows of chips (R6). Desktop only (the control is for a mouse and a pen; a finger books people
// in the details sheet, which gantt-manipulation.spec.ts covers). Covered here: the search, a drag
// from the list and from a recent chip, assign mode (two bars, then Escape), the keyboard's direct
// assign and how it sits with assign mode, a container refused with its message, and the toolbar
// staying on one row at 1500, 1280, 1024 and 820 px, with the list closed, open and in assign mode.
// Every assertion on the plan is on its text, which only the picker's own edits may change.
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, Rig } from './lib/gantt-rig';

const CONTAINER_MESSAGE =
	'People are booked on subtasks. Drop them on a subtask, or assign them in the text.';

/** The toolbar is one row: it does not scroll, nothing is cut off, and the controls share a line. */
async function fitsOneRow(page: Page, state: string, maxHeight = 64): Promise<number> {
	await page.waitForTimeout(150);
	const m = await page.getByTestId('gantt').evaluate((el) => {
		const bar = el.querySelector('.bar') as HTMLElement;
		const r = bar.getBoundingClientRect();
		// What shows: not the visually hidden helpers or the empty slots.
		const chips = [...(bar.querySelector('.chips')?.children ?? [])].flatMap((c) => {
			const b = c.getBoundingClientRect();
			return c instanceof HTMLElement && b.width > 4 && b.height > 4 ? [b] : [];
		});
		const mid = (b: DOMRect): number => b.top + b.height / 2;
		return {
			overflow: bar.scrollWidth - bar.clientWidth,
			height: r.height,
			right: r.right,
			chipRight: Math.max(...chips.map((b) => b.right)),
			spread: Math.max(...chips.map(mid)) - Math.min(...chips.map(mid)),
			assign: !!bar.querySelector('[data-testid="assign-button"]'),
			recent:
				!!bar.querySelector('.recent') && bar.querySelector('.recent')!.getClientRects().length > 0,
		};
	});
	expect(m.assign, state).toBe(true);
	expect(m.overflow, `${state}: the row does not scroll`).toBeLessThanOrEqual(0);
	expect(m.height, `${state}: one row`).toBeLessThan(maxHeight);
	expect(m.spread, `${state}: the controls share a line`).toBeLessThan(6);
	expect(m.chipRight, `${state}: nothing is cut off`).toBeLessThanOrEqual(m.right + 0.5);
	return m.height;
}

test.describe('the people picker', () => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'desktop', 'a mouse and a keyboard (polish 17)');
	});

	// The list's own options (the zoom and view menus have native ones).
	const options = (page: Page) => page.getByRole('listbox', { name: 'People' }).getByRole('option');
	const count = async (rig: Rig, id: string): Promise<number> =>
		((await rig.text()).match(new RegExp(`allocate[^\\n]*\\b${id}\\b`, 'g')) ?? []).length;

	test('search narrows the list by name or id, and the arrows and Enter work', async ({
		page,
	}, info) => {
		// The Fedora plan with a generated pool has dozens of people: the case the picker is for.
		const rig = await Rig.open(page, info, 'week', 'visual', 'fedora-res');
		await rig.openPeople();
		const status = page.getByTestId('people-list').getByRole('status');
		await expect(status).toHaveText(/^\d+ people$/);
		await expect(options(page)).toHaveCount(24);
		await expect(status).toHaveText('24 people');
		await page.keyboard.type('server');
		await expect(options(page)).toHaveCount(6);
		// An id: "qa03" is Quality 03.
		await rig.peopleSearch.fill('qa03');
		await expect(options(page)).toHaveCount(1);
		await expect(options(page).first()).toContainText('Quality 03');
		await rig.peopleSearch.fill('zzzz');
		await expect(options(page)).toHaveCount(0);
		await expect(status).toContainText('No one');
		// Words in any order, and the arrows move the active option (aria-activedescendant).
		await rig.peopleSearch.fill('03 desktop');
		await expect(options(page)).toHaveCount(1);
		await rig.peopleSearch.fill('docs');
		await expect(options(page)).toHaveCount(6);
		const first = await options(page).first().getAttribute('id');
		await expect(rig.peopleSearch).toHaveAttribute('aria-activedescendant', first ?? '');
		await page.keyboard.press('ArrowDown');
		const second = await options(page).nth(1).getAttribute('id');
		await expect(rig.peopleSearch).toHaveAttribute('aria-activedescendant', second ?? '');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		const last = await options(page).last().getAttribute('id');
		await expect(rig.peopleSearch).toHaveAttribute('aria-activedescendant', last ?? '');
		// Escape closes the list and gives the focus back to the button.
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('people-list')).toBeHidden();
		await expect(page.getByTestId('assign-button')).toBeFocused();
		// Reopened, the search starts empty.
		await rig.openPeople();
		await expect(rig.peopleSearch).toHaveValue('');
		await expect(options(page)).toHaveCount(24);
	});

	test('a drag from the list assigns, one undo undoes it, and the person is a recent chip', async ({
		page,
	}, info) => {
		// Wide enough that the recent chips have room (the chart is at least 1200 px with the details docked).
		await page.setViewportSize({ width: 1700, height: 900 });
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const b = await rig.bar('design.review');
		const rev = await rig.revision();
		await rig.openPeople();
		await rig.drag(await rig.optionPoint('dev3'), b.body);
		// The list closes on the drop, and the booking is one `allocate`.
		await expect(page.getByTestId('people-list')).toBeHidden();
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		expect(await rig.text()).toContain('allocate dev3');
		await rig.rescheduled(rev);
		await rig.undoNewest();
		await expect.poll(() => rig.text()).toBe(before);
		// Dev 3 is the last person used: a small chip to drag again (where the toolbar has room).
		const chip = page.locator('[data-recent="dev3"]');
		await expect(chip).toBeVisible();
		const to = await rig.bar('launch');
		const box = await chip.boundingBox();
		if (!box) throw new Error('no chip');
		await rig.drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, to.body);
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		await rig.undoNewest();
		await expect.poll(() => rig.text()).toBe(before);
	});

	test('assign mode: a click on a person, two bars, then Escape ends it', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.openPeople();
		await rig.personOption('dev3').click();
		const mode = page.getByTestId('assign-mode');
		await expect(mode).toContainText('Assigning Dev 3');
		await expect(page.getByTestId('people-list')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Done assigning' })).toBeVisible();
		// The cursor says each bar takes someone.
		const review = await rig.bar('design.review');
		await page.mouse.move(review.body.x, review.body.y);
		await expect(page.getByTestId('gantt-overlay')).toHaveCSS('cursor', 'copy');
		await rig.tap(review.body);
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		const launch = await rig.bar('launch');
		await rig.tap(launch.body);
		await expect.poll(() => count(rig, 'dev3')).toBe(3);
		// Each click is its own undo step, and it does not select the bar.
		await expect(page.locator('[role="row"][aria-selected="true"]')).toHaveCount(0);
		await expect(mode).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(mode).toBeHidden();
		// Out of the mode a click on a bar selects it and books no one.
		const afterTwo = await rig.text();
		await rig.tap((await rig.bar('support.hotfix')).body);
		await expect(rig.row('task:support.hotfix')).toHaveAttribute('aria-selected', 'true');
		expect(await rig.text()).toBe(afterTwo);
		// Done ends it too; and one undo per booking brings the text back.
		await rig.openPeople();
		await rig.personOption('dev2').click();
		await expect(mode).toBeVisible();
		await page.getByRole('button', { name: 'Done assigning' }).click();
		await expect(mode).toBeHidden();
		await rig.undoNewest();
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		await rig.undoNewest();
		await expect.poll(() => rig.text()).toBe(before);
	});

	test('keyboard: Enter on a person books the selected task at once; assign mode is left as it is', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.select('design.review');
		await page.getByTestId('assign-button').focus();
		await page.keyboard.press('Enter');
		await expect(rig.peopleSearch).toBeFocused();
		await page.keyboard.type('dev 3');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('people-list')).toBeHidden();
		await expect(page.getByTestId('assign-button')).toBeFocused();
		// It booked the selected task and did not start assign mode.
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		await expect(page.getByTestId('assign-mode')).toBeHidden();
		await rig.undoNewest();
		await expect.poll(() => rig.text()).toBe(before);
		// With assign mode on (Dev 2) and a task selected in the list, Enter books Dev 3 on it and
		// the mode stays on Dev 2, the person it was started for.
		await rig.openPeople();
		await rig.personOption('dev2').click();
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning Dev 2');
		await rig.row('task:design.review').locator('.label').click();
		await expect(rig.row('task:design.review')).toHaveAttribute('aria-selected', 'true');
		await rig.openPeople();
		await page.keyboard.type('dev 3');
		await page.keyboard.press('Enter');
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning Dev 2');
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('assign-mode')).toBeHidden();
	});

	test('with no task selected Enter starts assign mode, as a click does', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		await rig.openPeople();
		await page.keyboard.type('dev 2');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning Dev 2');
	});

	test('a container is refused with its message, by a drag, in assign mode and by key', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		const design = await rig.bar('design');
		const onDesign = { x: design.box.x + 24, y: design.box.y + design.box.h / 2 };
		await rig.openPeople();
		await rig.drag(await rig.optionPoint('dev3'), onDesign);
		await expect(rig.toast.last()).toContainText(CONTAINER_MESSAGE);
		expect(await rig.text()).toBe(before);
		// Assign mode: the click on the summary bar is refused the same way.
		await rig.openPeople();
		await rig.personOption('dev3').click();
		await rig.tap(onDesign);
		await expect(rig.toast.last()).toContainText(CONTAINER_MESSAGE);
		expect(await rig.text()).toBe(before);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('assign-mode')).toBeHidden();
	});

	for (const [width, height] of [
		[1500, 900],
		[1280, 720],
		[1024, 768],
		[820, 1000],
	] as const) {
		for (const mode of ['visual', 'split'] as const) {
			test(`the toolbar stays on one row at ${width} px in ${mode}: closed, open, assigning, details docked`, async ({
				page,
			}, info) => {
				await page.setViewportSize({ width, height });
				const rig = await Rig.open(page, info, 'week', mode);
				const fits = (state: string): Promise<number> => fitsOneRow(page, state);
				await fits('closed');
				await rig.openPeople();
				await fits('list open');
				// The list's panel stays inside the window, whichever side of the button it opens to.
				const panel = await page.getByTestId('people-list').boundingBox();
				if (!panel) throw new Error('no list');
				expect(panel.x).toBeGreaterThanOrEqual(0);
				expect(panel.x + panel.width).toBeLessThanOrEqual(width + 0.5);
				await rig.personOption('dev2').click();
				await expect(page.getByTestId('assign-mode')).toBeVisible();
				await fits('assigning');
				// The widest row: the pill and the selected task's line together.
				await rig.row('task:design.research').locator('.label').click();
				await expect(rig.row('task:design.research')).toHaveAttribute('aria-selected', 'true');
				await fits('assigning, a task selected');
				await page.keyboard.press('Escape');
				await expect(page.getByTestId('assign-mode')).toBeHidden();
				// A selected task fills the task line (and docks the details where there is room).
				await rig.select('design.research');
				await fits('a task selected');
			});
		}
	}

	// The recent chips need room: none under a 1350 px chart, avatars under 1600 px, names above.
	// On fedora-res the critical-path note sits beside them too (two lines at most).
	const PLANS = {
		'gantt-manipulation': {
			ids: ['dev1', 'dev2', 'dev3', 'ops1'],
			names: ['Ops 1', 'Dev 3', 'Dev 2'],
			max: 64,
		},
		'fedora-res': {
			// The longest name is among the chips (truncated at 6rem): the widest case.
			ids: ['desk04', 'qa03', 'server02', 'docs01'],
			names: ['Documentation 01', 'Server 02', 'Quality 03'],
			max: 72,
		},
	} as const;
	for (const sample of ['gantt-manipulation', 'fedora-res'] as const) {
		for (const [width, height, tier] of [
			[1280, 720, 'none'],
			[1500, 900, 'avatars'],
			[1920, 1000, 'names'],
		] as const) {
			test(`${sample}: with the details hidden at ${width} px the recent chips are ${tier} and share the row`, async ({
				page,
			}, info) => {
				const plan = PLANS[sample];
				await page.setViewportSize({ width, height });
				const rig = await Rig.open(page, info, 'week', 'visual', sample);
				await page.getByRole('button', { name: 'Hide details' }).click();
				await expect(page.getByTestId('inspector')).toBeHidden();
				// Four people used: the newest three are chips, newest first.
				for (const id of plan.ids) {
					await rig.openPeople();
					await rig.personOption(id).click();
					await page.getByRole('button', { name: 'Done assigning' }).click();
				}
				const chips = page.locator('.recent [data-recent]');
				await expect(chips).toHaveCount(3);
				if (tier === 'none') {
					await expect(page.locator('.recent')).toBeHidden();
				} else {
					for (const [i, name] of plan.names.entries()) {
						await expect(chips.nth(i)).toHaveAccessibleName(name);
					}
					await expect(chips.first().locator('.name')).toBeVisible({ visible: tier === 'names' });
				}
				const label = `${sample}, recent chips (${tier})`;
				await fitsOneRow(page, label, plan.max);
				await rig.openPeople();
				await fitsOneRow(page, `${label}, list open`, plan.max);
				await page.keyboard.press('Escape');
				await page.locator('[role="row"][data-key]').nth(1).locator('.label').click();
				await fitsOneRow(page, `${label}, a task selected`, plan.max);
				await rig.openPeople();
				await rig.personOption(plan.ids[0]).click();
				await fitsOneRow(page, `${label}, assigning`, plan.max);
				await page.getByRole('button', { name: 'Done assigning' }).click();
				// The filter pill names the filter, one more thing in the band: with a person filter on
				// (the first person used: they have tasks) and a task selected, the row still fits.
				const worker = await page.evaluate(() => {
					const r = (
						window as unknown as {
							__mainspringGantt: {
								result(): {
									tasks: Array<{ scenarios: Record<string, { allocated: string[] }> }>;
									resources: Array<{ id: string; name: string }>;
									project: { scenarios: Array<{ id: string; active: boolean }> };
								};
							};
						}
					).__mainspringGantt.result();
					const sc = r.project.scenarios.find((x) => x.active)?.id ?? '';
					const n = (id: string): number =>
						r.tasks.filter((t) => t.scenarios[sc]?.allocated.includes(id)).length;
					return r.resources.find((x) => n(x.id) >= 2)?.name ?? '';
				});
				expect(worker, 'a person with tasks').not.toBe('');
				await page.getByTestId('filter-button').click();
				await page.getByRole('combobox', { name: 'Find a person to filter by' }).fill(worker);
				await page.keyboard.press('Enter');
				await page.getByTestId('filter-panel').getByRole('button', { name: 'Done' }).click();
				await expect(page.getByTestId('filter-button')).toHaveAccessibleName(/^Filter: /);
				await fitsOneRow(page, `${label}, filtered`, plan.max);
				await page.locator('[role="row"][data-key]').first().locator('.label').click();
				await fitsOneRow(page, `${label}, filtered, a task selected`, plan.max);
			});
		}
	}

	// The Fedora plan shows a note beside the chips when nothing is selected (the critical path ends
	// before the status date): it wraps, so it is two lines at most, and the band keeps its height
	// when assign mode puts the note away (no jump of the chart).
	for (const [width, height] of [
		[1500, 900],
		[1280, 720],
		[1024, 768],
		[820, 1000],
	] as const) {
		test(`the toolbar with the critical-path note stays on one band at ${width} px: closed, list open, assigning`, async ({
			page,
		}, info) => {
			await page.setViewportSize({ width, height });
			const rig = await Rig.open(page, info, 'month', 'visual', 'fedora-res');
			const closed = await fitsOneRow(page, 'closed', 72);
			await rig.openPeople();
			expect(await fitsOneRow(page, 'list open', 72), 'list open: same height').toBe(closed);
			await rig.personOption('docs02').click();
			await expect(page.getByTestId('assign-mode')).toContainText('Assigning Documentation 02');
			expect(await fitsOneRow(page, 'assigning', 72), 'assigning: same height').toBe(closed);
		});
	}

	test('a press that wobbles on a bar in assign mode books the person and moves nothing', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.openPeople();
		await rig.personOption('dev3').click();
		const review = await rig.bar('design.review');
		// A drag of a few pixels, down and a little along: not a move of the bar.
		await rig.drag(review.body, { x: review.body.x + 9, y: review.body.y + 2 }, { steps: 4 });
		await expect.poll(() => count(rig, 'dev3')).toBe(2);
		// Only the booking changed: every other line of the plan is as it was.
		const rest = (t: string): string[] => t.split('\n').filter((l) => !/allocate dev3/.test(l));
		expect(rest(await rig.text())).toEqual(rest(before));
		await expect(page.getByTestId('assign-mode')).toBeVisible();
		// A release off any bar books no one.
		const text = await rig.text();
		const scroller = await page.getByTestId('gantt').locator('.scroller').boundingBox();
		if (!scroller) throw new Error('no chart');
		await rig.drag(
			{ x: scroller.x + scroller.width - 30, y: scroller.y + scroller.height - 12 },
			{ x: scroller.x + scroller.width - 60, y: scroller.y + scroller.height - 12 },
		);
		await page.waitForTimeout(300);
		expect(await rig.text()).toBe(text);
	});

	test('link mode ends assign mode: the next bar click makes a link and books no one', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.openPeople();
		await rig.personOption('dev3').click();
		await expect(page.getByTestId('assign-mode')).toBeVisible();
		// Choose Link from the selected row's menu (the row is selected in the task list).
		await rig.row('task:design.sketch').locator('.label').click();
		await page.getByTestId('row-menu').click();
		await page.getByRole('menuitem', { name: /^Link from this task/ }).click();
		await expect(page.getByTestId('link-banner')).toBeVisible();
		await expect(page.getByTestId('assign-mode')).toBeHidden();
		await rig.tap((await rig.bar('launch')).body);
		await expect.poll(async () => (await rig.text()) !== before).toBe(true);
		// A link was written, and no one was booked.
		expect(await count(rig, 'dev3')).toBe(1);
		expect(await rig.text()).toMatch(/launch[\s\S]*depends/);
		await expect(page.getByTestId('assign-mode')).toBeHidden();
	});

	test('the key L ends assign mode too, and a click then links', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		await rig.openPeople();
		await rig.personOption('dev3').click();
		await rig.row('task:design.sketch').focus();
		await page.keyboard.press('l');
		await expect(page.getByTestId('link-banner')).toBeVisible();
		await expect(page.getByTestId('assign-mode')).toBeHidden();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('link-banner')).toBeHidden();
		await rig.tap((await rig.bar('design.review')).body);
		expect(await count(rig, 'dev3')).toBe(1);
	});

	test('Escape in the middle of a drag from the list cancels the drag only: assign mode stays', async ({
		page,
	}, info) => {
		const rig = await Rig.open(page, info);
		const before = await rig.text();
		await rig.openPeople();
		await rig.personOption('dev3').click();
		await rig.openPeople();
		const review = await rig.bar('design.review');
		await rig.drag(await rig.optionPoint('dev2'), review.body, {
			pause: async () => {
				await page.keyboard.press('Escape');
			},
		});
		await page.waitForTimeout(300);
		expect(await rig.text()).toBe(before);
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning Dev 3');
		await expect(page.getByTestId('assign-button')).toBeFocused();
		await expect(page.getByTestId('people-list')).toBeHidden();
	});

	test('assign mode ends when its person leaves the plan, and an undo does not bring it back', async ({
		page,
	}, info) => {
		// No braces: the editor closes a typed bracket by itself.
		const PLAN = (second: string): string =>
			`project p "P" 2026-03-02 - 2026-04-30\nresource r1 "R One"\n${second}task a "A"\ntask b "B"\n`;
		const rig = await Rig.open(page, info, 'week', 'split');
		const edit = async (text: string): Promise<void> => {
			await page.locator('.cm-content').click();
			await page.keyboard.press('ControlOrMeta+a');
			await page.keyboard.insertText(text);
		};
		await edit(PLAN('resource r2 "R Two"\n'));
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await rig.openPeople();
		await rig.personOption('r2').click();
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning R Two');
		await edit(PLAN(''));
		await expect(page.getByTestId('assign-mode')).toBeHidden({ timeout: READY_TIMEOUT_MS });
		// Undo in the editor brings R Two back to the plan, not to assign mode.
		await page.keyboard.press('ControlOrMeta+z');
		await rig.openPeople();
		await expect(rig.personOption('r2')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(page.getByTestId('assign-mode')).toBeHidden();
		await page.keyboard.press('Escape');
	});

	test('opening another plan ends assign mode and forgets the recent people', async ({
		page,
	}, info) => {
		// Wide, so that the recent chips show; Ana (ana) is in both plans, so that only the
		// switch can end the mode.
		await page.setViewportSize({ width: 1920, height: 1000 });
		const rig = await Rig.open(page, info, 'week', 'visual', 'ui-basic');
		await page.getByRole('button', { name: 'Hide details' }).click();
		await rig.openPeople();
		await rig.personOption('ana').click();
		await expect(page.getByTestId('assign-mode')).toContainText('Assigning Ana');
		await page.getByRole('button', { name: 'Done assigning' }).click();
		await rig.openPeople();
		await rig.personOption('ana').click();
		await expect(page.getByTestId('assign-mode')).toBeVisible();
		await page.getByRole('combobox', { name: 'Sample plan' }).selectOption('ui-multifile');
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('assign-button')).toBeVisible();
		await expect(page.getByTestId('assign-mode')).toBeHidden();
		await expect(page.locator('.recent [data-recent]')).toHaveCount(0);
	});

	test('hiding the Gantt (the Text view) ends assign mode', async ({ page }, info) => {
		const rig = await Rig.open(page, info);
		await rig.openPeople();
		await rig.personOption('dev3').click();
		await expect(page.getByTestId('assign-mode')).toBeVisible();
		const views = page.getByRole('group', { name: 'View' });
		await views.getByRole('button', { name: 'Text' }).click();
		await expect(page.getByTestId('gantt')).toBeHidden();
		await views.getByRole('button', { name: 'Visual' }).click();
		await expect(page.getByTestId('gantt')).toBeVisible();
		await expect(page.getByTestId('assign-button')).toBeVisible();
		await expect(page.getByTestId('assign-mode')).toBeHidden();
	});
});
