// SPDX-License-Identifier: GPL-2.0-or-later
// The Resources lanes (phase-3.md 9.4, 7.1 W1 and W2, 8.1, 10; T15), on desktop Chrome and the
// Pixel 7 emulation:
// - on `fedora-res` the lanes match the engine's bookings and leave: an oracle written here walks the
//   live result (`bookings`, `workingTime`, `leaves`) and shares no code with the view or with
//   src/lib/lanes; and the canvas shows what the model has (pixels: a bar, the leave hatch, the
//   over strip, a group's roll-up);
// - on `gantt-manipulation` (small, and it has the shapes): a drag of a bar to another person (W1)
//   and along its lane (W2) are exact patches, one undo step each (Undo restores the bytes, Redo the
//   patch), with a mouse on desktop and a long-press and drag on the phone; a bar whose allocation
//   is inherited is refused with its toast and "Show in text"; a text-only task shows its badge and
//   does not drag; the keyboard's Alt+arrows in the details do W1;
// - axe passes in light and dark.
// Over 400 lines on purpose: one spec file for one view, each test a user path.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { EngineLeaveType, ScheduleResult } from '../../src/engine/protocol';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { LanesRig, bookedOf, near } from './lib/lanes-rig';
import { smallTargets } from './lib/targets';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(({ browserName: _b }, info) => {
	test.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7 (T15); iPhone is reported');
});
test.setTimeout(READY_TIMEOUT_MS * 2);

type Pair = [number, number];
const overlaps = (set: Pair[], a: number, b: number): boolean =>
	set.some(([s, e]) => s < b && a < e);

function scenarioOf(r: ScheduleResult): string {
	const s = r.project?.scenarios.find((x) => x.active)?.id;
	if (!s) throw new Error('no active scenario');
	return s;
}

test('fedora-res: every person lane equals the bookings and leave of the result', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info, 'fedora-res');
	const result = await rig.result();
	if (!result?.project) throw new Error('no result');
	const sc = scenarioOf(result);
	const booked = bookedOf(result);
	const shape = await rig.shape();
	expect(shape?.zoom).toBe('week');
	// Every resource of the result is a lane, groups included, and nothing else.
	expect(new Set(shape?.rows)).toEqual(new Set(result.resources.map((r) => r.id)));

	let people = 0;
	let barsSeen = 0;
	let slotsChecked = 0;
	let leavesChecked = 0;
	for (const res of result.resources) {
		const bars = await rig.bars(res.id);
		if (res.group) {
			expect(bars, `${res.id} is a group: no bars`).toEqual([]);
			continue;
		}
		people++;
		const tasks = booked.get(res.id) ?? new Map<string, Pair[]>();
		// The same tasks, and per task the same booked minutes.
		expect(new Set(bars.map((b) => b.task)), `${res.id}: tasks`).toEqual(new Set(tasks.keys()));
		for (const [task, intervals] of tasks) {
			const mine = bars.filter((b) => b.task === task);
			const total = intervals.reduce((n, [s, e]) => n + (e - s), 0);
			expect(
				mine.reduce((n, b) => n + b.minutes, 0),
				`${res.id} ${task}: booked minutes`,
			).toBe(total);
			// Each booked slot run lies inside exactly one bar of its task.
			for (const [s, e] of intervals) {
				const inside = mine.filter((b) => b.from <= s && e <= b.to);
				expect(inside, `${res.id} ${task} [${s}, ${e})`).toHaveLength(1);
				slotsChecked++;
			}
			// A bar starts where a booking starts and ends where one ends.
			for (const b of mine) {
				expect(
					intervals.some(([s]) => s === b.from),
					`${res.id} ${task}: bar start`,
				).toBe(true);
				expect(
					intervals.some(([, e]) => e === b.to),
					`${res.id} ${task}: bar end`,
				).toBe(true);
			}
		}
		barsSeen += bars.length;
		// A lane has no stacking: bars are ordered and never overlap.
		for (let i = 1; i < bars.length; i++) {
			expect(bars[i]?.from, `${res.id}: bars overlap`).toBeGreaterThanOrEqual(bars[i - 1]?.to ?? 0);
		}
		// Leave: every engine leave slot is inside a block of its type, and a block holds no working time.
		const rs = res.scenarios[sc];
		const working = (rs?.workingTime ?? result.project.workingTime) as Pair[];
		const blocks = await rig.leaves(res.id);
		for (const l of rs?.leaves ?? []) {
			const of = blocks.find((b) => b.type === l.type)?.runs ?? [];
			for (const [s, e] of l.intervals) {
				expect(
					of.some((r) => r.from <= s && e <= r.to),
					`${res.id} ${l.type} leave [${s}, ${e})`,
				).toBe(true);
				leavesChecked++;
			}
		}
		for (const b of blocks) {
			for (const r of b.runs) {
				expect(
					overlaps(working, r.from, r.to),
					`${res.id}: a ${b.type} block over working time`,
				).toBe(false);
			}
		}
	}
	console.log(
		`lanes oracle (${info.project.name}): ${people} people, ${barsSeen} bars, ${slotsChecked} booking runs and ${leavesChecked} leave runs checked, 0 differences`,
	);
	expect(people).toBe(24);
	expect(barsSeen).toBeGreaterThan(150);
	expect(leavesChecked).toBeGreaterThan(20);
	// Every leave type of the result is in the legend's list.
	const types = new Set<EngineLeaveType>();
	for (const r of result.resources)
		for (const l of r.scenarios[sc]?.leaves ?? []) types.add(l.type);
	expect(new Set(await rig.leaveTypes())).toEqual(types);
});

test('fedora-res: the canvas draws the bars, the leave hatch, the over strip and the roll-up', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info, 'fedora-res');
	const barFill = await rig.token('--color-gantt-bar-bottom');
	const surface = await rig.token('--color-gantt-surface');
	const differs = (a: readonly number[], b: readonly number[]): boolean => !near(a, b, 40);

	// A bar: its fill just inside its left edge, mid-height; nothing but the lane before it.
	const bars = await rig.bars('desk03');
	const first = bars[0];
	if (!first) throw new Error('no bar');
	const inside = await rig.barPoint('desk03', first.task, 0, 4);
	expect(near(await rig.pixel(inside), barFill)).toBe(true);
	const before = { x: inside.x - 4 - 9, y: inside.y };
	expect(near(await rig.pixel(before), barFill, 10)).toBe(false);

	// Leave: a block of annual leave is hatched (many pixels that are not the lane's ground), the
	// lane a few columns on is not.
	const annual = (await rig.leaves('desk04')).find((l) => l.type === 'annual')?.runs[0];
	if (!annual) throw new Error('no annual leave');
	const mid = await rig.minutePoint('desk04', Math.round((annual.from + annual.to) / 2));
	await page.waitForTimeout(300);
	const grid = (cx: number, cy: number) =>
		Array.from({ length: 36 }, (_, i) => ({
			x: cx - 20 + (i % 12) * 3.5,
			y: cy - 10 + Math.floor(i / 12) * 6,
		}));
	const hatched = (await rig.pixels(grid(mid.x, mid.y))).filter((p) => differs(p, surface)).length;
	expect(hatched, 'hatch pixels in the leave block').toBeGreaterThan(5);
	const empty = await rig.minutePoint('desk04', annual.to + 60 * 24 * 7 * 6);
	await page.waitForTimeout(300);
	const bare = (await rig.pixels(grid(empty.x - 60, empty.y))).filter((p) =>
		differs(p, surface),
	).length;
	expect(bare, 'hatch pixels away from leave').toBeLessThan(hatched / 3);

	// A group's roll-up: the band colour of a period at the middle of its thin band.
	const bands = await rig.bands('desk');
	const col = bands.findIndex((b) => b === 'spare' || b === 'full');
	expect(col).toBeGreaterThanOrEqual(0);
	const shape = await rig.shape();
	const bounds = shape?.bounds ?? [];
	const gp = await rig.minutePoint('desk', (bounds[col] ?? 0) + 3000);
	const colour = await rig.token(`--load-${bands[col]}`);
	// The thin band is centred in the group's row: sample its middle; the lane centre is it.
	expect(near(await rig.pixel({ x: gp.x, y: gp.y }), colour, 6), `roll-up ${bands[col]}`).toBe(
		true,
	);

	// The over strip: a period that is over (held or unmet work comes after the first build) is red
	// at the foot of its lane.
	let over: { person: string; col: number } | null = null;
	const result = await rig.result();
	const leaves = (result?.resources ?? []).filter((r) => !r.group).map((r) => r.id);
	await expect
		.poll(
			async () => {
				for (const r of leaves) {
					const b = await rig.bands(r);
					const c = b.findIndex((x) => x === 'over');
					if (c >= 0) {
						over = { person: r, col: c };
						return true;
					}
				}
				return false;
			},
			{ timeout: 90_000, intervals: [2000] },
		)
		.toBe(true);
	const o = over as unknown as { person: string; col: number };
	const op = await rig.minutePoint(o.person, (bounds[o.col] ?? 0) + 3000);
	await page.waitForTimeout(300);
	// The strip is the last 6 px of the row: the lane's bar zone is 34 px, its centre 17 down.
	const strip = Array.from({ length: 12 }, (_, i) => ({ x: op.x - 20 + i * 3, y: op.y + 17 + 3 }));
	const red = (await rig.pixels(strip)).filter(
		(p) => p[0] > 140 && p[1] < 110 && p[2] < 130,
	).length;
	expect(red, `red pixels on the over strip of ${o.person} in column ${o.col}`).toBeGreaterThan(3);
});

/** The text of the entry file and the same with a replacement made once. */
const swap = (text: string, from: string, to: string): string => {
	expect(text, `the text has "${from}"`).toContain(from);
	return text.replace(from, to);
};

test('W1: dragging a bar to another person is one exact patch, and Undo and Redo go through it', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info);
	const before = await rig.text();
	const from = await rig.barPoint('dev1', 'design.research', 0, 12);
	const to = await rig.lane('dev2', from.x);
	await rig.drag(from, to, { hold: rig.hold, steps: 8 });
	// Research is `allocate dev1`, written once: the one id token changes, nothing else.
	const after = swap(
		before,
		'effort 3d\n    allocate dev1\n    complete 40',
		'effort 3d\n    allocate dev2\n    complete 40',
	);
	await rig.patched(after);
	// The lanes follow the engine: the bar is on Dev 2's lane, no longer on Dev 1's.
	await expect
		.poll(async () => (await rig.bars('dev2')).some((b) => b.task === 'design.research'), {
			timeout: READY_TIMEOUT_MS,
		})
		.toBe(true);
	expect((await rig.bars('dev1')).some((b) => b.task === 'design.research')).toBe(false);
	await rig.undoTo(before);
	// Undo took the bytes back and Redo gave the patch again (`undoTo`): the lanes follow the engine.
	await expect
		.poll(async () => (await rig.bars('dev2')).some((b) => b.task === 'design.research'), {
			timeout: READY_TIMEOUT_MS,
		})
		.toBe(true);
});

test('W1: a task of two people moves one of them, one id token', async ({ page }, info) => {
	const rig = await LanesRig.openLanes(page, info);
	const before = await rig.text();
	// Write docs is `allocate dev1, dev2` (ALAP, in March): Dev 1's bar goes to Dev 3.
	const from = await rig.barPoint('dev1', 'design.docs', 0, 8);
	const to = await rig.lane('dev3', from.x);
	await rig.drag(from, to, { hold: rig.hold, steps: 8 });
	await rig.patched(swap(before, 'allocate dev1, dev2', 'allocate dev3, dev2'));
	await rig.undoTo(before);
});

test('W2: dragging a bar along its lane moves the task a week: the start is written', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info);
	const before = await rig.text();
	const shape = await rig.shape();
	const from = await rig.barPoint('dev1', 'design.research', 0, 12);
	const to = { x: from.x + (shape?.cell.w ?? 112), y: from.y };
	await rig.drag(from, to, { hold: rig.hold, steps: 8 });
	// Monday 2 March to Monday 9 March: five working days, written as `start` (the preference was
	// answered: "start"), above the effort.
	await rig.patched(
		swap(
			before,
			'task research "Research" {\n    effort 3d',
			'task research "Research" {\n    start 2026-03-09\n    effort 3d',
		),
	);
	await rig.undoTo(before);
});

test('a refusal: an allocation that comes from a parent says so, with "Show in text"', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info);
	const before = await rig.text();
	// Hotfix is booked on Ops 1 through its container's `allocate ops1`: it is not written there.
	const from = await rig.barPoint('ops1', 'support.hotfix', 0, 2);
	const to = await rig.lane('dev1', from.x);
	await rig.drag(from, to, { hold: rig.hold, steps: 8 });
	const toast = page.getByTestId('toast').filter({ hasText: 'comes from a parent task' });
	await expect(toast).toBeVisible({ timeout: 30_000 });
	await expect(toast).toContainText('This value comes from a parent task. Change it there.');
	const show = toast.getByRole('button', { name: 'Show in text' });
	await expect(show).toBeVisible();
	expect(await rig.text()).toBe(before);
	// The button reveals the place in the text (the dispatcher's own reveal, as for every refusal);
	// pressing it edits nothing.
	await show.click();
	expect(await rig.text()).toBe(before);
});

test('a text-only task shows its badge and does not drag', async ({ page }, info) => {
	const rig = await LanesRig.openLanes(page, info);
	const before = await rig.text();
	const bars = await rig.bars('ops1');
	const bar = bars.find((b) => b.task === 'build.check_unit');
	// The macro-written task: text only, so not movable.
	expect(bar).toMatchObject({ textOnly: true, movable: false });
	const brass = await rig.token('--color-gantt-bar-bottom');
	const inside = await rig.barPoint('ops1', 'build.check_unit', 0, 5);
	// Faint and dashed, not the brass fill.
	expect(near(await rig.pixel(inside), brass, 10)).toBe(false);
	// Its period's name says "text only".
	const shape = await rig.shape();
	const bounds = shape?.bounds ?? [];
	const col = bounds.findIndex(
		(b, i) => (bar?.from ?? 0) >= b && (bar?.from ?? 0) < (bounds[i + 1] ?? 0),
	);
	const cell = page.locator(`[data-testid="lane-cell"][data-person="ops1"][data-col="${col}"]`);
	await expect(cell).toContainText('works on');
	await expect(cell).toContainText('(text only)');
	// A drag to another lane, and along its own, changes nothing and shows nothing.
	const rev = await rig.revision();
	const w = shape?.cell.w ?? 112;
	const down = await rig.lane('dev1', inside.x);
	await rig.drag(inside, down, { hold: rig.hold, steps: 8 });
	await page.waitForTimeout(500);
	const along = await rig.barPoint('ops1', 'build.check_unit', 0, 5);
	await rig.drag(along, { x: along.x + w, y: along.y }, { hold: rig.hold, steps: 8 });
	await page.waitForTimeout(700);
	expect(await rig.text()).toBe(before);
	expect(await rig.revision()).toBe(rev);
	await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('a click (a second tap on a phone) on a bar selects its task and opens the details of its period', async ({
	page,
}, info) => {
	const rig = await LanesRig.openLanes(page, info);
	const at = await rig.barPoint('dev3', 'spike', 0, 10);
	await rig.tap(at);
	if (rig.touch) {
		// A first tap selects; the sheet opens on the second.
		await expect(rig.root.getByTestId('cell-details')).toBeHidden();
		await rig.tap(at);
	}
	const details = rig.root.getByTestId('cell-details');
	await expect(details).toBeVisible();
	await expect(details.getByRole('heading', { level: 2 })).toContainText('Dev 3');
	await expect(details.getByTestId('detail-task').first()).toContainText('Spike');
	// The task is the app's selection: the Gantt shows it selected.
	await details.getByRole('button', { name: 'Show in Gantt' }).first().click();
	await expect(page.getByTestId('gantt')).toBeVisible();
	await expect(page.locator('[role="row"][data-key="task:spike"]')).toHaveAttribute(
		'aria-selected',
		'true',
	);
});

test('a long-press without moving opens the details; on a text-only bar too', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'a finger');
	const rig = await LanesRig.openLanes(page, info);
	const at = await rig.barPoint('ops1', 'build.check_unit', 0, 5);
	await rig.drag(at, at, { hold: 550, steps: 1 });
	await expect(rig.root.getByTestId('cell-details')).toBeVisible();
	await expect(rig.root.getByTestId('cell-details')).toContainText('Check');
});

test('keyboard: Enter opens the details of a period, Alt+Down on a task moves it to the next person', async ({
	page,
}, info) => {
	test.skip(isTouch(info), 'a keyboard');
	const rig = await LanesRig.openLanes(page, info);
	const before = await rig.text();
	const cell = page.locator('[data-testid="lane-cell"][data-person="dev1"][data-col="0"]');
	await expect(cell).toContainText('works on Research');
	await cell.focus();
	await page.keyboard.press('Enter');
	const details = rig.root.getByTestId('cell-details');
	await expect(details).toBeVisible();
	const task = details.getByTestId('detail-task').first();
	await task.focus();
	await page.keyboard.press('Alt+ArrowDown');
	await page.keyboard.press('Enter');
	await rig.patched(
		swap(
			before,
			'effort 3d\n    allocate dev1\n    complete 40',
			'effort 3d\n    allocate dev2\n    complete 40',
		),
	);
	await rig.undoTo(before);
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe: the lanes and the period details (${scheme})`, async ({ page }, info) => {
		const rig = await LanesRig.openLanes(page, info, 'gantt-manipulation', scheme);
		await rig.revealPerson('ops1');
		const run = async (state: string): Promise<void> => {
			await page.waitForTimeout(400);
			const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
			expect
				.soft(
					r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
					state,
				)
				.toEqual([]);
		};
		await run(`lanes (${scheme})`);
		const at = await rig.barPoint('dev3', 'spike', 0, 10);
		await rig.tap(at);
		if (rig.touch) await rig.tap(at);
		await expect(rig.root.getByTestId('cell-details')).toBeVisible();
		await run(`details (${scheme})`);
	});
}

test('a finger: the targets of the lanes are 44 px, but the 40 px lanes (the Phase 2 row)', async ({
	page,
}, info) => {
	test.skip(!isTouch(info), 'a finger');
	await LanesRig.openLanes(page, info);
	const small = (await smallTargets(page)).filter(
		(t) => !/people-shell|segment|panel|gridcell/i.test(t.what),
	);
	expect(small.map((t) => `${t.what} ${t.width}x${t.height}`)).toEqual([]);
});
