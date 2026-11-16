// SPDX-License-Identifier: GPL-2.0-or-later
// Records the Spring loader for the user (docs/design/logo-2026-11/loader/): a WebM and a GIF per
// theme and a PNG strip of 6 frames. It runs the real built app with the engine's asset requests
// held, so the app stays in "Starting the scheduler" with its three loaders on screen (the engine
// pill, the status strip and the Gantt's "Scheduling..." placeholder), then steps the animations
// to exact times with the Web Animations API, so the frames are deterministic.
// Usage: serve dist/ (python3 -m http.server 4412 -d dist), then
//   node docs/design/logo-2026-11/tools/record-loader.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const repo = new URL('../../../../', import.meta.url).pathname;
const out = `${repo}docs/design/logo-2026-11/loader/`;
const work = `${process.env.LOGO_SCRATCH ?? '/tmp'}/loader-frames`;
const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:4412/';
const CYCLE_MS = 2000;
const FPS = 25;
const STRIP_MS = [0, 300, 700, 1000, 1500, 1800];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

for (const theme of ['light', 'dark']) {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 3,
		colorScheme: theme,
	});
	const page = await ctx.newPage();
	// hold the engine's assets: the request never completes, so the app keeps loading
	await page.route('**/engine/**', () => {});
	await page.goto(`${base}app/`, { waitUntil: 'load' });
	await page.waitForSelector('.placeholder', { timeout: 30000 });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(1000);

	// each place: the loader mark and the words beside it (width of the clip, in CSS px)
	const targets = [
		['[data-testid="engine-status"] svg.mark', 250],
		['.strip .state svg.mark', 250],
		['.placeholder svg.mark', 250],
	];
	const boxes = [];
	for (const [sel, width] of targets) {
		const b = await page.locator(sel).first().boundingBox();
		if (!b) throw new Error(`no ${sel}`);
		boxes.push({ x: Math.max(0, b.x - 14), y: Math.max(0, b.y - 12), width, height: b.height + 24 });
	}
	const frame = async (ms, file) => {
		await page.evaluate((t) => {
			for (const a of document.getAnimations()) {
				// Svelte scopes keyframe names (svelte-<hash>-mark-draw)
				if (/mark-(draw|arc)$/.test(String(a.animationName))) {
					a.pause();
					a.currentTime = t;
				}
			}
		}, ms);
		const shots = [];
		for (let i = 0; i < boxes.length; i++) {
			const f = `${file}-${i}.png`;
			await page.screenshot({ path: f, clip: boxes[i] });
			shots.push(f);
		}
		// stack the three places on one ground, left aligned
		const bg = theme === 'light' ? '#ECE7DC' : '#080B10';
		execFileSync('convert', ['-background', bg, ...shots, '-gravity', 'West', '-append', '-bordercolor', bg, '-border', '24', file]);
	};

	const n = Math.round((CYCLE_MS / 1000) * FPS);
	for (let i = 0; i < n; i++) await frame((i * CYCLE_MS) / n, `${work}/f${String(i).padStart(3, '0')}.png`);
	// the 6-frame strip, each with its time
	const strip = [];
	for (const ms of STRIP_MS) {
		const f = `${work}/s${ms}.png`;
		await frame(ms, f);
		const labelled = `${work}/sl${ms}.png`;
		const bg = theme === 'light' ? '#ECE7DC' : '#080B10';
		const fg = theme === 'light' ? '#1C1A17' : '#EEE7D7';
		execFileSync('convert', [f, '-background', bg, '-gravity', 'North', '-splice', '0x64', '-fill', fg, '-font', 'DejaVu-Sans', '-pointsize', '30', '-annotate', '+0+14', `${(ms / 1000).toFixed(1)} s`, labelled]);
		strip.push(labelled);
	}
	execFileSync('convert', [...strip, '+append', `${out}loader-strip-${theme}.png`]);
	await ctx.close();

	const input = ['-y', '-framerate', String(FPS), '-i', `${work}/f%03d.png`];
	const scale = 'scale=iw/2:ih/2:flags=lanczos';
	execFileSync('ffmpeg', [...input, '-vf', `${scale},pad=ceil(iw/2)*2:ceil(ih/2)*2`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-pix_fmt', 'yuv420p', '-loop', '0', `${out}loader-${theme}.webm`], { stdio: 'ignore' });
	execFileSync('ffmpeg', [...input, '-vf', `${scale},split[a][b];[a]palettegen[p];[b][p]paletteuse`, '-loop', '0', `${out}loader-${theme}.gif`], { stdio: 'ignore' });
	console.log('recorded', theme);
}
await browser.close();
