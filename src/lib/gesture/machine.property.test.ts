// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGestureMachine } from './machine';
import { BODY, EMPTY, END_HANDLE, LINK, LINK_DOT, OTHER_BAR, ROW_HANDLE, run } from './testing';
import {
	NO_MODIFIERS,
	type GestureInput,
	type GestureOutput,
	type GestureTarget,
	type PointerKind,
} from './types';

const TARGETS: readonly GestureTarget[] = [
	BODY,
	END_HANDLE,
	LINK_DOT,
	OTHER_BAR,
	ROW_HANDLE,
	EMPTY,
	LINK,
];
const IDS = [1, 2, 3] as const;

/** One abstract step; `build` turns a list of them into inputs with a rising clock. */
interface Step {
	readonly kind: 'down' | 'move' | 'up' | 'cancel' | 'timer' | 'scroll' | 'escape';
	readonly id: number;
	readonly dt: number;
	readonly x: number;
	readonly y: number;
	readonly target: number;
	readonly buttons: number;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
	kind: fc.constantFrom(
		'down',
		'move',
		'move',
		'move',
		'up',
		'cancel',
		'timer',
		'scroll',
		'escape',
	),
	id: fc.constantFrom(...IDS),
	dt: fc.integer({ min: 0, max: 300 }),
	x: fc.integer({ min: -60, max: 60 }),
	y: fc.integer({ min: -60, max: 60 }),
	target: fc.integer({ min: 0, max: TARGETS.length - 1 }),
	buttons: fc.constantFrom(0, 1, 1, 1, 2),
});

const kindsArb = fc.tuple(
	fc.constantFrom<PointerKind>('mouse', 'pen', 'touch'),
	fc.constantFrom<PointerKind>('mouse', 'pen', 'touch'),
	fc.constantFrom<PointerKind>('mouse', 'pen', 'touch'),
);

function build(kinds: readonly PointerKind[], steps: readonly Step[]): GestureInput[] {
	let t = 0;
	return steps.map((s): GestureInput => {
		t += s.dt;
		if (s.kind === 'escape') return { type: 'escape' };
		if (s.kind === 'timer' || s.kind === 'scroll') return { type: s.kind, t };
		return {
			type: s.kind,
			id: s.id,
			kind: kinds[s.id - 1] ?? 'touch',
			x: s.x,
			y: s.y,
			t,
			target: TARGETS[s.target] ?? BODY,
			buttons: s.buttons,
			modifiers: NO_MODIFIERS,
		};
	});
}

function touch(
	type: 'down' | 'move' | 'up',
	x: number,
	y: number,
	t: number,
	target: GestureTarget,
): GestureInput {
	return { type, id: 1, kind: 'touch', x, y, t, target, buttons: 1, modifiers: NO_MODIFIERS };
}

/**
 * What finger 1, the clock and the scroller can still do once finger 1's press is native: moves,
 * lifts, cancels, timers and scrolls, later than `after`. Other fingers and new presses are left
 * out, because those are new gestures and may edit.
 */
function fingerOneAfter(steps: readonly Step[], after: number): GestureInput[] {
	const events: GestureInput[] = [];
	for (const e of build(['touch', 'touch', 'touch'], steps)) {
		if (e.type === 'escape') events.push(e);
		else if (e.type === 'timer' || e.type === 'scroll') events.push({ ...e, t: e.t + after });
		else if (e.id === 1) {
			events.push({ ...e, type: e.type === 'down' ? 'move' : e.type, t: e.t + after });
		}
	}
	return events;
}

const EDITING = new Set(['tap', 'long-press', 'drag-start', 'drag-move', 'drag-end', 'capture']);
const RUNS = { numRuns: 400 };

describe('gesture machine properties', () => {
	it('Escape always returns to idle, with nothing pending', () => {
		fc.assert(
			fc.property(kindsArb, fc.array(stepArb, { maxLength: 40 }), (kinds, steps) => {
				const m = createGestureMachine();
				run(m, build(kinds, steps));
				m.send({ type: 'escape' });
				expect(m.state).toBe('idle');
				expect(m.timerAt).toBeNull();
			}),
			RUNS,
		);
	});

	it('pointercancel for every pointer always returns to idle', () => {
		fc.assert(
			fc.property(kindsArb, fc.array(stepArb, { maxLength: 40 }), (kinds, steps) => {
				const m = createGestureMachine();
				run(m, build(kinds, steps));
				for (const id of IDS) {
					m.send({
						type: 'cancel',
						id,
						kind: kinds[id - 1] ?? 'touch',
						x: 0,
						y: 0,
						t: 1e6,
						target: BODY,
						buttons: 0,
						modifiers: NO_MODIFIERS,
					});
				}
				expect(m.state).toBe('idle');
			}),
			RUNS,
		);
	});

	it('drags and pinches are balanced: starts and ends pair up, captures are released', () => {
		fc.assert(
			fc.property(kindsArb, fc.array(stepArb, { maxLength: 50 }), (kinds, steps) => {
				const m = createGestureMachine();
				const out: GestureOutput[] = run(m, build(kinds, steps));
				out.push(...m.send({ type: 'escape' }));
				let dragging = false;
				let pinching = false;
				let captured = 0;
				for (const o of out) {
					switch (o.type) {
						case 'capture':
							captured++;
							break;
						case 'release':
							captured--;
							break;
						case 'drag-start':
							expect(dragging).toBe(false);
							dragging = true;
							break;
						case 'drag-move':
							expect(dragging).toBe(true);
							break;
						case 'drag-end':
							expect(dragging).toBe(true);
							dragging = false;
							break;
						case 'drag-cancel':
							dragging = false;
							break;
						case 'pinch':
							pinching = true;
							expect(Number.isFinite(o.scale) && o.scale > 0).toBe(true);
							break;
						case 'pinch-end':
							pinching = false;
							break;
						default:
					}
				}
				expect(captured).toBe(0);
				expect(dragging).toBe(false);
				expect(pinching).toBe(false);
			}),
			RUNS,
		);
	});

	it('never edits from a scroll: a touch that moves past the slop before 350 ms only pans natively', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(BODY, ROW_HANDLE, EMPTY, LINK, OTHER_BAR),
				fc.integer({ min: 9, max: 80 }),
				fc.integer({ min: -80, max: 80 }),
				fc.integer({ min: 1, max: 349 }),
				fc.array(stepArb, { maxLength: 30 }),
				(target, x, y, at, steps) => {
					const m = createGestureMachine();
					const first = run(m, [touch('down', 0, 0, 0, target), touch('move', x, y, at, target)]);
					expect(first.map((o) => o.type)).toEqual(['pan-native']);
					const out = run(m, fingerOneAfter(steps, at));
					expect(out.filter((o) => EDITING.has(o.type))).toEqual([]);
				},
			),
			RUNS,
		);
	});

	it('never edits from a scroll event before the long-press fires', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...TARGETS),
				fc.integer({ min: 0, max: 349 }),
				fc.array(stepArb, { maxLength: 30 }),
				(target, at, steps) => {
					const m = createGestureMachine();
					run(m, [touch('down', 0, 0, 0, target), { type: 'scroll', t: at }]);
					const out = run(m, fingerOneAfter(steps, at));
					expect(out.filter((o) => EDITING.has(o.type))).toEqual([]);
				},
			),
			RUNS,
		);
	});
});
