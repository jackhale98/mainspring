// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The month's edge auto-scroll during a drag (calendar-gestures.svelte.ts): a drag that begins
// inside the bottom band and moves away from the edge does not scroll the month; one that goes
// toward the edge does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSCROLL_ARM_PX } from '../../lib/gesture/autoscroll';
import { fakeScroller, pointerEvent } from '../../lib/gesture/dom-testing';
import { CalendarGestures, type CalendarHost } from './calendar-gestures.svelte';

/** The month's box is y 100 to 500: the bottom band is 452 to 500. */
function rig() {
	const scroller = fakeScroller({ top: 100, width: 300, height: 400, contentHeight: 1200 });
	const day = document.createElement('div');
	day.dataset['day'] = '3';
	scroller.append(day);
	document.body.append(scroller);
	document.elementFromPoint = () => day;
	const host: CalendarHost = {
		mode: () => 'select',
		scroller: () => scroller,
		valid: () => true,
		tap: vi.fn(),
		drop: vi.fn(),
		open: vi.fn(),
		announce: vi.fn(),
		label: () => 'day',
	};
	const gestures = new CalendarGestures(host);
	const stop = gestures.attach(scroller);
	const send = (name: string, y: number): void =>
		void scroller.dispatchEvent(pointerEvent(name, { x: 50, y }));
	/** A press at `from`, then the pointer to `to` in steps of 2 px, one animation frame each. */
	const drag = (from: number, to: number): void => {
		send('pointerdown', from);
		const dir = Math.sign(to - from);
		for (let y = from + 2 * dir; dir * (to - y) >= 0; y += 2 * dir) {
			send('pointermove', y);
			vi.advanceTimersByTime(16);
		}
		// The pointer stays where it is for a few frames.
		vi.advanceTimersByTime(16 * 10);
	};
	return { scroller, drag, send, stop };
}

describe('the month auto-scroll', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('scrolls when the drag goes into the bottom band from the middle', () => {
		const { scroller, drag, stop } = rig();
		drag(300, 490);
		expect(scroller.scrollTop).toBeGreaterThan(0);
		stop();
	});

	it('does not scroll toward the edge for a drag that began in the band and moves away from it', () => {
		const { scroller, drag, stop } = rig();
		drag(490, 420);
		expect(scroller.scrollTop).toBe(0);
		stop();
	});

	it('scrolls once a drag that began in the band goes toward the edge by the arming distance', () => {
		const { scroller, drag, stop } = rig();
		drag(480, 480 + AUTOSCROLL_ARM_PX + 6);
		expect(scroller.scrollTop).toBeGreaterThan(0);
		stop();
	});

	it('holds again in the next drag', () => {
		const { scroller, drag, send, stop } = rig();
		drag(300, 490);
		send('pointerup', 490);
		const after = scroller.scrollTop;
		scroller.scrollTop = 0;
		drag(490, 420);
		expect(after).toBeGreaterThan(0);
		expect(scroller.scrollTop).toBe(0);
		stop();
	});
});
