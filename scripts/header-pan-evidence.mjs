// SPDX-License-Identifier: GPL-2.0-or-later
// Evidence for the frozen header and name column (phase-2.md 9.2) on the 500-task sample: fast
// horizontal pans to the far end and back, sampled every animation frame, on Pixel 7 emulation
// (touch flings, several touch moves per frame) and on desktop (shift-wheel with large deltas,
// several per frame), run against any build, so the same numbers can be taken before and after.
//
//   BASE_URL=http://localhost:4340 node scripts/header-pan-evidence.mjs --out after
//
// Per frame it records the name column's left against the scroller's (0 means pinned), whether the
// name column is visible there (the element at the scroller's left edge belongs to it), the header's
// left against the bars' left and, on a build whose header labels are DOM text, the largest
// offset of any day or week label from the content position the bars give it. It also counts the
// header canvas's repaints (one per scroll frame is the per-event repaint). Screenshots of the far
// right end go next to the JSON. Output: docs/phases/screenshots/phase-2/header-pan-<out>-*.{json,png}
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:4340';
const OUT = process.argv.includes('--out')
	? process.argv[process.argv.indexOf('--out') + 1]
	: 'run';
const DIR = path.join(process.cwd(), 'docs', 'phases', 'screenshots', 'phase-2');
const PLAN = 'gantt-500';

const SAMPLER = () => {
	window.__frames = [];
	window.__paints = 0;
	const original = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function (...a) {
		if (this.dataset.testid === 'gantt-header') window.__paints++;
		return original.apply(this, a);
	};
	const q = (s) => document.querySelector(s);
	const t0 = performance.now();
	const tick = () => {
		const scroller = q('[data-testid="gantt"] .scroller');
		const names = q('[data-testid="gantt"] .names');
		const head = q('[data-testid="gantt"] .head');
		const plot = q('[data-testid="gantt"] .plot');
		if (scroller && names && head && plot) {
			const sr = scroller.getBoundingClientRect();
			const nr = names.getBoundingClientRect();
			const pr = plot.getBoundingClientRect();
			const hr = head.getBoundingClientRect();
			const at = document.elementFromPoint(sr.left + 4, sr.top + sr.height / 2);
			let drift = null;
			let shown = 0;
			for (const el of head.querySelectorAll('.minor')) {
				const r = el.getBoundingClientRect();
				if (r.right < nr.right || r.left > sr.right) continue;
				shown++;
				drift = Math.max(drift ?? 0, Math.abs(r.left - pr.left - parseFloat(el.style.left)));
			}
			window.__frames.push({
				t: Math.round(performance.now() - t0),
				scrollLeft: scroller.scrollLeft,
				scrollMax: scroller.scrollWidth - scroller.clientWidth,
				namesLeft: Math.round((nr.left - sr.left) * 100) / 100,
				namesVisible: !!at && names.contains(at),
				headMinusBarsX: Math.round((hr.left - pr.left) * 100) / 100,
				labelDriftPx: drift === null ? null : Math.round(drift * 100) / 100,
				labelsShown: shown,
				headerPaints: window.__paints,
			});
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
};

function summary(device, frames) {
	const v = (k) => frames.map((f) => f[k]).filter((x) => x !== null && x !== undefined);
	const lastPaints = frames.at(-1)?.headerPaints ?? 0;
	const drifts = v('labelDriftPx');
	return {
		device,
		plan: PLAN,
		build: BASE,
		frames: frames.length,
		pannedToX: Math.max(...v('scrollLeft')),
		scrollXMax: Math.max(...v('scrollMax')),
		namesLeft: { min: Math.min(...v('namesLeft')), max: Math.max(...v('namesLeft')) },
		framesWithNamesNotVisible: frames.filter((f) => !f.namesVisible).length,
		headVsBarsOffsetPx: { max: Math.max(...v('headMinusBarsX').map(Math.abs)) },
		labelOffsetPx: drifts.length
			? { max: Math.max(...drifts) }
			: 'n/a (labels are painted into the header canvas)',
		headerCanvasRepaints: lastPaints,
		repaintsPerFrame: Math.round((lastPaints / Math.max(1, frames.length)) * 100) / 100,
		samples: frames,
	};
}

async function open(browser, contextOptions) {
	const context = await browser.newContext(contextOptions);
	const page = await context.newPage();
	await page.goto(`${BASE}/app?sample=${PLAN}&mode=visual`);
	await page
		.getByTestId('engine-status')
		.filter({ hasText: 'Engine: Ready' })
		.waitFor({ timeout: 240_000 });
	await page
		.getByRole('group', { name: 'Plan status' })
		.filter({ hasText: 'Scheduled' })
		.waitFor({ timeout: 240_000 });
	await page.getByRole('treeitem').first().waitFor();
	await page.waitForTimeout(1200);
	return { context, page };
}

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const result = {};

// Pixel 7: fast one-finger flings, several touch moves per frame, far right and back.
{
	const { context, page } = await open(browser, { ...devices['Pixel 7'] });
	await page.evaluate(SAMPLER);
	const cdp = await context.newCDPSession(page);
	const swipe = async (x0, x1, y) => {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
		for (let i = 1; i <= 8; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y }],
			});
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	};
	for (let i = 0; i < 40; i++) await swipe(390, 60, 430);
	await page.waitForTimeout(600);
	await page.screenshot({ path: path.join(DIR, `header-pan-${OUT}-pixel7-far-right.png`) });
	for (let i = 0; i < 60; i++) await swipe(60, 390, 430);
	await page.waitForTimeout(500);
	result.pixel7 = summary(
		'Pixel 7 emulation, fast touch flings (8 moves per swipe, no waits)',
		await page.evaluate(() => window.__frames),
	);
	await context.close();
}

// Desktop: shift-wheel with large deltas, several wheel events per frame.
{
	const { context, page } = await open(browser, {
		viewport: { width: 1440, height: 860 },
		deviceScaleFactor: 2,
	});
	await page.evaluate(SAMPLER);
	const box = await page.getByTestId('gantt-overlay').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + 200);
	await page.keyboard.down('Shift');
	for (let i = 0; i < 150; i++) await page.mouse.wheel(0, 900);
	await page.waitForTimeout(700);
	await page.screenshot({ path: path.join(DIR, `header-pan-${OUT}-desktop-far-right.png`) });
	for (let i = 0; i < 150; i++) await page.mouse.wheel(0, -900);
	await page.waitForTimeout(500);
	await page.keyboard.up('Shift');
	result.desktop = summary(
		'Desktop Chrome, shift-wheel, 900 px deltas, several per frame',
		await page.evaluate(() => window.__frames),
	);
	await context.close();
}
await browser.close();

for (const [key, value] of Object.entries(result)) {
	fs.writeFileSync(
		path.join(DIR, `header-pan-${OUT}-${key}.json`),
		JSON.stringify(value, null, 1) + '\n',
	);
	const { samples, ...rest } = value;
	console.log(key, JSON.stringify(rest));
}
