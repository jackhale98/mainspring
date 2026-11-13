// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createLayout, type GanttLayout } from '../layout';
import type { GanttModel } from '../model';
import { createScale } from '../scale';
import { D, metricsOf, modelOf, row } from '../testing';
import { BarMotion, MOTION_MS, motionFor } from './motion';
import { paintBars } from './bars';
import { frameOf } from './testing';

function clock(reduced = false) {
	let now = 1000;
	const queue: Array<(() => void) | null> = [];
	const motion = new BarMotion({
		now: () => now,
		reduced: () => reduced,
		schedule: (cb) => queue.push(cb),
		cancel: (h) => {
			queue[h - 1] = null;
		},
	});
	return {
		motion,
		advance: (ms: number) => void (now += ms),
		flush: () => {
			const run = queue.splice(0).filter((cb) => cb !== null);
			for (const cb of run) cb();
			return run.length;
		},
	};
}

const layoutOf = (m: GanttModel, pxPerDay = 48): GanttLayout =>
	createLayout(m, createScale(pxPerDay, 0), metricsOf(false), 1000);
const model = (...rows: ReturnType<typeof row>[]) => modelOf(rows);
const xOf = (l: GanttLayout, i: number) => l.barRect(i)?.x ?? NaN;

describe('BarMotion', () => {
	it('returns the layout it was given when nothing moved, and for the first model', () => {
		const { motion } = clock();
		const a = model(row(0, 0, 2 * D));
		const la = layoutOf(a);
		expect(motion.layoutFor(a, la)).toBe(la);
		expect(motion.animating).toBe(false);
		// The same model again, and a new one with the same dates.
		expect(motion.layoutFor(a, la)).toBe(la);
		const b = model(row(0, 0, 2 * D));
		const lb = layoutOf(b);
		expect(motion.layoutFor(b, lb)).toBe(lb);
	});

	it('glides a bar from its old position to its new one in 180 ms, keyed by task id', () => {
		const { motion, advance } = clock();
		const before = model(row(0, 0, 2 * D), row(1, 4 * D, 6 * D));
		motion.layoutFor(before, layoutOf(before));
		// Task 0 moves 10 days later; task 1 stays.
		const after = model(row(0, 10 * D, 12 * D), row(1, 4 * D, 6 * D));
		const target = layoutOf(after);
		const first = motion.layoutFor(after, target);
		expect(motion.animating).toBe(true);
		// At the start the bar is where it was, the other has not moved.
		expect(xOf(first, 0)).toBeCloseTo(0);
		expect(xOf(first, 1)).toBe(xOf(target, 1));
		advance(MOTION_MS / 2);
		const mid = motion.layoutFor(after, target);
		expect(xOf(mid, 0)).toBeGreaterThan(0);
		expect(xOf(mid, 0)).toBeLessThan(xOf(target, 0));
		// Eased out: more than half way at half the time.
		expect(xOf(mid, 0)).toBeGreaterThan(xOf(target, 0) / 2);
		// The width follows too, and the link geometry reads the moving bars.
		advance(MOTION_MS);
		expect(motion.layoutFor(after, target)).toBe(target);
		expect(motion.animating).toBe(false);
	});

	it('tweens rows too, so a bar whose row changed slides to it', () => {
		const { motion, advance } = clock();
		const a = model(row(0, 0, 2 * D), row(1, 0, 2 * D));
		motion.layoutFor(a, layoutOf(a));
		// A task is inserted above: id t1 moves from row 1 to row 2.
		const inserted = row(9, 0, 2 * D);
		const b = model(row(0, 0, 2 * D), inserted, row(1, 0, 2 * D));
		const target = layoutOf(b);
		const start = motion.layoutFor(b, target);
		expect(start.barRect(2)?.y).toBeCloseTo(target.barRect(1)?.y ?? NaN);
		advance(MOTION_MS / 2);
		const mid = motion.layoutFor(b, target);
		const from = target.barRect(1)?.y ?? NaN;
		const to = target.barRect(2)?.y ?? NaN;
		expect(mid.barRect(2)?.y).toBeGreaterThan(from);
		expect(mid.barRect(2)?.y).toBeLessThan(to);
		// A new task appears at once.
		expect(start.barRect(1)?.y).toBe(target.barRect(1)?.y);
	});

	it('does not animate a zoom or a shift of the first date: minutes did not change', () => {
		const { motion } = clock();
		const m = model(row(0, 0, 2 * D), row(1, 4 * D, 6 * D));
		motion.layoutFor(m, layoutOf(m, 48));
		// The same model at another zoom: the model is the same object, nothing to tween.
		const zoomed = layoutOf(m, 96);
		expect(motion.layoutFor(m, zoomed)).toBe(zoomed);
		// A rebuilt model with the same dates, at another zoom, is not a reschedule either.
		const again = model(row(0, 0, 2 * D), row(1, 4 * D, 6 * D));
		const l = layoutOf(again, 12);
		expect(motion.layoutFor(again, l)).toBe(l);
		expect(motion.animating).toBe(false);
	});

	it('does not animate the first schedule or a bar that was not scheduled before', () => {
		const { motion } = clock();
		const unscheduled = model(row(0, null, null));
		motion.layoutFor(unscheduled, layoutOf(unscheduled));
		const scheduled = model(row(0, 3 * D, 5 * D));
		const l = layoutOf(scheduled);
		expect(motion.layoutFor(scheduled, l)).toBe(l);
	});

	it('honours prefers-reduced-motion: bars jump', () => {
		const { motion } = clock(true);
		const a = model(row(0, 0, 2 * D));
		motion.layoutFor(a, layoutOf(a));
		const b = model(row(0, 9 * D, 11 * D));
		const l = layoutOf(b);
		expect(motion.layoutFor(b, l)).toBe(l);
		expect(motion.animating).toBe(false);
	});

	it('starts from what is on screen when another reschedule arrives mid-tween', () => {
		const { motion, advance } = clock();
		const a = model(row(0, 0, 2 * D));
		motion.layoutFor(a, layoutOf(a));
		const b = model(row(0, 10 * D, 12 * D));
		const lb = layoutOf(b);
		motion.layoutFor(b, lb);
		advance(MOTION_MS / 2);
		const shown = xOf(motion.layoutFor(b, lb), 0);
		// A new model with the bar back at the start: it glides from where it is now.
		const c = model(row(0, 0, 2 * D));
		const lc = layoutOf(c);
		const start = motion.layoutFor(c, lc);
		expect(xOf(start, 0)).toBeCloseTo(shown, 0);
	});

	it('asks for the next frame only while a tween runs, and a later request replaces an earlier', () => {
		const { motion, advance, flush } = clock();
		let repaints = 0;
		const a = model(row(0, 0, 2 * D));
		motion.layoutFor(a, layoutOf(a));
		motion.continueWith(() => repaints++);
		expect(flush()).toBe(0);
		const b = model(row(0, 5 * D, 7 * D));
		motion.layoutFor(b, layoutOf(b));
		motion.continueWith(() => repaints++);
		motion.continueWith(() => repaints++);
		expect(flush()).toBe(1);
		expect(repaints).toBe(1);
		advance(MOTION_MS + 1);
		motion.layoutFor(b, layoutOf(b));
		motion.continueWith(() => repaints++);
		expect(flush()).toBe(0);
	});
});

describe('paintBars with a tween', () => {
	it('repaints the bars layer only on animation frames, and stops when the tween ends', () => {
		const { motion, advance, flush } = clock();
		const before = model(row(0, 0, 2 * D));
		const first = frameOf(before);
		paintBars({ ...first.frame, motion });
		const after = model(row(0, 10 * D, 12 * D));
		const next = frameOf(after);
		next.rec.clear();
		paintBars({ ...next.frame, motion });
		const painted: number[] = [];
		const barX = () => next.rec.of('moveTo').map((c) => c[1] as number);
		painted.push(Math.min(...barX()));
		// One animation frame at a time, each a repaint of this layer, until it ends.
		let frames = 0;
		for (let guard = 0; guard < 40; guard++) {
			advance(16);
			next.rec.clear();
			if (flush() === 0) break;
			frames++;
			painted.push(Math.min(...barX()));
		}
		expect(frames).toBeGreaterThanOrEqual(8);
		expect(frames).toBeLessThanOrEqual(13);
		// Monotone: the bar moves right every frame, to rest at its place.
		for (let i = 1; i < painted.length; i++) {
			expect(painted[i] ?? 0).toBeGreaterThanOrEqual(painted[i - 1] ?? 0);
		}
		const rest = next.layout.barRect(0)?.x ?? NaN;
		expect(painted.at(-1) ?? 0).toBeLessThanOrEqual(rest + 4);
		expect(painted[0] ?? NaN).toBeLessThan(rest - 100);
	});

	it('keeps one motion per canvas context', () => {
		const a = frameOf(model(row(0, 0, D)));
		const b = frameOf(model(row(0, 0, D)));
		expect(motionFor(a.frame.ctx)).toBe(motionFor(a.frame.ctx));
		expect(motionFor(a.frame.ctx)).not.toBe(motionFor(b.frame.ctx));
	});
});
