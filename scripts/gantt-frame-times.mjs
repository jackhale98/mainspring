// SPDX-License-Identifier: GPL-2.0-or-later
// Frame times of the Gantt (phase-2.md 8.4, first cut; task T22 replaces it with the CI harness).
// Fedora 20 (414 tasks) and gantt-500 (500 tasks, all expanded), on desktop and on Pixel 7
// emulation at 4x CPU throttle. Scrolls are synthesised through the DevTools Input domain, so the
// browser's own scroller handles them (the compositor scrolls the canvases, not our script).
//
// Every scroll is checked: the scroller's offset is read before and after and the run FAILS if it
// did not move by at least half of what was asked (a measurement of a page that did not scroll
// measures nothing). The input used is recorded as `input` with a note: for the phone profile the
// script first tries a touch gesture (`Input.synthesizeScrollGesture`, touch), and if the scroller
// does not move (it does not in headless Chrome here: scrollTop 0 to 0) it falls back to a mouse
// wheel gesture on the same emulated device, and then to a requestAnimationFrame-driven scrollBy,
// labelled as such. A wheel scroll on an emulated phone exercises the same canvases, compositor and
// painters as a finger, but not touch-specific paths (touch-action, the touchmove listener).
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
// - `zoomSteps`: for each zoom level chosen, the time until the frame after it was painted.
// - `wheelZoom` (desktop): a burst of Ctrl+wheel events, in and out, measured like the scrolls.
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

const SCROLLER = '[data-testid="gantt"] .scroller';

const readScroll = (page) =>
	page.evaluate((sel) => {
		const el = document.querySelector(sel);
		return { x: Math.round(el.scrollLeft), y: Math.round(el.scrollTop) };
	}, SCROLLER);

const setScroll = (page, x, y) =>
	page.evaluate(
		([sel, left, top]) => {
			const el = document.querySelector(sel);
			el.scrollTo({ left, top, behavior: 'instant' });
		},
		[SCROLLER, x, y],
	);

/**
 * One measured action: frames, long animation frames and the compositor's frames. With `expectMove`
 * (`{ x, y }`, the distance asked, in px) the scroller's offset is read before and after, recorded
 * as `scrolledPx`, and the run fails when it moved by less than half of the distance asked.
 */
async function measure(browser, page, run, expectMove = null, label = '') {
	const from = expectMove ? await readScroll(page) : null;
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
	const stats = frameStats(frames, loaf, pipelineOf(trace));
	if (expectMove && from) {
		const to = await readScroll(page);
		const moved = { x: to.x - from.x, y: to.y - from.y };
		stats.scrolledPx = moved;
		for (const axis of ['x', 'y']) {
			const asked = Math.abs(expectMove[axis]);
			if (asked > 0 && moved[axis] * expectMove[axis] < (asked * asked) / 2) {
				throw new Error(
					`${label}: the scroller did not move on ${axis}: asked ${expectMove[axis]} px, ` +
						`moved ${moved[axis]} px (or the wrong way). The frame times of a page that does not scroll are not a result.`,
				);
			}
		}
	}
	return stats;
}

/**
 * One scroll of `dx`, `dy` px (a negative distance scrolls the content forward, as a finger or a
 * wheel moving down does). `source` is 'touch', 'mouse' (CDP wheel gesture) or 'raf' (a
 * requestAnimationFrame loop calling scrollBy, for when no synthesised input scrolls).
 */
async function gesture(page, cdp, source, x, y, dx, dy, speed) {
	if (source === 'raf') {
		await page.evaluate(
			([sel, mx, my, pxPerSec]) =>
				new Promise((resolve) => {
					const el = document.querySelector(sel);
					const total = Math.hypot(mx, my);
					const start = performance.now();
					let done = 0;
					const tick = (t) => {
						const want = Math.min(total, ((t - start) / 1000) * pxPerSec);
						const step = want - done;
						el.scrollBy({
							left: (mx / total) * step,
							top: (my / total) * step,
							behavior: 'instant',
						});
						done = want;
						if (done < total) requestAnimationFrame(tick);
						else resolve();
					};
					requestAnimationFrame(tick);
				}),
			[SCROLLER, -dx, -dy, speed],
		);
		return;
	}
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

/** The first input that moves the scroller: touch for a phone if it works, then wheel, then rAF. */
async function pickInput(page, cdp, phone, x, y) {
	const candidates = phone
		? [
				['touch', 'touch gesture'],
				['mouse', 'mouse-wheel gesture on the emulated phone (touch synthesis did not scroll)'],
				[
					'raf',
					'requestAnimationFrame scrollBy on the emulated phone (no synthesised input scrolled)',
				],
			]
		: [
				['mouse', 'mouse-wheel gesture'],
				['raf', 'requestAnimationFrame scrollBy (the wheel gesture did not scroll)'],
			];
	const tried = [];
	for (const [source, note] of candidates) {
		await setScroll(page, 0, 0);
		await gesture(page, cdp, source, x, y, 0, -400, 2000);
		await page.waitForTimeout(300);
		const moved = (await readScroll(page)).y;
		tried.push(`${source}: ${moved} px`);
		await setScroll(page, 0, 0);
		if (moved >= 200) return { source, note, tried };
	}
	throw new Error(`No input scrolled the chart (${tried.join('; ')}): nothing to measure.`);
}

/**
 * Choosing a zoom level: the time to the first frame after it (the chart already shows the new
 * scale, stretched) and to the frame after the repaint at the new scale has settled.
 */
async function zoomStep(page, level) {
	return page.evaluate(async (value) => {
		const gantt = document.querySelector('[data-testid="gantt"]');
		const select = gantt.querySelector('select');
		const frames = (n) =>
			new Promise((resolve) => {
				const tick = () => (--n <= 0 ? resolve() : requestAnimationFrame(tick));
				requestAnimationFrame(tick);
			});
		const start = performance.now();
		select.value = value;
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await frames(2);
		const first = performance.now() - start;
		const space = gantt.querySelector('.space');
		while (space.style.getPropertyValue('--zoom-ratio') !== '' || gantt.dataset.zoom !== value) {
			await frames(1);
		}
		await frames(2);
		return [first, performance.now() - start];
	}, level);
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
	const picked = await pickInput(page, cdp, phone, x, y);
	const source = picked.source;
	const down = Math.min(size.height - size.view - 50, 40_000);
	const pan = Math.min(size.width - size.viewW - 50, 8000);
	const speed = 4000;
	if (down < 500 || pan < 500) {
		throw new Error(`${sample}: too little to scroll (down ${down} px, pan ${pan} px).`);
	}
	const result = {
		sample,
		profile: name,
		scrollHeightPx: size.height,
		scrollWidthPx: size.width,
		input: source,
		inputNote: picked.note,
		inputProbe: picked.tried,
	};
	const scroll = async (key, from, dx, dy, spd = speed) => {
		await setScroll(page, from.x, from.y);
		await page.waitForTimeout(300);
		result[key] = await measure(
			browser,
			page,
			() => gesture(page, cdp, source, x, y, dx, dy, spd),
			{ x: -dx, y: -dy },
			`${sample} ${name} ${key}`,
		);
	};
	await scroll('scrollDown', { x: 0, y: 0 }, 0, -down);
	await scroll('scrollUp', { x: 0, y: down }, 0, down);
	await scroll('panRight', { x: 0, y: 0 }, -pan, 0);
	await scroll('panLeft', { x: pan, y: 0 }, pan, 0);
	await scroll('diagonal', { x: 0, y: 0 }, -1500, -3000, 3000);
	const steps = [];
	result.zoom = await measure(browser, page, async () => {
		// Week to day, back to week, then month, quarter and month again.
		for (const level of ['day', 'week', 'month', 'quarter', 'month']) {
			const [first, settled] = await zoomStep(page, level);
			steps.push({ level, firstFrameMs: round(first), settledMs: round(settled) });
			await page.waitForTimeout(400);
		}
	});
	result.zoomSteps = steps;
	if (!phone) {
		// A continuous Ctrl+wheel zoom: a burst of wheel events, in and out.
		result.wheelZoom = await measure(browser, page, async () => {
			await page.mouse.move(x, y);
			await page.keyboard.down('Control');
			for (let i = 0; i < 40; i++) {
				await page.mouse.wheel(0, i < 20 ? -40 : 40);
				await page.waitForTimeout(16);
			}
			await page.keyboard.up('Control');
			await page.waitForTimeout(300);
		});
	}
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
				loadAverageAtEnd: os.loadavg().map((v) => round(v)),
				results,
			},
			null,
			2,
		),
	);
}
