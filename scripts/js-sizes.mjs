// SPDX-License-Identifier: GPL-2.0-or-later
// JS sizes of the built app (phase-2.md 11.3, 13.4, 18.11). Two numbers:
//
//   1. the total gzip of every script in dist/_astro: a cap of 450,000 bytes, enforced (exit 1);
//   2. the JS a first load really fetches in Visual mode and in Text mode, measured in a browser
//      against a preview. The code-split CodeMirror chunk is fetched in Text and Split, never in
//      Visual: that is enforced too. The Visual-first size has a target of 300,000 bytes that is
//      reported, as a warning, not enforced (18.11).
//
//   npm run build
//   node scripts/js-sizes.mjs --serve [--out file.json]      serves dist itself, as Pages does
//   node scripts/js-sizes.mjs --dist-only                    the total and the chunks, no browser
//   BASE_URL=http://localhost:4321 node scripts/js-sizes.mjs   against a preview that is running
//
// CHROMIUM_PATH picks a browser that is already installed. PORT (default 4399) is the port of
// --serve. In GitHub Actions the table goes to the step summary and the warning to an annotation.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const TOTAL_CAP = 450_000;
export const VISUAL_FIRST_TARGET = 300_000;

const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const arg = (name) =>
	process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const flag = (name) => process.argv.includes(name);

/** Every script in `dir` with its gzip size, biggest first. */
export function distScripts(dir) {
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.js'))
		.map((f) => {
			const buf = fs.readFileSync(path.join(dir, f));
			return { file: f, raw: buf.length, gzip: gzip(buf) };
		})
		.sort((a, b) => b.gzip - a.gzip);
}

async function firstLoad(browser, base, query) {
	const page = await browser.newPage();
	const seen = new Map();
	page.on('response', async (res) => {
		const url = res.url();
		if (!/\.js(\?|$)/.test(url) || !url.startsWith(base)) return;
		try {
			const body = await res.body();
			seen.set(url, { raw: body.length, gzip: gzip(body) });
		} catch {
			// A response that was cancelled with the page.
		}
	});
	await page.goto(`${base}/app?${query}`);
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

async function measureLoads() {
	const { chromium } = await import('@playwright/test');
	let server = null;
	let base = process.env.BASE_URL ?? 'http://localhost:4321';
	if (flag('--serve')) {
		// The built site served in this process as Pages serves it (scripts/serve-pages.mjs), at the
		// root: nothing to start and nothing to stop that could outlive the script.
		const { createPagesServer } = await import('./serve-pages.mjs');
		server = createPagesServer({ dir: path.join(process.cwd(), 'dist'), base: '/' });
		await new Promise((resolve) =>
			server.listen(Number(process.env.PORT ?? 4399), 'localhost', resolve),
		);
		base = `http://localhost:${server.address().port}`;
	}
	const browser = await chromium.launch(
		process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
	);
	try {
		return {
			visualFirst: await firstLoad(browser, base, 'sample=upstream-tutorial&mode=visual'),
			textFirst: await firstLoad(browser, base, 'sample=upstream-tutorial&mode=text'),
		};
	} finally {
		await browser.close();
		server?.closeAllConnections();
		server?.close();
	}
}

const kb = (n) => `${(n / 1000).toFixed(1)} KB`;

async function main() {
	const files = distScripts(path.join(process.cwd(), 'dist', '_astro'));
	const total = files.reduce((n, f) => n + f.gzip, 0);
	const result = {
		distTotal: { files: files.length, gzipBytes: total, cap: TOTAL_CAP },
		biggest: files.slice(0, 6),
	};
	const problems = [];
	if (total >= TOTAL_CAP)
		problems.push(`the app's JS is ${total} bytes gzip; the cap is ${TOTAL_CAP}`);
	if (!flag('--dist-only')) {
		Object.assign(result, await measureLoads());
		result.visualFirstTarget = VISUAL_FIRST_TARGET;
		if (result.visualFirst.loadsEditorChunk)
			problems.push('a Visual-first load fetched the CodeMirror chunk (it must stay split off)');
		if (!result.textFirst.loadsEditorChunk)
			problems.push('a Text-first load did not fetch the CodeMirror chunk (the split moved?)');
	}
	const text = JSON.stringify(result, null, 2) + '\n';
	const out = arg('--out');
	if (out) {
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, text);
	}
	console.log(text);

	const lines = [
		'## JS sizes (gzip)',
		'',
		`Total of \`dist/_astro\`: **${kb(total)}** of ${kb(TOTAL_CAP)} (${files.length} files).`,
	];
	if (result.visualFirst) {
		lines.push(
			`First load, Visual mode: **${kb(result.visualFirst.gzipBytes)}** (target ${kb(VISUAL_FIRST_TARGET)}).`,
			`First load, Text mode: **${kb(result.textFirst.gzipBytes)}**.`,
		);
	}
	lines.push(
		'',
		'| Chunk | gzip |',
		'| --- | ---: |',
		...files.slice(0, 6).map((f) => `| ${f.file} | ${kb(f.gzip)} |`),
	);
	if (process.env.GITHUB_STEP_SUMMARY)
		fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
	if (
		result.visualFirst &&
		result.visualFirst.gzipBytes > VISUAL_FIRST_TARGET &&
		process.env.GITHUB_ACTIONS
	)
		console.log(
			`::warning title=Visual-first JS::${kb(result.visualFirst.gzipBytes)} is over the ${kb(VISUAL_FIRST_TARGET)} target (phase-2 18.11)`,
		);
	for (const p of problems) console.error(`js-sizes: ${p}`);
	if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
