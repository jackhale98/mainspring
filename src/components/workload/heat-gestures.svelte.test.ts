// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The workload plot's edge auto-scroll during a drag (heat-gestures.svelte.ts): a drag that begins
// inside an edge band and moves away from the edge does not scroll toward it; one that goes into
// a band from the middle, or toward the edge, does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSCROLL_ARM_PX } from '../../lib/gesture/autoscroll';
import { fakeScroller, pointerEvent } from '../../lib/gesture/dom-testing';
import type { CellTask } from '../../lib/workload/types';
import { HeatGestures, type HeatHost, type PressTarget } from './heat-gestures.svelte';

/** The plot is x 0 to 300 and y 0 to 400: the right band is 252 to 300, the bottom band 352 to 400. */
function rig() {
	const scroller = fakeScroller({
		width: 300,
		height: 400,
		contentWidth: 1200,
		contentHeight: 1200,
	});
	const overlay = document.createElement('div');
	scroller.append(overlay);
	document.body.append(scroller);
	// A cell with a movable task under every point: the press can become a drag.
	const target: PressTarget = {
		key: 1,
		cell: { row: 0, col: 0 },
		tasks: [{ task: 't' } as unknown as CellTask],
	};
	const host: HeatHost = {
		target: () => target,
		layout: () => {
			throw new Error('not read');
		},
		model: () => null,
		labels: () => null,
		origin: () => ({ left: 0, top: 0 }),
		scroller: () => scroller,
		visible: () => ({ x: 0, y: 0, w: 300, h: 400 }),
		tap: vi.fn(),
		open: vi.fn(),
		check: () => null,
		drop: vi.fn(),
		zoomStep: vi.fn(),
		announce: vi.fn(),
	};
	const gestures = new HeatGestures(host);
	const stop = gestures.attach(overlay);
	const send = (name: string, x: number, y: number): void =>
		void overlay.dispatchEvent(pointerEvent(name, { x, y }));
	/** A press at `from`, then the pointer to `to` in steps of 2 px, one animation frame each. */
	const drag = (from: [number, number], to: [number, number]): void => {
		send('pointerdown', ...from);
		const n = Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / 2);
		for (let i = 1; i <= n; i++) {
			send(
				'pointermove',
				from[0] + ((to[0] - from[0]) * i) / n,
				from[1] + ((to[1] - from[1]) * i) / n,
			);
			vi.advanceTimersByTime(16);
		}
		vi.advanceTimersByTime(16 * 10);
	};
	return { scroller, drag, stop };
}

describe('the workload plot auto-scroll', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('scrolls both ways when the drag goes into a band from the middle', () => {
		const a = rig();
		a.drag([150, 200], [290, 200]);
		expect(a.scroller.scrollLeft).toBeGreaterThan(0);
		a.stop();
		const b = rig();
		b.drag([150, 200], [150, 390]);
		expect(b.scroller.scrollTop).toBeGreaterThan(0);
		b.stop();
	});

	it('does not scroll toward the right edge for a drag that began in that band and moves away', () => {
		const { scroller, drag, stop } = rig();
		drag([290, 200], [220, 200]);
		expect(scroller.scrollLeft).toBe(0);
		stop();
	});

	it('does not scroll toward the bottom edge for a drag that began in that band and moves away', () => {
		const { scroller, drag, stop } = rig();
		drag([150, 390], [150, 320]);
		expect(scroller.scrollTop).toBe(0);
		stop();
	});

	it('holds each axis alone: the one the drag began away from still scrolls', () => {
		const { scroller, drag, stop } = rig();
		// Began in the right band, goes away from it and down into the bottom band.
		drag([290, 200], [220, 390]);
		expect(scroller.scrollLeft).toBe(0);
		expect(scroller.scrollTop).toBeGreaterThan(0);
		stop();
	});

	it('scrolls once a drag that began in a band goes toward the edge by the arming distance', () => {
		const { scroller, drag, stop } = rig();
		drag([270, 200], [270 + AUTOSCROLL_ARM_PX + 6, 200]);
		expect(scroller.scrollLeft).toBeGreaterThan(0);
		stop();
	});
});
