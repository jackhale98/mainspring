// SPDX-License-Identifier: GPL-2.0-or-later
// The critical path and float in the Gantt (phase-2.md 6.2, T5): the Critical path chip is
// available once the analysis exists, shows the estimate on the selected task's line, and turns it
// off; the copy says "estimate". Desktop Chrome and Pixel 7.
//
// Timings (desktop only): the analysis runs once per result in an idle task and records a
// `performance` measure (src/lib/gantt/analysis.ts). This reads it for gantt-500 and Fedora 20:
// - cold: the first result after the page loads, so the analysis code has never run (JIT-cold);
// - warm: the result of an edit (a comment appended in the editor), as every edit brings one;
// - warm at 4x: the same with the CPU throttled 4x (spec 6.2 records it; the 10 ms target is for
//   desktop).
// It writes test-results/gantt-analysis-browser.json with the machine's load. Enforced: only a
// cap of ten times the target on the warm desktop number, as the other perf specs do.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const MEASURE = 'mainspring:gantt-analysis';
const TARGET_MS = 10;

async function open(page: Page, sample: string, mode?: string): Promise<void> {
	await page.goto(`/app?sample=${sample}${mode ? `&mode=${mode}` : ''}`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByTestId('gantt')).toBeVisible();
}

const rows = (page: Page) => page.getByTestId('gantt').getByRole('treeitem');
const chip = (page: Page) => page.getByRole('button', { name: 'Critical path' });

/** The analysis measures recorded so far: [tasks, duration ms]. */
function measures(page: Page): Promise<Array<[number, number]>> {
	return page.evaluate((name) => {
		return (performance.getEntriesByName(name) as PerformanceMeasure[]).map((e) => [
			(e.detail as { tasks: number }).tasks,
			e.duration,
		]);
	}, MEASURE) as Promise<Array<[number, number]>>;
}

test.describe('gantt critical path', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('the chip shows the estimate on the selected task, and turns it off', async ({ page }) => {
		await open(page, 'upstream-tutorial');
		await expect(chip(page)).toBeEnabled();
		await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(chip(page)).toHaveAttribute('title', /estimates: they ignore resource limits/);
		const line = page.getByRole('status').filter({ hasText: 'Graphical User Interface:' });

		await rows(page).filter({ hasText: 'Graphical User Interface' }).first().click();
		await expect(line).toContainText('On the critical path (estimate)');
		await rows(page).filter({ hasText: 'Manual' }).first().click();
		await expect(page.getByRole('status').filter({ hasText: 'Manual:' })).toContainText(
			/Float about \d+ working days \(estimate\)/,
		);

		await chip(page).click();
		await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
		await expect(page.getByRole('status').filter({ hasText: 'Manual:' })).not.toContainText(
			'estimate',
		);
		await chip(page).click();
		await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
	});

	test('says so when the whole path ends before the status date (Fedora, no `now`)', async ({
		page,
	}) => {
		// Fedora 20 sets no `now`, so the status date is today's clock, after its 2014 finish.
		await open(page, 'upstream-fedora-20', 'visual');
		await expect(chip(page)).toBeEnabled();
		await expect(chip(page)).toHaveAttribute('title', /ends before the status date/);
	});

	test('times the analysis in the browser: cold, warm and warm at 4x', async ({
		page,
		context,
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'timings are recorded on desktop Chrome');
		test.setTimeout(6 * READY_TIMEOUT_MS);
		const out: Record<string, { tasks: number; ms: number }> = {};
		const latest = async (): Promise<{ tasks: number; ms: number }> => {
			const [tasks, ms] = (await measures(page)).at(-1) ?? [0, NaN];
			return { tasks, ms };
		};
		/** Appends a comment to the plan and waits for the analysis of the new result. */
		const edit = async (n: number): Promise<void> => {
			const before = (await measures(page)).length;
			await page.getByRole('textbox', { name: /^Editor for / }).click();
			await page.keyboard.press('Control+End');
			await page.keyboard.type(`\n# t5 timing ${n}\n`);
			await expect
				.poll(async () => (await measures(page)).length, { timeout: 3 * READY_TIMEOUT_MS })
				.toBeGreaterThan(before);
		};
		for (const sample of ['gantt-500', 'upstream-fedora-20']) {
			await open(page, sample);
			await expect.poll(async () => (await measures(page)).length).toBeGreaterThan(0);
			out[`${sample} cold`] = await latest();
			await edit(1);
			out[`${sample} warm`] = await latest();
			const cdp = await context.newCDPSession(page);
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
			await edit(2);
			out[`${sample} warm 4x throttle`] = await latest();
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
			await cdp.detach();
		}
		for (const [name, v] of Object.entries(out)) {
			console.info(`analysis ${name} (${v.tasks} tasks): ${v.ms.toFixed(2)} ms`);
		}
		const file = path.join(REPO, 'test-results', 'gantt-analysis-browser.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify(
				{
					browser: context.browser()?.version() ?? null,
					cpus: os.cpus().length,
					loadAverage: os.loadavg(),
					targetMs: TARGET_MS,
					timings: out,
				},
				null,
				2,
			),
		);
		await info.attach('gantt-analysis-browser.json', { path: file });
		for (const sample of ['gantt-500', 'upstream-fedora-20']) {
			expect(out[`${sample} warm`]?.ms, sample).toBeLessThan(TARGET_MS * 10);
		}
	});
});
