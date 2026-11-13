// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { Hit } from '../gantt/hit';
import { createGestureMachine } from './machine';
import {
	EMPTY,
	END_HANDLE,
	ESCAPE,
	LINK,
	LINK_DOT,
	ROW_HANDLE,
	cancel,
	down,
	kinds,
	move,
	run,
	runCases,
	SELECTED,
	timer,
	up,
	type Case,
} from './testing';
import type { GestureInput } from './types';

const M = 'mouse' as const;
const P = 'pen' as const;
const T = 'touch' as const;

const mouseAndPen: Case[] = [
	{
		name: 'a click is a tap',
		events: [down(M, 10, 10, 0), up(M, 10, 10, 50)],
		out: ['tap'],
		state: 'idle',
	},
	{
		name: 'a wiggle inside 3 px is still a click',
		events: [down(M, 10, 10, 0), move(M, 12, 11, 10), up(M, 12, 11, 20)],
		out: ['tap'],
		state: 'idle',
	},
	{
		name: 'moving past 3 px starts a captured drag, then follows the pointer and drops',
		events: [down(M, 10, 10, 0), move(M, 14, 10, 10), move(M, 40, 10, 20), up(M, 60, 10, 30)],
		out: ['capture', 'drag-start', 'drag-move', 'drag-move', 'release', 'drag-end'],
		state: 'idle',
	},
	{
		name: 'a pen needs more than 4 px',
		events: [down(P, 10, 10, 0), move(P, 14, 10, 5)],
		out: [],
		state: 'pressed',
	},
	{
		name: 'a pen drags past 4 px',
		events: [down(P, 10, 10, 0), move(P, 15, 10, 5)],
		out: ['capture', 'drag-start', 'drag-move'],
		state: 'dragging',
	},
	{
		name: 'a drop within the slop of the origin cancels with no edit',
		events: [down(M, 10, 10, 0), move(M, 50, 10, 10), move(M, 11, 10, 20), up(M, 11, 10, 30)],
		out: ['capture', 'drag-start', 'drag-move', 'drag-move', 'release', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'Escape cancels a drag; the rest of the press is ignored',
		events: [
			down(M, 10, 10, 0),
			move(M, 50, 10, 10),
			ESCAPE,
			move(M, 90, 10, 20),
			up(M, 90, 10, 30),
		],
		out: ['capture', 'drag-start', 'drag-move', 'release', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'pointercancel during a drag cancels',
		events: [down(M, 10, 10, 0), move(M, 50, 10, 10), cancel(M, 50, 10, 20)],
		out: ['capture', 'drag-start', 'drag-move', 'release', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'a mouse button released outside the window (no capture) cancels the drag',
		events: [down(M, 10, 10, 0), move(M, 50, 10, 10), move(M, 70, 10, 20, { buttons: 0 })],
		out: ['capture', 'drag-start', 'drag-move', 'release', 'drag-cancel'],
		state: 'idle',
	},
	{
		name: 'right and middle clicks are not gestures',
		events: [
			down(M, 10, 10, 0, { buttons: 2 }),
			up(M, 10, 10, 10),
			down(M, 10, 10, 20, { buttons: 4 }),
		],
		out: [],
		state: 'idle',
	},
	{
		name: 'dragging empty space is not a tap and not a drag',
		events: [down(M, 10, 10, 0, { target: EMPTY }), move(M, 60, 10, 10), up(M, 60, 10, 20)],
		out: [],
		state: 'idle',
	},
	{
		name: 'a link is selected by a tap',
		events: [down(M, 10, 10, 0, { target: LINK }), up(M, 10, 10, 20)],
		out: ['tap'],
		state: 'idle',
	},
	{
		name: 'a target the hook refuses never drags',
		events: [down(M, 10, 10, 0), move(M, 60, 10, 10), up(M, 60, 10, 20)],
		out: [],
		state: 'idle',
		hooks: { canDrag: () => false },
	},
	{
		name: 'the row handle drags with a mouse',
		events: [down(M, 10, 10, 0, { target: ROW_HANDLE }), move(M, 10, 60, 10)],
		out: ['capture', 'drag-start', 'drag-move'],
		state: 'dragging',
	},
];

runCases('gesture machine: mouse and pen', mouseAndPen);

describe('gesture machine details', () => {
	it('reports the long-press deadline for the wiring timer, only while pressed', () => {
		const m = createGestureMachine();
		expect(m.timerAt).toBeNull();
		m.send(down(T, 10, 10, 1000));
		expect(m.timerAt).toBe(1350);
		m.send(timer(1350));
		expect(m.timerAt).toBeNull();
		const handle = createGestureMachine({}, SELECTED);
		handle.send(down(T, 10, 10, 0, { target: END_HANDLE }));
		expect(handle.timerAt).toBeNull();
		const mouse = createGestureMachine();
		mouse.send(down(M, 10, 10, 0));
		expect(mouse.timerAt).toBeNull();
	});

	it('honours a custom long-press time and slop', () => {
		const m = createGestureMachine({ longPressMs: 500, slop: { mouse: 3, pen: 4, touch: 12 } });
		m.send(down(T, 10, 10, 0));
		expect(m.timerAt).toBe(500);
		expect(kinds(m.send(move(T, 10, 21, 100)))).toEqual([]);
		expect(kinds(m.send(move(T, 10, 23, 110)))).toEqual(['pan-native']);
	});

	it('starts the drag from where the press began and reports the current position', () => {
		const m = createGestureMachine();
		const out = run(m, [down(M, 10, 20, 0), move(M, 30, 25, 10)]);
		expect(out).toContainEqual(expect.objectContaining({ type: 'capture', id: 1 }));
		expect(out).toContainEqual(expect.objectContaining({ type: 'drag-start', x: 10, y: 20 }));
		expect(out).toContainEqual(
			expect.objectContaining({ type: 'drag-move', x: 30, y: 25, atOrigin: false }),
		);
	});

	it('flags a move back inside the slop so the label can say "cancel"', () => {
		const m = createGestureMachine();
		run(m, [down(M, 10, 10, 0), move(M, 50, 10, 10)]);
		expect(m.send(move(M, 12, 10, 20))).toEqual([
			expect.objectContaining({ type: 'drag-move', atOrigin: true }),
		]);
	});

	it('hands the pointer under it to the drag outputs (link drops need the target)', () => {
		const m = createGestureMachine({}, SELECTED);
		const out = run(m, [
			down(T, 10, 10, 0, { target: LINK_DOT }),
			move(T, 50, 10, 10, { target: { kind: 'bar', row: 5 } }),
			up(T, 50, 10, 20, { target: { kind: 'bar', row: 5 } }),
		]);
		expect(out.at(-1)).toMatchObject({ type: 'drag-end', target: { kind: 'bar', row: 5 } });
	});

	describe('taps', () => {
		const tapCounts = (events: GestureInput[]): number[] => {
			const m = createGestureMachine();
			return run(m, events).flatMap((o) => (o.type === 'tap' ? [o.count] : []));
		};
		it('counts a second tap within 300 ms on the same target as a double tap', () => {
			const taps = [
				down(M, 10, 10, 0),
				up(M, 10, 10, 40),
				down(M, 11, 10, 200),
				up(M, 11, 10, 240),
				down(M, 11, 10, 300),
				up(M, 11, 10, 340),
			];
			expect(tapCounts(taps)).toEqual([1, 2, 1]);
		});
		it('is a single tap when the second comes late, elsewhere or on another target', () => {
			expect(
				tapCounts([
					down(M, 10, 10, 0),
					up(M, 10, 10, 40),
					down(M, 10, 10, 500),
					up(M, 10, 10, 540),
				]),
			).toEqual([1, 1]);
			expect(
				tapCounts([
					down(M, 10, 10, 0),
					up(M, 10, 10, 40),
					down(M, 200, 10, 100),
					up(M, 200, 10, 140),
				]),
			).toEqual([1, 1]);
			expect(
				tapCounts([
					down(M, 10, 10, 0),
					up(M, 10, 10, 40),
					down(M, 10, 10, 100, { target: EMPTY }),
					up(M, 10, 10, 140, { target: EMPTY }),
				]),
			).toEqual([1, 1]);
		});
		it('carries the pressed target, the position and the modifiers', () => {
			const m = createGestureMachine();
			const e = {
				...up(M, 12, 13, 40),
				modifiers: { shift: true, alt: false, ctrl: false, meta: false },
			};
			const out = run(m, [down(M, 10, 10, 0, { target: LINK }), e]);
			expect(out).toEqual([
				{ type: 'tap', hit: LINK, count: 1, x: 12, y: 13, modifiers: e.modifiers },
			]);
		});
	});

	it('accepts a gantt Hit as a target (the library mirrors hit.ts)', () => {
		const hit: Hit = { kind: 'bar', row: 3 };
		const m = createGestureMachine();
		expect(kinds(run(m, [down(M, 1, 1, 0, { target: hit }), up(M, 1, 1, 10)]))).toEqual(['tap']);
	});
});
