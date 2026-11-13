// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createGestureMachine } from './machine';
import {
	BODY,
	EMPTY,
	END_HANDLE,
	RESET,
	SELECTED,
	down,
	kinds,
	move,
	run,
	scroll,
	timer,
	up,
} from './testing';
import type { GestureInput, GestureOutput } from './types';

const M = 'mouse' as const;
const P = 'pen' as const;
const T = 'touch' as const;
const a = { id: 1 };
const b = { id: 2 };

describe('reset (lostpointercapture, visibilitychange, blur)', () => {
	const cases: Array<[string, GestureInput[], string[]]> = [
		['idle', [], []],
		['pressed', [down(T, 10, 10, 0)], []],
		['armed', [down(T, 10, 10, 0), timer(350)], ['drag-cancel']],
		['dragging', [down(M, 10, 10, 0), move(M, 60, 10, 10)], ['release', 'drag-cancel']],
		['pinching', [down(T, 10, 10, 0, a), down(T, 90, 10, 5, b)], ['pinch-end']],
		['native', [down(T, 10, 10, 0), move(T, 10, 60, 10)], []],
	];
	it.each(cases)(
		'from %s: back to idle, and the rest of the press is ignored',
		(_s, events, out) => {
			const m = createGestureMachine();
			run(m, events);
			expect(kinds(m.send(RESET))).toEqual(out);
			expect(m.state).toBe('idle');
			expect(m.timerAt).toBeNull();
			expect(run(m, [move(M, 90, 10, 600), up(M, 90, 10, 610), up(T, 10, 10, 620, a)])).toEqual([]);
		},
	);

	it('reports its own reason', () => {
		const m = createGestureMachine();
		run(m, [down(M, 10, 10, 0), move(M, 60, 10, 10)]);
		expect(m.send(RESET).at(-1)).toEqual({ type: 'drag-cancel', reason: 'reset' });
	});
});

describe('claimsTouch: when the wiring must preventDefault touchmove', () => {
	it('is false until the machine owns the finger, then true until the gesture ends', () => {
		const m = createGestureMachine({}, SELECTED);
		expect(m.claimsTouch).toBe(false);
		m.send(down(T, 10, 10, 0));
		expect(m.claimsTouch).toBe(false); // a long-press is pending: the browser may still scroll
		m.send(timer(350));
		expect(m.claimsTouch).toBe(true); // lifted
		m.send(move(T, 90, 10, 400));
		expect(m.claimsTouch).toBe(true); // dragging
		m.send(up(T, 90, 10, 420));
		expect(m.claimsTouch).toBe(false);
	});

	it('is true at once for a selected bar handle, false for the same handle unselected', () => {
		const selected = createGestureMachine({}, SELECTED);
		selected.send(down(T, 10, 10, 0, { target: END_HANDLE }));
		expect(selected.claimsTouch).toBe(true);
		const unselected = createGestureMachine();
		unselected.send(down(T, 10, 10, 0, { target: END_HANDLE }));
		expect(unselected.claimsTouch).toBe(false);
	});

	it('is true while pinching and false once handed to native scrolling', () => {
		const m = createGestureMachine();
		run(m, [down(T, 10, 10, 0, a), down(T, 90, 10, 5, b)]);
		expect(m.claimsTouch).toBe(true);
		const n = createGestureMachine();
		run(n, [down(T, 10, 10, 0), move(T, 10, 60, 10)]);
		expect(n.state).toBe('native');
		expect(n.claimsTouch).toBe(false);
	});

	it('is false for a mouse press, which has no touchmove to cancel', () => {
		const m = createGestureMachine();
		m.send(down(M, 10, 10, 0));
		expect(m.claimsTouch).toBe(false);
	});
});

describe('pen buttons', () => {
	it('ignores the barrel button and the eraser, accepts the pen tip', () => {
		const m = createGestureMachine();
		expect(m.send(down(P, 10, 10, 0, { buttons: 3 }))).toEqual([]);
		expect(m.state).toBe('idle');
		expect(m.send(down(P, 10, 10, 0, { buttons: 32 }))).toEqual([]);
		expect(m.state).toBe('idle');
		m.send(down(P, 10, 10, 0, { buttons: 1 }));
		expect(m.state).toBe('pressed');
	});

	it('detects a lost release for a pen, as for a mouse', () => {
		const m = createGestureMachine();
		run(m, [down(P, 10, 10, 0), move(P, 60, 10, 10)]);
		const out = m.send(move(P, 70, 10, 20, { buttons: 0 }));
		expect(kinds(out)).toEqual(['release', 'drag-cancel']);
		expect(out.at(-1)).toEqual({ type: 'drag-cancel', reason: 'lost-release' });
		const pressed = createGestureMachine();
		run(pressed, [down(P, 10, 10, 0), move(P, 11, 10, 10, { buttons: 0 })]);
		expect(pressed.state).toBe('idle');
	});

	it('does not read a touch with no buttons as a lost release', () => {
		const m = createGestureMachine();
		run(m, [down(T, 10, 10, 0), timer(350), move(T, 60, 10, 400, { buttons: 0 })]);
		expect(m.state).toBe('dragging');
	});
});

describe('double tap', () => {
	const counts = (events: GestureInput[]): number[] => {
		const m = createGestureMachine();
		return run(m, events).flatMap((o: GestureOutput) => (o.type === 'tap' ? [o.count] : []));
	};
	const tap = (t: number, o: { target?: typeof BODY } = {}): GestureInput[] => [
		down(M, 10, 10, t, o),
		up(M, 10, 10, t + 40, o),
	];

	it('is measured from the first release to the second press, so a slow second press still counts', () => {
		// First tap released at 40; the second press is at 300 (260 later) and held until 700.
		expect(counts([...tap(0), down(M, 10, 10, 300), up(M, 10, 10, 700)])).toEqual([1, 2]);
		// The second press comes 360 ms after the release: too late.
		expect(counts([...tap(0), down(M, 10, 10, 400), up(M, 10, 10, 440)])).toEqual([1, 1]);
	});

	it('is not a double tap after a drag, a scroll or a hand-over to native scrolling', () => {
		expect(
			counts([...tap(0), down(M, 10, 10, 60), move(M, 80, 10, 70), up(M, 80, 10, 80), ...tap(100)]),
		).toEqual([1, 1]);
		expect(counts([...tap(0), scroll(50), ...tap(80)])).toEqual([1, 1]);
		expect(
			counts([
				...tap(0),
				down(T, 10, 10, 60, { target: EMPTY }),
				move(T, 10, 60, 70, { target: EMPTY }),
				up(T, 10, 60, 80, { target: EMPTY }),
				...tap(100),
			]),
		).toEqual([1, 1]);
	});

	it('a third quick tap starts a new count', () => {
		expect(counts([...tap(0), ...tap(100), ...tap(200)])).toEqual([1, 2, 1]);
	});
});
