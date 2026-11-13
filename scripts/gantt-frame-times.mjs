// SPDX-License-Identifier: GPL-2.0-or-later
// Frame times of the Gantt while scrolling (phase-2.md 8.4, first cut; task T22 replaces it with
// the CI harness). A real compositor scroll through every row and back, a horizontal pan, and a
// zoom, on Fedora 20 (414 tasks) and the 1,000-task scale plan pasted into the editor, on desktop
// and on Pixel 7 emulation at 4x CPU throttle. Frame intervals come from requestAnimationFrame;
// long animation frames from the browser.
//
//   npm run build && npm run preview -- --port 4321 &
//   CHROMIUM_PATH=/usr/bin/google-chrome node scripts/gantt-frame-times.mjs [--out file.json]
//
// Headless Chrome has no GPU, so absolute numbers are pessimistic for fill and optimistic for
// compositing; the comparison between runs is what counts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const READY_MS = 180_000;
const SCALE_PLAN = path.join(
	import.meta.dirname,
	'..',
	'engine/golden/plans/synthetic/20-scale-1000/plan.tjp',
);

const percentile = (values, p) => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

function stats(intervals, loaf) {
	const late = intervals.filter((d) => d > 20).length;
	return {
		frames: intervals.length,
		medianMs: +percentile(intervals, 50).toFixed(1),
		p95Ms: +percentile(intervals, 95).toFixed(1),
		p99Ms: +percentile(intervals, 99).toFixed(1),
		maxMs: +Math.max(0, ...intervals).toFixed(1),
		over20msPct: +((100 * late) / Math.max(1, intervals.length)).toFixed(1),
		over50ms: intervals.filter((d) => d > 50).length,
		loafCount: loaf.length,
		loafMaxMs: +Math.max(0, ...loaf).toFixed(1),
	};
}

async function openPlan(page, plan, phone) {
	if (plan === 'fedora') {
		await page.goto(`${BASE}/app?sample=upstream-fedora-20&mode=gantt`);
	} else {
		await page.goto(`${BASE}/app?mode=text`);
	}
	await page.getByTestId('engine-status').waitFor();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="engine-status"]')?.textContent === 'Engine: Ready',
		null,
		{ timeout: READY_MS },
	);
	if (plan === 'scale') {
		const text = fs.readFileSync(SCALE_PLAN, 'utf8');
		const editor = page.getByRole('textbox', { name: /^Editor for / });
		await editor.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.evaluate((t) => {
			const data = new DataTransfer();
			data.setData('text/plain', t);
			document
				.querySelector('.cm-content')
				?.dispatchEvent(
					new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
				);
		}, text);
		await page.getByText('Item 3.4.9.4').first().waitFor({ timeout: READY_MS });
	}
	// Wait for a result of this plan, then show the Gantt.
	await page.waitForFunction(
		() => /Scheduled/.test(document.querySelector('[aria-label="Plan status"]')?.textContent ?? ''),
		null,
		{ timeout: READY_MS },
	);
	if (plan === 'scale') {
		await page.waitForTimeout(3000);
		if (phone) await page.getByRole('tab', { name: 'Gantt', exact: true }).click();
		else await page.getByRole('button', { name: 'Gantt', exact: true }).click();
	}
	await page.getByTestId('gantt').waitFor();
	await page.waitForTimeout(1500);
}

async function measure(page, cdp, run) {
	await page.evaluate(() => {
		window.__frames = [];
		window.__loaf = [];
		window.__run = true;
		let last = performance.now();
		const tick = (t) => {
			window.__frames.push(t - last);
			last = t;
			if (window.__run) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		try {
			new PerformanceObserver((l) => {
				for (const e of l.getEntries()) window.__loaf.push(e.duration);
			}).observe({ type: 'long-animation-frame', buffered: false });
		} catch {
			// Not supported: the count stays 0.
		}
	});
	await run();
	await page.waitForTimeout(300);
	const { frames, loaf } = await page.evaluate(() => {
		window.__run = false;
		return { frames: window.__frames.slice(2), loaf: window.__loaf };
	});
	return stats(frames, loaf);
}

async function scrollGesture(cdp, x, y, dx, dy, speed) {
	await cdp.send('Input.synthesizeScrollGesture', {
		x,
		y,
		xDistance: dx,
		yDistance: dy,
		speed,
		gestureSourceType: 'touch',
		preventFling: true,
	});
}

async function profile(browser, name, plan) {
	const phone = name === 'pixel-7';
	const context = await browser.newContext(
		phone
			? { ...devices['Pixel 7'] }
			: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 },
	);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await openPlan(page, plan, phone);
	if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	const box = await page.locator('[data-testid="gantt"] .scroller').boundingBox();
	const rows = await page.evaluate(() => {
		const s = document.querySelector('[data-testid="gantt"] .scroller');
		return {
			height: s.scrollHeight,
			view: s.clientHeight,
			width: s.scrollWidth,
			viewW: s.clientWidth,
		};
	});
	const x = box.x + box.width * 0.7;
	const y = box.y + box.height * 0.6;
	const down = Math.min(rows.height - rows.view - 50, 40_000);
	const speed = 4000;
	const result = { plan, profile: name, rowsHeightPx: rows.height };

	result.scrollDown = await measure(page, cdp, () => scrollGesture(cdp, x, y, 0, -down, speed));
	result.scrollUp = await measure(page, cdp, () => scrollGesture(cdp, x, y, 0, down, speed));
	const pan = Math.min(rows.width - rows.viewW - 50, 8000);
	result.panRight = await measure(page, cdp, () => scrollGesture(cdp, x, y, -pan, 0, speed));
	result.panLeft = await measure(page, cdp, () => scrollGesture(cdp, x, y, pan, 0, speed));
	// A diagonal flick, as a thumb does.
	result.diagonal = await measure(page, cdp, () => scrollGesture(cdp, x, y, -1500, -3000, 3000));
	// Zoom steps: day, week, month, quarter, with the Zoom buttons (a model-sized repaint each).
	result.zoomCycle = await measure(page, cdp, async () => {
		for (const name of ['Zoom in', 'Zoom out', 'Zoom out', 'Zoom out', 'Zoom in']) {
			await page.getByRole('button', { name, exact: true }).click();
			await page.waitForTimeout(250);
		}
	});
	await context.close();
	return result;
}

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const results = [];
for (const plan of ['fedora', 'scale']) {
	for (const name of ['desktop', 'pixel-7']) {
		const r = await profile(browser, name, plan);
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
