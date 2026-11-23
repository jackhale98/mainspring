// SPDX-License-Identifier: GPL-2.0-or-later
// The merge-tier half of the Phase 3 performance audit (T22; phase-3.md 8.1, 8.2), beside
// workload-perf.spec.ts (scrolls, zoom, the drag; the Workload cap of 800 DOM nodes on a phone) and
// phase3-timing.spec.ts (derived work, the Health panel, memory):
// - the mounted DOM of the lanes (on the lanes paint page), the Calendar and the Resources table, counted with a
//   cap of about twice what was measured (it catches a view that starts to mount a row per person
//   or a cell per day). The lanes and the table use `fedora-res` (28 people); the Calendar is the
//   same month grid on any plan, so it uses the small `poc-sample`;
// - the paint of the heatmap and the lanes, from the cells painter's own stats (the audit's recorder
//   in HeatPlot): at most 600 fills a frame on a phone (8.1), at day and week zoom, over a sweep across
//   the plot. A desktop's fills are recorded and not asserted: 731 at day zoom is over the 600 of 8.1
//   and waits for the user's decision (phase-3-perf-a11y.md, P2). The script time per paint is
//   recorded (4 ms desktop, 8 ms at 4x).
// Each test writes its own file, test-results/phase3-perf-<name>-<project>.json, with its device,
// browser, build and load.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { openCalendar } from './lib/calendar-rig';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { LanesRig } from './lib/lanes-rig';
import { perfEnvironment, recordFile } from './lib/perf-env';
import { openResources } from './lib/resources-rig';
import { frames, settledValue } from './lib/settle';
import { chooseZoom } from './lib/workload-heat';
import { openHeatmap } from './lib/workload-rig';

const record = (key: string, value: unknown): void => recordFile(`phase3-perf-${key}`, value);

test.setTimeout(READY_TIMEOUT_MS * 4);

const count = (page: Page, sel: string): Promise<number> =>
	page.evaluate((s) => document.querySelector(s)?.querySelectorAll('*').length ?? 0, sel);

/**
 * About twice what each view mounted when measured (2026-11-23, fedora-res, desktop and Pixel 7:
 * lanes 170 and 239, table 495, calendar 112 and 120).
 */
const MAX_NODES: Record<string, number> = { lanes: 500, calendar: 300, team: 1000 };

function checkDom(view: string, info: TestInfo, n: number): void {
	record(`dom-${view}-${info.project.name}`, { nodes: n });
	console.log('DOM nodes', view, info.project.name, n);
	expect(n, `${view} mounted ${n} elements`).toBeGreaterThan(20);
	expect(n, `${view} mounted ${n} elements`).toBeLessThanOrEqual(MAX_NODES[view] ?? 0);
}

test('the DOM of the Calendar is counted', async ({ page }, info) => {
	await openCalendar(page, info);
	const n = await page.evaluate(
		() =>
			document
				.querySelector('[data-testid="cal-day"]')
				?.closest('[role="grid"]')
				?.querySelectorAll('*').length ?? 0,
	);
	checkDom('calendar', info, n);
});

test('the DOM of the Resources table is counted', async ({ page }, info) => {
	await openResources(page, info, { plan: 'fedora-res' });
	checkDom('team', info, await count(page, '[data-testid="resource-grid"]'));
});

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
	// One page for both zooms (a plan load is most of a test's time on WebKit); the lanes' mounted
	// DOM is counted on the same page.
	test(`paint: the ${view} cells stay within the fills a frame at week and at day zoom`, async ({
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
			checkDom('lanes', info, await count(page, '[data-testid="lanes"]'));
		}
		const cdp = info.project.name === 'pixel-7' ? await page.context().newCDPSession(page) : null;
		for (const zoom of ['Week', 'Day']) {
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
			expect(report.paints, `the ${zoom} sweep painted`).toBeGreaterThan(5);
			// 8.1 says 600, asserted for a finger's window (3 rows of overscan, a phone's width). A 1280 px
			// desktop at day zoom has 28 rows by about 26 columns in its window (731 on fedora-res); its
			// figure is recorded only, until the user decides what a desktop's budget is.
			if (isTouch(info))
				expect(report.maxFills, `${zoom}: fills in one frame`).toBeLessThanOrEqual(600);
			// A Pixel 7 is also swept at 4x CPU: the script time per paint is 8 ms there (8.1), recorded.
			if (cdp) {
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
				const slow = await paintReport(page, info, sel, view, 4);
				record(`paint-${view}-${zoom.toLowerCase()}-pixel-7-4x`, slow);
				console.log('paint 4x', view, zoom, JSON.stringify({ ...slow, environment: undefined }));
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
			}
		}
	});
}
