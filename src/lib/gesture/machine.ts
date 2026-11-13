// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The gesture state machine (phase-2.md 6.5 and 7.2; ADR-0008 #4). Pure: it reads no clock, no DOM
 * and no layout. The wiring feeds `GestureInput`s (pointer events with their hit, a timer, a
 * scroll, Escape, a reset) and acts on the `GestureOutput`s. It never edits anything.
 *
 *   idle -down-> pressed -slop (mouse, pen, touch handle of a selected bar)--> dragging -up-> idle
 *                   |  \-timer (touch body)-> armed -move-------------------/
 *                   |   \-slop before the timer (touch)-> native (pan-native) -up/cancel-> idle
 *                   \-second touch-> pinching -a finger lifts-> native -> idle
 *
 * Rules the tests pin down:
 * - Mouse and pen drag after 3 px (pen 4); touch drags a selected bar's handle after 8 px and
 *   everything else after a 350 ms long-press. Moving farther than 8 px first is a scroll.
 * - A drop within the slop of the origin, Escape, reset and pointercancel cancel: `drag-cancel`,
 *   no edit. A lifted item is never released as a tap.
 * - Only the first pointer owns a press. A second touch cancels it and starts a pinch; any other
 *   second pointer (palm, mouse next to a finger) and a third finger are ignored.
 * - After any cancel the machine forgets the pointers, so the rest of that press is ignored.
 * - Slop, long-press tolerance, double tap and the two-finger gestures read viewport coordinates;
 *   only the drag reads content coordinates (types.ts).
 */
import {
	beyondSlop,
	distance,
	longPressDeadline,
	longPressDue,
	pressMode,
	slopFor,
	type PressMode,
} from './long-press';
import { createPinchTracker, type PinchTracker } from './pinch';
import {
	DEFAULT_GESTURE_CONFIG,
	type CancelReason,
	type GestureConfig,
	type GestureHooks,
	type GestureInput,
	type GestureMachine,
	type GestureOutput,
	type GestureState,
	type GestureTarget,
	type Modifiers,
	type PointerInput,
	type PointerKind,
} from './types';

interface Tracked {
	readonly id: number;
	readonly kind: PointerKind;
	/** Where the press began: content coordinates, and viewport coordinates. */
	readonly x0: number;
	readonly y0: number;
	readonly cx0: number;
	readonly cy0: number;
	readonly downTarget: GestureTarget;
	readonly downModifiers: Modifiers;
	/** This press came soon enough after the last tap, close enough, to be a double tap. */
	readonly secondTap: boolean;
	/** Latest viewport position (the pinch reads it). */
	cx: number;
	cy: number;
}

interface LastTap {
	/** When the first tap was released. */
	readonly t: number;
	readonly cx: number;
	readonly cy: number;
	readonly key: string;
}

function targetKey(h: GestureTarget): string {
	switch (h.kind) {
		case 'bar':
		case 'row-handle':
			return `${h.kind}:${h.row}`;
		case 'link':
			return `link:${h.link}`;
		case 'empty':
			return `empty:${h.row ?? -1}`;
	}
}

export function createGestureMachine(
	config: Partial<GestureConfig> = {},
	hooks: GestureHooks = {},
): GestureMachine {
	const cfg: GestureConfig = {
		...DEFAULT_GESTURE_CONFIG,
		...config,
		slop: { ...DEFAULT_GESTURE_CONFIG.slop, ...config.slop },
	};
	const canDrag = hooks.canDrag ?? (() => true);
	const isSelected = hooks.isSelected ?? (() => false);

	let state: GestureState = 'idle';
	const pointers = new Map<number, Tracked>();
	let primaryId = -1;
	let mode: PressMode = 'none';
	let deadline: number | null = null;
	let lastTap: LastTap | null = null;
	let pinch: PinchTracker | null = null;
	let pinchIds: readonly [number, number] = [-1, -1];

	function reset(): void {
		state = 'idle';
		pointers.clear();
		primaryId = -1;
		deadline = null;
		pinch = null;
	}

	/** Ends whatever is in flight with the outputs that tell the wiring to clean up. */
	function abort(out: GestureOutput[], reason: CancelReason): void {
		lastTap = null;
		if (state === 'dragging') out.push({ type: 'release', id: primaryId });
		if (state === 'armed' || state === 'dragging') out.push({ type: 'drag-cancel', reason });
		if (state === 'pinching') out.push({ type: 'pinch-end' });
	}

	function tick(t: number, out: GestureOutput[]): void {
		if (state !== 'pressed' || !longPressDue(deadline, t)) return;
		const p = pointers.get(primaryId);
		if (!p) return;
		deadline = null;
		lastTap = null;
		out.push({ type: 'long-press', hit: p.downTarget, x: p.x0, y: p.y0 });
		// A target that cannot drag (a text-only bar) has been reported; the finger is free to scroll.
		state = canDrag(p.downTarget) ? 'armed' : 'native';
	}

	function handOver(out: GestureOutput[], p: Tracked): void {
		state = 'native';
		deadline = null;
		lastTap = null;
		if (p.kind === 'touch') out.push({ type: 'pan-native' });
	}

	function startDrag(out: GestureOutput[], p: Tracked, e: PointerInput): void {
		state = 'dragging';
		deadline = null;
		lastTap = null;
		out.push({ type: 'capture', id: p.id });
		out.push({
			type: 'drag-start',
			hit: p.downTarget,
			x: p.x0,
			y: p.y0,
			modifiers: p.downModifiers,
		});
		out.push({
			type: 'drag-move',
			x: e.x,
			y: e.y,
			target: e.target,
			atOrigin: distance(p.x0, p.y0, e.x, e.y) <= slopFor(cfg, p.kind),
		});
	}

	function startPinch(first: Tracked, second: Tracked): void {
		pinch = createPinchTracker(
			{ x: first.cx, y: first.cy },
			{ x: second.cx, y: second.cy },
			cfg.slop.touch,
		);
		pinchIds = [first.id, second.id];
		state = 'pinching';
		deadline = null;
		lastTap = null;
	}

	function updatePinch(out: GestureOutput[]): void {
		const a = pointers.get(pinchIds[0]);
		const b = pointers.get(pinchIds[1]);
		if (!pinch || !a || !b) return;
		const frame = pinch.update({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy });
		if (frame.scale !== null) {
			out.push({ type: 'pinch', scale: frame.scale, cx: pinch.anchor.x, cy: pinch.anchor.y });
		}
		if (frame.pan && (frame.pan.dx !== 0 || frame.pan.dy !== 0)) {
			out.push({ type: 'pan2', dx: frame.pan.dx, dy: frame.pan.dy });
		}
	}

	function recordTap(out: GestureOutput[], p: Tracked, e: PointerInput): void {
		const count = p.secondTap ? 2 : 1;
		lastTap = p.secondTap
			? null
			: { t: e.t, cx: e.clientX, cy: e.clientY, key: targetKey(p.downTarget) };
		out.push({
			type: 'tap',
			hit: p.downTarget,
			count,
			x: e.x,
			y: e.y,
			modifiers: e.modifiers,
		});
	}

	function down(e: PointerInput, out: GestureOutput[]): void {
		// A mouse or pen press is the primary button alone: right and middle clicks, the pen's
		// barrel button and its eraser are not gestures.
		if (e.kind !== 'touch' && e.buttons !== 1) return;
		if (pointers.has(e.id)) {
			// A pointer went down twice: its up or cancel was lost. Start over.
			abort(out, 'pointer-cancel');
			reset();
		}
		// Measured from the first release to this press, so a slow second tap still counts.
		const second =
			lastTap !== null &&
			e.t - lastTap.t <= cfg.doubleTapMs &&
			lastTap.key === targetKey(e.target) &&
			distance(lastTap.cx, lastTap.cy, e.clientX, e.clientY) <= cfg.doubleTapSlop;
		const tracked: Tracked = {
			id: e.id,
			kind: e.kind,
			x0: e.x,
			y0: e.y,
			cx0: e.clientX,
			cy0: e.clientY,
			cx: e.clientX,
			cy: e.clientY,
			downTarget: e.target,
			downModifiers: e.modifiers,
			secondTap: second,
		};
		if (state === 'idle') {
			pointers.set(e.id, tracked);
			primaryId = e.id;
			state = 'pressed';
			const selected = e.target.kind === 'bar' && isSelected(e.target.row);
			mode = pressMode(e.kind, e.target, canDrag(e.target), selected);
			deadline = mode === 'long-press' ? longPressDeadline(cfg, e.t) : null;
			return;
		}
		const first = pointers.get(primaryId);
		const singlePress = state === 'pressed' || state === 'armed' || state === 'dragging';
		if (singlePress && first && first.kind === 'touch' && e.kind === 'touch') {
			abort(out, 'second-pointer');
			pointers.set(e.id, tracked);
			startPinch(first, tracked);
		}
		// Anything else is ignored: a palm or mouse beside a finger, a third finger, a native pan.
	}

	function move(e: PointerInput, out: GestureOutput[]): void {
		const p = pointers.get(e.id);
		if (!p) return;
		p.cx = e.clientX;
		p.cy = e.clientY;
		// A mouse or pen reporting no button while we think it is down lost its release (it went
		// up outside the window, with no capture): nothing will ever end this press.
		const lostRelease = e.kind !== 'touch' && e.buttons === 0;
		switch (state) {
			case 'pressed':
				if (lostRelease) return reset();
				if (!beyondSlop(cfg, p.kind, p.cx0, p.cy0, e.clientX, e.clientY)) return;
				if (mode === 'immediate') startDrag(out, p, e);
				else handOver(out, p);
				return;
			case 'armed':
				// The lift happened; the next real movement of the finger is the drag.
				if (e.clientX !== p.cx0 || e.clientY !== p.cy0) startDrag(out, p, e);
				return;
			case 'dragging':
				if (lostRelease) {
					abort(out, 'lost-release');
					return reset();
				}
				out.push({
					type: 'drag-move',
					x: e.x,
					y: e.y,
					target: e.target,
					atOrigin: distance(p.x0, p.y0, e.x, e.y) <= slopFor(cfg, p.kind),
				});
				return;
			case 'pinching':
				return updatePinch(out);
			default:
				return;
		}
	}

	function up(e: PointerInput, out: GestureOutput[]): void {
		const p = pointers.get(e.id);
		if (!p) return;
		pointers.delete(e.id);
		switch (state) {
			case 'pressed':
				recordTap(out, p, e);
				return reset();
			case 'armed':
				// The lift never became a drag, and it is not a tap either.
				out.push({ type: 'drag-cancel', reason: 'back-to-origin' });
				return reset();
			case 'dragging':
				out.push({ type: 'release', id: p.id });
				if (distance(p.x0, p.y0, e.x, e.y) <= slopFor(cfg, p.kind)) {
					out.push({ type: 'drag-cancel', reason: 'back-to-origin' });
				} else {
					out.push({
						type: 'drag-end',
						x: e.x,
						y: e.y,
						target: e.target,
						modifiers: e.modifiers,
					});
				}
				return reset();
			case 'pinching':
				out.push({ type: 'pinch-end' });
				pinch = null;
				// The finger left behind must not tap or drag: it is swallowed until it lifts.
				state = pointers.size > 0 ? 'native' : 'idle';
				return;
			default:
				if (pointers.size === 0) reset();
		}
	}

	function cancel(e: PointerInput, out: GestureOutput[]): void {
		if (!pointers.has(e.id)) return;
		pointers.delete(e.id);
		if (state === 'native' && pointers.size > 0) return;
		// A pointercancel means the browser took the pointers: nothing is left to track.
		abort(out, 'pointer-cancel');
		reset();
	}

	return {
		get state() {
			return state;
		},
		get timerAt() {
			return state === 'pressed' ? deadline : null;
		},
		get claimsTouch() {
			if (state === 'armed' || state === 'dragging' || state === 'pinching') return true;
			const p = pointers.get(primaryId);
			return state === 'pressed' && p?.kind === 'touch' && mode === 'immediate';
		},
		send(e: GestureInput): readonly GestureOutput[] {
			const out: GestureOutput[] = [];
			if (e.type === 'escape' || e.type === 'reset') {
				abort(out, e.type);
				reset();
				return out;
			}
			tick(e.t, out);
			switch (e.type) {
				case 'timer':
					break;
				case 'scroll': {
					lastTap = null;
					const p = pointers.get(primaryId);
					if (state === 'pressed' && p?.kind === 'touch') handOver(out, p);
					break;
				}
				case 'down':
					down(e, out);
					break;
				case 'move':
					move(e, out);
					break;
				case 'up':
					up(e, out);
					break;
				case 'cancel':
					cancel(e, out);
					break;
			}
			return out;
		},
	};
}
