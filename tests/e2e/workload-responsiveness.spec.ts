// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The responsiveness rule of phase-3.md 8.3, extended to `fedora-res` with the Workload view open
 * (13.3, the `responsiveness` job): after the engine is ready, no main-thread task over 50 ms while
 * the first result is handled and the derived work runs (the Gantt's analysis, the load model, the
 * demand and the health checks, each in its own idle task). Chromium desktop only, one worker, no
 * Playwright trace: playwright.responsiveness.config.ts runs it with engine-responsiveness.spec.ts,
 * and playwright.config.ts leaves it out (testIgnore), as it does that one.
 *
 * Engine boot is not judged here: while V8 compiles the 30 MB ruby.wasm the compile job occupies the
 * renderer's thread pool and a long task can show up with no CPU in it (engine-responsiveness.spec.ts
 * explains); boot tasks are only reported here (engine-responsiveness.spec.ts caps them). A run at 4x CPU throttling is reported, not asserted.
 * Writes test-results/workload-responsiveness.json with the device, browser and build.
 */
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS } from './lib/gantt-rig';
import { perfEnvironment, recordInto } from './lib/perf-env';
import { installMonitor, splitByReady, type LongTaskRecord } from './lib/responsiveness-monitor';
import { appSettled, frames } from './lib/settle';
import { traceEventsOf } from './lib/trace-max-task';

const LIMIT_MS = 50;
const RUNS = 3;

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'Responsiveness gates on Chromium only');
test.setTimeout(READY_TIMEOUT_MS * 3);

interface Report {
	label: string;
	readyAt: number;
	endAt: number;
	bootLongTasks: LongTaskRecord[];
	afterReady: LongTaskRecord[];
	measures: Record<string, number[]>;
	/**
	 * The main thread's tasks over the limit in a Chromium trace of the whole page life, longest
	 * first: wall time and thread CPU time. A task far longer in wall than in CPU time was waiting
	 * for the machine (this audit ran on a shared one), not computing.
	 */
	slowTasks: Array<{ wallMs: number; cpuMs: number | null }>;
}

async function run(page: Page, label: string, throttle: number): Promise<Report> {
	await page.addInitScript(installMonitor);
	// The moment the status turns "Engine: Ready", on the page's own clock.
	await page.addInitScript(() => {
		const w = window as unknown as { __readyAt?: number };
		const look = (): void => {
			const el = document.querySelector('[data-testid="engine-status"]');
			if (w.__readyAt === undefined && el?.textContent === 'Engine: Ready')
				w.__readyAt = performance.now();
		};
		new MutationObserver(look).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	});
	if (throttle > 1) {
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
	}
	const browser = page.context().browser();
	await browser?.startTracing(page, { categories: ['devtools.timeline', 'toplevel'] });
	await page.goto('/app?sample=fedora-res&mode=visual&view=workload&hooks=edits,workload');
	await appSettled(page);
	await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: 60_000 });
	// The derived work of the first result: the health check is the last of the idle tasks (8.3).
	await expect
		.poll(
			() => page.evaluate(() => performance.getEntriesByName('mainspring:health-check').length),
			{
				timeout: READY_TIMEOUT_MS,
			},
		)
		.toBeGreaterThan(0);
	await frames(page, 30);
	const data = await page.evaluate(() => ({
		readyAt: (window as unknown as { __readyAt?: number }).__readyAt ?? 0,
		endAt: performance.now(),
		longTasks: window.__monitor?.longTasks ?? [],
		measures: Object.fromEntries(
			['gantt-analysis', 'workload-load', 'workload-demand', 'health-check', 'runner-task'].map(
				(n) => [
					n,
					performance
						.getEntriesByName(`mainspring:${n}`)
						.map((e) => Math.round(e.duration * 10) / 10),
				],
			),
		),
	}));
	expect(data.readyAt, 'the page saw the engine ready').toBeGreaterThan(0);
	const raw = (await browser?.stopTracing())?.toString() ?? '{"traceEvents":[]}';
	// Kept beside the report, for the first run and the throttled one: the slow tasks are looked up
	// in it (about 15 MB each).
	if (label === 'run 1' || label === '4x') {
		fs.mkdirSync('test-results', { recursive: true });
		fs.writeFileSync(
			`test-results/workload-responsiveness-trace-${label.replace(/\W+/g, '-')}.json`,
			raw,
		);
	}
	const trace = JSON.parse(raw);
	const events = traceEventsOf(trace);
	const mains = new Set(
		events
			.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
			.map((e) => `${e.pid}:${e.tid}`),
	);
	const slowTasks = events
		.filter(
			(e) =>
				e.ph === 'X' &&
				(e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') &&
				mains.has(`${e.pid}:${e.tid}`) &&
				(e.dur ?? 0) > LIMIT_MS * 1000,
		)
		.map((e) => ({
			wallMs: Math.round((e.dur ?? 0) / 100) / 10,
			cpuMs: e.tdur === undefined ? null : Math.round(e.tdur / 100) / 10,
		}))
		.sort((a, b) => b.wallMs - a.wallMs)
		.slice(0, 10);
	const split = splitByReady(data.longTasks, data.readyAt);
	return {
		label,
		readyAt: data.readyAt,
		endAt: data.endAt,
		bootLongTasks: split.boot,
		afterReady: split.afterReady,
		measures: data.measures,
		slowTasks,
	};
}

for (let i = 1; i <= RUNS; i++) {
	test(`fedora-res with the Workload view open: no task over ${LIMIT_MS} ms after the engine is ready (run ${i})`, async ({
		page,
	}, info) => {
		const report = await run(page, `run ${i}`, 1);
		recordInto('workload-responsiveness.json', `run${i}`, {
			environment: await perfEnvironment(page, info),
			...report,
		});
		console.log('workload responsiveness', JSON.stringify(report));
		// A long task counts when it was busy: its thread CPU time (from the trace, matched by wall
		// time) is over the limit itself (on a quiet machine wall and CPU time are the same). One far longer in wall than in CPU time waited for the
		// machine or for V8's compile job (the header of engine-responsiveness.spec.ts); the list
		// above keeps it. A long task the trace cannot match counts.
		const busy = report.afterReady.filter((t) => {
			if (t.duration <= LIMIT_MS) return false;
			// The Long Tasks API and the trace round differently: the nearest within 10 ms is the same task.
			const m = [...report.slowTasks]
				.sort((a, b) => Math.abs(a.wallMs - t.duration) - Math.abs(b.wallMs - t.duration))
				.find((s) => Math.abs(s.wallMs - t.duration) <= 10);
			return !m || m.cpuMs === null || m.cpuMs >= LIMIT_MS;
		});
		expect(busy, `busy long tasks after ready: ${JSON.stringify(report.afterReady)}`).toEqual([]);
	});
}

test('the same at 4x CPU throttling (reported, not asserted)', async ({ page }, info) => {
	const report = await run(page, '4x', 4);
	recordInto('workload-responsiveness.json', 'throttled4x', {
		environment: await perfEnvironment(page, info, 4),
		...report,
	});
	console.log('workload responsiveness (4x)', JSON.stringify(report));
});
