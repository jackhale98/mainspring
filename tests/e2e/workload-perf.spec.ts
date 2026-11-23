// SPDX-License-Identifier: GPL-2.0-or-later
// The heatmap's scroll cost (phase-3.md 8.4; T14), on `fedora-res` (28 rows, 88 weeks, 611 days),
// with T22's harness (tests/e2e/lib/perf.ts):
// - desktop: a vertical scroll through every row and back, and a horizontal pan across the whole
//   frame and back, at week and at day zoom. Enforced as regression catchers: the best of up to
//   three runs has at most 5 % of compositor frames dropped and none over 50 ms (the desktop caps);
// - Pixel 7: the mounted Workload view has at most 800 DOM nodes (enforced: it is deterministic);
//   frame times of a swipe are recorded, not enforced (no real device in Phase 3, 8.5).
// Each run is written to test-results/workload-perf.json. The pass criterion of a scroll is that
// the scroller moved: a page that did not scroll has no frames to judge.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { installProbe, measure, withinDesktopCaps, type Measure } from './lib/perf';
import { perfEnvironment, recordInto } from './lib/perf-env';
import { animationsDone, frames, resultAfter, resultRevision, settledValue } from './lib/settle';
import { skipOnWebKitIfAllowlisted } from './lib/webkit-allowlist';
import { movableCell, pointOf } from './lib/workload-heat';
import { openHeatmap } from './lib/workload-rig';

const SCROLLER = '[data-testid="workload"] .scroller';
const RUNS = 3;

test.setTimeout(READY_TIMEOUT_MS * 4);
test.beforeEach(({ browserName: _b }, info) => {
	// Only the swipe recording is on the allowlist (it needs a Chromium trace and a native touch scroll).
	skipOnWebKitIfAllowlisted(info);
});

const record = (key: string, value: unknown): void => recordInto('workload-perf.json', key, value);

const metrics = (page: Page) =>
	page.evaluate((sel) => {
		const s = document.querySelector(sel) as HTMLElement;
		return {
			top: s.scrollTop,
			left: s.scrollLeft,
			h: s.scrollHeight,
			w: s.scrollWidth,
			vh: s.clientHeight,
			vw: s.clientWidth,
		};
	}, SCROLLER);

const scrollTo = (page: Page, left: number, top: number) =>
	page.evaluate(
		([sel, l, t]) =>
			(document.querySelector(sel as string) as HTMLElement).scrollTo({
				left: l as number,
				top: t as number,
				behavior: 'instant',
			}),
		[SCROLLER, left, top] as const,
	);

async function wheel(cdp: CDPSession, at: { x: number; y: number }, dx: number, dy: number) {
	await cdp.send('Input.synthesizeScrollGesture', {
		x: at.x,
		y: at.y,
		xDistance: dx,
		yDistance: dy,
		speed: 3000,
		gestureSourceType: 'mouse',
		preventFling: true,
	});
}

async function chooseZoom(page: Page, name: string): Promise<void> {
	// A desktop toolbar has the radios; a phone has the menu.
	const radio = page.getByRole('radiogroup', { name: 'Zoom' }).getByRole('radio', { name });
	if (await radio.isVisible()) await radio.click();
	else await page.getByRole('combobox', { name: 'Zoom' }).selectOption({ label: name });
	// The zoom is drawn: the canvas has had its frames and nothing animates.
	await frames(page, 4);
	await animationsDone(page, 0);
}

test(
	'desktop: scrolling every row and the whole frame, at week and day zoom',
	{ tag: '@timing' },
	async ({ page }, info) => {
		test.skip(isTouch(info), 'desktop caps');
		await installProbe(page);
		await openHeatmap(page, info);
		record('environment-desktop', await perfEnvironment(page, info));
		const cdp = await page.context().newCDPSession(page);
		const box = await page.locator(SCROLLER).boundingBox();
		const at = {
			x: (box?.x ?? 0) + (box?.width ?? 800) * 0.6,
			y: (box?.y ?? 0) + (box?.height ?? 600) * 0.6,
		};
		const report: Record<string, unknown> = {};
		for (const zoom of ['Week', 'Day']) {
			await chooseZoom(page, zoom);
			for (const axis of ['rows', 'frame'] as const) {
				const runs: Measure[] = [];
				for (let i = 0; i < RUNS; i++) {
					const m0 = await metrics(page);
					const dy = axis === 'rows' ? m0.h - m0.vh : 0;
					const dx = axis === 'frame' ? m0.w - m0.vw : 0;
					await scrollTo(page, 0, 0);
					// The scroller is back at the origin and has stopped: its offsets hold still.
					await settledValue(page, () => {
						const s = document.querySelector('[data-testid="workload"] .scroller');
						return [s?.scrollTop, s?.scrollLeft].join('|');
					});
					// Out and back, four times for the rows (28 rows are only 840 px: a few dozen frames).
					const laps = axis === 'rows' ? 4 : 1;
					const m = await measure(page, async () => {
						for (let lap = 0; lap < laps; lap++) {
							await wheel(cdp, at, -dx, -dy);
							await wheel(cdp, at, dx, dy);
						}
					});
					// The scroller went out and came back: the run is worth judging.
					const end = await metrics(page);
					expect(Math.abs(end.top) + Math.abs(end.left)).toBeLessThan(80);
					runs.push(m);
					if (withinDesktopCaps(m)) break;
					// A cool-down before the retry: the pause itself is what the retry is for.
					await page.waitForTimeout(3000);
				}
				const best = [...runs].sort(
					(a, b) => a.pipeline.droppedPct - b.pipeline.droppedPct,
				)[0] as Measure;
				report[`${zoom}-${axis}`] = {
					runs: runs.length,
					// Every run, for scripts/ci/timing-check.mjs (a gross regression is in all of them).
					runList: runs.map((r) => ({ droppedPct: r.pipeline.droppedPct, maxMs: r.maxMs })),
					frames: best.frames,
					onTimePct: best.onTimePct,
					maxMs: best.maxMs,
					droppedPct: best.pipeline.droppedPct,
					scrollPx: axis === 'rows' ? (await metrics(page)).h : (await metrics(page)).w,
				};
				// Written before the assertion, so that a failing run still leaves its numbers for
				// scripts/ci/timing-check.mjs (which judges a gross regression).
				record('desktop', report);
				expect(
					withinDesktopCaps(best),
					`${zoom} ${axis}: ${JSON.stringify(report[`${zoom}-${axis}`])}`,
				).toBe(true);
			}
		}
		record('desktop', report);
		console.log('workload perf (desktop)', JSON.stringify(report));
	},
);

// The DOM-node cap is deterministic: it stays in the merge tier (ADR-0016 section 1).
test('the mounted Workload view stays under 800 DOM nodes on a phone', async ({ page }, info) => {
	test.skip(!isTouch(info), 'a finger');
	await openHeatmap(page, info);
	const nodes = await page.evaluate(
		() => document.querySelector('[data-testid="workload"]')?.querySelectorAll('*').length ?? 0,
	);
	console.log('workload DOM nodes (phone):', nodes);
	expect(nodes).toBeLessThanOrEqual(800);
});

const nodesOf = (page: Page, testid = 'workload'): Promise<number> =>
	page.evaluate(
		(id) => document.querySelector(`[data-testid="${id}"]`)?.querySelectorAll('*').length ?? 0,
		testid,
	);

const level = (page: Page): Promise<string | null> =>
	page.getByTestId('workload').getAttribute('data-zoom');

/** The share of a measure the budget talks about, as it goes into the JSON. */
const summary = (m: Measure) => ({
	frames: m.frames,
	onTimePct: m.onTimePct,
	maxMs: m.maxMs,
	over50: m.over50,
	droppedPct: m.pipeline.droppedPct,
	longestTaskMs: m.longestTaskMs,
	inputScriptP95Ms: m.inputScript.p95Ms,
	rafScriptP95Ms: m.rafScript.p95Ms,
	loafMaxMs: m.loafMaxMs,
});

/** One swipe: a finger lands, moves in eight steps one frame apart and lifts. */
async function swipes(page: Page, cdp: CDPSession, n: number): Promise<void> {
	const box = await page.locator(SCROLLER).boundingBox();
	const mid = {
		x: (box?.x ?? 0) + (box?.width ?? 300) / 2,
		y: (box?.y ?? 0) + (box?.height ?? 400) / 2,
	};
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
		});
	for (let swipe = 0; swipe < n; swipe++) {
		await touch('touchStart', mid);
		for (let i = 1; i <= 8; i++) {
			await touch('touchMove', { x: mid.x - i * 24, y: mid.y - i * 8 });
			// One frame between two moves: the pace of the finger is part of the gesture being measured.
			await frames(page, 1);
		}
		await touch('touchEnd');
		// The pause between two swipes is part of the measured script: a finger lifts and lands again.
		await frames(page, 7);
	}
}

/** Two fingers moving together, `rounds` times: a pinch in, which zooms out. */
async function pinches(page: Page, cdp: CDPSession, rounds: number): Promise<void> {
	const box = await page.locator(SCROLLER).boundingBox();
	const cx = (box?.x ?? 0) + (box?.width ?? 300) / 2;
	const cy = (box?.y ?? 0) + (box?.height ?? 400) / 2;
	const pair = (spread: number) => [
		{ x: cx - spread, y: cy, id: 1 },
		{ x: cx + spread, y: cy, id: 2 },
	];
	for (let r = 0; r < rounds; r++) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(60) });
		for (let i = 1; i <= 20; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: pair(60 - (50 * i) / 20),
			});
			await frames(page, 1);
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await frames(page, 9);
	}
}

test(
	'Pixel 7: swipes and pinches are recorded, unthrottled and at 4x CPU',
	{ tag: '@timing' },
	async ({ page }, info) => {
		test.skip(!isTouch(info), 'a finger');
		await installProbe(page);
		await openHeatmap(page, info);
		const nodes = await nodesOf(page);
		const cdp = await page.context().newCDPSession(page);
		const report: Record<string, unknown> = { nodes };
		for (const rate of [1, 4]) {
			await cdp.send('Emulation.setCPUThrottlingRate', { rate });
			record(`environment-pixel-7-${rate}x`, await perfEnvironment(page, info, rate));
			await page.evaluate((sel) => {
				(document.querySelector(sel) as HTMLElement).scrollTo({ left: 0, top: 0 });
			}, SCROLLER);
			await settledValue(page, () => document.querySelector('.scroller')?.scrollLeft ?? 0);
			const swipe = await measure(page, () => swipes(page, cdp, 12));
			const end = await metrics(page);
			expect(end.left + end.top).toBeGreaterThan(200);
			report[`swipe-${rate}x`] = { ...summary(swipe), scrolledPx: Math.round(end.left + end.top) };
			const before = await level(page);
			const pinch = await measure(page, () => pinches(page, cdp, 4));
			report[`pinch-${rate}x`] = { ...summary(pinch), from: before, to: await level(page) };
			await chooseZoom(page, 'Week');
		}
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		record('pixel-7', report);
		console.log('workload perf (Pixel 7, recorded)', JSON.stringify(report));
	},
);

test(
	'desktop: zoom through day, week and month, a 3 s rebalance drag and a scroll during a result',
	{ tag: '@timing' },
	async ({ page }, info) => {
		test.skip(isTouch(info), 'desktop caps');
		await installProbe(page);
		await openHeatmap(page, info);
		const cdp = await page.context().newCDPSession(page);
		const report: Record<string, unknown> = {};
		await chooseZoom(page, 'Day');
		const box = await page.locator(SCROLLER).boundingBox();
		const at = {
			x: (box?.x ?? 0) + (box?.width ?? 800) * 0.6,
			y: (box?.y ?? 0) + (box?.height ?? 600) * 0.6,
		};
		// 1. Ctrl+wheel from day outwards to month, one notch a frame.
		await page.mouse.move(at.x, at.y);
		const zoom = await measure(page, async () => {
			await page.keyboard.down('Control');
			for (let i = 0; i < 60; i++) {
				await page.mouse.wheel(0, 40);
				await frames(page, 1);
			}
			await page.keyboard.up('Control');
		});
		report['zoom'] = { ...summary(zoom), endedAt: await level(page) };
		expect(await level(page), 'the wheel zoomed out').not.toBe('day');
		await chooseZoom(page, 'Week');

		// 2. A 3 s drag from a cell with a movable task: out along the row and back, released on its
		// own cell (no edit). The script time per frame, p95 of the input handlers plus the rAF
		// callbacks, is the budget (8 ms).
		const from = await movableCell(page);
		const a = await pointOf(page, from.person, from.col);
		const size = await page.evaluate(
			() =>
				(
					window as unknown as {
						__mainspringWorkload: { shape(): { cell: { w: number; h: number } } | null };
					}
				).__mainspringWorkload.shape()?.cell,
		);
		const w = size?.w ?? 56;
		const steps = Math.round(3000 / 16);
		const drag = await measure(page, async () => {
			await page.mouse.move(a.x, a.y);
			await page.mouse.down();
			for (let i = 1; i <= steps; i++) {
				const t = Math.sin((i / steps) * Math.PI);
				await page.mouse.move(a.x + 2 * w * t, a.y);
				await frames(page, 1);
			}
			await page.mouse.up();
		});
		const dragScript = drag.inputScript.p95Ms + drag.rafScript.p95Ms;
		report['drag'] = { ...summary(drag), scriptP95Ms: Math.round(dragScript * 10) / 10 };
		record('desktop-extra', report);
		expect(dragScript, 'drag script time p95 per frame').toBeLessThan(8);

		// 3. A scroll during which a result arrives: a real move along the row two weeks, released,
		// with the wheel turning at once, until the newer result of the engine is in.
		const rev = await resultRevision(page);
		await page.mouse.move(a.x, a.y);
		await page.mouse.down();
		for (let i = 1; i <= 8; i++) {
			await page.mouse.move(a.x + (2 * w * i) / 8, a.y);
			await frames(page, 1);
		}
		await page.mouse.up();
		// The first move asks how a move changes the plan (answered once); a cell with two movable
		// tasks asks which one moves (7.1). The default answer, and the first task, are taken.
		const asks = [
			page.getByRole('button', { name: 'Move', exact: true }),
			page.getByTestId('which-task').locator('button[data-task]').first(),
		];
		const during = await measure(page, async () => {
			const t0 = Date.now();
			let dir = 1;
			// The scroll goes on until the result is in (or a cap): the arrival is what is measured.
			while ((await resultRevision(page)) <= rev && Date.now() - t0 < 60_000) {
				for (const ask of asks) if (await ask.isVisible()) await ask.click();
				await wheel(cdp, at, 0, 300 * dir);
				dir = -dir;
			}
		});
		await resultAfter(page, rev, READY_TIMEOUT_MS);
		report['scrollDuringResult'] = summary(during);
		record('desktop-extra', report);
		console.log('workload perf (desktop, extra)', JSON.stringify(report));
	},
);
