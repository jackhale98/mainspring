// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A press and hold on a button (the phone's Undo opens the History sheet), on the shared slop
 * rules (long-press.ts) and Pointer Events. It is not the Gantt's gesture machine: a button has
 * no drag, so it needs only a timer and a slop check.
 *
 * Wiring: `down` on pointerdown, `move` on pointermove, `end` on pointerup, pointercancel and
 * leave. A hold that fires calls `onhold` once; the click that follows the release then has to
 * be ignored, which `consumeClick()` tells (true once after a hold). A press that moves beyond
 * the slop is not a hold (it was a scroll or a slip of the finger).
 */
import type { KeyTimers } from '../tjp/cm/android-key';
import { beyondSlop } from './long-press';
import { DEFAULT_GESTURE_CONFIG, type GestureConfig, type PointerKind } from './types';

/** Longer than the drag's 350 ms: a slow tap on Undo must stay an undo. */
export const HOLD_MS = 500;

export interface HoldPointer {
	readonly pointerId: number;
	readonly pointerType: string;
	readonly button: number;
	readonly clientX: number;
	readonly clientY: number;
}

const KINDS: readonly PointerKind[] = ['mouse', 'pen', 'touch'];
const kindOf = (t: string): PointerKind => KINDS.find((k) => k === t) ?? 'mouse';

export class ButtonHold {
	readonly #onhold: () => void;
	readonly #timers: KeyTimers;
	readonly #cfg: GestureConfig;
	readonly #ms: number;
	#press: { id: number; kind: PointerKind; x: number; y: number } | null = null;
	#timer: unknown = null;
	#fired = false;

	constructor(
		onhold: () => void,
		timers: KeyTimers,
		opts: { ms?: number; config?: GestureConfig } = {},
	) {
		this.#onhold = onhold;
		this.#timers = timers;
		this.#ms = opts.ms ?? HOLD_MS;
		this.#cfg = opts.config ?? DEFAULT_GESTURE_CONFIG;
	}

	down(e: HoldPointer): void {
		this.end();
		this.#fired = false;
		// A mouse's right or middle button is not a press (its context menu has its own route).
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		this.#press = { id: e.pointerId, kind: kindOf(e.pointerType), x: e.clientX, y: e.clientY };
		this.#timer = this.#timers.setTimeout(() => {
			this.#timer = null;
			if (!this.#press) return;
			this.#press = null;
			this.#fired = true;
			this.#onhold();
		}, this.#ms);
	}

	move(e: HoldPointer): void {
		const p = this.#press;
		if (!p || p.id !== e.pointerId) return;
		if (beyondSlop(this.#cfg, p.kind, p.x, p.y, e.clientX, e.clientY)) this.end();
	}

	/** The press is over (released, cancelled, or left): no hold from now on. */
	end(): void {
		if (this.#timer !== null) this.#timers.clearTimeout(this.#timer);
		this.#timer = null;
		this.#press = null;
	}

	/** True once after a hold fired: the click that follows its release is not a tap. */
	consumeClick(): boolean {
		const fired = this.#fired;
		this.#fired = false;
		return fired;
	}

	/** The hold's own action ran some other way (the context menu): a click is not a tap either. */
	markFired(): void {
		this.end();
		this.#fired = true;
	}
}
