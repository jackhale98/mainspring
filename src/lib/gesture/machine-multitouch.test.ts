// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createGestureMachine } from './machine';
import { BODY, END_HANDLE, ESCAPE, cancel, down, kinds, move, run, timer, up } from './testing';
import type { GestureOutput } from './types';

const M = 'mouse' as const;
const P = 'pen' as const;
const T = 'touch' as const;
const a = { id: 1 };
const b = { id: 2 };
const c = { id: 3 };

describe('two pointers: pinch and two-finger pan', () => {
	it('a second finger starts a pinch and cancels the single press without a tap', () => {
		const m = createGestureMachine();
		const out = run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 20, b)]);
		expect(out).toEqual([]);
		expect(m.state).toBe('pinching');
		expect(m.timerAt).toBeNull();
		expect(kinds(run(m, [timer(400), up(T, 100, 100, 500, a), up(T, 200, 100, 510, b)]))).toEqual([
			'pinch-end',
		]);
		expect(m.state).toBe('idle');
	});

	it('scales time by the finger distance, anchored at the centroid where the fingers began', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		const first = m.send(move(T, 50, 100, 10, a)); // gap 150, centroid 125
		expect(first).toEqual([
			{ type: 'pinch', scale: 1.5, cx: 150, cy: 100 },
			{ type: 'pan2', dx: -25, dy: 0 },
		]);
		const second = m.send(move(T, 250, 100, 20, b)); // gap 200, centroid 150
		expect(second).toEqual([
			{ type: 'pinch', scale: 2, cx: 150, cy: 100 },
			{ type: 'pan2', dx: 25, dy: 0 },
		]);
	});

	it('stays quiet inside the dead zone, so a held pair of fingers does not jitter the zoom', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		expect(m.send(move(T, 103, 101, 10, a))).toEqual([]);
		expect(m.send(move(T, 197, 99, 20, b))).toEqual([]);
	});

	it('a parallel two-finger move pans without zooming', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		// The fingers report one after the other, 5 px per step: the gap between them wobbles by
		// less than the dead zone while the pair travels 40 px right and 30 px down.
		const out: GestureOutput[] = [];
		for (let i = 1; i <= 10; i++) {
			out.push(...m.send(move(T, 100 + 4 * i, 100 + 3 * i, 10 * i, a)));
			out.push(...m.send(move(T, 200 + 4 * i, 100 + 3 * i, 10 * i + 5, b)));
		}
		expect(out.some((o) => o.type === 'pinch')).toBe(false);
		const pan = out.filter((o) => o.type === 'pan2');
		expect(pan.length).toBeGreaterThan(0);
		const dx = pan.reduce((s, o) => s + (o.type === 'pan2' ? o.dx : 0), 0);
		const dy = pan.reduce((s, o) => s + (o.type === 'pan2' ? o.dy : 0), 0);
		expect(dx).toBeCloseTo(40);
		expect(dy).toBeCloseTo(30);
	});

	it('fingers that begin on the same spot do not divide by zero', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 100, 100, 5, b)]);
		for (const o of m.send(move(T, 130, 100, 10, b))) {
			if (o.type === 'pinch') expect(Number.isFinite(o.scale)).toBe(true);
		}
	});

	it('a second finger while the item is lifted drops the lift and pinches', () => {
		const m = createGestureMachine();
		const out = run(m, [down(T, 100, 100, 0, a), timer(350), down(T, 200, 100, 400, b)]);
		expect(out).toEqual([
			expect.objectContaining({ type: 'long-press' }),
			{ type: 'drag-cancel', reason: 'second-pointer' },
		]);
		expect(m.state).toBe('pinching');
	});

	it('a second finger during a drag cancels it, releases the capture and pinches', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, { ...a, target: END_HANDLE }), move(T, 150, 100, 20, a)]);
		expect(m.state).toBe('dragging');
		expect(kinds(m.send(down(T, 300, 100, 40, b)))).toEqual(['release', 'drag-cancel']);
		expect(m.state).toBe('pinching');
	});

	it('lifting one finger ends the pinch and the other finger can neither tap nor drag', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		expect(kinds(m.send(up(T, 200, 100, 50, b)))).toEqual(['pinch-end']);
		expect(m.state).toBe('native');
		expect(run(m, [move(T, 160, 100, 60, a), timer(500), up(T, 160, 100, 70, a)])).toEqual([]);
		expect(m.state).toBe('idle');
	});

	it('a third finger is ignored, and so are its moves and its lift', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		const out = run(m, [
			down(T, 300, 100, 10, c),
			move(T, 330, 100, 15, c),
			up(T, 330, 100, 20, c),
		]);
		expect(out).toEqual([]);
		expect(m.state).toBe('pinching');
	});

	it('pointercancel (the browser took over) ends the pinch and forgets every finger', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		expect(kinds(m.send(cancel(T, 100, 100, 50, a)))).toEqual(['pinch-end']);
		expect(m.state).toBe('idle');
		expect(run(m, [move(T, 150, 100, 60, b), up(T, 150, 100, 70, b)])).toEqual([]);
	});

	it('Escape ends a pinch', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(T, 200, 100, 5, b)]);
		expect(kinds(m.send(ESCAPE))).toEqual(['pinch-end']);
		expect(m.state).toBe('idle');
	});
});

describe('pointers that are not a pinch', () => {
	it('a mouse next to a held finger does not disturb it', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), down(M, 400, 100, 10, b)]);
		expect(m.state).toBe('pressed');
		expect(
			kinds(run(m, [move(M, 450, 100, 20, b), up(M, 450, 100, 30, b), up(T, 100, 100, 100, a)])),
		).toEqual(['tap']);
	});

	it('a palm touch beside a pen stroke is ignored', () => {
		const m = createGestureMachine();
		run(m, [down(P, 100, 100, 0, a), down(T, 300, 300, 5, b)]);
		expect(kinds(run(m, [move(P, 150, 100, 10, a), move(T, 320, 300, 12, b)]))).toEqual([
			'capture',
			'drag-start',
			'drag-move',
		]);
		expect(kinds(run(m, [up(T, 320, 300, 15, b)]))).toEqual([]);
		expect(m.state).toBe('dragging');
	});

	it('a touch next to a mouse drag is ignored', () => {
		const m = createGestureMachine();
		run(m, [down(M, 100, 100, 0, a), move(M, 160, 100, 10, a)]);
		expect(m.send(down(T, 300, 300, 20, b))).toEqual([]);
		expect(m.state).toBe('dragging');
	});

	it('a second finger after the scroll was handed over is ignored', () => {
		const m = createGestureMachine();
		run(m, [down(T, 100, 100, 0, a), move(T, 100, 140, 50, a)]);
		expect(m.state).toBe('native');
		expect(m.send(down(T, 200, 100, 60, b))).toEqual([]);
		expect(m.state).toBe('native');
	});

	it('moves, lifts and cancels of pointers it never saw are ignored', () => {
		const m = createGestureMachine();
		expect(
			run(m, [move(T, 1, 1, 0, a), up(T, 1, 1, 1, a), cancel(T, 1, 1, 2, a), timer(500)]),
		).toEqual([]);
		expect(m.state).toBe('idle');
	});

	it('a repeated down for the same pointer (its up was lost) starts over', () => {
		const m = createGestureMachine();
		run(m, [down(M, 10, 10, 0), move(M, 60, 10, 10)]);
		const out = run(m, [down(M, 200, 10, 100), up(M, 200, 10, 120)]);
		expect(kinds(out)).toEqual(['release', 'drag-cancel', 'tap']);
		expect(m.state).toBe('idle');
	});

	it('two different fingers one after the other are two separate gestures', () => {
		const m = createGestureMachine();
		const out = run(m, [
			down(T, 10, 10, 0, a),
			up(T, 10, 10, 50, a),
			down(T, 300, 10, 100, b),
			up(T, 300, 10, 150, b),
		]);
		expect(kinds(out)).toEqual(['tap', 'tap']);
	});

	it('a press that ends in a lift then a drag still gets its own capture', () => {
		const m = createGestureMachine();
		const out = run(m, [
			down(T, 10, 10, 0, { ...a, target: BODY }),
			timer(350),
			move(T, 80, 10, 400, a),
		]);
		expect(out.filter((o) => o.type === 'capture')).toEqual([{ type: 'capture', id: 1 }]);
	});
});
