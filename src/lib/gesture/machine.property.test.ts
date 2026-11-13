// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distance } from './long-press';
import { createGestureMachine } from './machine';
import { BODY, EMPTY, END_HANDLE, LINK, LINK_DOT, OTHER_BAR, ROW_HANDLE, run } from './testing';
import {
	DEFAULT_GESTURE_CONFIG,
	NO_MODIFIERS,
	type GestureHooks,
	type GestureInput,
	type GestureOutput,
	type GestureState,
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
/** Row 2 is the selected bar: its handles drag at once on touch. Row 5 is not. */
const HOOKS: GestureHooks = { isSelected: (row) => row === 2 };

/** One abstract step; `build` turns a list of them into inputs with a rising clock. */
interface Step {
	readonly kind: 'down' | 'move' | 'up' | 'cancel' | 'timer' | 'scroll' | 'escape' | 'reset';
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
		'reset',
	),
	id: fc.constantFrom(...IDS),
	dt: fc.integer({ min: 0, max: 300 }),
	x: fc.integer({ min: -60, max: 60 }),
	y: fc.integer({ min: -60, max: 60 }),
	target: fc.integer({ min: 0, max: TARGETS.length - 1 }),
	buttons: fc.constantFrom(0, 1, 1, 1, 2),
});

const kindArb = fc.constantFrom<PointerKind>('mouse', 'pen', 'touch');
const kindsArb = fc.tuple(kindArb, kindArb, kindArb);

function build(kinds: readonly PointerKind[], steps: readonly Step[]): GestureInput[] {
	let t = 0;
	return steps.map((s): GestureInput => {
		t += s.dt;
		if (s.kind === 'escape' || s.kind === 'reset') return { type: s.kind };
		if (s.kind === 'timer' || s.kind === 'scroll') return { type: s.kind, t };
		return {
			type: s.kind,
			id: s.id,
			kind: kinds[s.id - 1] ?? 'touch',
			x: s.x,
			y: s.y,
			clientX: s.x,
			clientY: s.y,
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
	return {
		type,
		id: 1,
		kind: 'touch',
		x,
		y,
		clientX: x,
		clientY: y,
		t,
		target,
		buttons: 1,
		modifiers: NO_MODIFIERS,
	};
}

/**
 * What finger 1, the clock and the scroller can still do once finger 1's press is native: moves,
 * lifts, cancels, timers and scrolls, later than `after`. Other fingers and new presses are left
 * out, because those are new gestures and may edit.
 */
function fingerOneAfter(steps: readonly Step[], after: number): GestureInput[] {
	const events: GestureInput[] = [];
	for (const e of build(['touch', 'touch', 'touch'], steps)) {
		if (e.type === 'escape' || e.type === 'reset') events.push(e);
		else if (e.type === 'timer' || e.type === 'scroll') events.push({ ...e, t: e.t + after });
		else if (e.id === 1) {
			events.push({ ...e, type: e.type === 'down' ? 'move' : e.type, t: e.t + after });
		}
	}
	return events;
}

interface Frame {
	readonly input: GestureInput;
	readonly out: readonly GestureOutput[];
	readonly before: GestureState;
	readonly after: GestureState;
}

/** Runs the inputs one by one and keeps what each did. */
function frames(inputs: readonly GestureInput[], hooks: GestureHooks = HOOKS): Frame[] {
	const m = createGestureMachine({}, hooks);
	return inputs.map((input) => {
		const before = m.state;
		const out = m.send(input);
		return { input, out, before, after: m.state };
	});
}

const EDITING = new Set(['tap', 'long-press', 'drag-start', 'drag-move', 'drag-end', 'capture']);
const RUNS = { numRuns: 400 };
const seqArb = fc.tuple(kindsArb, fc.array(stepArb, { maxLength: 50 }));

describe('gesture machine properties', () => {
	it('Escape and reset always return to idle, with nothing pending', () => {
		fc.assert(
			fc.property(
				kindsArb,
				fc.array(stepArb, { maxLength: 40 }),
				fc.boolean(),
				(kinds, steps, esc) => {
					const m = createGestureMachine({}, HOOKS);
					run(m, build(kinds, steps));
					m.send({ type: esc ? 'escape' : 'reset' });
					expect(m.state).toBe('idle');
					expect(m.timerAt).toBeNull();
					expect(m.claimsTouch).toBe(false);
				},
			),
			RUNS,
		);
	});

	it('pointercancel for every pointer always returns to idle', () => {
		fc.assert(
			fc.property(kindsArb, fc.array(stepArb, { maxLength: 40 }), (kinds, steps) => {
				const m = createGestureMachine({}, HOOKS);
				run(m, build(kinds, steps));
				for (const id of IDS) {
					m.send({
						type: 'cancel',
						id,
						kind: kinds[id - 1] ?? 'touch',
						x: 0,
						y: 0,
						clientX: 0,
						clientY: 0,
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

	it('drags and pinches are balanced; at most one capture at a time, released by the same id', () => {
		fc.assert(
			fc.property(seqArb, ([kinds, steps]) => {
				const m = createGestureMachine({}, HOOKS);
				const out: GestureOutput[] = [];
				let captured: number | null = null;
				let dragging = false;
				let pinching = false;
				const all = [...build(kinds, steps), { type: 'escape' } as const];
				for (const e of all) {
					out.push(...m.send(e));
					for (const o of out.splice(0)) {
						switch (o.type) {
							case 'capture':
								expect(captured).toBeNull();
								captured = o.id;
								break;
							case 'release':
								expect(captured).toBe(o.id);
								captured = null;
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
					// A capture is held exactly while the machine is dragging.
					expect(captured !== null).toBe(m.state === 'dragging');
				}
				expect(captured).toBeNull();
				expect(dragging).toBe(false);
				expect(pinching).toBe(false);
			}),
			RUNS,
		);
	});

	it('a touch drag on anything but a selected bar handle never starts less than 350 ms after the press', () => {
		fc.assert(
			fc.property(fc.array(stepArb, { maxLength: 50 }), (steps) => {
				const inputs = build(['touch', 'touch', 'touch'], steps);
				const downs = new Map<number, { t: number; target: GestureTarget }>();
				for (const f of frames(inputs)) {
					const e = f.input;
					if (e.type === 'down') downs.set(e.id, { t: e.t, target: e.target });
					if (e.type !== 'move' || !f.out.some((o) => o.type === 'drag-start')) continue;
					const d = downs.get(e.id);
					if (!d) continue;
					const handle =
						d.target.kind === 'bar' &&
						d.target.row === 2 &&
						(d.target.part === 'end-handle' || d.target.part === 'link-dot');
					if (!handle) expect(e.t - d.t).toBeGreaterThanOrEqual(DEFAULT_GESTURE_CONFIG.longPressMs);
				}
			}),
			RUNS,
		);
	});

	it('a pinch never starts from a press handed to native scrolling', () => {
		fc.assert(
			fc.property(seqArb, ([, steps]) => {
				for (const f of frames(build(['touch', 'touch', 'touch'], steps))) {
					if (f.before === 'native') {
						expect(f.out.filter((o) => o.type === 'pinch' || o.type === 'pan2')).toEqual([]);
						expect(f.after).not.toBe('pinching');
					}
				}
			}),
			RUNS,
		);
	});

	it('a lifted item is never released as a tap', () => {
		fc.assert(
			fc.property(seqArb, ([kinds, steps]) => {
				let lifted = false;
				for (const f of frames(build(kinds, steps))) {
					if (lifted) expect(f.out.some((o) => o.type === 'tap')).toBe(false);
					if (f.out.some((o) => o.type === 'long-press')) lifted = true;
					if (f.after === 'idle') lifted = false;
				}
			}),
			RUNS,
		);
	});

	it('a drop within the slop of where the drag began is never a drag-end', () => {
		fc.assert(
			fc.property(seqArb, ([kinds, steps]) => {
				let origin: { x: number; y: number } | null = null;
				for (const f of frames(build(kinds, steps))) {
					const start = f.out.find((o) => o.type === 'drag-start');
					if (start?.type === 'drag-start') origin = { x: start.x, y: start.y };
					const end = f.out.find((o) => o.type === 'drag-end');
					if (end?.type === 'drag-end' && origin && f.input.type === 'up') {
						const slop = DEFAULT_GESTURE_CONFIG.slop[f.input.kind];
						expect(distance(origin.x, origin.y, end.x, end.y)).toBeGreaterThan(slop);
					}
				}
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
					const m = createGestureMachine({}, HOOKS);
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
					const m = createGestureMachine({}, HOOKS);
					run(m, [touch('down', 0, 0, 0, target), { type: 'scroll', t: at }]);
					const out = run(m, fingerOneAfter(steps, at));
					expect(out.filter((o) => EDITING.has(o.type))).toEqual([]);
				},
			),
			RUNS,
		);
	});
});
