// SPDX-License-Identifier: GPL-2.0-or-later
// Frame cost of the Gantt on the gantt-500 plan (phase-2.md 8.4; T22). Chromium only: desktop
// without throttling, and the Pixel 7 emulation with 4x CPU throttling (Emulation.
// setCPUThrottlingRate), after the engine is ready (the boot stall is the known Phase 0 deviation).
// Scenarios, in one page per profile (the boot of 500 tasks is long): a native vertical scroll
// through all rows and back, three runs at day zoom and three at week zoom (the 18.7 pass
// definition is applied to each run); a horizontal pan across the frame; a pinch (the phone) or a
// Ctrl+wheel burst (desktop) to the widest zoom; a 3 s drag of a bar's size handle with the
// drop-to-paint and drop-to-reschedule times; a scroll during which a result arrives. The
// touch-listener comparison (8.2) is the last test: the same phone scroll, three runs each, on a
// page with the Gantt's non-passive touchmove listener and on one with it dropped.
//
// Enforced, as regression catchers only (a headless runner has no GPU and shares its CPUs):
// desktop, at most 5% dropped compositor frames and no rAF interval over 50 ms in every scroll run,
// and drag script time p95 under 8 ms. The throttled phone profile is recorded and judged against
// 18.7 in the JSON (`criterion18_7`), not failed. Everything is written to test-results/
// gantt-perf.json with the load average and the device, browser and build it came from.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { REPO } from '../golden/corpus';
import { READY_TIMEOUT_MS, Rig, type Point } from './lib/gantt-rig';
import { MAX_FRAME_MS, installProbe, measure, type Measure } from './lib/perf';

const OUT = path.join(REPO, 'test-results', 'gantt-perf.json');
const SCROLLER = '[data-testid="gantt"] .scroller';
const RUNS = 3;
/** The 18.7 pass definition: this share of frames on time, and none over MAX_FRAME_MS. */
const PASS_ON_TIME_PCT = 95;
const TASK = 'p0.p0k0.t1';

type Win = { __drop?: { at: number; paint: number; resched: number } };

const loadavg = (): number[] => os.loadavg().map((v) => Math.round(v * 100) / 100);

function build(): string {
	try {
		return execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
	} catch {
		return 'unknown';
	}
}

/** Merges one profile's results into the shared file. */
function record(key: string, value: unknown): void {
	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	const old = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as object) : {};
	fs.writeFileSync(OUT, JSON.stringify({ ...old, [key]: value }, null, 2));
}

async function environment(page: Page, info: TestInfo, throttle: number) {
	return {
		when: new Date().toISOString(),
		profile: info.project.name,
		device:
			info.project.name === 'pixel-7'
				? 'Pixel 7 emulation (412x915, dpr 2.625, touch)'
				: 'Desktop Chrome',
		cpuThrottle: throttle,
		browser: `${page.context().browser()?.browserType().name()} ${page.context().browser()?.version()}`,
		userAgent: await page.evaluate(() => navigator.userAgent),
		build: build(),
		host: `${os.cpus()[0]?.model} x${os.cpus().length}`,
		loadAverageAtStart: loadavg(),
	};
}

const scrollMetrics = (page: Page) =>
	page.evaluate((sel) => {
		const s = document.querySelector(sel) as HTMLElement;
		return {
			top: Math.round(s.scrollTop),
			left: Math.round(s.scrollLeft),
			height: s.scrollHeight,
			view: s.clientHeight,
			width: s.scrollWidth,
			viewW: s.clientWidth,
		};
	}, SCROLLER);

const setScroll = (page: Page, left: number, top: number) =>
	page.evaluate(
		([sel, l, t]) =>
			(document.querySelector(sel as string) as HTMLElement).scrollTo({
				left: l as number,
				top: t as number,
				behavior: 'instant',
			}),
		[SCROLLER, left, top] as const,
	);

type Source = 'touch' | 'mouse';

/** One native scroll of dx, dy px (negative scrolls the content forward, as a finger moving up does). */
async function gesture(
	cdp: CDPSession,
	source: Source,
	at: Point,
	dx: number,
	dy: number,
	speed: number,
): Promise<void> {
	await cdp.send('Input.synthesizeScrollGesture', {
		x: at.x,
		y: at.y,
		xDistance: dx,
		yDistance: dy,
		speed,
		gestureSourceType: source,
		preventFling: true,
	});
}

/** The first input that moves the scroller: a finger on the phone profile, the wheel if that fails. */
async function pickInput(page: Page, cdp: CDPSession, phone: boolean, at: Point) {
	const tried: string[] = [];
	for (const source of (phone ? ['touch', 'mouse'] : ['mouse']) as Source[]) {
		await setScroll(page, 0, 0);
		await gesture(cdp, source, at, 0, -400, 2000);
		await page.waitForTimeout(300);
		const moved = (await scrollMetrics(page)).top;
		tried.push(`${source}: ${moved} px`);
		await setScroll(page, 0, 0);
		if (moved >= 200) return { source, tried };
	}
	throw new Error(`No input scrolled the chart (${tried.join('; ')}): nothing to measure.`);
}

/** A measure that fails when the scroller did not move: the frames of a page that did not scroll are no result. */
async function scrolled(
	page: Page,
	label: string,
	asked: { x: number; y: number },
	run: () => Promise<void>,
): Promise<Measure> {
	const from = await scrollMetrics(page);
	const m = await measure(page, run);
	const to = await scrollMetrics(page);
	m.scrolledPx = { x: to.left - from.left, y: to.top - from.top };
	for (const axis of ['x', 'y'] as const) {
		if (asked[axis] !== 0 && Math.abs(m.scrolledPx[axis]) < Math.abs(asked[axis]) / 2)
			throw new Error(
				`${label}: the scroller did not move on ${axis} (asked ${asked[axis]}, moved ${m.scrolledPx[axis]})`,
			);
	}
	return m;
}

/** The 18.7 definition for one run. */
const passes = (m: Measure): boolean => m.onTimePct >= PASS_ON_TIME_PCT && m.maxMs <= MAX_FRAME_MS;

async function scrollRun(
	page: Page,
	cdp: CDPSession,
	source: Source,
	at: Point,
	label: string,
): Promise<Measure> {
	const s = await scrollMetrics(page);
	const down = Math.min(s.height - s.view - 50, 40_000);
	await setScroll(page, 0, 0);
	await page.waitForTimeout(300);
	// All rows and back, as one window (18.7: "a scripted 500-row scroll").
	let farthest = 0;
	const m = await measure(page, async () => {
		await gesture(cdp, source, at, 0, -down, 4000);
		farthest = (await scrollMetrics(page)).top;
		await gesture(cdp, source, at, 0, down, 4000);
	});
	const back = (await scrollMetrics(page)).top;
	m.scrolledPx = { x: 0, y: farthest };
	if (farthest < down / 2 || back > farthest / 2)
		throw new Error(
			`${label}: the scroller did not go down and back (asked ${down}, reached ${farthest}, back at ${back})`,
		);
	return m;
}

/**
 * Presses the size handle of `TASK`'s bar and drags it over `ms`, paced by timer, then releases.
 * In the page, a pointerup listener times the drop: to the second frame after it (the frame that
 * paints what the drop left) and to the engine's newer revision (the reschedule).
 */
async function pacedDrag(
	rig: Rig,
	from: Point,
	ms: number,
	dx: number,
	afterRelease?: () => Promise<void>,
) {
	const { page } = rig;
	const frames = Math.round(ms / 16);
	const rev = await rig.revision();
	await page.evaluate((r) => {
		const w = window as unknown as Win;
		delete w.__drop;
		window.addEventListener(
			'pointerup',
			() => {
				const at = performance.now();
				const drop = { at, paint: 0, resched: 0 };
				w.__drop = drop;
				requestAnimationFrame(() =>
					requestAnimationFrame(() => (drop.paint = performance.now() - at)),
				);
				const hooks = window as unknown as { __mainspringEdits: { revision(): number | null } };
				const poll = (): void => {
					if ((hooks.__mainspringEdits.revision() ?? 0) > r) drop.resched = performance.now() - at;
					else requestAnimationFrame(poll);
				};
				requestAnimationFrame(poll);
			},
			{ once: true, capture: true },
		);
	}, rev);
	const at = (i: number): Point => ({ x: from.x + (dx * i) / frames, y: from.y });
	if (rig.touch) {
		await rig.touches('touchStart', [from]);
		for (let i = 1; i <= frames; i++) {
			await rig.touches('touchMove', [at(i)]);
			await page.waitForTimeout(16);
		}
		await rig.touches('touchEnd', []);
	} else {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let i = 1; i <= frames; i++) {
			await page.mouse.move(at(i).x, at(i).y);
			await page.waitForTimeout(16);
		}
		await page.mouse.up();
	}
	await afterRelease?.();
	await rig.rescheduled(rev);
	await page.waitForFunction(() => {
		const d = (window as unknown as Win).__drop;
		return !!d && d.paint > 0 && d.resched > 0;
	});
	return page.evaluate(() => {
		const d = (window as unknown as Win).__drop as { paint: number; resched: number };
		return { dropToPaintMs: Math.round(d.paint), dropToRescheduleMs: Math.round(d.resched) };
	});
}

/** Selects the task's bar; the first tap after a long burst of scrolling and zooming is tried twice. */
async function selectBar(rig: Rig) {
	try {
		return await rig.select(TASK);
	} catch {
		const b = await rig.peek(TASK);
		const diag = await rig.page.evaluate(
			([x, y]) => {
				const el = document.elementFromPoint(x as number, y as number);
				return `${el?.tagName}.${el?.className} data-testid=${el?.getAttribute('data-testid')}`;
			},
			[b.body.x, b.body.y],
		);
		console.log('select failed; element at the bar:', diag, JSON.stringify(b.body));
		return rig.select(TASK);
	}
}

test.describe('gantt perf (gantt-500)', () => {
	test.setTimeout(READY_TIMEOUT_MS * 5);
	test.beforeEach(({ browserName: _b }, info) => {
		test.skip(info.project.name === 'iphone-14', 'Chromium measures (phase-2.md 8.4)');
	});

	test('scroll, pan, zoom, drag and a result during a scroll', async ({ page }, info) => {
		const phone = info.project.name === 'pixel-7';
		const throttle = phone ? 4 : 1;
		await installProbe(page);
		const rig = await Rig.open(page, info, 'day', 'visual', 'gantt-500');
		// The engine has the plan; let the first paint, the analysis and the idle work settle.
		await page.waitForTimeout(3000);
		const cdp = await page.context().newCDPSession(page);
		if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
		const result: Record<string, unknown> = { ...(await environment(page, info, throttle)) };
		const box = await page.locator(SCROLLER).boundingBox();
		if (!box) throw new Error('no chart');
		// Clear of the task column, so that a finger scrolls the timeline.
		const at: Point = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.6 };
		const picked = await pickInput(page, cdp, phone, at);
		result['input'] = picked.source;
		result['inputProbe'] = picked.tried;
		const dims = await scrollMetrics(page);
		result['scrollHeightPx'] = dims.height;
		result['scrollWidthPx'] = dims.width;
		result['rows'] = await page.locator('[role="treegrid"]').getAttribute('aria-rowcount');

		// 1. Vertical scroll through all rows and back, three runs at each zoom.
		const scroll: Record<string, Measure[]> = {};
		for (const zoom of ['day', 'week'] as const) {
			await rig.zoom(zoom);
			await page.waitForTimeout(500);
			scroll[zoom] = [];
			for (let i = 0; i < RUNS; i++) {
				scroll[zoom]!.push(
					await scrollRun(page, cdp, picked.source, at, `scroll ${zoom} #${i + 1}`),
				);
			}
		}
		result['scroll'] = scroll;
		const runs = Object.values(scroll).flat();
		result['criterion18_7'] = {
			definition: `at least ${PASS_ON_TIME_PCT}% of rAF intervals up to 20 ms (16.7 ms plus jitter) and none over ${MAX_FRAME_MS} ms, in every run`,
			runs: runs.length,
			passingRuns: runs.filter(passes).length,
			pass: runs.every(passes),
			emulation: phone
				? 'Pixel 7 emulation, 4x CPU throttle, no GPU, no real device'
				: 'desktop, no throttle',
		};

		// 2. A horizontal pan across the frame, at week zoom.
		await rig.zoom('day');
		await page.waitForTimeout(500);
		const wide = await scrollMetrics(page);
		const pan = Math.min(wide.width - wide.viewW - 50, 12_000);
		await setScroll(page, 0, 0);
		await page.waitForTimeout(300);
		result['pan'] = await scrolled(page, 'pan', { x: -pan, y: 0 }, async () => {
			await gesture(cdp, picked.source, at, -pan, 0, 4000);
		});

		// 3. Zoom: a pinch on the phone, a Ctrl+wheel burst on the desktop, from day outwards.
		await setScroll(page, 0, 0);
		await rig.zoom('day');
		const level = (): Promise<string | null> => page.getByTestId('gantt').getAttribute('data-zoom');
		result['zoom'] = await measure(page, async () => {
			if (phone) {
				for (let i = 0; i < 4; i++) {
					await cdp.send('Input.synthesizePinchGesture', {
						x: at.x,
						y: at.y,
						scaleFactor: 0.35,
						relativeSpeed: 400,
						gestureSourceType: 'touch',
					});
					await page.waitForTimeout(150);
				}
			} else {
				await page.mouse.move(at.x, at.y);
				await page.keyboard.down('Control');
				for (let i = 0; i < 60; i++) {
					await page.mouse.wheel(0, 40);
					await page.waitForTimeout(16);
				}
				await page.keyboard.up('Control');
			}
		});
		result['zoomEndedAt'] = await level();
		expect(await level(), 'the pinch or wheel zoom changed the zoom level').not.toBe('day');
		// The drag runs at week zoom, where the whole bar is within the chart beside the panel.
		await rig.zoom('week');
		await page.waitForTimeout(800);

		// 4. A 3 s drag of a bar's size handle (the pointer moves are paced over 3 s).
		await setScroll(page, 0, 0);
		const handle = (await selectBar(rig)).endEdge;
		const dragRun = await (async () => {
			let times = { dropToPaintMs: 0, dropToRescheduleMs: 0 };
			const m = await measure(page, async () => {
				times = await pacedDrag(rig, handle, 3000, 240);
			});
			return { ...m, ...times };
		})();
		result['drag3s'] = dragRun;

		// 5. A scroll during which a result arrives: a short drag whose drop starts the runner, and
		// the scroll begins the moment the finger or the button is released.
		// Undo the first drag (the bar is back to its length), so that the next handle is on the screen.
		const rev = await rig.revision();
		await rig.toast.last().getByRole('button', { name: 'Undo' }).click();
		await rig.rescheduled(rev);
		await page.waitForTimeout(800);
		const handle2 = (await selectBar(rig)).endEdge;
		const during = await (async () => {
			let times = { dropToPaintMs: 0, dropToRescheduleMs: 0 };
			const m = await scrolled(page, 'scroll with a result', { x: 0, y: -4000 }, async () => {
				times = await pacedDrag(rig, handle2, 300, -48, async () => {
					await gesture(cdp, picked.source, at, 0, -4000, 3000);
				});
			});
			return { ...m, ...times };
		})();
		result['scrollDuringResult'] = during;
		result['loadAverageAtEnd'] = loadavg();
		record(phone ? 'pixel-7-4x' : 'desktop', result);

		// What the budgets mean in CI (8.4): regression catchers on the desktop profile only.
		if (!phone) {
			for (const m of runs) {
				expect(
					m.pipeline.droppedPct,
					'compositor frames dropped during a scroll (%)',
				).toBeLessThanOrEqual(5);
				expect(m.maxMs, 'longest rAF interval during a scroll (ms)').toBeLessThanOrEqual(
					MAX_FRAME_MS,
				);
			}
			expect(
				dragRun.inputScript.p95Ms + dragRun.rafScript.p95Ms,
				'drag script time p95 (ms)',
			).toBeLessThan(8);
		}
		expect(runs.length).toBe(RUNS * 2);
	});

	// The comparison of 8.2: the same phone scroll at 4x CPU, three runs each, on a page of its own
	// with the Gantt's non-passive touchmove listener, and on one with it dropped by an init script.
	for (const without of [false, true]) {
		test(`phone scroll with${without ? 'out' : ''} the touchmove listener`, async ({
			page,
		}, info) => {
			test.skip(info.project.name !== 'pixel-7', 'the touch listener comparison is a phone one');
			await installProbe(page);
			if (without) {
				await page.addInitScript(() => {
					const add = EventTarget.prototype.addEventListener;
					EventTarget.prototype.addEventListener = function (type, fn, opts) {
						const passive = typeof opts === 'object' && opts !== null ? opts.passive : undefined;
						if (type === 'touchmove' && passive === false) return;
						return add.call(this, type, fn, opts);
					};
				});
			}
			const rig = await Rig.open(page, info, 'week', 'visual', 'gantt-500');
			void rig;
			await page.waitForTimeout(3000);
			const cdp = await page.context().newCDPSession(page);
			await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
			const box = await page.locator(SCROLLER).boundingBox();
			if (!box) throw new Error('no chart');
			const at: Point = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.6 };
			const picked = await pickInput(page, cdp, true, at);
			const runs: Measure[] = [];
			for (let i = 0; i < RUNS; i++) {
				runs.push(await scrollRun(page, cdp, picked.source, at, `listener ${without} #${i + 1}`));
			}
			record(`touch-listener-${without ? 'without' : 'with'}`, {
				...(await environment(page, info, 4)),
				input: picked.source,
				runs,
				loadAverageAtEnd: loadavg(),
			});
			expect(runs).toHaveLength(RUNS);
		});
	}
});
