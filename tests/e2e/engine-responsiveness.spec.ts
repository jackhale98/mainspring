// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Gate criterion 2 (phase-0 spec section 9): the UI thread stays responsive, no task over 50 ms,
 * while a 1,000-task plan schedules. Chromium only, against a build with MAINSPRING_DEV_PAGES=1.
 *
 * Per run, in a fresh page: a cold window (from createEngineClient() until the syn-20-scale-1000
 * result is handled, plus two frames) and a warm window (the same plan, a new revision). A CSS
 * and a rAF animation run on the page and the test types into an input every 100 ms. Every run
 * asserts; run 1 also records Chromium traces of both windows. A fourth run with 4x CPU
 * throttling is reported but not asserted. Writes test-results/responsiveness-report.{md,json}.
 *
 * Engine boot (spec section 11, item 18, pending the user's approval at the gate): while V8
 * compiles the 30 MB ruby.wasm, the compile job occupies every renderer thread-pool worker.
 * Compositor raster tasks queue behind it, so a frame that needs new raster (typed text) waits:
 * the main thread is blocked, with about 2 ms of CPU, for up to about 150 ms. No web API limits
 * compile parallelism. So long tasks that end before the worker is ready are reported and capped
 * at BOOT_CAP_MS each, and everything after ready, and the whole warm window, must have none.
 *
 * Run with `npm run test:responsiveness`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadCorpus, planRequest } from '../golden/corpus';
import { maxMainThreadTask } from './lib/trace-max-task';
import { installMonitor, windowStats, type MonitorData } from './lib/responsiveness-monitor';
import {
	renderReport,
	type RunReport,
	type TraceStats,
	type WindowReport,
} from './lib/responsiveness-report';

const PLAN_ID = 'syn-20-scale-1000';
const LIMIT_MS = 50;
/** Cap on each engine-boot long task (see the header): a regression in boot still fails. */
const BOOT_CAP_MS = 250;
/** Event Timing: keystroke to next paint after ready (the INP "good" threshold). */
const EVENT_LIMIT_MS = 100;
const RUNS = 3;
const THROTTLE_RATE = 4;
const TYPE_INTERVAL_MS = 100;
const OUT_DIR = path.resolve('test-results');

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'Responsiveness gates on Chromium only');

const entry = loadCorpus().find((c) => c.plan.id === PLAN_ID);
if (!entry) throw new Error(`corpus has no ${PLAN_ID}`);
const reports: RunReport[] = [];

interface Summary {
	status: string;
	ok: boolean;
	tasks: number;
	bookings: number;
	scheduleMs: number;
	totalMs: number;
	/** performance.now() when the ready message was handled (cold) or the window start (warm). */
	readyAt: number;
	/** performance.now() before the call and after the two frames following it. */
	start: number;
	end: number;
}

/** Schedules through the dev API; returns a small summary so that no big value crosses CDP. */
function scheduleInPage(page: Page, revision: number, awaitReady: boolean): Promise<Summary> {
	const request = planRequest(entry!.plan, entry!.golden, revision);
	return page.evaluate(
		async ({ req, waitReady, cold }) => {
			const api = window.mainspringDev;
			const monitor = window.__monitor;
			if (!api || !monitor)
				throw new Error('dev page is missing; build with MAINSPRING_DEV_PAGES=1');
			// The cold window starts when the page created the client.
			const start = cold
				? (performance.getEntriesByName('mainspring:client-created')[0]?.startTime ?? 0)
				: performance.now();
			if (waitReady) await api.ready();
			// Cold: the page marks the moment the worker's ready message was handled. Warm: start.
			const readyAt = cold
				? (performance.getEntriesByName('mainspring:ready')[0]?.startTime ?? performance.now())
				: start;
			const outcome = await api.schedule(req);
			const end = await monitor.twoFrames();
			if (outcome.status !== 'done') {
				return {
					status: outcome.status,
					ok: false,
					tasks: 0,
					bookings: 0,
					scheduleMs: 0,
					totalMs: 0,
					readyAt,
					start,
					end,
				};
			}
			const r = outcome.result;
			return {
				status: 'done',
				ok: r.ok,
				tasks: r.tasks.length,
				bookings: r.bookings.length,
				scheduleMs: r.timings.scheduleMs,
				totalMs: r.timings.totalMs,
				readyAt,
				start,
				end,
			};
		},
		{ req: request, waitReady: awaitReady, cold: awaitReady },
	);
}

/** Types into the probe input every 100 ms until stopped. */
function startTyping(page: Page): () => Promise<void> {
	let stopped = false;
	const loop = (async () => {
		await page.focus('[data-testid="probe"]');
		while (!stopped) {
			await page.keyboard.press('a').catch(() => undefined);
			await new Promise((r) => setTimeout(r, TYPE_INTERVAL_MS));
		}
	})();
	return async () => {
		stopped = true;
		await loop;
	};
}

interface RunOptions {
	label: string;
	throttle?: number;
	/** Record Chromium traces (cold and warm windows) with this file name prefix. */
	tracePrefix?: string;
}

async function startTrace(page: Page, file: string): Promise<void> {
	await page
		.context()
		.browser()!
		.startTracing(page, { path: file, categories: ['devtools.timeline', 'toplevel'] });
}

function readTrace(file: string): TraceStats {
	const t = maxMainThreadTask(JSON.parse(readFileSync(file, 'utf8')));
	return {
		maxMs: t.maxMs,
		maxCpuMs: t.maxCpuMs,
		longestCpuMs: t.longestCpuMs,
		taskCount: t.taskCount,
		file: path.relative(process.cwd(), file),
	};
}

async function measure(page: Page, opts: RunOptions): Promise<RunReport> {
	if (opts.throttle) {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
	}
	const coldFile = `${opts.tracePrefix}-cold.json`;
	const warmFile = `${opts.tracePrefix}-warm.json`;
	await page.addInitScript(installMonitor);
	if (opts.tracePrefix) await startTrace(page, coldFile);
	await page.goto('/dev/engine');
	await page.waitForFunction(() => window.__monitor !== undefined && !!window.mainspringDev);
	const stopTyping = startTyping(page);
	try {
		const cold = await scheduleInPage(page, 1, true);
		if (opts.tracePrefix) {
			await page.context().browser()!.stopTracing();
			await startTrace(page, warmFile);
		}
		const warm = await scheduleInPage(page, 2, false);
		if (opts.tracePrefix) await page.context().browser()!.stopTracing();
		const data = await page.evaluate<MonitorData>(() => ({
			longTasks: window.__monitor!.longTasks,
			frames: window.__monitor!.frames,
			events: window.__monitor!.events,
			keys: window.__monitor!.keys,
		}));
		const window_ = (s: Summary): WindowReport => {
			const stats = windowStats(data, s.start, s.end);
			const afterReady = windowStats(data, s.readyAt, s.end);
			// A boot long task ended before the ready message was handled. The task that delivers
			// ready runs the handler, so it ends after the mark and counts as post-ready.
			const boot = stats.longTasks.filter((t) => t.start + t.duration <= s.readyAt);
			return {
				...s,
				...stats,
				windowMs: s.end - s.start,
				bootLongTasks: boot,
				scheduleLongTasks: stats.longTasks.filter((t) => !boot.includes(t)),
				afterReadyMaxEventMs: afterReady.maxEventMs,
				afterReadyMaxInputDelayMs: afterReady.maxInputDelayMs,
			};
		};
		return {
			label: opts.label,
			throttle: opts.throttle ?? 1,
			cold: window_(cold),
			warm: window_(warm),
			traceCold: opts.tracePrefix ? readTrace(coldFile) : null,
			traceWarm: opts.tracePrefix ? readTrace(warmFile) : null,
		};
	} finally {
		await stopTyping();
	}
}

/** Checks shared by both windows. */
function expectResult(w: WindowReport, name: string): void {
	expect(w.status, `${name}: outcome`).toBe('done');
	expect(w.ok, `${name}: result.ok`).toBe(true);
	expect(w.tasks, `${name}: task count`).toBeGreaterThanOrEqual(1000);
	expect(w.scheduleMs, `${name}: worker scheduleMs`).toBeGreaterThanOrEqual(1000);
	expect(w.keyCount, `${name}: typed keys seen`).toBeGreaterThan(0);
}

test.beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));

test.afterAll(() => {
	if (reports.length === 0) return;
	writeFileSync(
		path.join(OUT_DIR, 'responsiveness-report.json'),
		JSON.stringify(reports, null, '\t'),
	);
	writeFileSync(
		path.join(OUT_DIR, 'responsiveness-report.md'),
		renderReport(reports, LIMIT_MS, BOOT_CAP_MS, EVENT_LIMIT_MS),
	);
});

for (let run = 1; run <= RUNS; run++) {
	test(`run ${run}: no task over ${LIMIT_MS} ms while ${PLAN_ID} schedules`, async ({
		browser,
	}) => {
		test.setTimeout(300_000);
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			// Run 1 is traced; tracing slows the page a little, so runs 2 and 3 are not.
			const tracePrefix = run === 1 ? path.join(OUT_DIR, 'responsiveness-trace') : undefined;
			const report = await measure(page, {
				label: `run ${run}`,
				...(tracePrefix ? { tracePrefix } : {}),
			});
			reports.push(report);
			expectResult(report.cold, 'cold');
			expectResult(report.warm, 'warm');
			// Warm: every long task counts. Cold: see the header (engine boot).
			expect(report.warm.longTasks, `warm: longtask entries (over ${LIMIT_MS} ms)`).toEqual([]);
			expect(report.cold.scheduleLongTasks, 'cold, after ready: longtask entries').toEqual([]);
			for (const t of report.cold.bootLongTasks) {
				expect(t.duration, `cold, boot: long task at ${t.start.toFixed(0)} ms`).toBeLessThanOrEqual(
					BOOT_CAP_MS,
				);
			}
			expect(
				report.warm.maxEventMs,
				'warm: longest Event Timing duration (ms)',
			).toBeLessThanOrEqual(EVENT_LIMIT_MS);
			expect(
				report.cold.afterReadyMaxEventMs,
				'cold, after ready: longest Event Timing duration (ms)',
			).toBeLessThanOrEqual(EVENT_LIMIT_MS);
			const warmTrace = report.traceWarm;
			if (warmTrace) {
				expect(warmTrace.taskCount, 'warm trace: main-thread tasks found').toBeGreaterThan(0);
				expect(warmTrace.maxMs, 'warm trace: longest main-thread task (ms)').toBeLessThanOrEqual(
					LIMIT_MS,
				);
			}
			const coldTrace = report.traceCold;
			if (coldTrace) {
				// Evidence for the boot mechanism: the longest cold task was blocked, not busy.
				// A trace without thread CPU times cannot show that, so it fails instead of passing.
				expect(coldTrace.longestCpuMs, 'cold trace: CPU time of the longest task').not.toBeNull();
				expect(
					coldTrace.longestCpuMs ?? Infinity,
					'cold trace: CPU time of the longest main-thread task (ms)',
				).toBeLessThanOrEqual(LIMIT_MS);
			}
		} finally {
			await context.close();
		}
	});
}

test(`throttled ${THROTTLE_RATE}x CPU run (reported, not asserted)`, async ({ browser }) => {
	test.setTimeout(600_000);
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		reports.push(
			await measure(page, { label: `throttled ${THROTTLE_RATE}x`, throttle: THROTTLE_RATE }),
		);
	} finally {
		await context.close();
	}
});
