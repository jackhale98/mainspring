// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt behaves like a native app (phase-2.md 9.2): the page never scrolls, the corner is
// fixed, the date header is frozen at the top and moves only sideways, the name column is frozen
// at the left and moves only up and down, and names and bars share one vertical scroll. The
// header is not repainted per scroll event (it moves with the content on the compositor). Run on
// Pixel 7 emulation (touch) and on desktop. With SCREENSHOTS=1 the Pixel 7 run also writes its
// frame log to docs/phases/screenshots/phase-2/header-scroll-pixel7.json as evidence, with the long
// pan to the far right and back (header-scroll-pixel7-longpan.json; on desktop with a shift-wheel pan, header-scroll-desktop.json):
// the name column's left never leaves the scroller's left, and every header label (months, days,
// weeks) sits exactly where the bars' content puts it at every sampled frame, 0 px drift.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO } from '../golden/corpus';

const READY_TIMEOUT_MS = 120_000;
const EVIDENCE = path.join(
	REPO,
	'docs',
	'phases',
	'screenshots',
	'phase-2',
	'header-scroll-pixel7.json',
);

interface Rects {
	corner: DOMRect;
	head: DOMRect;
	names: DOMRect;
	plot: DOMRect;
	scrollLeft: number;
	scrollTop: number;
}

const evidence = (name: string): string =>
	path.join(REPO, 'docs', 'phases', 'screenshots', 'phase-2', name);

declare global {
	interface Window {
		__headerPaints?: number;
		__frames?: Array<Record<string, number>>;
	}
}

async function open(page: Page, sample = 'upstream-fedora-20'): Promise<void> {
	// Counts the header canvas's paints: its draw asks for the 2d context each time.
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: never[]) {
			if (this.dataset['testid'] === 'gantt-header') {
				window.__headerPaints = (window.__headerPaints ?? 0) + 1;
			}
			return (original as (...a: unknown[]) => unknown).apply(this, args);
		} as typeof original;
	});
	await page.goto(`/app?sample=${sample}&mode=visual`);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByTestId('gantt')).toBeVisible();
	await expect(page.getByRole('treeitem').first()).toBeVisible();
	await page.waitForTimeout(600);
}

const rectsOf = (page: Page): Promise<Rects> =>
	page.evaluate(() => {
		const q = (s: string): Element => {
			const el = document.querySelector(s);
			if (!el) throw new Error(s);
			return el;
		};
		const scroller = q('[data-testid="gantt"] .scroller');
		return {
			corner: q('[data-testid="gantt"] .corner').getBoundingClientRect().toJSON(),
			head: q('[data-testid="gantt"] .head').getBoundingClientRect().toJSON(),
			names: q('[data-testid="gantt"] .names').getBoundingClientRect().toJSON(),
			plot: q('[data-testid="gantt"] .plot').getBoundingClientRect().toJSON(),
			scrollLeft: scroller.scrollLeft,
			scrollTop: scroller.scrollTop,
		};
	});

test.describe('frozen header and name column', () => {
	test.setTimeout(READY_TIMEOUT_MS + 60_000);

	test('stay pinned while the chart scrolls, and the page never scrolls', async ({ page }) => {
		await open(page);
		const before = await rectsOf(page);
		const paintsBefore = await page.evaluate(() => window.__headerPaints ?? 0);

		await page.evaluate(() => {
			document
				.querySelector('[data-testid="gantt"] .scroller')
				?.scrollTo({ left: 240, top: 200, behavior: 'instant' });
		});
		await page.waitForTimeout(400);
		const after = await rectsOf(page);
		expect(after.scrollLeft).toBeGreaterThan(100);
		expect(after.scrollTop).toBeGreaterThan(100);

		// The corner does not move at all.
		expect(after.corner.x).toBeCloseTo(before.corner.x, 0);
		expect(after.corner.y).toBeCloseTo(before.corner.y, 0);
		// The header keeps its top and follows the horizontal scroll only.
		expect(after.head.y).toBeCloseTo(before.head.y, 0);
		expect(before.head.x - after.head.x).toBeCloseTo(after.scrollLeft, 0);
		// The name column keeps its left and follows the vertical scroll only.
		expect(after.names.x).toBeCloseTo(before.names.x, 0);
		expect(before.names.y - after.names.y).toBeCloseTo(after.scrollTop, 0);
		// The header and the bars stay locked together sideways, the names and the bars up and down.
		expect(after.head.x - after.plot.x).toBeCloseTo(before.head.x - before.plot.x, 0);
		expect(after.names.y - after.plot.y).toBeCloseTo(before.names.y - before.plot.y, 0);

		// The page itself neither scrolls nor chains the scroll.
		const page0 = await page.evaluate(() => {
			window.scrollTo(0, 120);
			return {
				y: window.scrollY,
				scrollTop: document.scrollingElement?.scrollTop ?? 0,
				bodyOverscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
				chartOverscroll: getComputedStyle(
					document.querySelector('[data-testid="gantt"] .scroller') as Element,
				).overscrollBehaviorY,
			};
		});
		expect(page0.y).toBe(0);
		expect(page0.scrollTop).toBe(0);
		expect(page0.bodyOverscroll).toBe('none');
		expect(page0.chartOverscroll).toBe('none');

		// A scroll within the overscan does not repaint the header (at most one window shift).
		expect(
			(await page.evaluate(() => window.__headerPaints ?? 0)) - paintsBefore,
		).toBeLessThanOrEqual(2);
	});

	test('a touch scroll gesture moves header and bars rigidly (Pixel 7)', async ({
		page,
		browserName,
	}, info) => {
		test.skip(info.project.name !== 'pixel-7' || browserName !== 'chromium');
		await open(page);
		await page.evaluate(() => {
			window.__frames = [];
			const scroller = document.querySelector('[data-testid="gantt"] .scroller');
			const head = document.querySelector('[data-testid="gantt"] .head');
			const names = document.querySelector('[data-testid="gantt"] .names');
			const corner = document.querySelector('[data-testid="gantt"] .corner');
			const plot = document.querySelector('[data-testid="gantt"] .plot');
			if (!scroller || !head || !names || !corner || !plot) throw new Error('missing');
			window.__headerPaints = 0;
			const t0 = performance.now();
			const tick = (): void => {
				const h = head.getBoundingClientRect();
				const n = names.getBoundingClientRect();
				const c = corner.getBoundingClientRect();
				const p = plot.getBoundingClientRect();
				window.__frames?.push({
					t: Math.round(performance.now() - t0),
					scrollLeft: scroller.scrollLeft,
					scrollTop: scroller.scrollTop,
					headMinusPlotX: Math.round((h.x - p.x) * 100) / 100,
					namesMinusPlotY: Math.round((n.y - p.y) * 100) / 100,
					headY: h.y,
					namesX: n.x,
					cornerX: c.x,
					cornerY: c.y,
					headerPaints: window.__headerPaints ?? 0,
				});
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const cdp = await page.context().newCDPSession(page);
		// One finger dragging, as touch events through the DevTools Input domain: the browser's own
		// scroller handles them, on the compositor, as on a phone.
		const drag = async (x0: number, y0: number, x1: number, y1: number): Promise<void> => {
			const steps = 14;
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [{ x: x0, y: y0 }],
			});
			for (let i = 1; i <= steps; i++) {
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }],
				});
				await page.waitForTimeout(16);
			}
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await page.waitForTimeout(350);
		};
		await drag(350, 420, 150, 420); // pan sideways
		await drag(300, 520, 300, 300); // pan down the plan
		await drag(160, 300, 330, 400); // diagonal back
		await page.waitForTimeout(300);
		const frames = await page.evaluate(() => window.__frames ?? []);
		expect(frames.length).toBeGreaterThan(20);
		const spread = (key: string): number => {
			const v = frames.map((f) => f[key] ?? 0);
			return Math.max(...v) - Math.min(...v);
		};
		// The chart did scroll, both ways.
		expect(spread('scrollLeft')).toBeGreaterThan(100);
		expect(spread('scrollTop')).toBeGreaterThan(100);
		// Rigid: header and bars never part sideways, names and bars never part vertically, and
		// the corner, the header's top and the names' left never move.
		expect(spread('headMinusPlotX')).toBeLessThanOrEqual(0.5);
		expect(spread('namesMinusPlotY')).toBeLessThanOrEqual(0.5);
		expect(spread('headY')).toBeLessThanOrEqual(0.5);
		expect(spread('namesX')).toBeLessThanOrEqual(0.5);
		expect(spread('cornerX')).toBeLessThanOrEqual(0.5);
		expect(spread('cornerY')).toBeLessThanOrEqual(0.5);
		// Never repainted per scroll event: a few window shifts at most, not one per frame.
		const paints = frames[frames.length - 1]?.['headerPaints'] ?? 0;
		expect(paints).toBeLessThan(frames.length / 4);

		if (process.env['SCREENSHOTS']) {
			fs.writeFileSync(
				EVIDENCE,
				JSON.stringify(
					{
						device:
							'Pixel 7 emulation, one-finger drags as touch events through the DevTools Input domain',
						plan: 'upstream-fedora-20 (Visual)',
						frames: frames.length,
						headerPaints: paints,
						maxDriftPx: {
							headVsBarsX: spread('headMinusPlotX'),
							namesVsBarsY: spread('namesMinusPlotY'),
							headTop: spread('headY'),
							namesLeft: spread('namesX'),
							corner: Math.max(spread('cornerX'), spread('cornerY')),
						},
						scrolled: { x: spread('scrollLeft'), y: spread('scrollTop') },
						samples: frames,
					},
					null,
					1,
				) + '\n',
			);
		}
	});

	/** Samples every frame while `pan` runs: the name column against the scroller, the header
	 *  against the bars, and each day or week label against its own content position. */
	async function sampleWhile(
		page: Page,
		pan: () => Promise<void>,
	): Promise<Array<Record<string, number>>> {
		await page.evaluate(() => {
			window.__frames = [];
			window.__headerPaints = 0;
			const q = (s: string): HTMLElement => {
				const el = document.querySelector<HTMLElement>(s);
				if (!el) throw new Error(s);
				return el;
			};
			const scroller = q('[data-testid="gantt"] .scroller');
			const head = q('[data-testid="gantt"] .head');
			const names = q('[data-testid="gantt"] .names');
			const plot = q('[data-testid="gantt"] .plot');
			const t0 = performance.now();
			const tick = (): void => {
				const sr = scroller.getBoundingClientRect();
				const pr = plot.getBoundingClientRect();
				const hr = head.getBoundingClientRect();
				// A label's left, relative to the bars' content origin, must equal its own x (its `left`).
				let drift = 0;
				let shown = 0;
				const nameLeft = names.getBoundingClientRect().left - sr.left;
				for (const el of head.querySelectorAll<HTMLElement>('.minor')) {
					const r = el.getBoundingClientRect();
					if (r.right < sr.left + nameLeft || r.left > sr.right) continue;
					shown++;
					drift = Math.max(drift, Math.abs(r.left - pr.left - parseFloat(el.style.left)));
				}
				window.__frames?.push({
					t: Math.round(performance.now() - t0),
					scrollLeft: scroller.scrollLeft,
					scrollMax: scroller.scrollWidth - scroller.clientWidth,
					namesLeft: Math.round((names.getBoundingClientRect().left - sr.left) * 100) / 100,
					namesVisible: (() => {
						const at = document.elementFromPoint(sr.left + 4, sr.top + sr.height / 2);
						return at && names.contains(at) ? 1 : 0;
					})(),
					headMinusPlotX: Math.round((hr.left - pr.left) * 100) / 100,
					minorDrift: Math.round(drift * 100) / 100,
					minorShown: shown,
					headerPaints: window.__headerPaints ?? 0,
				});
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		await pan();
		await page.waitForTimeout(400);
		return page.evaluate(() => window.__frames ?? []);
	}

	function assertLongPan(frames: Array<Record<string, number>>): void {
		const get = (k: string): number[] => frames.map((f) => f[k] ?? 0);
		expect(frames.length).toBeGreaterThan(30);
		// It went to the far right and came back.
		const max = Math.max(...get('scrollMax'));
		expect(Math.max(...get('scrollLeft'))).toBeGreaterThanOrEqual(max - 2);
		expect(frames[frames.length - 1]?.['scrollLeft'] ?? 0).toBeLessThan(max / 2);
		// The name column's left never leaves the scroller's left, anywhere, momentum included.
		expect(Math.min(...get('namesVisible'))).toBe(1); // visible in every frame, not just placed
		expect(Math.max(...get('namesLeft'))).toBeLessThanOrEqual(0.5);
		expect(Math.min(...get('namesLeft'))).toBeGreaterThanOrEqual(-0.5);
		// The header tracks the bars, and every visible day or week label is where its content is.
		expect(Math.max(...get('headMinusPlotX').map(Math.abs))).toBeLessThanOrEqual(0.5);
		expect(Math.max(...get('minorDrift'))).toBeLessThanOrEqual(0.5);
		// A label is always in view: none ever blinks out while the window changes.
		const settled = frames.slice(2);
		expect(Math.min(...settled.map((f) => f['minorShown'] ?? 0))).toBeGreaterThan(0);
	}

	function summary(frames: Array<Record<string, number>>, device: string): object {
		const get = (k: string): number[] => frames.map((f) => f[k] ?? 0);
		return {
			device,
			plan: 'gantt-500 (Visual)',
			frames: frames.length,
			scrolledToXMax: Math.max(...get('scrollLeft')),
			scrollXMax: Math.max(...get('scrollMax')),
			framesWithNamesNotVisible: get('namesVisible').filter((v) => v !== 1).length,
			namesLeftRange: [Math.min(...get('namesLeft')), Math.max(...get('namesLeft'))],
			maxHeadVsBarsDriftPx: Math.max(...get('headMinusPlotX').map(Math.abs)),
			maxLabelDriftPx: Math.max(...get('minorDrift')),
			minLabelsShown: Math.min(...get('minorShown').slice(2)),
			headerCanvasRepaints: frames[frames.length - 1]?.['headerPaints'] ?? 0,
			samples: frames,
		};
	}

	test('a long touch pan to the far right and back keeps the name column and the labels in place (Pixel 7)', async ({
		page,
		browserName,
	}, info) => {
		test.skip(info.project.name !== 'pixel-7' || browserName !== 'chromium');
		await open(page, 'gantt-500');
		const cdp = await page.context().newCDPSession(page);
		const drag = async (x0: number, x1: number, y: number): Promise<void> => {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [{ x: x0, y }],
			});
			for (let i = 1; i <= 10; i++) {
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y }],
				});
			}
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		};
		const frames = await sampleWhile(page, async () => {
			// Far right: swipes with a fling, past the end (the over-scroll), then all the way back.
			for (let i = 0; i < 40; i++) await drag(380, 90, 430);
			await page.waitForTimeout(500);
			for (let i = 0; i < 60; i++) await drag(90, 380, 430);
		});
		assertLongPan(frames);
		if (process.env['SCREENSHOTS']) {
			fs.writeFileSync(
				evidence('header-scroll-pixel7-longpan.json'),
				JSON.stringify(
					summary(frames, 'Pixel 7 emulation, touch swipes with fling, far right and back'),
					null,
					1,
				) + '\n',
			);
		}
	});

	test('a long shift-wheel pan to the far right and back keeps the name column and the labels in place (desktop)', async ({
		page,
	}, info) => {
		test.skip(info.project.name !== 'desktop');
		await open(page, 'gantt-500');
		const box = await page.getByTestId('gantt-overlay').boundingBox();
		if (!box) throw new Error('no chart');
		await page.mouse.move(box.x + box.width / 2, box.y + 200);
		const frames = await sampleWhile(page, async () => {
			await page.keyboard.down('Shift');
			for (let i = 0; i < 150; i++) {
				await page.mouse.wheel(0, 900);
			}
			await page.waitForTimeout(400);
			for (let i = 0; i < 150; i++) {
				await page.mouse.wheel(0, -900);
			}
			await page.keyboard.up('Shift');
		});
		assertLongPan(frames);
		if (process.env['SCREENSHOTS']) {
			fs.writeFileSync(
				evidence('header-scroll-desktop.json'),
				JSON.stringify(
					summary(frames, 'Desktop Chrome, shift-wheel, far right and back'),
					null,
					1,
				) + '\n',
			);
		}
	});
});
