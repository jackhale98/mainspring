// SPDX-License-Identifier: GPL-2.0-or-later
// Frame times of the Gantt on a real Android phone (phase-2.md 8.5; T22). NOT RUN in Phase 2: the
// user dropped the real-device run (T26) on 2026-11-13, and criterion 2 is judged on the emulated
// Pixel 7 runs of tests/e2e/gantt-perf.spec.ts. The script is kept for a later device run and has
// not been exercised against a device.
//
// What it does: drives Chrome on a USB-connected device through Playwright's experimental Android
// support (`_android`; needs `adb` and USB debugging, Chrome stable on the device), opens
// `/app?sample=gantt-500&mode=visual` served from this machine over `adb reverse`, waits for the
// engine, and runs the 18.7 scenario: three runs of a native vertical scroll through every row and
// back (CDP `Input.synthesizeScrollGesture`, touch), then a horizontal pan and a pinch, each with
// the frame meter (rAF intervals), Long Animation Frames and a trace of the compositor's frames.
// It writes test-results/gantt-perf-android.json with the device model, Android and Chrome
// versions and the refresh rate (`adb shell dumpsys display`), and exits non-zero when a scroll
// run fails the 18.7 definition (95% of frames on time and none over 50 ms).
//
//   MAINSPRING_DEV_PAGES=1 npm run build && npm run preview -- --port 4321 &
//   node scripts/perf-android.mjs [--serial <adb serial>] [--port 4321] [--out file.json]
//
// If `_android` cannot attach (it needs a Chrome that allows the debug socket), fall back to
// chrome://inspect with the same page and read the meter on /dev/gantt-perf by hand.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _android as android } from '@playwright/test';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', '4321'));
const SERIAL = arg('--serial', undefined);
const OUT = arg('--out', path.join('test-results', 'gantt-perf-android.json'));
const READY_MS = 240_000;
const RUNS = 3;
const ON_TIME_MS = 20;
const MAX_FRAME_MS = 50;
const PASS_ON_TIME_PCT = 95;
const TRACE = ['benchmark', 'cc', 'viz', 'disabled-by-default-devtools.timeline.frame'];
const SCROLLER = '[data-testid="gantt"] .scroller';

const round = (v) => Math.round(v * 10) / 10;
const percentile = (values, p) => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

function frameStats(frames, loaf) {
	const on = frames.filter((f) => f <= ON_TIME_MS).length;
	return {
		frames: frames.length,
		medianMs: round(percentile(frames, 50)),
		p95Ms: round(percentile(frames, 95)),
		maxMs: round(Math.max(0, ...frames)),
		over50: frames.filter((f) => f > MAX_FRAME_MS).length,
		onTimePct: frames.length === 0 ? 0 : round((100 * on) / frames.length),
		loafCount: loaf.length,
		loafMaxMs: round(Math.max(0, ...loaf)),
	};
}

function pipelineOf(trace) {
	const states = new Map();
	for (const e of trace.traceEvents ?? trace) {
		const f = e.name === 'PipelineReporter' && e.ph === 'b' ? e.args?.frame_reporter : null;
		if (f) states.set(f.state, (states.get(f.state) ?? 0) + 1);
	}
	const get = (s) => states.get(s) ?? 0;
	const presented = get('STATE_PRESENTED_ALL') + get('STATE_PRESENTED_PARTIAL');
	const dropped = get('STATE_DROPPED');
	return {
		presented,
		dropped,
		droppedPct: presented + dropped === 0 ? 0 : round((100 * dropped) / (presented + dropped)),
	};
}

function adb(...args) {
	const full = SERIAL ? ['-s', SERIAL, ...args] : args;
	return execFileSync('adb', full, { encoding: 'utf8' }).trim();
}

function refreshRate() {
	try {
		const m = /fps=(\d+(\.\d+)?)/.exec(adb('shell', 'dumpsys', 'display'));
		return m ? Number(m[1]) : null;
	} catch {
		return null;
	}
}

const [device] = await android.devices();
if (!device) {
	console.error('perf-android: no Android device found (adb devices; USB debugging on).');
	process.exit(2);
}
console.log(`Device: ${device.model()} (${device.serial()})`);
// The phone reaches this machine's preview server as localhost.
adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
const info = {
	model: device.model(),
	serial: device.serial(),
	android: adb('shell', 'getprop', 'ro.build.version.release'),
	refreshHz: refreshRate(),
	battery: adb('shell', 'dumpsys', 'battery').match(/level: (\d+)/)?.[1] ?? null,
	host: `${os.cpus()[0]?.model} x${os.cpus().length}`,
	loadAverageAtStart: os.loadavg().map(round),
};
await device.shell('am force-stop com.android.chrome');
const context = await device.launchBrowser({ pkg: 'com.android.chrome' });
const page = await context.newPage();
await page.addInitScript(() => {
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
			if (window.__recording) for (const e of list.getEntries()) window.__loaf.push(e.duration);
		}).observe({ type: 'long-animation-frame', buffered: false });
	} catch {
		// Not supported: the count stays 0.
	}
});
await page.goto(`http://localhost:${PORT}/app?sample=gantt-500&mode=visual`);
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
await page.waitForTimeout(3000);
info.chrome = await page.evaluate(() => navigator.userAgent);
const cdp = await context.newCDPSession(page);
const box = await page.locator(SCROLLER).boundingBox();
const at = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.6 };
const metrics = () =>
	page.evaluate((sel) => {
		const s = document.querySelector(sel);
		return {
			top: Math.round(s.scrollTop),
			height: s.scrollHeight,
			view: s.clientHeight,
			width: s.scrollWidth,
			viewW: s.clientWidth,
		};
	}, SCROLLER);
const scrollTo = (left, top) =>
	page.evaluate(
		([sel, l, t]) => document.querySelector(sel).scrollTo({ left: l, top: t, behavior: 'instant' }),
		[SCROLLER, left, top],
	);
const swipe = (dx, dy) =>
	cdp.send('Input.synthesizeScrollGesture', {
		...at,
		xDistance: dx,
		yDistance: dy,
		speed: 4000,
		gestureSourceType: 'touch',
		preventFling: true,
	});

async function measure(run) {
	await page.evaluate(() => {
		window.__frames = [];
		window.__loaf = [];
		window.__recording = true;
	});
	await cdp.send('Tracing.start', {
		transferMode: 'ReturnAsStream',
		traceConfig: { includedCategories: TRACE },
	});
	await run();
	const { frames, loaf } = await page.evaluate(() => {
		window.__recording = false;
		return { frames: window.__frames.slice(1), loaf: window.__loaf };
	});
	await page.waitForTimeout(300);
	const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
	await cdp.send('Tracing.end');
	const { stream } = await done;
	let text = '';
	for (;;) {
		const chunk = await cdp.send('IO.read', { handle: stream });
		text += chunk.data;
		if (chunk.eof) break;
	}
	await cdp.send('IO.close', { handle: stream });
	return { ...frameStats(frames, loaf), pipeline: pipelineOf(JSON.parse(text)) };
}

const dims = await metrics();
const down = Math.min(dims.height - dims.view - 50, 40_000);
const scroll = [];
for (let i = 0; i < RUNS; i++) {
	await scrollTo(0, 0);
	await page.waitForTimeout(300);
	let farthest = 0;
	const m = await measure(async () => {
		await swipe(0, -down);
		farthest = (await metrics()).top;
		await swipe(0, down);
	});
	if (farthest < down / 2) throw new Error(`run ${i + 1}: the chart did not scroll (${farthest} px)`);
	scroll.push(m);
	console.log(`scroll run ${i + 1}: ${JSON.stringify(m)}`);
}
const pan = Math.min(dims.width - dims.viewW - 50, 12_000);
await scrollTo(0, 0);
const panRun = await measure(() => swipe(-pan, 0));
const pinch = await measure(async () => {
	for (let i = 0; i < 4; i++) {
		await cdp.send('Input.synthesizePinchGesture', {
			...at,
			scaleFactor: 0.35,
			relativeSpeed: 400,
			gestureSourceType: 'touch',
		});
		await page.waitForTimeout(150);
	}
});
const passes = (m) => m.onTimePct >= PASS_ON_TIME_PCT && m.maxMs <= MAX_FRAME_MS;
const result = {
	when: new Date().toISOString(),
	...info,
	loadAverageAtEnd: os.loadavg().map(round),
	criterion18_7: {
		definition: `at least ${PASS_ON_TIME_PCT}% of rAF intervals up to ${ON_TIME_MS} ms and none over ${MAX_FRAME_MS} ms, in every run`,
		pass: scroll.every(passes),
	},
	scroll,
	pan: panRun,
	pinch,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`Wrote ${OUT}; 18.7: ${result.criterion18_7.pass ? 'PASS' : 'FAIL'}`);
await context.close();
await device.close();
process.exit(result.criterion18_7.pass ? 0 : 1);
