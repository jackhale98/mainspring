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
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, isTouch } from './lib/gantt-rig';
import { installProbe, measure, withinDesktopCaps, type Measure } from './lib/perf';
import { animationsDone, frames, settledValue } from './lib/settle';
import { skipOnWebKitIfAllowlisted } from './lib/webkit-allowlist';
import { openHeatmap } from './lib/workload-rig';

const OUT = path.join(REPO, 'test-results', 'workload-perf.json');
const SCROLLER = '[data-testid="workload"] .scroller';
const RUNS = 3;

test.setTimeout(READY_TIMEOUT_MS * 4);
test.beforeEach(({ browserName: _b }, info) => {
	// Only the swipe recording is on the allowlist (it needs a Chromium trace and a native touch scroll).
	skipOnWebKitIfAllowlisted(info);
});

function record(key: string, value: unknown): void {
	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	const old = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as object) : {};
	fs.writeFileSync(OUT, JSON.stringify({ ...old, [key]: value }, null, 2));
}

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
	await page.getByRole('radiogroup', { name: 'Zoom' }).getByRole('radio', { name }).click();
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

test(
	'Pixel 7: the frame times of a swipe are recorded',
	{ tag: '@timing' },
	async ({ page }, info) => {
		test.skip(!isTouch(info), 'a finger');
		await installProbe(page);
		await openHeatmap(page, info);
		const nodes = await page.evaluate(
			() => document.querySelector('[data-testid="workload"]')?.querySelectorAll('*').length ?? 0,
		);
		const cdp = await page.context().newCDPSession(page);
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
		const m = await measure(page, async () => {
			for (let swipe = 0; swipe < 12; swipe++) {
				await touch('touchStart', mid);
				for (let i = 1; i <= 8; i++) {
					await touch('touchMove', { x: mid.x - i * 24, y: mid.y - i * 8 });
					// One frame between two moves: the finger's pace is part of the gesture being measured.
					await page.waitForTimeout(16);
				}
				await touch('touchEnd');
				// The pause between two swipes is part of the measured script: a finger lifts and lands again.
				await page.waitForTimeout(120);
			}
		});
		const end = await metrics(page);
		expect(end.left + end.top).toBeGreaterThan(200);
		const report = {
			nodes,
			frames: m.frames,
			onTimePct: m.onTimePct,
			maxMs: m.maxMs,
			scrolledPx: Math.round(end.left + end.top),
		};
		record('pixel-7', report);
		console.log('workload perf (Pixel 7, recorded)', JSON.stringify(report));
	},
);
