// SPDX-License-Identifier: GPL-2.0-or-later
// "Why here?" and "Show in Gantt" (phase-3.md 9.3, 9.7, 20, 24; T18), desktop Chrome, the Pixel 7
// emulation and the iPhone 14 (WebKit). The one test that reads the explainer against the native
// golden of the plan with the most causes runs on `fedora-res`; the others run on the small plans
// `ui-basic` and `ui-people`, or on the health fixture H8 typed into the editor (ADR-0016 change 4:
// the size of the plan is not what they test), with the explainer's sentences read from the engine
// run in the spec's own process (lib/small-plan.ts) and, for the fixture, its native golden:
// - the task details' Schedule block lists the explainer's causes of the task as sentences, read
//   here from `explainTask` and `whyText` on the golden (the live result equals it on this plan), and
//   says less when the explainer cannot tell ("The schedule does not show why."); a cause links to
//   the task it names;
// - a finding's "Why here?" fix opens the details at that section, with the focus on it;
// - the heatmap's cell details list a task's reasons under its row;
// - "Show in Gantt" from a cell's task and from a finding about a person sets the person filter (the
//   filter line over the task table names the person) and selects the task; "Open in Workload"
//   opens the person's cell; axe in light and dark; 44 px targets on a phone.
// Over 400 lines on purpose: one spec for the one feature, each test a user path on the same plan.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { whyText } from '../../src/lib/health/why-text';
import { explainTask } from '../../src/lib/schedule/explain-task';
import { goldenContext } from '../../src/lib/schedule/explain-testing';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import {
	H8_LONE_PLAN,
	openHealth,
	openPlan,
	openSample,
	rowOf,
	selectionOf,
	setPlan,
	TAGS,
} from './lib/health-rig';
import { settledValue } from './lib/settle';
import { contextOfText, smallContext } from './lib/small-plan';
import type { ExplainContext } from '../../src/lib/schedule/explain-types';
import { checkPlan } from '../../src/lib/health/report';
import { inputOf } from '../../src/lib/health/testing';
import { oracle, openHeatmap, resultOf, shape } from './lib/workload-rig';

test.setTimeout(READY_TIMEOUT_MS * 2);
test.use({ actionTimeout: 20_000 });

const NAMING = 'f20.naming';
const WIKI = 'f20.PlanningPhase.clean_market_wiki';

/** The explainer's sentences for a task, in the browser's language (en-US under Playwright). */
function expectedWhy(ctx: ExplainContext, task: string) {
	const w = whyText(explainTask(task, ctx), ctx, 'en-US');
	return {
		causes: w.causes,
		inside: w.inside,
		texts: [...w.causes, ...w.inside].map((l) => l.text),
	};
}

// The small plans (tests/fixtures/ui): ui-basic's Sketch waits for Research with a gap, and its
// Launch has a written start; ui-people's Core is a container whose cause the explainer cannot tell.
const SMALL = 'ui-basic';
const SKETCH = 'design.sketch';
const RESEARCH = 'design.research';
const LAUNCH = 'launch';
const UNSURE = 'build.core';
// Health fixture H8 (fail) with one more task (H8_LONE_PLAN): "side" runs without Dev for 24 hours;
// "lone" is a task of Ann's that Dev is not on, with nothing before it.
const SIDE = 'side';
const LONE = 'lone';
const H8_PLAN = H8_LONE_PLAN;

/** The details: the side panel on a desktop (the Details tab), the bottom sheet on a phone. */
const details = (page: Page, info: TestInfo): Locator =>
	isTouch(info)
		? page.getByRole('dialog', { name: /Task details/ })
		: page.getByRole('complementary', { name: 'Details' });

/** Selects a task in the Gantt as a click or a tap does (a sheet layout opens on a second tap). */
async function select(page: Page, info: TestInfo, rig: Rig, id: string): Promise<Locator> {
	// A sheet from the last task would cover the next row: close it first.
	if (isTouch(info) && (await details(page, info).count()) > 0) {
		await details(page, info).getByRole('button', { name: 'Close', exact: true }).click();
		await expect(details(page, info)).toHaveCount(0);
	}
	await page.evaluate(
		(t) =>
			(
				window as unknown as { __mainspringGantt: { reveal(t: string): void } }
			).__mainspringGantt.reveal(t),
		id,
	);
	const row = rig.row(`task:${id}`);
	await row.locator('[data-col="name"]').click();
	if (isTouch(info) && (await details(page, info).count()) === 0) {
		await row.locator('[data-col="name"]').click();
	}
	const panel = details(page, info);
	await expect(panel.getByTestId('why-here')).toBeVisible({ timeout: 30_000 });
	return panel;
}

/** What the section says, line by line, with each line's kind. */
async function said(section: Locator): Promise<Array<{ kind: string; text: string }>> {
	return section.locator('li').evaluateAll((lis) =>
		lis.map((li) => ({
			kind: li.getAttribute('data-kind') ?? '',
			text: li.querySelector('span')?.textContent ?? '',
		})),
	);
}

test.describe('in the task details', () => {
	test('lists the causes the explainer reads from the schedule (fedora-res, its native golden)', async ({
		page,
	}, info) => {
		const ctx = goldenContext('fedora-res');
		const rig = await openPlan(page, info);

		// A dependency with a gap, from the golden's explainer.
		let panel = await select(page, info, rig, WIKI);
		let want = expectedWhy(ctx, WIKI);
		expect(want.texts[0]).toMatch(
			/^Waits for Start Feature Submission \(ends .*May 1\), then a gap\.$/,
		);
		await expect(panel.getByRole('heading', { name: 'Why here?' })).toBeVisible();
		expect((await said(panel.getByTestId('why-here'))).map((l) => l.text)).toEqual(want.texts);

		// A written date, on the task itself.
		panel = await select(page, info, rig, NAMING);
		want = expectedWhy(ctx, NAMING);
		expect(want.texts).toEqual(['“start Sep 17, 2013” is written on this task (a constraint).']);
		expect((await said(panel.getByTestId('why-here'))).map((l) => l.text)).toEqual(want.texts);
	});

	test('lists a gap and a written date from the schedule of a small plan', async ({
		page,
	}, info) => {
		const ctx = await smallContext(SMALL);
		const rig = await openSample(page, info, SMALL);

		let panel = await select(page, info, rig, SKETCH);
		let want = expectedWhy(ctx, SKETCH);
		expect(want.texts).toEqual(['Waits for Research (ends Thu, Mar 5), then a gap.']);
		await expect(panel.getByRole('heading', { name: 'Why here?' })).toBeVisible();
		expect((await said(panel.getByTestId('why-here'))).map((l) => l.text)).toEqual(want.texts);

		panel = await select(page, info, rig, LAUNCH);
		want = expectedWhy(ctx, LAUNCH);
		expect(want.texts).toEqual(['“start May 4, 2026” is written on this task (a constraint).']);
		expect((await said(panel.getByTestId('why-here'))).map((l) => l.text)).toEqual(want.texts);
	});

	test('says less when the explainer cannot tell', async ({ page }, info) => {
		const ctx = await smallContext('ui-people');
		const rig = await openSample(page, info, 'ui-people');
		const panel = await select(page, info, rig, UNSURE);
		const want = expectedWhy(ctx, UNSURE);
		// The explainer knows what the container waits for and nothing else: one cause, and "does
		// not show why".
		expect(want.causes.map((c) => c.kind)).toEqual(['dependency', 'unknown']);
		const lines = await said(panel.getByTestId('why-here'));
		expect(lines).toEqual(want.causes.map((c) => ({ kind: c.kind, text: c.text })));
		expect(lines[1]?.text).toBe('The schedule does not show why.');
		// The unknown line claims nothing: no link, no person, no task.
		await expect(
			panel.getByTestId('why-here').locator('li[data-kind="unknown"] button'),
		).toHaveCount(0);
	});

	test('a cause links to the task it names', async ({ page }, info) => {
		const rig = await openSample(page, info, SMALL);
		const panel = await select(page, info, rig, SKETCH);
		await panel.getByTestId('why-here').getByRole('button', { name: 'Select Research' }).click();
		await expect.poll(() => selectionOf(page)).toMatchObject({ kind: 'task', id: RESEARCH });
		await expect(details(page, info).getByLabel('Name', { exact: true })).toHaveValue('Research');
	});

	test('a finding\'s "Why here?" opens the details at the section, with the focus on it', async ({
		page,
	}, info) => {
		const ctx = await smallContext(SMALL);
		await openSample(page, info, SMALL);
		const panel = await openHealth(page, info);
		// Launch has two (its start and its end are written): the first one.
		await (
			await rowOf(panel, 'hard-constraint', LAUNCH)
		)
			.first()
			.locator('[data-fix="why"]')
			.click();
		const open = details(page, info);
		await expect(open.getByTestId('why-here')).toBeVisible();
		await expect(open.getByRole('heading', { name: 'Why here?' })).toBeFocused();
		// It is the finding's task whose details are open.
		await expect(open.locator('p.id code')).toHaveText(LAUNCH);
		expect((await said(open.getByTestId('why-here'))).map((l) => l.text)).toEqual(
			expectedWhy(ctx, LAUNCH).texts,
		);
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`axe finds nothing with the section open (${scheme})`, async ({ page }, info) => {
			const rig = await openSample(page, info, SMALL, scheme);
			const panel = await select(page, info, rig, SKETCH);
			await expect(panel.getByTestId('why-here').locator('li').first()).toBeVisible();
			expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
			if (isTouch(info)) {
				// Its links are 44 px targets on a finger.
				const small = await panel
					.getByTestId('why-here')
					.locator('button')
					.evaluateAll((els) =>
						els.flatMap((el) => {
							const r = el.getBoundingClientRect();
							return r.width < 43.5 || r.height < 43.5
								? [`${el.textContent} ${r.width}x${r.height}`]
								: [];
						}),
					);
				expect(small).toEqual([]);
			}
		});
	}
});

/** A person's cell with a booked task, from the independent oracle and the hook. */
async function bookedCell(page: Page): Promise<{ person: string; col: number; task: string }> {
	const result = await resultOf(page);
	const s = await shape(page);
	if (!result) throw new Error('no result');
	const o = oracle(result);
	for (const person of s?.rows ?? []) {
		if (result.resources.find((r) => r.id === person)?.group) continue;
		const row = o.booked.get(person) ?? [];
		for (let col = 0; col < row.length; col++) {
			if ((row[col] ?? 0) === 0) continue;
			const tasks = await page.evaluate(
				([p, c]) =>
					(
						window as unknown as {
							__mainspringWorkload: {
								tasks(p: string, c: number): Array<{ task: string; kind: string }>;
							};
						}
					).__mainspringWorkload.tasks(p as string, c as number),
				[person, col] as const,
			);
			const booked = tasks.find((t) => t.kind === 'booked');
			if (booked) return { person, col, task: booked.task };
		}
	}
	throw new Error('no cell has a booked task');
}

/** Opens a cell's details as a click, or a finger's two taps, does. */
async function openCell(page: Page, info: TestInfo, person: string, col: number): Promise<Locator> {
	await page.evaluate(
		([p, c]) =>
			(
				window as unknown as { __mainspringWorkload: { scrollTo(p: string, c: number): boolean } }
			).__mainspringWorkload.scrollTo(p as string, c as number),
		[person, col] as const,
	);
	// The scroll has landed: the cell's point holds still for a few frames.
	await settledValue(
		page,
		([p, c]) =>
			(
				window as unknown as {
					__mainspringWorkload: { cell(p: string, c: number): { x: number; y: number } | null };
				}
			).__mainspringWorkload.cell(p as string, c as number),
		4,
		[person, col] as const,
	);
	const at = await page.evaluate(
		([p, c]) =>
			(
				window as unknown as {
					__mainspringWorkload: { cell(p: string, c: number): { x: number; y: number } | null };
				}
			).__mainspringWorkload.cell(p as string, c as number),
		[person, col] as const,
	);
	if (!at) throw new Error('no cell point');
	if (isTouch(info)) {
		await page.touchscreen.tap(at.x, at.y);
		// The first tap has selected the cell (its line reads hours), so the second is a second tap.
		await expect(page.getByTestId('heat-line')).toContainText('hours');
		await page.touchscreen.tap(at.x, at.y);
	} else {
		await page.mouse.click(at.x, at.y);
	}
	const dialog = page.getByTestId('cell-details');
	await expect(dialog).toBeVisible();
	return dialog;
}

test.describe("in the heatmap's cell details", () => {
	test('a task row has "Why here?", which lists the explainer\'s reasons under it', async ({
		page,
	}, info) => {
		const ctx = await smallContext('ui-people');
		await openHeatmap(page, info, 'ui-people');
		const { person, col, task } = await bookedCell(page);
		const cell = await openCell(page, info, person, col);
		const row = cell.locator(`[data-testid="detail-task"][data-task="${task}"]`);
		const toggle = row.getByTestId('why-toggle');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const why = cell.getByTestId('cell-why').first();
		await expect(why.locator('li').first()).toBeVisible({ timeout: 30_000 });
		expect((await said(why)).map((l) => l.text)).toEqual(expectedWhy(ctx, task).texts);
		// Again closes it.
		await toggle.click();
		await expect(cell.getByTestId('cell-why')).toHaveCount(0);
	});

	test('"Show in Gantt" sets the person filter, which the filter line names, and selects the task', async ({
		page,
	}, info) => {
		await openHeatmap(page, info, 'ui-people');
		const { person, col, task } = await bookedCell(page);
		const result = await resultOf(page);
		const name = result?.resources.find((r) => r.id === person)?.name ?? person;
		const cell = await openCell(page, info, person, col);
		await cell
			.locator(`[data-testid="detail-task"][data-task="${task}"]`)
			.getByRole('button', { name: 'Show in Gantt' })
			.click();
		// The Gantt is on screen, filtered to the person, and the task is the selection.
		await expect(page.getByTestId('filter-note')).toContainText(name, { timeout: 30_000 });
		await expect(page.getByTestId('filter-button')).toHaveAttribute(
			'aria-label',
			new RegExp(`Filter: .*${name}`),
		);
		await expect.poll(() => selectionOf(page)).toMatchObject({ kind: 'task', id: task });
	});
});

/** The health fixture H8 (with one more task) typed into the small plan, and its panel open. */
async function openH8(page: Page, info: TestInfo): Promise<Locator> {
	await openSample(page, info, SMALL);
	await setPlan(page, info, H8_PLAN);
	return openHealth(page, info);
}

test.describe('from a finding about a person', () => {
	test('"Show in Gantt" filters the chart to the person', async ({ page }, info) => {
		const panel = await openH8(page, info);
		const row = await rowOf(panel, 'work-without-people', SIDE);
		await expect(row).toContainText('Runs without Dev for 24 hours');
		await row.locator('[data-fix="show-in-gantt"]').click();
		await expect(page.getByTestId('filter-note')).toContainText('Dev', { timeout: 30_000 });
		await expect.poll(() => selectionOf(page)).toMatchObject({ kind: 'task', id: SIDE });
		// The panel is not in the way on a phone; on a desktop it stays beside the chart.
		if (isTouch(info)) await expect(panel).toHaveCount(0);
	});

	test("a finding's task, which the filter would hide, drops the filter and is selected", async ({
		page,
	}, info) => {
		const ctx = await contextOfText(H8_PLAN);
		let panel = await openH8(page, info);
		await (
			await rowOf(panel, 'work-without-people', SIDE)
		)
			.locator('[data-fix="show-in-gantt"]')
			.click();
		await expect(page.getByTestId('filter-note')).toContainText('Dev', { timeout: 30_000 });
		// Another task of the plan, which Dev is not on (not allocated, not booked, and not the
		// first candidate of an allocate), found from the oracle: its button in the panel.
		const sc = ctx.scenario;
		const booked = new Set(
			ctx.result.bookings
				.filter((b) => b.resource === 'dev' && b.scenario === sc)
				.map((b) => b.task),
		);
		const target = checkPlan(inputOf(ctx)).findings.find((f) => {
			if (f.check !== 'no-predecessor' || f.subject.kind !== 'task') return false;
			const id = f.subject.id;
			const own = ctx.result.tasks.find((t) => t.id === id)?.scenarios[sc];
			const asks =
				own?.allocate.some((a) => a.candidates[0] === 'dev') || own?.allocated.includes('dev');
			return !booked.has(id) && !asks;
		});
		const id = target?.subject.kind === 'task' ? target.subject.id : '';
		expect(id).toBe(LONE);
		panel = await openHealth(page, info);
		await (await rowOf(panel, 'no-predecessor', id)).locator('button.task').click();
		await expect.poll(() => selectionOf(page)).toMatchObject({ kind: 'task', id });
		// The line over the table is empty: no filter.
		await expect(page.getByTestId('filter-note')).toHaveText('');
	});

	test('"Open in Workload" opens the person\'s cell', async ({ page }, info) => {
		const panel = await openH8(page, info);
		await (await rowOf(panel, 'work-without-people', SIDE)).locator('[data-fix="open"]').click();
		const cell = page.getByTestId('cell-details');
		await expect(cell).toBeVisible({ timeout: 60_000 });
		await expect(cell.getByRole('heading', { level: 2 })).toContainText('Dev');
		// The cell is a week the task runs without them: it lists it among the waiting or running-without.
		await expect(cell.getByTestId('detail-task').first()).toBeVisible();
		// Dev books it on its last two days, and the cell lists it again among the work that runs
		// without them: two rows, the second under its own heading.
		await expect(cell.locator(`[data-testid="detail-task"][data-task="${SIDE}"]`)).toHaveCount(2);
		await expect(cell.getByText(/^Running without /)).toBeVisible();
	});
});
