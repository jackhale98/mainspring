// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The task list's edge auto-scroll while a row is dragged (row-drag.svelte.ts): a drag that begins
// inside the bottom band and moves away from the edge does not scroll the list; one that goes
// toward the edge does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DropRow, Tree } from '../../lib/gantt/reorder';
import { AUTOSCROLL_ARM_PX } from '../../lib/gesture/autoscroll';
import { fakeScroller, pointerEvent } from '../../lib/gesture/dom-testing';
import { RowDrag, type RowDragHost } from './row-drag.svelte';

const KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** The list's rows are y 100 to 500 (rows of 40 px): the bottom band is 452 to 500. */
function rig() {
	const scroller = fakeScroller({ top: 100, width: 300, height: 400, contentHeight: 1200 });
	const grip = document.createElement('div');
	scroller.append(grip);
	document.body.append(scroller);
	const rows: DropRow[] = KEYS.map((key) => ({ key, depth: 0, kind: 'task', expanded: null }));
	const tree: Tree = new Map(
		KEYS.map((key) => [key, { key, id: key, parent: null, children: [] }] as const),
	);
	const host: RowDragHost = {
		rows: () => rows,
		tree: () => tree,
		roots: () => KEYS,
		rowHeight: () => 40,
		bodyTop: () => 100 - scroller.scrollTop,
		visible: () => ({ left: 0, top: 100, right: 300, bottom: 500 }),
		scroller: () => scroller,
		nameOf: (key) => key,
		open: vi.fn(),
		move: vi.fn(),
		announce: vi.fn(),
	};
	const drag = new RowDrag(host);
	grip.addEventListener('pointerdown', (e) => drag.down(e as PointerEvent, 'a'));
	const send = (name: string, y: number): void => {
		const target: EventTarget = name === 'pointerdown' ? grip : window;
		target.dispatchEvent(pointerEvent(name, { x: 50, y }));
	};
	/** A press at `from`, then the pointer to `to` in steps of 2 px, one animation frame each. */
	const run = (from: number, to: number): void => {
		send('pointerdown', from);
		const dir = Math.sign(to - from);
		for (let y = from + 2 * dir; dir * (to - y) >= 0; y += 2 * dir) {
			send('pointermove', y);
			vi.advanceTimersByTime(16);
		}
		vi.advanceTimersByTime(16 * 10);
	};
	return { scroller, run, send, drag };
}

describe('the task list auto-scroll for a dragged row', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('scrolls when the drag goes into the bottom band from the middle', () => {
		const { scroller, run, send, drag } = rig();
		run(300, 490);
		expect(scroller.scrollTop).toBeGreaterThan(0);
		send('pointerup', 490);
		drag.dispose();
	});

	it('does not scroll toward the edge for a drag that began in the band and moves away from it', () => {
		const { scroller, run, send, drag } = rig();
		run(490, 420);
		expect(scroller.scrollTop).toBe(0);
		send('pointerup', 420);
		drag.dispose();
	});

	it('scrolls once a drag that began in the band goes toward the edge by the arming distance', () => {
		const { scroller, run, send, drag } = rig();
		run(480, 480 + AUTOSCROLL_ARM_PX + 6);
		expect(scroller.scrollTop).toBeGreaterThan(0);
		send('pointerup', 480);
		drag.dispose();
	});
});
