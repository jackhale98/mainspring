// SPDX-License-Identifier: GPL-2.0-or-later
// JS sizes of the built app (phase-2.md 11.3, 13.4, 18.11; budget amended by the user 2026-11-16,
// raised by the user 2026-11-17).
// The budgets are on what a first load fetches, where the user waits, plus a loose guard on the
// whole app and caps on named lazy chunks:
//
//   0. reported only: the JS a returning visit fetches, a stored plan restored on start (T4 review
//      M3; phase-4.md 12.1), in Visual and Text mode;
//   1. the JS a first load fetches in Visual mode (340,000 bytes gzip; raised from 330,000 at the Phase 3 gate, user 2026-11-23) and in Text mode (445,000; raised from 440,000 in Phase 4, user 2026-11-23),
//      measured in a browser against a preview: enforced (exit 1). The code-split CodeMirror chunk
//      is fetched in Text and Split, never in Visual: enforced too. So is the keyword docs asset
//      (`engine/tj-docs.*.json.gz`, ADR-0017): a Visual-first load never requests it (a Text-first
//      load does, after the editor mounts; that is reported, not enforced);
//   2. the total gzip of every script in dist/_astro: a guard of 650,000 bytes against accidents,
//      enforced;
//   3. each named lazy chunk (CHUNK_CAPS, matched by file name): its own cap, enforced.
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

export const TOTAL_CAP = 650_000;
export const VISUAL_FIRST_CAP = 340_000;
export const TEXT_FIRST_CAP = 445_000;
/**
 * All the People views' lazy chunks together (the heatmap, the lanes, the Calendar, the Resources
 * table, the person details and what they share; found from the built graph, `viewChunkSet`). The
 * 60,000 of phase-3.md 8.3 was one chunk's target; the views are now one chunk each (23.1) with
 * caps of their own, and 90,589 bytes were measured together on 2026-11-23 (T22): this guard keeps the sum
 * from growing unseen.
 */
export const PEOPLE_VIEWS_CAP = 100_000;
/**
 * Lazy chunks with their own cap, by file name (Rollup names a chunk after its entry module, and
 * a chunk two views share after one of its modules). `lazy: true` marks a chunk no first load may
 * fetch (export, phase-4.md 12.1). `view: true` marks a People view chunk: none
 * of them may load with a Gantt-first load (phase-3.md 8.3). A pattern that matches no chunk is a
 * problem too (the split moved, and the cap guards nothing).
 *
 * The People views are one chunk each (phase-3.md 23.1): PeopleView.svelte is only the shell that
 * imports a view when it first opens; the others are what it imports.
 */
export const CHUNK_CAPS = [
	{ name: 'editor', pattern: /^editor-controller/, cap: 118_000 },
	{ name: 'people', pattern: /^PeopleView/, cap: 3_700, view: true },
	{ name: 'workload', pattern: /^Workload\./, cap: 7_000, view: true },
	// What the heatmap and the lanes share (the canvas plot, names, header, details, the model).
	{ name: 'heat', pattern: /^WorkloadBar/, cap: 34_000, view: true },
	// What the heatmap and the lanes share, named after one of its modules (WhichTask: the plot, the
	// painters, the details; 19,196 on 2026-11-23): it had no cap of its own (T22). Optional: only the
	// build with the test pages (CI's, MAINSPRING_DEV_PAGES) splits it off; the Pages build folds it
	// into the heat chunk above (24,407 there), whose cap then covers it.
	{ name: 'heat-shared', pattern: /^WhichTask/, cap: 21_000, view: true, optional: true },
	{ name: 'lanes', pattern: /^Lanes\./, cap: 12_200, view: true },
	{ name: 'calendar', pattern: /^(Calendar\.|calendar-state)/, cap: 16_400, view: true },
	// The Resources view: the resource table, its drag and the divider's rules (T17).
	{ name: 'resources', pattern: /^ResourcesView/, cap: 9_400, view: true },
	// A person's details and the working-hours editor, fetched when a person is selected (T17).
	{
		name: 'person',
		pattern: /^(ResourcePanel|WorkingHoursEditor|person-edit|rows)\./,
		cap: 15_800,
		view: true,
	},
	// Plan health (T18, phase-3.md 9.7). The panel (findings, fixes, settings, the sheet) and "Why
	// here?" are fetched when first asked for, and not by a first load; `text` is the findings'
	// sentences (lib/health/text.ts with the panel's copy). Not a People chunk: the Gantt's details
	// fetch them as well.
	{ name: 'health', pattern: /^(HealthPanel|HealthSheet|WhyHere|text)\./, cap: 16_700 },
	// The checks and the explainer's context (lib/health/compute.ts). A first load fetches them in
	// an idle task after the first result: the Health button's count is made from them. What they
	// import (demand, analysis, ...) is counted in the first load.
	{ name: 'health-checks', pattern: /^(compute|health-checks)\./, cap: 13_300 },
	// Export (T18, phase-4.md 18.20): the Gantt picture's renderer, the CSV writer and what they say,
	// fetched by the first use of the "More actions" menu's export entries and by no first load
	// (3,356 bytes on 2026-11-23).
	{ name: 'export', pattern: /^run-export\./, cap: 3_700, lazy: true },
	// Plans kept in the browser (T4, phase-4.md 12.1): the local store, the owner lock and autosave,
	// fetched when a plan has to be kept (a stored plan restores, a sample's first change, New plan),
	// never by a first visit that only reads a sample (3,881 bytes on 2026-11-23, after the T4
	// review and re-check: the owner epoch, the lock's channel without Web Locks, damaged plans,
	// changes a lost plan leaves unstored).
	{ name: 'keeper', pattern: /^plan-keeper\./, cap: 4_200, lazy: true },
	// The notice under the top bar (read-only, could not open, cleared, not kept, and changes another
	// tab refused with "Copy the text", T4 re-check N1; 1,308 bytes on 2026-11-23).
	{ name: 'plan-notice', pattern: /^PlanNotice\./, cap: 1_400, lazy: true },
	// The Sync panel behind the status control (T14, phase-4.md 11.1): a popover or a bottom sheet with
	// the state's sentence, the location and the actions that exist, and its copy (strings-sync.ts), fetched
	// by the first press of the control and by no first load (2,445 bytes on 2026-11-24). T14 part two
	// adds the Commit, Sync and Save actions to it, and raises this cap with them.
	{ name: 'sync-panel', pattern: /^SyncPanel\./, cap: 2_700, lazy: true },
];

/** The caps whose pattern matches no built file: the split moved, and the cap guards nothing. */
export function unmatchedCaps(files) {
	return CHUNK_CAPS.filter((c) => !c.optional && !files.some((f) => c.pattern.test(f.file))).map(
		(c) => `the ${c.name} chunk cap matches no built file (${c.pattern}); did the split move?`,
	);
}

/** Whether a built file is one of the capped People view chunks (by name). */
export const isViewChunk = (file) => CHUNK_CAPS.some((c) => c.view && c.pattern.test(file));

/** Whether a built file is a capped chunk that no first load may fetch (`lazy`), by name. */
export const isLazyChunk = (file) => CHUNK_CAPS.some((c) => c.lazy && c.pattern.test(file));

const STATIC_REF = /(?:from|import)\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g;
const ANY_REF = /["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]/g;
const ENTRY_REF = /_astro\/([A-Za-z0-9._-]+\.js)/g;

const refs = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

/**
 * Every chunk that belongs to the People views, found from the built graph and not from names (a
 * chunk two views share is named after one of its modules, and a shared module such as the leave
 * card or a strings module has no cap of its own): what the shell chunk (`PeopleView`) and the person details (`ResourcePanel`) reach by
 * static or dynamic imports, minus what a first load reaches by static imports from the page's
 * scripts, and minus what plan health shares with them. A Gantt-first load that fetches one of
 * them has pulled a People view in. `sources` maps a file name to its text; `html` is the page's
 * HTML.
 *
 * Plan health is shared: the heatmap's "Why here?" (`WhyHere`) and the Health button's count
 * (`compute`, which the first load fetches in an idle task) are reached from the People views and
 * from code a Gantt-first load runs, so what they reach is not a People chunk (phase-3.md 25).
 */
export function viewChunkSet(sources, html) {
	const firstLoad = new Set();
	const walk = (start, re, into) => {
		const todo = [...start];
		while (todo.length) {
			const f = todo.pop();
			if (into.has(f) || !(f in sources)) continue;
			into.add(f);
			todo.push(...refs(sources[f], re));
		}
	};
	walk(refs(html, ENTRY_REF), STATIC_REF, firstLoad);
	const shell = Object.keys(sources).filter((f) => /^(PeopleView|ResourcePanel)/.test(f));
	const reach = new Set();
	walk(shell, ANY_REF, reach);
	const shared = new Set();
	walk(
		Object.keys(sources).filter((f) => /^(compute|health-checks|WhyHere)\./.test(f)),
		ANY_REF,
		shared,
	);
	return new Set([...reach].filter((f) => !firstLoad.has(f) && !shared.has(f)));
}

/** The set for a build in `dist/` (the app page's scripts are the first load's entries). */
export function builtViewChunks(dir = path.join(process.cwd(), 'dist')) {
	const astro = path.join(dir, '_astro');
	const sources = Object.fromEntries(
		fs
			.readdirSync(astro)
			.filter((f) => f.endsWith('.js'))
			.map((f) => [f, fs.readFileSync(path.join(astro, f), 'utf8')]),
	);
	return viewChunkSet(sources, fs.readFileSync(path.join(dir, 'app', 'index.html'), 'utf8'));
}

/** The People views' lazy chunks together: how many files and their gzip bytes. */
export function peopleViewsSize(files, viewChunks) {
	const mine = files.filter((f) => viewChunks.has(f.file));
	return {
		files: mine.length,
		gzipBytes: mine.reduce((n, f) => n + f.gzip, 0),
		cap: PEOPLE_VIEWS_CAP,
	};
}

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

async function firstLoad(browser, base, query, viewChunks) {
	return measurePage(await browser.newPage(), base, query, viewChunks);
}

/**
 * A returning visit (phase-4.md 12.1; T4 review M3): a stored plan restores on start. In a fresh
 * context the Tutorial's copy is stored (an edit), that page closes, and a new page of the same
 * context opens `/app?mode=<mode>`, which opens the last plan: what it fetches is measured. It
 * fetches the keeper chunk (the store, the lock, autosave) and not the sample's own module.
 * Reported, not capped: the budget for it is the user's decision.
 */
async function returningLoad(browser, base, mode, viewChunks) {
	const context = await browser.newContext();
	try {
		const first = await context.newPage();
		await first.goto(`${base}/app?sample=upstream-tutorial&mode=text`);
		await first.getByTestId('engine-status').filter({ hasText: 'Engine: Ready' }).waitFor({
			timeout: 180_000,
		});
		await first.getByRole('textbox', { name: /^Editor for / }).click();
		await first.keyboard.press('Control+Home');
		await first.keyboard.insertText('# kept\n');
		// The copy is stored: the address drops ?sample= (App.svelte).
		await first.waitForURL((u) => !u.search.includes('sample='), { timeout: 30_000 });
		await first.close();
		return await measurePage(await context.newPage(), base, `mode=${mode}`, viewChunks);
	} finally {
		await context.close();
	}
}

async function measurePage(page, base, query, viewChunks) {
	const seen = new Map();
	const docs = [];
	page.on('request', (req) => {
		if (/\/tj-docs\.[0-9a-f]{12}\.json\.gz(\?|$)/.test(req.url())) docs.push(req.url());
	});
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
		loadsPeopleChunk: list.some((f) => isViewChunk(f.file) || viewChunks.has(f.file)),
		loadsLazy: list.filter((f) => isLazyChunk(f.file)).map((f) => f.file),
		loadsDocs: docs.length > 0,
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
		const views = builtViewChunks();
		return {
			viewChunks: [...views].sort(),
			visualFirst: await firstLoad(browser, base, 'sample=upstream-tutorial&mode=visual', views),
			textFirst: await firstLoad(browser, base, 'sample=upstream-tutorial&mode=text', views),
			returningVisual: await returningLoad(browser, base, 'visual', views),
			returningText: await returningLoad(browser, base, 'text', views),
		};
	} finally {
		await browser.close();
		server?.closeAllConnections();
		server?.close();
	}
}

const kb = (n) => `${(n / 1000).toFixed(1)} KB`;

/**
 * The budget problems of a measurement (empty when it is within every budget). `loads` is absent
 * with --dist-only. Pure, so it is unit-tested (tests/scripts/js-sizes.test.ts).
 * @param {{ files: { file: string, gzip: number }[], peopleViews?: { gzipBytes: number, cap: number }, loads?: { visualFirst: { gzipBytes: number, loadsEditorChunk: boolean, loadsPeopleChunk?: boolean, loadsLazy?: string[], loadsDocs?: boolean }, textFirst: { gzipBytes: number, loadsEditorChunk: boolean, loadsPeopleChunk?: boolean, loadsLazy?: string[], loadsDocs?: boolean } } }} m
 * @returns {string[]}
 */
export function checkBudgets({ files, loads, peopleViews }) {
	const problems = [];
	const total = files.reduce((n, f) => n + f.gzip, 0);
	if (total > TOTAL_CAP)
		problems.push(`the app's JS is ${total} bytes gzip; the guard is ${TOTAL_CAP}`);
	for (const c of CHUNK_CAPS) {
		const size = files.filter((f) => c.pattern.test(f.file)).reduce((n, f) => n + f.gzip, 0);
		if (size > c.cap)
			problems.push(`the ${c.name} chunk is ${size} bytes gzip; its cap is ${c.cap}`);
	}
	if (peopleViews && peopleViews.gzipBytes > peopleViews.cap)
		problems.push(
			`the People views' chunks are ${peopleViews.gzipBytes} bytes gzip together; the cap is ${peopleViews.cap}`,
		);
	if (loads) {
		const { visualFirst: v, textFirst: t } = loads;
		if (v.gzipBytes > VISUAL_FIRST_CAP)
			problems.push(
				`a Visual-first load fetches ${v.gzipBytes} bytes gzip; the cap is ${VISUAL_FIRST_CAP}`,
			);
		if (t.gzipBytes > TEXT_FIRST_CAP)
			problems.push(
				`a Text-first load fetches ${t.gzipBytes} bytes gzip; the cap is ${TEXT_FIRST_CAP}`,
			);
		if (v.loadsEditorChunk)
			problems.push('a Visual-first load fetched the CodeMirror chunk (it must stay split off)');
		// Only an editor needs the full keyword docs (ADR-0017).
		if (v.loadsDocs)
			problems.push(
				'a Visual-first load requested the keyword docs asset (only an editor loads it)',
			);
		if (!t.loadsEditorChunk)
			problems.push('a Text-first load did not fetch the CodeMirror chunk (the split moved?)');
		// The People views load when one opens, never with a Gantt-first load (phase-3.md 8.3).
		if (v.loadsPeopleChunk || t.loadsPeopleChunk)
			problems.push('a Gantt-first load fetched the People chunk (it must stay lazy)');
		// Export waits for its first use (phase-4.md 12.1).
		const lazy = [...(v.loadsLazy ?? []), ...(t.loadsLazy ?? [])];
		if (lazy.length > 0)
			problems.push(`a first load fetched a chunk that must stay lazy: ${lazy.join(', ')}`);
	}
	return problems;
}

async function main() {
	const files = distScripts(path.join(process.cwd(), 'dist', '_astro'));
	const total = files.reduce((n, f) => n + f.gzip, 0);
	const result = {
		distTotal: { files: files.length, gzipBytes: total, cap: TOTAL_CAP },
		biggest: files.slice(0, 6),
		chunkCaps: CHUNK_CAPS.map((c) => ({
			name: c.name,
			cap: c.cap,
			gzipBytes: files.filter((f) => c.pattern.test(f.file)).reduce((n, f) => n + f.gzip, 0),
		})),
	};
	if (!flag('--dist-only')) {
		Object.assign(result, await measureLoads());
		result.peopleViews = peopleViewsSize(files, new Set(result.viewChunks));
		result.visualFirstCap = VISUAL_FIRST_CAP;
		result.textFirstCap = TEXT_FIRST_CAP;
	}
	const problems = [
		...unmatchedCaps(files),
		...checkBudgets({
			files,
			peopleViews: result.peopleViews,
			loads: result.visualFirst
				? { visualFirst: result.visualFirst, textFirst: result.textFirst }
				: undefined,
		}),
	];
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
		`Total of \`dist/_astro\`: **${kb(total)}** of the ${kb(TOTAL_CAP)} guard (${files.length} files).`,
	];
	if (result.visualFirst) {
		const docs = (l) => (l.loadsDocs ? 'requested' : 'not requested');
		lines.push(
			`First load, Visual mode: **${kb(result.visualFirst.gzipBytes)}** of ${kb(VISUAL_FIRST_CAP)}; keyword docs ${docs(result.visualFirst)}.`,
			`First load, Text mode: **${kb(result.textFirst.gzipBytes)}** of ${kb(TEXT_FIRST_CAP)}; keyword docs ${docs(result.textFirst)}.`,
			`Returning visit (a stored plan restored, not capped), Visual: **${kb(result.returningVisual.gzipBytes)}**; Text: **${kb(result.returningText.gzipBytes)}**.`,
		);
	}
	if (result.peopleViews)
		lines.push(
			`People views, all ${result.peopleViews.files} lazy chunks together: **${kb(result.peopleViews.gzipBytes)}** of ${kb(PEOPLE_VIEWS_CAP)}.`,
		);
	for (const c of result.chunkCaps)
		lines.push(`Lazy chunk ${c.name}: **${kb(c.gzipBytes)}** of ${kb(c.cap)}.`);
	lines.push(
		'',
		'| Chunk | gzip |',
		'| --- | ---: |',
		...files.slice(0, 6).map((f) => `| ${f.file} | ${kb(f.gzip)} |`),
	);
	if (process.env.GITHUB_STEP_SUMMARY)
		fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
	for (const p of problems) console.error(`js-sizes: ${p}`);
	if (problems.length) process.exitCode = 1;
}

// Run only as a script, so the tests can import checkBudgets.
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
