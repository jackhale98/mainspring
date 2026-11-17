// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the sheet specs (phone-bugfixes.spec.ts, sheet-states.spec.ts): a frame-by-frame
 * recorder for a sheet's edges and animations, and the checks made on what it saw. A frame loop
 * records rather than an action followed by a check: on a loaded machine an action returns after a
 * 200 ms slide has ended. Smoothness itself cannot be asserted; what can is that only `transform`
 * moves, that the edge travels in many steps and the right way, and that no gap opens.
 */
import { expect, type Page } from '@playwright/test';
import { READY_TIMEOUT_MS } from './gantt-rig';

interface Rec {
	__rec: (number | null)[];
	__bot: (number | null)[];
	__raf: number;
	__props: string[];
	__closing: boolean;
	__closeAt: number;
	__titles: string[];
}

export interface Recording {
	/** The properties the element's animations changed (only `transform` may move a sheet). */
	props: string[];
	/** It was a dialog marked as closing while still open. */
	closing: boolean;
	/** The frame at which it was first seen closing (-1: never). */
	closeAt: number;
	/** Its heading's text, in every frame it was closing. */
	titles: string[];
	/** Its bottom edge in every frame it was on screen. */
	bottoms: number[];
}

/** Records, on every frame from now on, the top and bottom edges of the first element matching `selector`. */
export const record = (page: Page, selector: string): Promise<void> =>
	page.evaluate((sel) => {
		const w = window as unknown as Rec;
		w.__rec = [];
		w.__bot = [];
		w.__props = [];
		w.__titles = [];
		w.__closing = false;
		w.__closeAt = -1;
		const skip = new Set(['offset', 'easing', 'composite', 'computedOffset']);
		const r1 = (n: number): number => Math.round(n * 10) / 10;
		const tick = (): void => {
			const el = document.querySelector(sel);
			const shown = el !== null && el.getClientRects().length > 0;
			const box = shown ? el.getBoundingClientRect() : null;
			w.__rec.push(box ? r1(box.top) : null);
			w.__bot.push(box ? r1(box.bottom) : null);
			if (shown) {
				for (const a of el.getAnimations()) {
					const fx = a.effect;
					if (!(fx instanceof KeyframeEffect)) continue;
					for (const k of fx.getKeyframes())
						for (const p of Object.keys(k))
							if (!skip.has(p) && !w.__props.includes(p)) w.__props.push(p);
				}
				if (el instanceof HTMLDialogElement && el.open && el.hasAttribute('data-closing')) {
					w.__closing = true;
					if (w.__closeAt < 0) w.__closeAt = w.__rec.length - 1;
					w.__titles.push(el.querySelector('h2')?.textContent ?? '');
				}
			}
			w.__raf = requestAnimationFrame(tick);
		};
		tick();
	}, selector);

/** Stops recording; the top edge in every frame the element was on screen. */
export const stopRecording = (page: Page): Promise<number[]> =>
	page.evaluate(() => {
		const w = window as unknown as Rec;
		cancelAnimationFrame(w.__raf);
		return w.__rec.filter((v): v is number => v !== null);
	});

/** What the recording saw besides the top edge. */
export const recorded = (page: Page): Promise<Recording> =>
	page.evaluate(() => {
		const w = window as unknown as Rec;
		return {
			props: w.__props,
			closing: w.__closing,
			closeAt: w.__closeAt,
			titles: w.__titles,
			bottoms: w.__bot.filter((v): v is number => v !== null),
		};
	});

/** How many different places the edge was seen at: a jump is 2, a slide is many. */
export const steps = (tops: number[]): number => new Set(tops.map((t) => Math.round(t))).size;

/**
 * Drops a frame that was sampled between a layout change and the browser's resize notification,
 * which starts the glide before anything is painted: a lone spike at the start of a slide.
 */
export const despike = (t: number[]): number[] =>
	t.filter((v, i) => {
		const a = t[i - 1];
		const b = t[i + 1];
		return a === undefined || b === undefined || !((v - a) * (v - b) > 100);
	});

/** Every sample is at or below the one before it (a slide down), within a pixel. */
export const nonDecreasing = (t: number[]): boolean =>
	t.every((v, i) => i === 0 || v >= (t[i - 1] ?? 0) - 1);
/** Every sample is at or above the one before it (a slide up), within a pixel. */
export const nonIncreasing = (t: number[]): boolean =>
	t.every((v, i) => i === 0 || v <= (t[i - 1] ?? 0) + 1);

export async function ready(page: Page): Promise<void> {
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
}
