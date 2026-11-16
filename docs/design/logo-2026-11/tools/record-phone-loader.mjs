// SPDX-License-Identifier: GPL-2.0-or-later
// Records the busy phone status button (the top bar's status control, which shows the loader at
// 22 px with no arcs) at 360 x 780: loader/loader-phone-{light,dark}.gif, a 6-frame strip, and a
// still at docs/phases/screenshots/phase-3/logo-b-phone360-{light,dark}-busy.png. Like
// record-loader.mjs it holds the engine's assets so the app keeps loading, and steps the
// animations to exact times.
// Usage: serve dist/ (python3 -m http.server 4412 -d dist), then
//   node docs/design/logo-2026-11/tools/record-phone-loader.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const repo = new URL('../../../../', import.meta.url).pathname;
const out = `${repo}docs/design/logo-2026-11/loader/`;
const stills = `${repo}docs/phases/screenshots/phase-3/`;
const work = `${process.env.LOGO_SCRATCH ?? '/tmp'}/loader-phone-frames`;
const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:4412/';
const CYCLE_MS = 2000;
const FPS = 25;
// the frames that matter: the stub at the start and at the end, and the ribbon in between
const STRIP_MS = [0, 400, 800, 1100, 1500, 1990];
mkdirSync(out, { recursive: true });
mkdirSync(stills, { recursive: true });

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

for (const theme of ['light', 'dark']) {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	const ctx = await browser.newContext({
		viewport: { width: 360, height: 780 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		colorScheme: theme,
	});
	const page = await ctx.newPage();
	await page.route('**/engine/**', () => {});
	await page.goto(`${base}app/`, { waitUntil: 'load' });
	await page.waitForSelector('.topbar svg.mark.busy', { timeout: 30000 });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(800);
	const button = await page.locator('.topbar button:has(svg.mark.busy)').first().boundingBox();
	if (!button) throw new Error('no busy status button');
	const bar = { x: 0, y: 0, width: 360, height: 82 };
	const crop = {
		x: Math.max(0, button.x - 14),
		y: Math.max(0, button.y - 14),
		width: button.width + 28,
		height: button.height + 28,
	};
	const step = (ms) =>
		page.evaluate((t) => {
			for (const a of document.getAnimations()) {
				if (/mark-(draw|arc)$/.test(String(a.animationName))) {
					a.pause();
					a.currentTime = t;
				}
			}
		}, ms);

	const n = Math.round((CYCLE_MS / 1000) * FPS);
	for (let i = 0; i < n; i++) {
		await step((i * CYCLE_MS) / n);
		await page.screenshot({ path: `${work}/f${String(i).padStart(3, '0')}.png`, clip: bar, scale: 'device' });
	}
	const bg = theme === 'light' ? '#ECE7DC' : '#080B10';
	const fg = theme === 'light' ? '#1C1A17' : '#EEE7D7';
	const strip = [];
	for (const ms of STRIP_MS) {
		await step(ms);
		const f = `${work}/b${ms}.png`;
		await page.screenshot({ path: f, clip: crop });
		const labelled = `${work}/bl${ms}.png`;
		execFileSync('convert', [f, '-resize', '200%', '-background', bg, '-gravity', 'North', '-splice', '0x56', '-fill', fg, '-font', 'DejaVu-Sans', '-pointsize', '26', '-annotate', '+0+10', `${(ms / 1000).toFixed(2)} s`, '-bordercolor', bg, '-border', '8', labelled]);
		strip.push(labelled);
	}
	execFileSync('convert', [...strip, '+append', `${out}loader-phone-strip-${theme}.png`]);
	// the still: the whole top bar with the ribbon drawn
	await step(800);
	await page.screenshot({ path: `${stills}logo-b-phone360-${theme}-busy.png`, clip: bar });
	await ctx.close();

	execFileSync(
		'ffmpeg',
		['-y', '-framerate', String(FPS), '-i', `${work}/f%03d.png`, '-vf', 'scale=iw*2/3:ih*2/3:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', `${out}loader-phone-${theme}.gif`],
		{ stdio: 'ignore' },
	);
	console.log('recorded', theme);
}
await browser.close();
