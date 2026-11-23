// SPDX-License-Identifier: GPL-2.0-or-later
// The timing-tier half of the Phase 3 performance audit (T22; phase-3.md 8.3, 16.3), beside
// phase3-perf.spec.ts (DOM and paint) and workload-perf.spec.ts (scrolls, zoom, the drag):
// - the derived work (8.3): the Gantt's analysis, the load model, the demand and the health check on
//   `fedora-res`, and on `scale-1000` pasted in, unthrottled and at 4x CPU; recorded;
// - the Health panel: the time to open it, its mounted DOM, and a scroll through 241 findings. The
//   frame times need Chromium's trace and CPU throttle, so WebKit records only the time to open;
// - the worker's memory over a run of reschedules (16.3: "worker heap growth over the gate spec").
// Each test writes its own file, test-results/phase3-perf-<name>-<project>.json, with its device,
// browser, build and load.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { findings, openHealth, openPlan, panelOf } from './lib/health-rig';
import { installProbe, measure } from './lib/perf';
import { perfEnvironment, recordFile } from './lib/perf-env';
import { appSettled, frames, panelSettled, resultAfter, resultRevision } from './lib/settle';
import { editor } from './lib/text-mode';
import { openHeatmap, resultOf } from './lib/workload-rig';

const record = (key: string, value: unknown): void => recordFile(`phase3-perf-${key}`, value);

test.setTimeout(READY_TIMEOUT_MS * 4);

/** Reads the User Timing measures the app records for its derived work (8.3), in ms. */
const derived = (page: Page) =>
	page.evaluate(() =>
		Object.fromEntries(
			['gantt-analysis', 'workload-load', 'workload-demand', 'health-check', 'runner-task'].map(
				(n) => [
					n,
					performance
						.getEntriesByName(`mainspring:${n}`)
						.map((e) => Math.round(e.duration * 10) / 10),
				],
			),
		),
	);

async function pastePlan(page: Page, file: string): Promise<void> {
	const text = fs.readFileSync(path.join(REPO, file), 'utf8');
	await editor(page).click();
	await page.keyboard.press('ControlOrMeta+a');
	// One paste event with the whole file, as a user pasting a plan would send it.
	await page.evaluate((t) => {
		const data = new DataTransfer();
		data.setData('text/plain', t);
		document
			.querySelector('.cm-content')
			?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
			);
	}, text);
}

for (const rate of [1, 4]) {
	test(
		`derived work on fedora-res and on scale-1000, ${rate === 1 ? 'unthrottled' : 'at 4x CPU'}`,
		{ tag: '@timing' },
		async ({ page }, info) => {
			test.skip(isTouch(info), 'the desktop targets (8.3); a phone is the 4x run of this one');
			const cdp = await page.context().newCDPSession(page);
			if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
			const report: Record<string, unknown> = {};
			await openHeatmap(page, info);
			await expect
				.poll(
					() => page.evaluate(() => performance.getEntriesByName('mainspring:health-check').length),
					{
						timeout: READY_TIMEOUT_MS,
					},
				)
				.toBeGreaterThan(0);
			report['environment'] = await perfEnvironment(page, info, rate);
			report['fedora-res'] = await derived(page);

			// scale-1000: pasted into the text with the Workload view beside it.
			await page.getByRole('button', { name: 'Split', exact: true }).click();
			await expect(editor(page)).toBeVisible();
			const rev = await resultRevision(page);
			await pastePlan(page, 'engine/golden/plans/synthetic/20-scale-1000/plan.tjp');
			await resultAfter(page, rev, READY_TIMEOUT_MS * 3);
			await appSettled(page);
			// The paste's own health report: one more than the fedora-res run had.
			const had = (report['fedora-res'] as Record<string, number[]>)['health-check']?.length ?? 0;
			await expect
				.poll(
					() => page.evaluate(() => performance.getEntriesByName('mainspring:health-check').length),
					{ timeout: READY_TIMEOUT_MS },
				)
				.toBeGreaterThan(had);
			await frames(page, 30);
			const all = await derived(page);
			const first = report['fedora-res'] as Record<string, number[]>;
			// What the paste added, per measure: its results (the first of them may be a half-typed one).
			const added = Object.fromEntries(
				Object.entries(all).map(([n, xs]) => [n, xs.slice((first[n] ?? []).length)]),
			);
			report['scale-1000'] = {
				added,
				max: Object.fromEntries(Object.entries(added).map(([n, xs]) => [n, Math.max(0, ...xs)])),
			};
			record(`derived-${rate}x`, report);
			console.log('derived work', rate, JSON.stringify(report));
		},
	);
}

test(
	'worker memory over a run of reschedules (fedora-res, 12 edits)',
	{ tag: '@timing' },
	async ({ page }, info) => {
		test.skip(isTouch(info), 'one device is enough: the worker is the same');
		await page.goto('/app?sample=fedora-res&mode=split&view=workload&hooks=edits,workload');
		await appSettled(page);
		await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: 60_000 });
		const memory = async () => ({
			workerWasmBytes: (await resultOf(page).then((r) => r?.timings?.memoryBytes)) ?? null,
			pageJsHeapBytes: await page.evaluate(
				() =>
					(performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
						?.usedJSHeapSize ?? null,
			),
		});
		const series = [{ edit: 0, ...(await memory()) }];
		await editor(page).click();
		await page.keyboard.press('ControlOrMeta+Home');
		for (let i = 1; i <= 12; i++) {
			const rev = await resultRevision(page);
			// A character in the first line's comment: a new text, so a new schedule.
			await page.keyboard.type(i % 2 ? '#' : ' ');
			await resultAfter(page, rev, READY_TIMEOUT_MS);
			series.push({ edit: i, ...(await memory()) });
		}
		const first = series[1]!;
		const last = series[series.length - 1]!;
		const growth = {
			workerWasmBytes: (last.workerWasmBytes ?? 0) - (first.workerWasmBytes ?? 0),
			pageJsHeapBytes: (last.pageJsHeapBytes ?? 0) - (first.pageJsHeapBytes ?? 0),
		};
		record('memory', {
			environment: await perfEnvironment(page, info),
			series,
			growthAfterFirstEdit: growth,
		});
		console.log('worker memory', JSON.stringify({ series, growth }));
		// The wasm heap never shrinks and the client replaces a worker at 1.2 GiB (client.ts): a run of
		// twelve edits that grows it by more than 10% is a leak worth a look.
		// Desktop is Chromium: the worker reports its memory, and a null would pass nothing.
		expect(first.workerWasmBytes, 'the worker reports its memory').not.toBeNull();
		expect(last.workerWasmBytes, 'the worker reports its memory').not.toBeNull();
		expect(growth.workerWasmBytes).toBeLessThanOrEqual((first.workerWasmBytes ?? 0) * 0.1);
	},
);

test(
	'the Health panel opens and its list scrolls (241 findings on fedora-res), unthrottled and at 4x',
	{ tag: '@timing' },
	async ({ page, browserName }, info) => {
		// The frame times need Chromium's trace and CPU throttle; WebKit records the time to open and
		// the panel's DOM, and says so in the record (not a skip: the test runs on every project).
		const traced = browserName === 'chromium';
		await installProbe(page);
		await openPlan(page, info);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready');
		const cdp = traced ? await page.context().newCDPSession(page) : null;
		const report: Record<string, unknown> = { traced };
		for (const rate of traced ? [1, 4] : [1]) {
			await cdp?.send('Emulation.setCPUThrottlingRate', { rate });
			// From the press that opens the panel to the list in the page, on the page's own clock.
			await page.evaluate(() => {
				const w = window as unknown as { __open?: { t0: number; t1: number } };
				w.__open = { t0: 0, t1: 0 };
				addEventListener('click', () => (w.__open!.t0 = performance.now()), {
					capture: true,
					once: true,
				});
				const look = (): void => {
					const el = document.querySelector('[data-testid="health-summary"]');
					if (el?.textContent?.includes('problem') && w.__open!.t0 && !w.__open!.t1) {
						w.__open!.t1 = performance.now();
						mo.disconnect();
					}
				};
				const mo = new MutationObserver(look);
				mo.observe(document, { subtree: true, childList: true, characterData: true });
			});
			const panel = await openHealth(page, info);
			await expect(findings(panel, 'no-predecessor').first()).toBeVisible();
			const opened = await page.evaluate(() => {
				const o = (window as unknown as { __open: { t0: number; t1: number } }).__open;
				return Math.round(o.t1 - o.t0);
			});
			await panelSettled(panel);
			const nodes = await panelOf(page, info).evaluate((el) => el.querySelectorAll('*').length);
			if (!traced) {
				report[`${rate}x`] = {
					environment: await perfEnvironment(page, info, rate),
					openMs: opened,
					nodes,
				};
				continue;
			}
			const scroll = await measure(page, () =>
				panel.evaluate(
					(root) =>
						new Promise<void>((done) => {
							let p = root.querySelector<HTMLElement>('[data-group] h3');
							while (p && !['auto', 'scroll'].includes(getComputedStyle(p).overflowY))
								p = p.parentElement;
							const scroller = p ?? (document.scrollingElement as HTMLElement);
							let n = 0;
							const step = (): void => {
								scroller.scrollTop += 90 * (n < 100 ? 1 : -1);
								if (++n < 200) requestAnimationFrame(step);
								else done();
							};
							requestAnimationFrame(step);
						}),
				),
			);
			report[`${rate}x`] = {
				environment: await perfEnvironment(page, info, rate),
				openMs: opened,
				nodes,
				frames: scroll.frames,
				onTimePct: scroll.onTimePct,
				maxMs: scroll.maxMs,
				over50: scroll.over50,
				droppedPct: scroll.pipeline.droppedPct,
				longestTaskMs: scroll.longestTaskMs,
			};
			// Closed again for the next rate: the panel opens from nothing each time.
			await page.reload();
			await appSettled(page);
		}
		await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		record(`health-panel-${info.project.name}`, report);
		console.log('health panel', info.project.name, JSON.stringify(report));
	},
);
