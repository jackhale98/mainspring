// SPDX-License-Identifier: GPL-2.0-or-later
// Where the time of an end-to-end test goes (ADR-0016 change 4): records, per project, what one page
// open costs from navigation to a scheduled plan, and what a second schedule in the same page costs.
// It only measures and asserts nothing about budgets. Opt-in: ENGINE_COST=1 (it takes minutes on
// WebKit, so the timing job does not pay for it unless asked). Tagged @timing, so the merge tier
// never runs it.
//
//   ENGINE_COST=1 npx playwright test engine-cost --workers=1 --project=desktop
//   ENGINE_COST_N=3            opens per plan (default 3), each in a fresh context like a real test
//   ENGINE_COST_PLANS=a,b      a subset of the plans
//   ENGINE_COST_OUT=<file>     appends one JSON line per open (default: an attachment only)
//   ENGINE_COST_MAX_LOAD=<n>   waits up to two minutes for the one-minute load average to be <= n
//
// Per open: navigation to first paint and to the mounted shell, the worker's `ready` and `bootMs`,
// the first result's `timings` and the status showing it, the Gantt, Rig.open's zoom step, then one
// edit (`size-step` through the edit hook) and its schedule. Page probes (a wrapped `Worker`, a
// status observer) change nothing the app does. The last two tests reopen in one context; the second
// prepends a timer to the worker script (page.route: fetches, compile, instantiate) and ends in a new
// context. Routing disables Chromium's HTTP cache, so only that test routes.
//
// The "first edit" opens (ADR-0017) dispatch the edit as soon as the plan shows "Scheduled", not
// after "Engine: Ready": `firstEdit.queueWait` is the time from the dispatch to the result for that
// revision, minus the run's own `timings.totalMs`, which is what the edit waited for a busy worker.
// No fixed waits (scripts/ci/fixed-waits.mjs): the zoom step waits for the chart to hold still, as
// Rig.open does, and ENGINE_COST_MAX_LOAD sleeps in Node, not in the page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	expect,
	test,
	type Browser,
	type BrowserContextOptions,
	type Page,
	type TestInfo,
} from '@playwright/test';
import type { GanttAction } from '../../src/lib/gantt/intents';
import { settledValue } from './lib/settle';

const N = Math.max(1, Number(process.env['ENGINE_COST_N'] ?? '3'));
const OUT = process.env['ENGINE_COST_OUT'] ?? '';
const WAIT_MS = 300_000;

/** The plans, smallest first, and a leaf whose size the edit steps by one unit. */
const ONLY = process.env['ENGINE_COST_PLANS']?.split(',') ?? null;
const PLANS: readonly { sample: string; task: string }[] = [
	{ sample: 'ui-basic', task: 'design.sketch' },
	{ sample: 'gantt-manipulation', task: 'design.research' },
	{ sample: 'gantt-500', task: 'p0.p0k0.t1' },
	{ sample: 'fedora-res', task: 'f20.PlanningPhase.clean_market_wiki' },
].filter((p) => !ONLY || ONLY.includes(p.sample));

interface Recv {
	t: number;
	type: string;
	bootMs?: number;
	revision?: number;
	timings?: Record<string, unknown>;
	tasks?: number | undefined;
}
interface PageProbe {
	workers: { t: number; url: string }[];
	recv: Recv[];
	sent: { t: number; type: string; revision: number | null }[];
	status: { t: number; text: string }[];
	revisions: { t: number; revision: number | null }[];
	/** The `engine-status` line ("Engine: Ready" is idle: booted and the first run back). */
	engine: { t: number; text: string }[];
	/** Gaps of over 100 ms between animation frames: the page's main thread was busy. */
	stalls: { t: number; ms: number }[];
	shell: number | null;
}
interface WorkerProbe {
	t0: number;
	fetches: { url: string; s: number; h?: number; e?: number; bytes?: number }[];
	compile: { s: number; e: number; bytes: number }[];
	instantiate: { s: number; e: number }[];
	posts: { type: string; t: number }[];
}

/** Runs in the page before any of its scripts: records the engine's messages and the status. */
function installPageProbe(): void {
	const p: PageProbe = {
		workers: [],
		recv: [],
		sent: [],
		status: [],
		revisions: [],
		engine: [],
		stalls: [],
		shell: null,
	};
	(window as unknown as { __ecProbe: PageProbe }).__ecProbe = p;
	const Base = window.Worker;
	class Probed extends Base {
		constructor(url: string | URL, options?: WorkerOptions) {
			super(url, options);
			p.workers.push({ t: performance.now(), url: String(url) });
			this.addEventListener('message', (event: MessageEvent<unknown>) => {
				const d = event.data as Record<string, unknown> | null;
				if (!d || typeof d !== 'object' || d['type'] === 'progress') return;
				const r: Recv = { t: performance.now(), type: String(d['type']) };
				if (typeof d['bootMs'] === 'number') r.bootMs = d['bootMs'];
				const result = d['result'] as Record<string, unknown> | undefined;
				if (d['type'] === 'scheduled' && result) {
					r.revision = result['revision'] as number;
					r.timings = result['timings'] as Record<string, unknown>;
					r.tasks = Array.isArray(result['tasks']) ? result['tasks'].length : undefined;
				}
				p.recv.push(r);
			});
		}
		override postMessage(message: unknown, ...rest: unknown[]): void {
			const m = message as { type?: string; request?: { revision?: number } } | null;
			if (m?.type)
				p.sent.push({ t: performance.now(), type: m.type, revision: m.request?.revision ?? null });
			(Base.prototype.postMessage as (...a: unknown[]) => void).call(this, message, ...rest);
		}
	}
	window.Worker = Probed;
	const statusText = (): string | null => {
		const g = document.querySelector('[role="group"][aria-label="Plan status"]');
		return g ? (g.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
	};
	const look = (): void => {
		const line = document.querySelector('[data-testid="engine-status"]')?.textContent?.trim();
		if (p.shell === null && line !== undefined) p.shell = performance.now();
		const text = statusText();
		if (text !== null && p.status.at(-1)?.text !== text)
			p.status.push({ t: performance.now(), text });
		if (line && p.engine.at(-1)?.text !== line) p.engine.push({ t: performance.now(), text: line });
		const hook = (window as unknown as { __mainspringEdits?: { revision(): number | null } })
			.__mainspringEdits;
		const revision = hook ? hook.revision() : null;
		if (p.revisions.at(-1)?.revision !== revision)
			p.revisions.push({ t: performance.now(), revision });
	};
	let last = 0;
	const frame = (now: number): void => {
		if (last && now - last > 100) p.stalls.push({ t: last, ms: now - last });
		last = now;
		look();
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
	const all = { subtree: true, childList: true, characterData: true };
	document.addEventListener('DOMContentLoaded', () =>
		new MutationObserver(look).observe(document.body, all),
	);
}

/** Prepended to the worker script (the last test only): times what the boot does. */
const WORKER_PRELUDE = `;(() => {
	const P = (self.__ecWorker = { t0: performance.now(), fetches: [], compile: [], instantiate: [], posts: [] });
	const f = self.fetch.bind(self);
	self.fetch = async (input, init) => {
		const rec = { url: String(input && input.url ? input.url : input), s: performance.now() };
		P.fetches.push(rec);
		const r = await f(input, init);
		rec.h = performance.now();
		const ab = r.arrayBuffer.bind(r);
		r.arrayBuffer = async () => { const b = await ab(); rec.e = performance.now(); rec.bytes = b.byteLength; return b; };
		return r;
	};
	const c = WebAssembly.compile;
	WebAssembly.compile = async (b) => { const s = performance.now(); const m = await c.call(WebAssembly, b); P.compile.push({ s, e: performance.now(), bytes: b.byteLength }); return m; };
	const i = WebAssembly.instantiate;
	WebAssembly.instantiate = async (...a) => { const s = performance.now(); const r = await i.apply(WebAssembly, a); P.instantiate.push({ s, e: performance.now() }); return r; };
	const pm = self.postMessage.bind(self);
	self.postMessage = (m, ...rest) => { if (m && typeof m === 'object') P.posts.push({ type: m.type, t: performance.now() }); return pm(m, ...rest); };
})();
`;

const round = (v: number | null | undefined): number | null =>
	v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const load1 = (): number => Math.round(os.loadavg()[0]! * 100) / 100;
type Win = {
	__mainspringEdits: {
		action(a: GanttAction): Promise<{ status: string }>;
		revision(): number | null;
	};
};
const revision = (page: Page): Promise<number> =>
	page.evaluate(() => (window as unknown as Win).__mainspringEdits.revision() ?? 0);

/** Waits (in Node, up to two minutes) for the box's one-minute load to fall to ENGINE_COST_MAX_LOAD. */
async function waitQuiet(): Promise<void> {
	const max = Number(process.env['ENGINE_COST_MAX_LOAD'] ?? '0');
	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
	for (let i = 0; max > 0 && i < 24 && os.loadavg()[0]! > max; i++) await sleep(5000);
}

type GanttHook = { __mainspringGantt: { x(m: number): number; scroller(): unknown } };

/** What Rig.open waits for after a zoom (tests/e2e/lib/gantt-rig.ts `layoutSettled`). */
const layoutSettled = (page: Page): Promise<string> =>
	settledValue(page, () => {
		const g = (window as unknown as GanttHook).__mainspringGantt;
		return [g.x(0), g.x(1440), JSON.stringify(g.scroller())].join('|');
	});

/** One open of `sample` in `page`, as a gesture rig opens it, then one edit; logs the record. */
async function openOnce(
	page: Page,
	info: TestInfo,
	plan: (typeof PLANS)[number],
	label: string,
): Promise<void> {
	await waitQuiet();
	const loadStart = load1();
	const t0 = Date.now();
	await page.goto(`/app?sample=${plan.sample}&mode=visual&hooks=edits,gantt`);
	const tGoto = Date.now();
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', { timeout: WAIT_MS });
	const tReady = Date.now();
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: WAIT_MS,
	});
	const tScheduled = Date.now();
	await expect(page.getByTestId('gantt-overlay')).toBeVisible({ timeout: WAIT_MS });
	const tGantt = Date.now();
	// What Rig.open does next (tests/e2e/lib/gantt-rig.ts): a zoom, then the chart holds still.
	const zoom = info.project.name === 'desktop' ? 'day' : 'week';
	await page.getByLabel('Zoom').selectOption(zoom);
	await expect(page.getByTestId('gantt')).toHaveAttribute('data-zoom', zoom);
	await layoutSettled(page);
	const tZoom = Date.now();

	// A second schedule in the same page: one edit, as a gesture dispatches it.
	const rev0 = await revision(page);
	const tEdit = Date.now();
	const edit = await page.evaluate(
		async (a) => {
			const t = performance.now();
			return { t, status: (await (window as unknown as Win).__mainspringEdits.action(a)).status };
		},
		{ type: 'size-step', task: plan.task, steps: 1 } as GanttAction,
	);
	if (edit.status === 'applied') {
		await expect
			.poll(() => revision(page), { timeout: WAIT_MS, intervals: [50] })
			.toBeGreaterThan(rev0);
	}
	const tEdited = Date.now();

	const seen = await page.evaluate(() => ({
		probe: (window as unknown as { __ecProbe: PageProbe }).__ecProbe,
		origin: performance.timeOrigin,
		nav: performance.getEntriesByType('navigation')[0]?.toJSON() as Record<string, number>,
		paint: performance.getEntriesByType('paint').map((e) => ({ name: e.name, t: e.startTime })),
	}));
	const worker = page.workers().find((w) => w.url().includes('/_astro/worker-'));
	const inWorker = worker
		? await worker.evaluate(() => ({
				origin: performance.timeOrigin,
				probe: (self as unknown as { __ecWorker?: WorkerProbe }).__ecWorker ?? null,
				resources: performance.getEntriesByType('resource').map((r) => {
					const e = r as PerformanceResourceTiming;
					return {
						name: e.name.split('/').pop(),
						ms: e.responseEnd - e.startTime,
						transfer: e.transferSize,
						body: e.decodedBodySize,
					};
				}),
			}))
		: null;

	const p = seen.probe;
	const ready = p.recv.find((r) => r.type === 'ready');
	const first = p.recv.find((r) => r.type === 'scheduled');
	const firstShown = p.status.find((s) => s.text.includes('Scheduled') && s.t >= (first?.t ?? 0));
	const editSent = p.sent.find((s) => s.type === 'schedule' && s.t >= edit.t);
	const editRecv = p.recv.find((r) => r.type === 'scheduled' && r.t >= edit.t);
	const editSeen = p.revisions.find((r) => r.t >= edit.t && (r.revision ?? 0) > rev0);
	const toPage = (wt: number): number => wt + (inWorker ? inWorker.origin - seen.origin : 0);
	const wp = inWorker?.probe ?? null;
	const lastFetch = wp ? Math.max(...wp.fetches.map((x) => x.e ?? 0)) : null;
	const readyPost = wp?.posts.find((x) => x.type === 'ready')?.t ?? null;
	const record = {
		project: info.project.name,
		plan: plan.sample,
		open: label,
		load: [loadStart, load1()],
		// Test side, from the call to page.goto (ms).
		wall: {
			goto: tGoto - t0,
			ready: tReady - t0,
			scheduled: tScheduled - t0,
			gantt: tGantt - t0,
			zoomStep: tZoom - tGantt,
			edit: tEdited - tEdit,
			editStatus: edit.status,
		},
		// Page side, ms since the navigation started (the goto call is `navStart` before it).
		page: {
			navStart: round(seen.origin - t0),
			fcp: round(seen.paint.find((x) => x.name === 'first-contentful-paint')?.t),
			dcl: round(seen.nav?.['domContentLoadedEventEnd']),
			load: round(seen.nav?.['loadEventEnd']),
			shell: round(p.shell),
			workerCreated: round(p.workers[0]?.t),
			ready: round(ready?.t),
			firstSent: round(p.sent.find((s) => s.type === 'schedule')?.t),
			firstResult: round(first?.t),
			firstShown: round(firstShown?.t),
			// The app asks for the keyword docs once the engine is first idle: "Engine: Ready" waits for it.
			syntaxSent: round(p.sent.find((s) => s.type === 'syntax')?.t),
			syntaxResult: round(p.recv.find((r) => r.type === 'syntax')?.t),
			engineIdle: round(p.engine.find((e) => e.text === 'Engine: Ready')?.t),
			// Main-thread stalls (frame gaps over 100 ms) before and after the first result.
			stallsBoot: round(sum(p.stalls.filter((x) => x.t < (first?.t ?? 0)).map((x) => x.ms))),
			stallsAfter: round(sum(p.stalls.filter((x) => x.t >= (first?.t ?? 0)).map((x) => x.ms))),
			maxStall: round(Math.max(0, ...p.stalls.map((x) => x.ms))),
			workers: p.workers.length,
			failures: p.recv.filter((r) => r.type === 'failed').length,
		},
		bootMs: round(ready?.bootMs),
		first: first?.timings ?? null,
		tasks: first?.tasks ?? null,
		edit: {
			path: editRecv?.timings?.['path'] ?? 'full',
			timings: editRecv?.timings ?? null,
			toSent: round(editSent ? editSent.t - edit.t : null),
			toResult: round(editRecv ? editRecv.t - edit.t : null),
			toRevision: round(editSeen ? editSeen.t - edit.t : null),
		},
		worker: inWorker && {
			resources: inWorker.resources,
			probed: wp !== null,
			scriptStart: wp ? round(toPage(wp.t0)) : null,
			fetches: wp?.fetches.map((x) => ({
				name: x.url.split('/').pop(),
				ms: round((x.e ?? NaN) - x.s),
				bytes: x.bytes ?? null,
			})),
			fetchEnd: wp && lastFetch ? round(toPage(lastFetch)) : null,
			gunzipVerifyMs: wp && lastFetch && wp.compile[0] ? round(wp.compile[0].s - lastFetch) : null,
			compileMs: wp?.compile[0] ? round(wp.compile[0].e - wp.compile[0].s) : null,
			instantiateMs: wp?.instantiate[0] ? round(wp.instantiate[0].e - wp.instantiate[0].s) : null,
			rubyInitRequireMs:
				wp?.instantiate[0] && readyPost ? round(readyPost - wp.instantiate[0].e) : null,
		},
	};
	console.log(`[engine-cost] ${JSON.stringify(record)}`);
	if (OUT) {
		fs.mkdirSync(path.dirname(OUT), { recursive: true });
		fs.appendFileSync(OUT, `${JSON.stringify(record)}\n`);
	}
	const body = JSON.stringify(record, null, 2);
	await info.attach(`engine-cost-${plan.sample}-${label}.json`, {
		body,
		contentType: 'application/json',
	});
}

/**
 * One open of `sample` with an edit dispatched as soon as the plan shows "Scheduled", before
 * "Engine: Ready" (ADR-0017): what the first edit waits for. Logs the record.
 */
async function firstEditOnce(
	page: Page,
	info: TestInfo,
	plan: (typeof PLANS)[number],
	label: string,
): Promise<void> {
	await waitQuiet();
	const loadStart = load1();
	const t0 = Date.now();
	await page.goto(`/app?sample=${plan.sample}&mode=visual&hooks=edits`);
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: WAIT_MS,
	});
	const tScheduled = Date.now();
	const rev0 = await revision(page);
	const edit = await page.evaluate(
		async (a) => {
			const t = performance.now();
			return { t, status: (await (window as unknown as Win).__mainspringEdits.action(a)).status };
		},
		{ type: 'size-step', task: plan.task, steps: 1 } as GanttAction,
	);
	if (edit.status === 'applied') {
		await expect
			.poll(() => revision(page), { timeout: WAIT_MS, intervals: [50] })
			.toBeGreaterThan(rev0);
	}
	const tEdited = Date.now();
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', { timeout: WAIT_MS });
	const p = await page.evaluate(() => (window as unknown as { __ecProbe: PageProbe }).__ecProbe);
	const first = p.recv.find((r) => r.type === 'scheduled');
	const editSent = p.sent.find((s) => s.type === 'schedule' && s.t >= edit.t);
	const editRecv = editSent
		? p.recv.find((r) => r.type === 'scheduled' && r.revision === editSent.revision)
		: undefined;
	const syntaxSent = p.sent.find((s) => s.type === 'syntax');
	const syntaxRecv = p.recv.find((r) => r.type === 'syntax');
	const totalMs = editRecv?.timings?.['totalMs'];
	const toResult = editRecv ? editRecv.t - edit.t : null;
	const record = {
		project: info.project.name,
		plan: plan.sample,
		open: label,
		load: [loadStart, load1()],
		wall: { scheduled: tScheduled - t0, edit: tEdited - tScheduled, editStatus: edit.status },
		page: {
			firstResult: round(first?.t),
			dispatched: round(edit.t),
			syntaxSent: round(syntaxSent?.t),
			syntaxResult: round(syntaxRecv?.t),
			engineIdle: round(p.engine.find((e) => e.text === 'Engine: Ready')?.t),
			failures: p.recv.filter((r) => r.type === 'failed').length,
		},
		firstEdit: {
			path: editRecv?.timings?.['path'] ?? 'full',
			// The docs request was in the worker when the edit was dispatched.
			behindSyntax:
				syntaxSent !== undefined && syntaxSent.t < edit.t && (syntaxRecv?.t ?? Infinity) > edit.t,
			toSent: round(editSent ? editSent.t - edit.t : null),
			toResult: round(toResult),
			totalMs: typeof totalMs === 'number' ? round(totalMs) : null,
			queueWait:
				toResult !== null && typeof totalMs === 'number' ? round(toResult - totalMs) : null,
		},
	};
	console.log(`[engine-cost] ${JSON.stringify(record)}`);
	if (OUT) {
		fs.mkdirSync(path.dirname(OUT), { recursive: true });
		fs.appendFileSync(OUT, `${JSON.stringify(record)}\n`);
	}
	await info.attach(`engine-cost-${plan.sample}-${label}.json`, {
		body: JSON.stringify(record, null, 2),
		contentType: 'application/json',
	});
}

/** The project's device, for a second context in the same browser. */
const DEVICE_KEYS = ['baseURL', 'viewport', 'screen', 'userAgent', 'deviceScaleFactor', 'isMobile'];
const deviceOptions = (info: TestInfo): BrowserContextOptions =>
	Object.fromEntries(
		[...DEVICE_KEYS, 'hasTouch']
			.map((k) => [k, info.project.use[k as 'baseURL']])
			.filter((e) => e[1] !== undefined),
	) as BrowserContextOptions;

/** Prepends WORKER_PRELUDE to the worker script; `worker.probed` in the record says it took. */
const routeWorker = (target: Page): Promise<unknown> =>
	target.route('**/_astro/worker-*.js', async (route) => {
		const response = await route.fetch();
		const headers = { ...response.headers() };
		delete headers['content-length'];
		delete headers['content-encoding'];
		await route.fulfill({ response, headers, body: WORKER_PRELUDE + (await response.text()) });
	});

test.describe('engine cost per page open', { tag: '@timing' }, () => {
	test.skip(process.env['ENGINE_COST'] !== '1', 'opt-in: ENGINE_COST=1');
	test.describe.configure({ mode: 'serial' });
	test.beforeEach(async ({ context }) => {
		await context.addInitScript(installPageProbe);
	});

	// Each open is its own test, so each gets a fresh context, as every real test does.
	for (const plan of PLANS) {
		for (let i = 1; i <= N; i++) {
			test(`${plan.sample} open ${i}`, async ({ page }, info) => {
				test.setTimeout(3 * WAIT_MS);
				await openOnce(page, info, plan, `fresh-${i}`);
			});
		}
		for (let i = 1; i <= N; i++) {
			test(`${plan.sample} first edit ${i}`, async ({ page }, info) => {
				test.setTimeout(3 * WAIT_MS);
				await firstEditOnce(page, info, plan, `first-edit-${i}`);
			});
		}
	}

	// What a reopen pays: N opens in one context (the same page, as a shared page would). Without
	// routing it shows the HTTP cache; with the worker timed, the boot's parts, then a new context.
	for (const timed of [false, true]) {
		test(`reopen in one context${timed ? ', boot timed, then a new context' : ''}`, async ({
			page,
			browser,
		}, info) => {
			test.setTimeout((N + 2) * WAIT_MS);
			const plan = PLANS[0]!;
			if (timed) await routeWorker(page);
			const label = timed ? 'same-context-timed' : 'same-context';
			for (let i = 1; i <= N; i++) await openOnce(page, info, plan, `${label}-${i}`);
			if (!timed) return;
			const other = await (browser as Browser).newContext(deviceOptions(info));
			try {
				await other.addInitScript(installPageProbe);
				const page2 = await other.newPage();
				await routeWorker(page2);
				await openOnce(page2, info, plan, 'new-context-timed');
			} finally {
				await other.close();
			}
		});
	}
});
