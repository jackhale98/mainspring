// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The gesture state machine (phase-2.md 6.5 and 7.2; ADR-0008 #4). Pure: it reads no clock, no DOM
 * and no layout. The wiring feeds `GestureInput`s (pointer events with their hit, a timer, a
 * scroll, Escape) and acts on the `GestureOutput`s. It never edits anything.
 *
 *   idle -down-> pressed -slop (mouse, pen, touch handle)--------> dragging -up-> idle
 *                   |  \-timer (touch body)-> armed -move-------/
 *                   |   \-slop before the timer (touch)-> native (pan-native) -up/cancel-> idle
 *                   \-second touch-> pinching -a finger lifts-> native -> idle
 *
 * Rules the tests pin down:
 * - Mouse and pen drag after 3 px (pen 4); touch drags a selected bar's handle after 8 px and
 *   everything else after a 350 ms long-press. Moving farther than 8 px first is a scroll.
 * - A drop within the slop of the origin, Escape and pointercancel cancel: `drag-cancel`, no edit.
 * - Only the first pointer owns a press. A second touch cancels it and starts a pinch; any other
 *   second pointer (palm, mouse next to a finger) and a third finger are ignored.
 * - After any cancel the machine forgets the pointers, so the rest of that press is ignored.
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
	readonly x0: number;
	readonly y0: number;
	readonly downTarget: GestureTarget;
	readonly downModifiers: Modifiers;
	x: number;
	y: number;
}

interface LastTap {
	readonly t: number;
	readonly x: number;
	readonly y: number;
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
		if (state === 'dragging') out.push({ type: 'release', id: primaryId });
		if (state === 'armed' || state === 'dragging') out.push({ type: 'drag-cancel', reason });
		if (state === 'pinching') out.push({ type: 'pinch-end' });
	}

	function tick(t: number, out: GestureOutput[]): void {
		if (state !== 'pressed' || !longPressDue(deadline, t)) return;
		const p = pointers.get(primaryId);
		if (!p) return;
		deadline = null;
		out.push({ type: 'long-press', hit: p.downTarget, x: p.x, y: p.y });
		// A target that cannot drag (a text-only bar) has been reported; the finger is free to scroll.
		state = canDrag(p.downTarget) ? 'armed' : 'native';
	}

	function handOver(out: GestureOutput[], p: Tracked): void {
		state = 'native';
		deadline = null;
		if (p.kind === 'touch') out.push({ type: 'pan-native' });
	}

	function startDrag(out: GestureOutput[], p: Tracked, e: PointerInput): void {
		state = 'dragging';
		deadline = null;
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
		pinch = createPinchTracker(first, second, cfg.slop.touch);
		pinchIds = [first.id, second.id];
		state = 'pinching';
		deadline = null;
	}

	function updatePinch(out: GestureOutput[]): void {
		const a = pointers.get(pinchIds[0]);
		const b = pointers.get(pinchIds[1]);
		if (!pinch || !a || !b) return;
		const frame = pinch.update(a, b);
		if (frame.scale !== null) {
			out.push({ type: 'pinch', scale: frame.scale, cx: pinch.anchor.x, cy: pinch.anchor.y });
		}
		if (frame.pan && (frame.pan.dx !== 0 || frame.pan.dy !== 0)) {
			out.push({ type: 'pan2', dx: frame.pan.dx, dy: frame.pan.dy });
		}
	}

	function recordTap(out: GestureOutput[], p: Tracked, e: PointerInput): void {
		const key = targetKey(p.downTarget);
		const second =
			lastTap !== null &&
			e.t - lastTap.t <= cfg.doubleTapMs &&
			lastTap.key === key &&
			distance(lastTap.x, lastTap.y, e.x, e.y) <= cfg.doubleTapSlop;
		lastTap = second ? null : { t: e.t, x: e.x, y: e.y, key };
		out.push({
			type: 'tap',
			hit: p.downTarget,
			count: second ? 2 : 1,
			x: e.x,
			y: e.y,
			modifiers: e.modifiers,
		});
	}

	function down(e: PointerInput, out: GestureOutput[]): void {
		// A mouse press is the primary button alone: right and middle clicks are not gestures.
		if (e.kind === 'mouse' && e.buttons !== 1) return;
		if (pointers.has(e.id)) {
			// A pointer went down twice: its up or cancel was lost. Start over.
			abort(out, 'pointer-cancel');
			reset();
		}
		const tracked: Tracked = {
			id: e.id,
			kind: e.kind,
			x0: e.x,
			y0: e.y,
			x: e.x,
			y: e.y,
			downTarget: e.target,
			downModifiers: e.modifiers,
		};
		if (state === 'idle') {
			pointers.set(e.id, tracked);
			primaryId = e.id;
			state = 'pressed';
			mode = pressMode(e.kind, e.target, canDrag(e.target));
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
		p.x = e.x;
		p.y = e.y;
		const lostRelease = e.kind === 'mouse' && e.buttons === 0;
		switch (state) {
			case 'pressed':
				if (lostRelease) return reset();
				if (!beyondSlop(cfg, p.kind, p.x0, p.y0, e.x, e.y)) return;
				if (mode === 'immediate') startDrag(out, p, e);
				else handOver(out, p);
				return;
			case 'armed':
				// The lift happened; the next real movement is the drag.
				if (e.x !== p.x0 || e.y !== p.y0) startDrag(out, p, e);
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
				// The lift never became a drag.
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
		send(e: GestureInput): readonly GestureOutput[] {
			const out: GestureOutput[] = [];
			if (e.type === 'escape') {
				abort(out, 'escape');
				reset();
				return out;
			}
			tick(e.t, out);
			switch (e.type) {
				case 'timer':
					break;
				case 'scroll': {
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
