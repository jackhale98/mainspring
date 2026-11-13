// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt behaves like a native app (phase-2.md 9.2): the page never scrolls, the corner is
// fixed, the date header is frozen at the top and moves only sideways, the name column is frozen
// at the left and moves only up and down, and names and bars share one vertical scroll. The
// header is not repainted per scroll event (it moves with the content on the compositor). Run on
// Pixel 7 emulation (touch) and on desktop. With SCREENSHOTS=1 the Pixel 7 run also writes its
// frame log to docs/phases/screenshots/phase-2/header-scroll-pixel7.json as evidence.
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

declare global {
	interface Window {
		__headerPaints?: number;
		__frames?: Array<Record<string, number>>;
	}
}

async function open(page: Page): Promise<void> {
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
	await page.goto('/app?sample=upstream-fedora-20&mode=visual');
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
});
