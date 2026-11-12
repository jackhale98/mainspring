// SPDX-License-Identifier: GPL-2.0-or-later
// Browser timings of Text mode for the Phase 1 gate (phase-1.md 8.4, T21; BUILD_PLAN.md
// "Performance budgets"). Desktop Chrome only. Every number is printed, attached to the report and
// written to test-results/text-mode-perf.json with the browser, build and machine it came from;
// docs/phases/phase-1-audit.md quotes that file.
//
// What is measured
// - Keystroke to paint with Fedora 20 open (414 tasks) and with the 1,000-task `scale-1000` plan
//   pasted in (5,628 lines). Per key, the Event Timing interaction latency (the longest of the
//   key's keydown, keypress, beforeinput, input and keyup events, from the event's timestamp to the
//   next paint; durations are rounded to 8 ms and events under 16 ms are not reported, so an
//   unreported key counts as 16 ms, an upper bound). Also a frame measure (keydown to the first task
//   after the next animation frame), long tasks, and the same Fedora run with the CPU throttled 4x
//   as a stand-in for a mid-range phone. Each case is three rounds on fresh pages, 60 keys a round.
// - Cold load: time to first contentful paint (the app shell budget is 1.5 s), to the engine leaving
//   `booting` (engine ready, budget 4 s) and to the first schedule result, in fresh browser
//   contexts; and the JavaScript the page fetches, raw and gzipped.
// The Node timings of 8.4 (parse, reparse, index, intents) are in tests/perf/.
//
// Enforced here: only things that do not depend on the machine (JavaScript size) and generous caps
// that catch a regression of an order of magnitude, never the budgets themselves; GitHub runners
// are too noisy for a 50 ms or a 1.5 s limit. Everything else is recorded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const ROUNDS = 3;
const KEYS = 60;
/** Between keys. Below the runner's typing pause (150 ms), so the index refresh waits; see SLOW_GAP_MS. */
const GAP_MS = 90;
/** A slow typist: longer than the typing pause, so the index refresh runs between keys. */
const SLOW_GAP_MS = 200;
const COLD_RUNS = 5;
const EDITOR = /^Editor for /;

/** Caps. Sizes are exact; times are about ten times the budgets. */
const MAX_JS_GZIP_BYTES = 450_000;
const MAX_FCP_MS = 15_000;
const MAX_ENGINE_READY_MS = 60_000;
const MAX_KEY_P50_MS = 100;

interface Samples {
	interactions: Record<string, number>;
	frames: number[];
	longTasks: number[];
}

declare global {
	interface Window {
		__perf?: Samples;
		__engine?: Record<string, number>;
	}
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function summary(values: readonly number[]) {
	return {
		count: values.length,
		p50: percentile(values, 50),
		p90: percentile(values, 90),
		max: Math.max(0, ...values),
	};
}

async function scheduled(page: Page): Promise<void> {
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText(
		/Scheduled|Scheduled with problems/,
		{ timeout: READY_TIMEOUT_MS },
	);
}

/** Waits for the run that follows an edit: scheduling starts, then the strip shows a result. */
async function settled(page: Page): Promise<void> {
	const state = page.getByRole('group', { name: 'Plan status' }).locator('.state');
	await expect(state).toHaveAttribute('data-kind', 'scheduling', { timeout: 10_000 });
	await expect(state).not.toHaveAttribute('data-kind', 'scheduling', { timeout: READY_TIMEOUT_MS });
}

/** Types `KEYS` keys at the end of the open file and returns what the page observed. */
async function typeAndObserve(page: Page, gap: number): Promise<Samples & { reported: number }> {
	await page.evaluate(() => {
		const perf: Samples = { interactions: {}, frames: [], longTasks: [] };
		window.__perf = perf;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				const id = (e as PerformanceEventTiming).interactionId;
				if (!id) continue;
				perf.interactions[id] = Math.max(perf.interactions[id] ?? 0, e.duration);
			}
		}).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) perf.longTasks.push(e.duration);
		}).observe({ type: 'longtask' });
		document.addEventListener(
			'keydown',
			(e) => {
				const start = e.timeStamp;
				requestAnimationFrame(() =>
					setTimeout(() => perf.frames.push(performance.now() - start), 0),
				);
			},
			true,
		);
	});
	// A new comment line at the end, so the typing never makes a syntax error.
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('\n# ');
	await page.waitForTimeout(1500);
	await page.evaluate(() => {
		if (window.__perf) window.__perf.interactions = {};
	});
	for (let i = 0; i < KEYS; i++) {
		await page.keyboard.press(i % 7 === 6 ? 'Space' : 'KeyA');
		await page.waitForTimeout(gap);
	}
	await page.waitForTimeout(500);
	const perf = await page.evaluate(
		() => window.__perf ?? { interactions: {}, frames: [], longTasks: [] },
	);
	return { ...perf, reported: Object.keys(perf.interactions).length };
}

type Open = (page: Page) => Promise<void>;

async function openFedora(page: Page): Promise<void> {
	await page.goto('/app?sample=upstream-fedora-20');
	await scheduled(page);
	await page.getByRole('textbox', { name: EDITOR }).click();
}

async function openScale1000(page: Page): Promise<void> {
	const text = fs.readFileSync(
		path.join(REPO, 'engine/golden/plans/synthetic/20-scale-1000/plan.tjp'),
		'utf8',
	);
	await page.goto('/app');
	await scheduled(page);
	const editor = page.getByRole('textbox', { name: EDITOR });
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	// One paste event with the whole file, as a user pasting a plan would send it.
	await page.evaluate((t) => {
		const data = new DataTransfer();
		data.setData('text/plain', t);
		document
			.querySelector('.cm-content')
			?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
			);
	}, text);
	// The cursor ends after the pasted text, so the end of the file is what shows.
	await expect(editor).toContainText('task t3_4_9_4 "Item 3.4.9.4"');
	await settled(page);
}

async function keystrokes(
	browser: Browser,
	baseURL: string,
	open: Open,
	cpuSlowdown = 1,
	gap = GAP_MS,
) {
	const interactions: number[] = [];
	const frames: number[] = [];
	const longTasks: number[] = [];
	let keys = 0;
	let reported = 0;
	for (let round = 0; round < ROUNDS; round++) {
		const context = await browser.newContext({ baseURL });
		const page = await context.newPage();
		if (cpuSlowdown > 1) {
			const cdp = await context.newCDPSession(page);
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
		}
		await open(page);
		const r = await typeAndObserve(page, gap);
		await context.close();
		keys += KEYS;
		reported += r.reported;
		interactions.push(...Object.values(r.interactions));
		frames.push(...r.frames);
		longTasks.push(...r.longTasks);
	}
	// Keys with no event report took under 16 ms; count them as 16 (an upper bound).
	const all = [...interactions, ...Array<number>(Math.max(0, keys - reported)).fill(16)];
	return {
		keys,
		reportedKeys: reported,
		cpuSlowdown,
		gapMs: gap,
		interaction: summary(all),
		frames: summary(frames),
		longTasks: summary(longTasks),
	};
}

async function coldLoad(context: BrowserContext) {
	const page = await context.newPage();
	const js: Array<{ url: string; raw: number; gzip: number }> = [];
	page.on('response', (res) => {
		if (!/\.m?js(\?|$)/.test(res.url())) return;
		void res
			.body()
			.then((b) => {
				js.push({
					url: new URL(res.url()).pathname,
					raw: b.length,
					gzip: zlib.gzipSync(b, { level: 9 }).length,
				});
			})
			.catch(() => {});
	});
	await page.addInitScript(() => {
		const marks: Record<string, number> = {};
		window.__engine = marks;
		const watch = () => {
			const el = document.querySelector('[data-testid="engine-status"]');
			if (!el) return false;
			const note = () => {
				const s = el.getAttribute('data-state') ?? '';
				if (!(s in marks)) marks[s] = performance.now();
			};
			note();
			new MutationObserver(note).observe(el, { attributes: true, attributeFilter: ['data-state'] });
			return true;
		};
		const t = setInterval(() => watch() && clearInterval(t), 5);
	});
	await page.goto('/app');
	await scheduled(page);
	const t = await page.evaluate(() => {
		const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
		const fcp = performance.getEntriesByName('first-contentful-paint')[0];
		return {
			fcp: fcp?.startTime ?? 0,
			domContentLoaded: nav.domContentLoadedEventEnd,
			load: nav.loadEventEnd,
			engine: window.__engine ?? {},
			scheduledAt: performance.now(),
		};
	});
	await page.waitForTimeout(300);
	await context.close();
	return { ...t, js };
}

test.describe('text mode performance', () => {
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name !== 'desktop', 'desktop Chrome only (spec 8.4)');
	});
	test.describe.configure({ mode: 'serial' });
	test.setTimeout(READY_TIMEOUT_MS * 3);

	const results: Record<string, unknown> = {};

	test.afterAll(({ browser }) => {
		const file = path.join(REPO, 'test-results', 'text-mode-perf.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const meta = {
			recordedAt: new Date().toISOString(),
			browser: browser?.version() ?? 'unknown',
			machine: `${os.cpus()[0]?.model ?? 'cpu'} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GiB, ${os.platform()} ${os.release()}`,
			loadAverage1m: os.loadavg()[0],
			node: process.version,
			ci: !!process.env['CI'],
			commit: process.env['GITHUB_SHA'] ?? null,
		};
		fs.writeFileSync(file, JSON.stringify({ meta, ...results }, null, 2));
	});

	test('cold load: app shell, engine ready, JavaScript size', async ({
		browser,
		baseURL,
	}, info) => {
		const runs = [];
		for (let i = 0; i < COLD_RUNS; i++) {
			runs.push(await coldLoad(await browser.newContext(baseURL ? { baseURL } : {})));
		}
		const fcp = runs.map((r) => r.fcp);
		const booted = runs.map((r) => r.engine['idle'] ?? r.engine['busy'] ?? 0);
		const scheduledAt = runs.map((r) => r.scheduledAt);
		const first = runs[0]?.js ?? [];
		const js = {
			files: [...first].sort((a, b) => b.raw - a.raw),
			rawBytes: first.reduce((n, f) => n + f.raw, 0),
			gzipBytes: first.reduce((n, f) => n + f.gzip, 0),
		};
		const r = {
			runs: COLD_RUNS,
			firstContentfulPaintMs: summary(fcp),
			domContentLoadedMs: summary(runs.map((x) => x.domContentLoaded)),
			engineLeavesBootingMs: summary(booted),
			firstScheduleShownMs: summary(scheduledAt),
			engineStates: runs[0]?.engine,
			js,
		};
		results['coldLoad'] = r;
		console.log('cold load', JSON.stringify({ ...r, js: { ...js, files: js.files.length } }));
		await info.attach('perf-cold-load', {
			body: JSON.stringify(r),
			contentType: 'application/json',
		});
		expect(js.gzipBytes).toBeLessThan(MAX_JS_GZIP_BYTES);
		expect(r.firstContentfulPaintMs.p90).toBeLessThan(MAX_FCP_MS);
		expect(r.firstScheduleShownMs.p90).toBeLessThan(MAX_ENGINE_READY_MS);
	});

	const CASES: Array<[string, string, Open, number, number]> = [
		['upstream-fedora-20', 'Fedora 20 sample (414 tasks)', openFedora, 1, GAP_MS],
		['upstream-fedora-20-cpu4x', 'Fedora 20 sample, CPU throttled 4x', openFedora, 4, GAP_MS],
		[
			'syn-20-scale-1000',
			'scale-1000 pasted in (1,000 tasks, 5,628 lines)',
			openScale1000,
			1,
			GAP_MS,
		],
		[
			'syn-20-scale-1000-gap200',
			`scale-1000 pasted in, a key every ${SLOW_GAP_MS} ms`,
			openScale1000,
			1,
			SLOW_GAP_MS,
		],
	];
	for (const [key, title, open, slowdown, gap] of CASES) {
		test(`keystroke to paint: ${title}`, async ({ browser, baseURL }, info) => {
			const r = await keystrokes(browser, baseURL ?? 'http://localhost:4321/', open, slowdown, gap);
			results[key] = r;
			console.log(key, JSON.stringify(r));
			await info.attach(`perf-${key}`, {
				body: JSON.stringify(r),
				contentType: 'application/json',
			});
			expect(r.frames.count).toBeGreaterThan(KEYS);
			if (slowdown === 1) expect(r.interaction.p50).toBeLessThan(MAX_KEY_P50_MS);
		});
	}
});
