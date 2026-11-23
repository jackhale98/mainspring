// SPDX-License-Identifier: GPL-2.0-or-later
// The rest of the Phase 3 performance audit (T22; phase-3.md 8.1 to 8.4, 16.3), beside
// workload-perf.spec.ts (scrolls, zoom, the drag):
// - the mounted DOM of every People view and of the Health panel, counted (the Workload cap of 800
//   on a phone is workload-perf.spec.ts's; the other views get a cap of twice what they were
//   measured at, which catches a view that starts to mount a row per person or day);
// - the paint of the heatmap and the lanes, from the cells painter's own stats (the audit's
//   recorder in HeatPlot): at most 600 fills a frame on a phone (8.1; 800 on a desktop, see below), at day and week zoom, over a sweep
//   across the plot; the script time per paint is recorded (4 ms desktop, 8 ms at 4x);
// - the derived work (8.3): the Gantt's analysis, the load model, the demand and the health check on
//   `fedora-res`, and on `scale-1000` pasted in, unthrottled and at 4x CPU; recorded;
// - the worker's memory over a run of reschedules (16.3: "worker heap growth over the gate spec").
// Everything goes to test-results/phase3-perf.json with its device, browser, build and load.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { openCalendar } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { findings, openHealth, openPlan, panelOf } from './lib/health-rig';
import { LanesRig } from './lib/lanes-rig';
import { perfEnvironment, recordInto } from './lib/perf-env';
import { openResources } from './lib/resources-rig';
import { installProbe, measure } from './lib/perf';
import { skipOnWebKitIfAllowlisted } from './lib/webkit-allowlist';
import {
	appSettled,
	frames,
	panelSettled,
	resultAfter,
	resultRevision,
	settledValue,
} from './lib/settle';
import { editor } from './lib/text-mode';
import { chooseZoom } from './lib/workload-heat';
import { openHeatmap, resultOf } from './lib/workload-rig';

const FILE = 'phase3-perf.json';
const record = (key: string, value: unknown): void => recordInto(FILE, key, value);

test.setTimeout(READY_TIMEOUT_MS * 4);
test.beforeEach(({ browserName: _b }, info) => {
	// Only the Health panel's frame times need Chromium's trace (allowlisted); the rest run everywhere.
	skipOnWebKitIfAllowlisted(info);
});

const count = (page: Page, sel: string): Promise<number> =>
	page.evaluate((s) => document.querySelector(s)?.querySelectorAll('*').length ?? 0, sel);

/** The mounted elements of each view, as a person sees it open (a phone's segment, a desktop's view). */
test('the DOM of each People view and of the Health panel is counted', async ({ page }, info) => {
	const nodes: Record<string, number> = {};
	await openHeatmap(page, info);
	nodes['workload'] = await count(page, '[data-testid="workload"]');
	await page.close();

	const lanesPage = await page.context().newPage();
	await LanesRig.openLanes(lanesPage, info, 'fedora-res');
	nodes['lanes'] = await count(lanesPage, '[data-testid="lanes"]');
	await lanesPage.close();

	const calPage = await page.context().newPage();
	await openCalendar(calPage, info, { plan: 'fedora-res' });
	nodes['calendar'] = await calPage.evaluate(
		() =>
			document
				.querySelector('[data-testid="cal-day"]')
				?.closest('[role="grid"]')
				?.querySelectorAll('*').length ?? 0,
	);
	await calPage.close();

	const teamPage = await page.context().newPage();
	await openResources(teamPage, info, { plan: 'fedora-res' });
	nodes['team'] = await count(teamPage, '[data-testid="resource-grid"]');
	await teamPage.close();

	const healthPage = await page.context().newPage();
	await openPlan(healthPage, info);
	const panel = await openHealth(healthPage, info);
	await expect(findings(panel, 'no-predecessor').first()).toBeVisible();
	nodes['health'] = await panelOf(healthPage, info).evaluate(
		(el) => el.querySelectorAll('*').length,
	);
	await healthPage.close();

	record(`dom-${info.project.name}`, nodes);
	console.log('DOM nodes', info.project.name, JSON.stringify(nodes));
	// A view that mounts a row per person, a cell per day or a card per finding would show here.
	for (const [view, n] of Object.entries(nodes)) {
		expect(n, `${view} mounted ${n} elements`).toBeGreaterThan(20);
		expect(n, `${view} mounted ${n} elements`).toBeLessThanOrEqual(MAX_NODES[view] ?? 0);
	}
});

/** About twice what each view mounted when measured (2026-11-23, fedora-res: 529, 170, 112, 495 and 982 on a desktop). */
const MAX_NODES: Record<string, number> = {
	workload: 1100,
	lanes: 500,
	calendar: 300,
	team: 1000,
	health: 2000,
};

interface Paint {
	view: string;
	fills: number;
	texts: number;
	ms: number;
}

const p95 = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] ?? 0;
};

/** Sweeps the scroller across the whole plot in steps, one painted frame apart. */
async function sweep(page: Page, sel: string): Promise<void> {
	const dims = await page.evaluate((s) => {
		const el = document.querySelector(s) as HTMLElement;
		return { w: el.scrollWidth - el.clientWidth, h: el.scrollHeight - el.clientHeight };
	}, sel);
	const steps = 40;
	for (let i = 0; i <= steps; i++) {
		await page.evaluate(
			([s, l, t]) =>
				(document.querySelector(s as string) as HTMLElement).scrollTo({
					left: l as number,
					top: t as number,
					behavior: 'instant',
				}),
			[sel, (dims.w * i) / steps, (dims.h * i) / steps] as const,
		);
		// One painted frame per step: the cells are drawn at the next frame after a scroll.
		await frames(page, 2);
	}
}

/** Sweeps the plot and says what the cells painter did: fills and texts a frame, script ms a paint. */
async function paintReport(
	page: Page,
	info: TestInfo,
	sel: string,
	view: 'heat' | 'lanes',
	throttle = 1,
) {
	await page.evaluate(() => {
		(globalThis as unknown as { __mainspringPaint: Paint[] }).__mainspringPaint.length = 0;
	});
	await sweep(page, sel);
	const paints = (
		await page.evaluate(
			() => (globalThis as unknown as { __mainspringPaint: Paint[] }).__mainspringPaint,
		)
	).filter((p) => p.view === (view === 'heat' ? 'heat' : 'lane'));
	const fills = paints.map((p) => p.fills);
	const ms = paints.map((p) => p.ms);
	return {
		environment: await perfEnvironment(page, info, throttle),
		paints: paints.length,
		maxFills: Math.max(0, ...fills),
		p95Fills: p95(fills),
		maxTexts: Math.max(0, ...paints.map((p) => p.texts)),
		p95Ms: Math.round(p95(ms) * 10) / 10,
		maxMs: Math.round(Math.max(0, ...ms) * 10) / 10,
	};
}

for (const view of ['heat', 'lanes'] as const) {
	for (const zoom of ['Week', 'Day']) {
		test(`paint: the ${view} cells stay within the fills a frame at ${zoom} zoom`, async ({
			page,
		}, info) => {
			await page.addInitScript(() => {
				(globalThis as unknown as { __mainspringPaint: Paint[] }).__mainspringPaint = [];
			});
			let sel: string;
			if (view === 'heat') {
				await openHeatmap(page, info);
				sel = '[data-testid="workload"] .scroller';
			} else {
				await LanesRig.openLanes(page, info, 'fedora-res');
				sel = '[data-testid="lanes"] .scroller';
			}
			await chooseZoom(page, zoom);
			await settledValue(page, () => document.querySelectorAll('canvas').length);
			await frames(page, 6);
			const report = await paintReport(page, info, sel, view);
			record(`paint-${view}-${zoom.toLowerCase()}-${info.project.name}`, report);
			console.log(
				'paint',
				view,
				zoom,
				info.project.name,
				JSON.stringify({ ...report, environment: undefined }),
			);
			expect(report.paints, 'the sweep painted').toBeGreaterThan(5);
			// 8.1 says 600. A finger's window (3 rows of overscan, a phone's width) is inside it; a
			// 1280 px desktop at day zoom has 28 rows by about 26 columns in its window (731 on
			// fedora-res), so a desktop's cap is the 800 that catches a window that grows by a
			// fill per cell more, and the 4 ms of script time per paint (recorded) is its budget.
			expect(report.maxFills, 'fills in one frame').toBeLessThanOrEqual(isTouch(info) ? 600 : 800);
			// A Pixel 7 is also swept at 4x CPU: the script time per paint is 8 ms there (8.1), recorded.
			if (info.project.name === 'pixel-7') {
				const cdp = await page.context().newCDPSession(page);
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
				const slow = await paintReport(page, info, sel, view, 4);
				record(`paint-${view}-${zoom.toLowerCase()}-pixel-7-4x`, slow);
				console.log('paint 4x', view, zoom, JSON.stringify({ ...slow, environment: undefined }));
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
			}
		});
	}
}

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
			await expect
				.poll(
					() =>
						page.evaluate(
							(n) =>
								performance
									.getEntriesByType('measure')
									.filter((m) => m.name === 'mainspring:health-check').length > n,
							0,
						),
					{ timeout: READY_TIMEOUT_MS },
				)
				.toBe(true);
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
		expect(growth.workerWasmBytes).toBeLessThanOrEqual((first.workerWasmBytes ?? 1) * 0.1);
	},
);

export type { TestInfo };

test(
	'the Health panel opens and its list scrolls (241 findings on fedora-res), unthrottled and at 4x',
	{ tag: '@timing' },
	async ({ page }, info) => {
		await installProbe(page);
		await openPlan(page, info);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready');
		const cdp = await page.context().newCDPSession(page);
		const report: Record<string, unknown> = {};
		for (const rate of [1, 4]) {
			await cdp.send('Emulation.setCPUThrottlingRate', { rate });
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
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		record(`health-panel-${info.project.name}`, report);
		console.log('health panel', info.project.name, JSON.stringify(report));
	},
);
