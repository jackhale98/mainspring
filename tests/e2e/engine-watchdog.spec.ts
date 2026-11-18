// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine client's reply watchdog against the real worker, on /dev/engine (a build with
 * MAINSPRING_DEV_PAGES=1). Ruby runs a request synchronously, so the worker sends `progress` from
 * inside the run (engine/bridge/progress.rb) and the client restarts its countdown on each one.
 *
 * - A long run (fedora-res) reports progress while it runs: the page receives beats while the
 *   worker is still busy, not only with the result. Before the beats, a slow engine (WebKit under
 *   load) went silent for the whole run and was terminated at 60 s.
 * - A run that stops advancing is still terminated. The plan nests macros 16 deep, two calls per
 *   level; TaskJuggler expands them inside one line, which passes no beat site and would run for
 *   hours. With `?timeoutMs=4000` it fails with kind `timeout` one watchdog period after the
 *   worker's last message, and the restarted worker schedules the next request.
 */
import { expect, test, type Page } from '@playwright/test';
import { loadCorpus, planRequest } from '../golden/corpus';
import type { ScheduleRequest } from '../../src/engine/protocol';

declare global {
	interface Window {
		/** [performance.now() when the page received it, message type], per worker message. */
		__workerMessages?: Array<[number, string]>;
	}
}

const WATCHDOG_MS = 4000;

/** Wraps `Worker` so that every message the page receives from a worker is recorded. */
function recordWorkerMessages(): void {
	const Base = window.Worker;
	const log: Array<[number, string]> = [];
	window.__workerMessages = log;
	window.Worker = class extends Base {
		constructor(url: string | URL, options?: WorkerOptions) {
			super(url, options);
			this.addEventListener('message', (event: MessageEvent<{ type?: unknown }>) => {
				log.push([performance.now(), String(event.data?.type)]);
			});
		}
	};
}

async function openEngine(page: Page, query = ''): Promise<void> {
	await page.addInitScript(recordWorkerMessages);
	await page.goto(`/dev/engine/${query}`);
	await page.waitForFunction(() => window.mainspringDev !== undefined);
	await page.evaluate(() => window.mainspringDev?.ready());
}

function hangRequest(revision: number): ScheduleRequest {
	const lines = ['macro m0 [x]'];
	for (let i = 1; i <= 16; i++) lines.push(`macro m${i} [\${m${i - 1}}\${m${i - 1}}]`);
	lines.push('project p "P" 2026-01-05 +1m', 'task t "T" { note "${m16}" }', '');
	return { files: { 'plan.tjp': lines.join('\n') }, entry: 'plan.tjp', revision };
}

function smallRequest(revision: number): ScheduleRequest {
	const text = 'project p "P" 2026-01-05 +1m\ntask t "T" { duration 1d }\n';
	return { files: { 'plan.tjp': text }, entry: 'plan.tjp', revision };
}

test('a long schedule reports progress while it runs', async ({ page }) => {
	test.setTimeout(240_000);
	const fedora = loadCorpus().find((c) => c.plan.id === 'fedora-res');
	if (!fedora) throw new Error('no golden fedora-res');
	await openEngine(page);
	const run = await page.evaluate(
		async (request) => {
			const log = window.__workerMessages ?? [];
			log.length = 0;
			const start = performance.now();
			const outcome = await window.mainspringDev!.schedule(request);
			const end = performance.now();
			const beats = log.filter(([, type]) => type === 'progress').map(([at]) => at - start);
			const times = [0, ...log.map(([at]) => at - start), end - start];
			const silences = times.slice(1).map((t, i) => t - (times[i] ?? 0));
			return {
				status: outcome.status,
				ok: outcome.status === 'done' && outcome.result.ok,
				ms: Math.round(end - start),
				beats: beats.length,
				firstBeat: Math.round(beats[0] ?? Number.POSITIVE_INFINITY),
				longestSilence: Math.round(Math.max(...silences)),
			};
		},
		planRequest(fedora.plan, fedora.golden, 1),
	);
	test.info().annotations.push({
		type: 'fedora-res',
		description: `${run.ms} ms, ${run.beats} beats, longest silence ${run.longestSilence} ms`,
	});
	expect(run).toMatchObject({ status: 'done', ok: true });
	expect(run.beats).toBeGreaterThanOrEqual(1);
	// Received while the worker was still running, well before the result.
	expect(run.firstBeat).toBeLessThan(run.ms - 500);
});

test('a worker that stops advancing is still terminated', async ({ page }) => {
	test.setTimeout(120_000);
	await openEngine(page, `?timeoutMs=${WATCHDOG_MS}`);
	const out = await page.evaluate(
		async ({ hang, small }) => {
			const api = window.mainspringDev!;
			const log = window.__workerMessages ?? [];
			log.length = 0;
			const outcome = await api.schedule(hang);
			const failedAt = performance.now();
			const last = log.at(-1)?.[0] ?? failedAt;
			const next = await api.schedule(small);
			return {
				status: outcome.status,
				kind: outcome.status === 'failed' ? outcome.error.kind : null,
				sinceLast: Math.round(failedAt - last),
				next: next.status === 'done' && next.result.ok ? 'scheduled' : next.status,
			};
		},
		{ hang: hangRequest(1), small: smallRequest(2) },
	);
	test.info().annotations.push({
		type: 'hang',
		description: `terminated ${out.sinceLast} ms after the worker's last message`,
	});
	expect(out).toMatchObject({ status: 'failed', kind: 'timeout', next: 'scheduled' });
	expect(out.sinceLast).toBeGreaterThanOrEqual(WATCHDOG_MS - 50);
	expect(out.sinceLast).toBeLessThan(WATCHDOG_MS + 3000);
});
