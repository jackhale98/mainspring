// SPDX-License-Identifier: GPL-2.0-or-later
// JS sizes of the built app (phase-2.md 11.3, 18.11): the total gzip of every script in
// dist/_astro (the 450,000-byte cap), and the JS a first load really fetches in Visual mode and in
// Text mode, measured in a browser against a running preview. The code-split CodeMirror chunk is
// fetched in Text and Split, never in Visual.
//
//   npm run build && npm run preview -- --port 4321 &
//   CHROMIUM_PATH=/usr/bin/google-chrome node scripts/js-sizes.mjs [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const DIST = path.join(process.cwd(), 'dist', '_astro');
const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

const files = fs
	.readdirSync(DIST)
	.filter((f) => f.endsWith('.js'))
	.map((f) => {
		const buf = fs.readFileSync(path.join(DIST, f));
		return { file: f, raw: buf.length, gzip: gzip(buf) };
	})
	.sort((a, b) => b.gzip - a.gzip);
const total = files.reduce((n, f) => n + f.gzip, 0);

async function firstLoad(browser, query) {
	const page = await browser.newPage();
	const seen = new Map();
	page.on('response', async (res) => {
		const url = res.url();
		if (!/\.js(\?|$)/.test(url) || !url.startsWith(BASE)) return;
		try {
			const body = await res.body();
			seen.set(url, { raw: body.length, gzip: gzip(body) });
		} catch {
			// A response that was cancelled with the page.
		}
	});
	await page.goto(`${BASE}/app?${query}`);
	await page.getByRole('group', { name: 'Plan status' }).waitFor({ timeout: 180_000 });
	await page.getByTestId('engine-status').filter({ hasText: 'Engine: Ready' }).waitFor({
		timeout: 180_000,
	});
	await page.waitForTimeout(1500);
	await page.close();
	const list = [...seen].map(([url, v]) => ({ file: path.basename(new URL(url).pathname), ...v }));
	return {
		files: list.sort((a, b) => b.gzip - a.gzip),
		gzipBytes: list.reduce((n, f) => n + f.gzip, 0),
		rawBytes: list.reduce((n, f) => n + f.raw, 0),
		loadsEditorChunk: list.some((f) => f.file.startsWith('editor-controller')),
	};
}

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const result = {
	distTotal: { files: files.length, gzipBytes: total, cap: 450_000 },
	biggest: files.slice(0, 6),
	visualFirst: await firstLoad(browser, 'sample=upstream-tutorial&mode=visual'),
	textFirst: await firstLoad(browser, 'sample=upstream-tutorial&mode=text'),
};
await browser.close();
const text = JSON.stringify(result, null, 2) + '\n';
if (OUT) fs.writeFileSync(OUT, text);
console.log(text);
if (total >= 450_000) process.exitCode = 1;
