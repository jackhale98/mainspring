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
		// Frame sampling can miss a whole 200 ms animation where few frames are painted (headless
		// WebKit on a CI runner), so animations and the closing mark are also caught as they start:
		// a script `animate()` on the element, a CSS animation's `animationstart`, and the
		// `data-closing` attribute through a MutationObserver.
		const note = (el: Element): void => {
			for (const a of el.getAnimations()) {
				const fx = a.effect;
				if (!(fx instanceof KeyframeEffect)) continue;
				for (const k of fx.getKeyframes())
					for (const p of Object.keys(k))
						if (!skip.has(p) && !w.__props.includes(p)) w.__props.push(p);
			}
		};
		const hooks = window as unknown as {
			__sheetHooks?: { sel: string; off: () => void };
		};
		hooks.__sheetHooks?.off();
		const proto = Element.prototype;
		const animate = proto.animate;
		proto.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
			const anim = animate.apply(this, args);
			if (this === document.querySelector(sel)) note(this);
			return anim;
		};
		const started = (e: Event): void => {
			if (e.target instanceof Element && e.target === document.querySelector(sel)) note(e.target);
		};
		document.addEventListener('animationstart', started, true);
		const watch = new MutationObserver(() => {
			const el = document.querySelector(sel);
			if (el instanceof HTMLDialogElement && el.open && el.hasAttribute('data-closing')) {
				if (!w.__closing) w.__titles.push(el.querySelector('h2')?.textContent ?? '');
				w.__closing = true;
				if (w.__closeAt < 0) w.__closeAt = w.__rec.length;
			}
		});
		watch.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['data-closing'],
		});
		hooks.__sheetHooks = {
			sel,
			off: () => {
				proto.animate = animate;
				document.removeEventListener('animationstart', started, true);
				watch.disconnect();
			},
		};
		tick();
	}, selector);

/** Stops recording; the top edge in every frame the element was on screen. */
export const stopRecording = (page: Page): Promise<number[]> =>
	page.evaluate(() => {
		const w = window as unknown as Rec;
		cancelAnimationFrame(w.__raf);
		(window as unknown as { __sheetHooks?: { off: () => void } }).__sheetHooks?.off();
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
 * Slows the sheets' motion (the tokens that the CSS and Sheet.svelte read, set on the root) so that
 * the recorder sees all of it. Headless WebKit on a software renderer draws the first frame after a
 * sheet opens 200 to 300 ms late, while the page is idle: the app's large blurred panel shadows
 * (`.panel`, `--shadow-panel`) are what it spends the time on (the stall drops to about 80 ms with
 * every box-shadow off, and a bare page with a dialog and the same slide has none; measured
 * 2026-11-18). An ease-out slide of 200
 * ms is therefore over before its first frame: one or two samples, no `animationstart`, and no
 * animation left to inspect. A slide ten times as long is seen in many frames; it has the same
 * keyframes, easing and code path, so a jump, a reversal or a gap still shows. Call it once the page
 * is loaded and before the sheet moves.
 */
export const slowSheets = (page: Page, full = false, ms = 2000): Promise<void> =>
	// `full` keeps the production speed (200 and 180 ms) for the @timing copies on Chromium, which
	// draws every frame; every other run slows the sheets, on every browser (ADR-0016 section 1).
	full
		? Promise.resolve()
		: page.evaluate((t) => {
				const root = document.documentElement.style;
				root.setProperty('--sheet-ms', String(t));
				root.setProperty('--sheet-out-ms', String(t));
			}, ms);

/** How long to record after a sheet starts to move: the slowed slide and the renderer's late first frame, or (`full`) the production slide. */
export const settleMs = (full = false): number => (full ? 700 : 2800);

/**
 * The two tiers of a sheet-motion test: the shape check (slowed, every browser, merge tier) and its
 * `@timing` copy (production speed, Chromium only; the spec skips it elsewhere).
 */
export const SPEEDS = [
	{ full: false, suffix: '', tag: [] as string[] },
	{ full: true, suffix: ' (full speed)', tag: ['@timing'] },
] as const;

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
