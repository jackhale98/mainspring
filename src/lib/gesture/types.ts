// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Types of the gesture library (phase-2.md 6.5). The machine is pure and framework free: the
 * wiring (T16) turns DOM pointer events into `GestureInput`, feeds the machine, and maps the
 * outputs to the canvas, to native scrolling and to edit intents. Coordinates are content
 * coordinates (the same ones `hitTest` takes); time is whatever clock the wiring reads, in ms.
 */
import type { Minutes } from '../../engine/protocol';

export type PointerKind = 'mouse' | 'pen' | 'touch';

export interface Modifiers {
	readonly shift: boolean;
	readonly alt: boolean;
	readonly ctrl: boolean;
	readonly meta: boolean;
}
export const NO_MODIFIERS: Modifiers = { shift: false, alt: false, ctrl: false, meta: false };

export type BarPart = 'body' | 'end-handle' | 'link-dot' | 'progress';

/**
 * What is under a pointer. This is `Hit` from `gantt/hit.ts` (phase-2.md 6.4) as the gestures need
 * it: any `Hit` is a valid target, and a bar with no `part` is its body. `hitTest` returns a handle
 * part only for the selected bar, so the machine can treat a handle press on touch as "visible
 * handle of a selected bar" (ADR-0008 #4) without knowing the selection.
 */
export type GestureTarget =
	| { readonly kind: 'bar'; readonly row: number; readonly part?: BarPart }
	| { readonly kind: 'link'; readonly link: number }
	| { readonly kind: 'row-handle'; readonly row: number }
	| { readonly kind: 'empty'; readonly row: number | null; readonly at: Minutes };

export interface GestureConfig {
	/** Touch press time before the item lifts (BUILD_PLAN: 350 ms). */
	readonly longPressMs: number;
	/** Movement in CSS px that separates a click or press from a drag, per pointer kind. */
	readonly slop: { readonly mouse: number; readonly pen: number; readonly touch: number };
	readonly doubleTapMs: number;
	/** How far apart two taps may be and still count as a double tap. */
	readonly doubleTapSlop: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
	longPressMs: 350,
	slop: { mouse: 3, pen: 4, touch: 8 },
	doubleTapMs: 300,
	doubleTapSlop: 24,
};

export interface PointerInput {
	readonly type: 'down' | 'move' | 'up' | 'cancel';
	/** `PointerEvent.pointerId`. */
	readonly id: number;
	readonly kind: PointerKind;
	readonly x: number;
	readonly y: number;
	/** ms, any monotonic clock (`PointerEvent.timeStamp`). */
	readonly t: number;
	/** The hit under the pointer now (on `down`: where the press began). */
	readonly target: GestureTarget;
	/** `PointerEvent.buttons`: a mouse press needs exactly the primary button. */
	readonly buttons: number;
	readonly modifiers: Modifiers;
}
export type GestureInput =
	| PointerInput
	/** The wiring's timer, due at `machine.timerAt`. Early or late timer events are harmless. */
	| { readonly type: 'timer'; readonly t: number }
	/** The scroll container scrolled. Only a scroll before the long-press fires cancels the press. */
	| { readonly type: 'scroll'; readonly t: number }
	| { readonly type: 'escape' };

export type CancelReason =
	'escape' | 'pointer-cancel' | 'back-to-origin' | 'second-pointer' | 'lost-release';

export type GestureOutput =
	| {
			readonly type: 'tap';
			readonly hit: GestureTarget;
			readonly count: 1 | 2;
			readonly x: number;
			readonly y: number;
			readonly modifiers: Modifiers;
	  }
	/** The item lifted (haptics, visual lift). A drag may follow on the next move. */
	| {
			readonly type: 'long-press';
			readonly hit: GestureTarget;
			readonly x: number;
			readonly y: number;
	  }
	/** `x`, `y` is where the press began; a `drag-move` to the current position follows at once. */
	| {
			readonly type: 'drag-start';
			readonly hit: GestureTarget;
			readonly x: number;
			readonly y: number;
			readonly modifiers: Modifiers;
	  }
	| {
			readonly type: 'drag-move';
			readonly x: number;
			readonly y: number;
			readonly target: GestureTarget;
			/** Within the slop of where the press began: a drop here cancels. */
			readonly atOrigin: boolean;
	  }
	| {
			readonly type: 'drag-end';
			readonly x: number;
			readonly y: number;
			readonly target: GestureTarget;
			readonly modifiers: Modifiers;
	  }
	/** Ends a drag, or a lift that never became one. No edit follows. */
	| { readonly type: 'drag-cancel'; readonly reason: CancelReason }
	/** Hand over to native scrolling; the pointercancel that follows is swallowed. */
	| { readonly type: 'pan-native' }
	/** `scale` is cumulative since the pinch began; (`cx`, `cy`) is the centroid where it began. */
	| { readonly type: 'pinch'; readonly scale: number; readonly cx: number; readonly cy: number }
	| { readonly type: 'pinch-end' }
	/** Incremental movement of the two-finger centroid. */
	| { readonly type: 'pan2'; readonly dx: number; readonly dy: number }
	/** Pointer capture semantics: call `setPointerCapture(id)` / `releasePointerCapture(id)`. */
	| { readonly type: 'capture'; readonly id: number }
	| { readonly type: 'release'; readonly id: number };

export type GestureState = 'idle' | 'pressed' | 'armed' | 'dragging' | 'native' | 'pinching';

export interface GestureMachine {
	send(e: GestureInput): readonly GestureOutput[];
	readonly state: GestureState;
	/**
	 * When the wiring must send a `timer` event (the long-press deadline), or null. The machine
	 * never reads a clock: it also fires a due long-press on any later event.
	 */
	readonly timerAt: number | null;
}

export interface GestureHooks {
	/**
	 * Whether a press on this target may drag (the dry run at drag start, text-only rows,
	 * handles the edit API would refuse). Default: every bar and row handle. A target that cannot
	 * drag still fires a touch long-press (the source sheet) but never starts a drag.
	 */
	readonly canDrag?: (hit: GestureTarget) => boolean;
}
