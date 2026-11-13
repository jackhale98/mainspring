// SPDX-License-Identifier: GPL-2.0-or-later
// Frame times of the Gantt (phase-2.md 8.4, first cut; task T22 replaces it with the CI harness).
// Fedora 20 (414 tasks) and gantt-500 (500 tasks, all expanded), on desktop (a mouse-wheel scroll
// gesture) and on Pixel 7 emulation at 4x CPU throttle (a touch scroll gesture), both synthesised
// through the DevTools Input domain so the browser's own scroller handles them.
//
//   MAINSPRING_DEV_PAGES=1 npm run build && npm run preview -- --port 4321 &
//   CHROMIUM_PATH=/usr/bin/google-chrome node scripts/gantt-frame-times.mjs [--out file.json]
//
// What is recorded, and what it can say:
// - `frames`: gaps between requestAnimationFrame callbacks on the main thread. It shows main-thread
//   stalls (a long script or paint task), not what the compositor presented.
// - `presented`, `dropped` and `checkerboardedFrames`: counts of the compositor's PipelineReporter
//   frames in a Chromium trace over the same window, by state, and how many of them reported
//   missing tiles (checkerboarding). This is the frame count that matters for smoothness.
// - `loaf`: Long Animation Frames (over 50 ms) from one PerformanceObserver per page.
// - `zoomSteps`: for each Zoom button press, the time until the frame after it was painted.
// Headless Chrome has no GPU (software raster), so rasterisation and checkerboarding are not a
// phone's. Real-device runs are task T26.
import fs from 'node:fs';
import os from 'node:os';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const READY_MS = 180_000;
const PLANS = ['upstream-fedora-20', 'gantt-500'];
const TRACE_CATEGORIES = ['benchmark', 'cc', 'viz', 'disabled-by-default-devtools.timeline.frame'];

const percentile = (values, p) => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const round = (v) => +v.toFixed(1);

function frameStats(frames, loaf, pipeline) {
	return {
		frames: frames.length,
		medianMs: round(percentile(frames, 50)),
		p95Ms: round(percentile(frames, 95)),
		maxMs: round(Math.max(0, ...frames)),
		over50ms: frames.filter((d) => d > 50).length,
		loafCount: loaf.length,
		loafMaxMs: round(Math.max(0, ...loaf)),
		...pipeline,
	};
}

/** The compositor's PipelineReporter frames in a trace: by state, and how many showed missing tiles. */
function pipelineOf(trace) {
	const states = new Map();
	let checkerboarded = 0;
	const events = trace.traceEvents ?? trace;
	for (const e of events) {
		if (e.name !== 'PipelineReporter' || e.ph !== 'b') continue;
		const f = e.args?.frame_reporter;
		if (!f) continue;
		states.set(f.state, (states.get(f.state) ?? 0) + 1);
		if (f.checkerboarded_needs_raster || f.checkerboarded_needs_record || f.has_missing_content) {
			checkerboarded++;
		}
	}
	const get = (s) => states.get(s) ?? 0;
	const presented = get('STATE_PRESENTED_ALL') + get('STATE_PRESENTED_PARTIAL');
	const dropped = get('STATE_DROPPED');
	return {
		presented,
		dropped,
		droppedPct: presented + dropped === 0 ? 0 : round((100 * dropped) / (presented + dropped)),
		checkerboardedFrames: checkerboarded,
		pipelineStates: Object.fromEntries(states),
	};
}

async function openPlan(page, sample) {
	await page.goto(`${BASE}/app?sample=${sample}&mode=visual`);
	await page.waitForFunction(
		() => document.querySelector('[data-testid="engine-status"]')?.textContent === 'Engine: Ready',
		null,
		{ timeout: READY_MS },
	);
	await page.waitForFunction(
		() => /Scheduled/.test(document.querySelector('[aria-label="Plan status"]')?.textContent ?? ''),
		null,
		{ timeout: READY_MS },
	);
	await page.getByTestId('gantt-overlay').waitFor();
	await page.waitForTimeout(2000);
}

/** One measured action: frames, long animation frames and the compositor's frames. */
async function measure(browser, page, run) {
	await page.evaluate(() => {
		window.__frames = [];
		window.__loaf = [];
		window.__recording = true;
	});
	await browser.startTracing(page, { categories: TRACE_CATEGORIES });
	await run();
	await page.waitForTimeout(300);
	const trace = JSON.parse((await browser.stopTracing()).toString());
	const { frames, loaf } = await page.evaluate(() => {
		window.__recording = false;
		return { frames: window.__frames.slice(1), loaf: window.__loaf };
	});
	return frameStats(frames, loaf, pipelineOf(trace));
}

async function gesture(cdp, source, x, y, dx, dy, speed) {
	await cdp.send('Input.synthesizeScrollGesture', {
		x,
		y,
		xDistance: dx,
		yDistance: dy,
		speed,
		gestureSourceType: source,
		preventFling: true,
	});
}

/** Time from pressing a Zoom button to the frame after the one that painted the result. */
async function zoomStep(page, name) {
	return page.evaluate(async (label) => {
		const button = [...document.querySelectorAll('[data-testid="gantt"] button')].find(
			(b) => b.textContent?.trim() === label,
		);
		const start = performance.now();
		button?.click();
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		return performance.now() - start;
	}, name);
}

async function profile(browser, name, sample) {
	const phone = name === 'pixel-7';
	const context = await browser.newContext(
		phone
			? { ...devices['Pixel 7'] }
			: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 },
	);
	// One observer and one frame recorder for the page's whole life.
	await context.addInitScript(() => {
		window.__recording = false;
		window.__frames = [];
		window.__loaf = [];
		let last = performance.now();
		const tick = (t) => {
			if (window.__recording) window.__frames.push(t - last);
			last = t;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		try {
			new PerformanceObserver((list) => {
				if (!window.__recording) return;
				for (const e of list.getEntries()) window.__loaf.push(e.duration);
			}).observe({ type: 'long-animation-frame', buffered: false });
		} catch {
			// Not supported: the count stays 0.
		}
	});
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await openPlan(page, sample);
	if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	const scroller = '[data-testid="gantt"] .scroller';
	const box = await page.locator(scroller).boundingBox();
	const size = await page.evaluate((sel) => {
		const s = document.querySelector(sel);
		return {
			height: s.scrollHeight,
			view: s.clientHeight,
			width: s.scrollWidth,
			viewW: s.clientWidth,
		};
	}, scroller);
	const x = box.x + box.width * 0.7;
	const y = box.y + box.height * 0.6;
	const source = phone ? 'touch' : 'mouse';
	const down = Math.min(size.height - size.view - 50, 40_000);
	const pan = Math.min(size.width - size.viewW - 50, 8000);
	const speed = 4000;
	const result = { sample, profile: name, scrollHeightPx: size.height, input: source };

	result.scrollDown = await measure(browser, page, () =>
		gesture(cdp, source, x, y, 0, -down, speed),
	);
	result.scrollUp = await measure(browser, page, () => gesture(cdp, source, x, y, 0, down, speed));
	result.panRight = await measure(browser, page, () => gesture(cdp, source, x, y, -pan, 0, speed));
	result.panLeft = await measure(browser, page, () => gesture(cdp, source, x, y, pan, 0, speed));
	result.diagonal = await measure(browser, page, () =>
		gesture(cdp, source, x, y, -1500, -3000, 3000),
	);
	const steps = [];
	result.zoom = await measure(browser, page, async () => {
		for (const label of ['Zoom in', 'Zoom out', 'Zoom out', 'Zoom out', 'Zoom in']) {
			steps.push([label, round(await zoomStep(page, label))]);
			await page.waitForTimeout(400);
		}
	});
	result.zoomSteps = steps;
	await context.close();
	return result;
}

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const results = [];
for (const sample of PLANS) {
	for (const name of ['desktop', 'pixel-7']) {
		const r = await profile(browser, name, sample);
		results.push(r);
		console.log(JSON.stringify(r));
	}
}
await browser.close();
if (OUT) {
	fs.writeFileSync(
		OUT,
		JSON.stringify(
			{
				when: new Date().toISOString(),
				host: `${os.cpus()[0]?.model} x${os.cpus().length}`,
				results,
			},
			null,
			2,
		),
	);
}
