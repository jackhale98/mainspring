// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGestureController, type GestureEnv, type GestureIntent } from './controller';
import { calendarDragSnapper, type DragSnapper } from './snap';
import {
	BODY,
	EMPTY,
	END_HANDLE,
	ESCAPE,
	LINK_DOT,
	OTHER_BAR,
	PROGRESS,
	RESET,
	ROW_HANDLE,
	SELECTED,
	down,
	move,
	timer,
	up,
} from './testing';
import type { GestureInput } from './types';

const M = 'mouse' as const;
const T = 'touch' as const;
const DAY = 1440;

/** 1 px = 60 minutes, calendar-day snapping; the start is on day 2, the end on day 5. */
function env(over: Partial<GestureEnv> = {}): GestureEnv {
	return {
		minutesAt: (x) => x * 60,
		snap: calendarDragSnapper(),
		edgeMin: (_bar, mode) => (mode === 'move' ? 2 * DAY : 5 * DAY),
		...over,
	};
}

function run(
	c: ReturnType<typeof createGestureController>,
	events: GestureInput[],
): GestureIntent[] {
	return events.flatMap((e) => [...c.send(e)]);
}
const types = (xs: readonly { type: string }[]) => xs.map((x) => x.type);

describe('time drags', () => {
	it('a body drag reports the snapped working days and movement, live and at the drop', () => {
		const c = createGestureController(env());
		// +100 px = 6000 min = 4.2 days: 4 days; the start goes from day 2 to day 6.
		const out = run(c, [down(M, 0, 0, 0), move(M, 100, 0, 10), up(M, 100, 0, 20)]);
		expect(types(out)).toEqual(['capture', 'drag-start', 'drag-move', 'release', 'drag-end']);
		expect(out[1]).toMatchObject({ type: 'drag-start', mode: 'move', x: 0, y: 0 });
		expect(out[2]).toMatchObject({
			type: 'drag-move',
			mode: 'move',
			dx: 100,
			time: { deltaMin: 4 * DAY, snappedMin: 6 * DAY, days: 4 },
		});
		expect(out[4]).toMatchObject({
			type: 'drag-end',
			time: { deltaMin: 4 * DAY, snappedMin: 6 * DAY, days: 4 },
		});
	});

	it('asks the snapper to move for a body and to resize for the end handle', () => {
		const calls: string[] = [];
		const inner = calendarDragSnapper();
		const spy: DragSnapper = {
			...inner,
			move: (r, d) => (calls.push('move'), inner.move(r, d)),
			resize: (r, d) => (calls.push('resize'), inner.resize(r, d)),
		};
		run(createGestureController(env({ snap: spy })), [
			down(M, 0, 0, 0),
			move(M, 100, 0, 10),
			up(M, 100, 0, 20),
		]);
		expect(new Set(calls)).toEqual(new Set(['move']));
		calls.length = 0;
		const out = run(createGestureController(env({ snap: spy })), [
			down(M, 0, 0, 0, { target: END_HANDLE }),
			move(M, 50, 0, 10),
			up(M, 50, 0, 20),
		]);
		expect(new Set(calls)).toEqual(new Set(['resize']));
		expect(out[1]).toMatchObject({ mode: 'resize-end' });
		// +50 px = 3000 min on an end at day 5 (7200).
		expect(out.at(-1)).toMatchObject({
			type: 'drag-end',
			time: { deltaMin: 3000, snappedMin: 7200 + 3000, days: null },
		});
	});

	it('a drag too small to change the snapped date is a cancel, not an edit', () => {
		const c = createGestureController(env());
		const out = run(c, [down(M, 0, 0, 0), move(M, 10, 0, 10), up(M, 10, 0, 20)]);
		expect(out.at(-1)).toEqual({ type: 'cancel', reason: 'no-change' });
		expect(types(out)).not.toContain('drag-end');
	});

	it('back at the origin the label shows no movement even for an off-grid edge', () => {
		const c = createGestureController(env({ edgeMin: () => 2 * DAY + 77 }));
		const out = run(c, [down(M, 0, 0, 0), move(M, 100, 0, 10), move(M, 1, 0, 20)]);
		expect(out.at(-1)).toMatchObject({
			atOrigin: true,
			time: { deltaMin: 0, snappedMin: 2 * DAY + 77, days: 0 },
		});
	});

	it('dragging back to the origin and dropping cancels', () => {
		const c = createGestureController(env());
		const out = run(c, [down(M, 0, 0, 0), move(M, 100, 0, 10), up(M, 1, 0, 20)]);
		expect(out.at(-1)).toEqual({ type: 'cancel', reason: 'back-to-origin' });
	});

	it('uses the pointer minute as the reference when the row has no dates', () => {
		const c = createGestureController(env({ edgeMin: () => null }));
		const out = run(c, [down(M, 40, 0, 0), move(M, 140, 0, 10)]);
		// Reference: 40 px = 2400 min. +6000 min = 4 days.
		expect(out.at(-1)).toMatchObject({ time: { deltaMin: 4 * DAY, snappedMin: 2400 + 4 * DAY } });
		const r = run(createGestureController(env({ edgeMin: () => null })), [
			down(M, 0, 0, 0, { target: END_HANDLE }),
			move(M, 10, 0, 10),
		]);
		expect(r.at(-1)).toMatchObject({ time: { deltaMin: 600 } });
	});

	it('reads the origin minute once, at the drag start: a zoom mid-drag does not move it', () => {
		let scale = 60;
		const c = createGestureController(env({ minutesAt: (x) => x * scale, edgeMin: () => 0 }));
		run(c, [down(M, 10, 0, 0, { target: END_HANDLE }), move(M, 100, 0, 10)]);
		scale = 120;
		const out = run(c, [move(M, 90, 0, 20, { target: END_HANDLE })]);
		// Origin 10 px at 60 = 600 min; the pointer is now at 90 px * 120 = 10800: 10200 min.
		expect(out.at(-1)).toMatchObject({ time: { deltaMin: 10200 } });
	});

	it('Escape and reset cancel with their reason, and the drop afterwards is nothing', () => {
		for (const [input, reason] of [
			[ESCAPE, 'escape'],
			[RESET, 'reset'],
		] as const) {
			const c = createGestureController(env());
			const out = run(c, [down(M, 0, 0, 0), move(M, 100, 0, 10), input, up(M, 100, 0, 20)]);
			expect(out.slice(-2).map((o) => o.type)).toEqual(['release', 'cancel']);
			expect(out.at(-1)).toEqual({ type: 'cancel', reason });
			expect(c.state).toBe('idle');
		}
	});

	it('a touch body drag needs the long-press, and reports the lift first', () => {
		const c = createGestureController(env());
		const out = run(c, [down(T, 0, 0, 0), timer(350), move(T, 100, 0, 400), up(T, 100, 0, 420)]);
		expect(types(out)).toEqual([
			'long-press',
			'capture',
			'drag-start',
			'drag-move',
			'release',
			'drag-end',
		]);
		expect(c.timerAt).toBeNull();
	});

	it('exposes claimsTouch from the machine', () => {
		const c = createGestureController(env(), {}, SELECTED);
		c.send(down(T, 0, 0, 0, { target: END_HANDLE }));
		expect(c.claimsTouch).toBe(true);
		c.send(ESCAPE);
		c.send(down(T, 0, 0, 10));
		expect(c.claimsTouch).toBe(false);
	});
});

describe('other drag modes', () => {
	it('progress and row drags carry pixels and no time', () => {
		const c = createGestureController(env(), {}, SELECTED);
		const p = run(c, [
			down(T, 0, 0, 0, { target: PROGRESS }),
			move(T, 30, 5, 10),
			up(T, 30, 5, 20),
		]);
		expect(p[1]).toMatchObject({ type: 'drag-start', mode: 'progress' });
		expect(p.at(-1)).toMatchObject({
			type: 'drag-end',
			mode: 'progress',
			dx: 30,
			dy: 5,
			time: null,
		});
		const r = run(c, [
			down(M, 10, 10, 100, { target: ROW_HANDLE }),
			move(M, 40, 90, 110, { target: EMPTY }),
			up(M, 40, 90, 120, { target: EMPTY }),
		]);
		expect(r[1]).toMatchObject({ mode: 'row' });
		expect(r.at(-1)).toMatchObject({
			type: 'drag-end',
			mode: 'row',
			dx: 30,
			dy: 80,
			target: EMPTY,
			time: null,
		});
	});
});

describe('link drags', () => {
	const linkMoves = (out: GestureIntent[]) => out.filter((o) => o.type === 'link-hover');

	it('reports linkStart, a linkMove per move, linkHover when the target bar changes, and linkDrop', () => {
		const c = createGestureController(env(), {}, SELECTED);
		const out = run(c, [
			down(T, 0, 0, 0, { target: LINK_DOT }),
			move(T, 30, 0, 10, { target: EMPTY }),
			move(T, 60, 0, 20, { target: OTHER_BAR }),
			move(T, 62, 0, 30, { target: OTHER_BAR }),
			move(T, 90, 0, 40, { target: EMPTY }),
			move(T, 120, 0, 50, { target: OTHER_BAR }),
			up(T, 120, 0, 60, { target: OTHER_BAR }),
		]);
		expect(types(out)).toEqual([
			'capture',
			'link-start',
			'link-move',
			'link-move',
			'link-hover',
			'link-move',
			'link-move',
			'link-hover',
			'link-move',
			'link-hover',
			'release',
			'link-drop',
		]);
		expect(out[1]).toEqual({ type: 'link-start', from: 2, x: 0, y: 0 });
		expect(
			out.filter((o) => o.type === 'link-move').map((o) => (o.type === 'link-move' ? o.x : 0)),
		).toEqual([30, 60, 62, 90, 120]);
		expect(linkMoves(out).map((o) => (o.type === 'link-hover' ? o.target?.row : -1))).toEqual([
			5,
			undefined,
			5,
		]);
		expect(out.at(-1)).toEqual({ type: 'link-drop', from: 2, to: OTHER_BAR });
	});

	it('a drop that is not on a bar is a cancel', () => {
		const c = createGestureController(env());
		const out = run(c, [
			down(M, 0, 0, 0, { target: LINK_DOT }),
			move(M, 50, 0, 10, { target: EMPTY }),
			up(M, 50, 0, 20, { target: EMPTY }),
		]);
		expect(out.at(-1)).toEqual({ type: 'cancel', reason: 'no-target' });
	});

	it('a drop on the source bar is reported, so the dispatcher can say cycle', () => {
		const c = createGestureController(env());
		const out = run(c, [
			down(M, 0, 0, 0, { target: LINK_DOT }),
			move(M, 50, 0, 10, { target: BODY }),
			up(M, 50, 0, 20, { target: BODY }),
		]);
		expect(out.at(-1)).toEqual({ type: 'link-drop', from: 2, to: BODY });
	});

	it('Escape cancels the link', () => {
		const c = createGestureController(env());
		const out = run(c, [
			down(M, 0, 0, 0, { target: LINK_DOT }),
			move(M, 50, 0, 10, { target: OTHER_BAR }),
			ESCAPE,
		]);
		expect(out.at(-1)).toEqual({ type: 'cancel', reason: 'escape' });
	});

	it('a tap on the link dot is a tap (link mode starts from it)', () => {
		const c = createGestureController(env(), {}, SELECTED);
		expect(
			types(
				run(c, [down(T, 0, 0, 0, { target: LINK_DOT }), up(T, 0, 0, 50, { target: LINK_DOT })]),
			),
		).toEqual(['tap']);
	});
});

describe('pass-through and hooks', () => {
	it('passes pinch and two-finger pan on unchanged, in viewport coordinates', () => {
		const c = createGestureController(env());
		const out = run(c, [
			down(T, 100, 100, 0, { id: 1 }),
			down(T, 200, 100, 5, { id: 2 }),
			move(T, 50, 100, 10, { id: 1 }),
			up(T, 50, 100, 20, { id: 1 }),
		]);
		expect(types(out)).toEqual(['pinch', 'pan2', 'pinch-end']);
		expect(out[0]).toEqual({ type: 'pinch', scale: 1, cx: 150, cy: 100 });
	});

	it('exposes the machine state and honours the canDrag hook', () => {
		const c = createGestureController(env(), {}, { canDrag: () => false });
		run(c, [down(M, 0, 0, 0), move(M, 50, 0, 10)]);
		expect(c.state).toBe('native');
	});
});

describe('controller properties', () => {
	const stepArb = fc.record({
		kind: fc.constantFrom('down', 'move', 'move', 'move', 'up', 'escape', 'reset'),
		x: fc.integer({ min: -80, max: 200 }),
		target: fc.constantFrom(BODY, END_HANDLE, LINK_DOT, PROGRESS, ROW_HANDLE, OTHER_BAR, EMPTY),
		dt: fc.integer({ min: 0, max: 400 }),
	});
	it('every drag-end carries a real change, and Escape ends idle', () => {
		fc.assert(
			fc.property(fc.constantFrom(M, T), fc.array(stepArb, { maxLength: 40 }), (kind, steps) => {
				const c = createGestureController(env(), {}, SELECTED);
				let t = 0;
				const out: GestureIntent[] = [];
				for (const s of steps) {
					t += s.dt;
					if (s.kind === 'escape') out.push(...c.send(ESCAPE));
					else if (s.kind === 'reset') out.push(...c.send(RESET));
					else if (s.kind === 'down')
						out.push(...c.send(down(kind, s.x, 0, t, { target: s.target })));
					else if (s.kind === 'move')
						out.push(...c.send(move(kind, s.x, 0, t, { target: s.target })));
					else out.push(...c.send(up(kind, s.x, 0, t, { target: s.target })));
				}
				out.push(...c.send(ESCAPE));
				expect(c.state).toBe('idle');
				for (const o of out) {
					if (o.type !== 'drag-end' && o.type !== 'drag-move') continue;
					if (!o.time) continue;
					if (o.time.days !== null) expect(Math.abs(o.time.snappedMin % DAY)).toBe(0);
					if (o.type === 'drag-end') expect(o.time.deltaMin).not.toBe(0);
				}
			}),
			{ numRuns: 300 },
		);
	});
});
