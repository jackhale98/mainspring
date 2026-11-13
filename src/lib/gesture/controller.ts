// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The gesture controller (phase-2.md 6.5, 7.1): the pointer machine plus snapping, emitting typed
 * gesture intents for the Gantt wiring (T16) to map to previews and to edit API intents (6.6).
 * It is still pure: the environment (time scale, snap function) comes in through `GestureEnv`.
 *
 * What a drag means comes from where the press began:
 *   bar body -> `move`, end handle -> `resize-end`, progress handle -> `progress`,
 *   row handle -> `row`, link dot -> `link` (reported as linkStart, linkHover, linkDrop).
 * Moves and resizes carry the snapped movement in minutes; the preview is the caller's, and
 * nothing here changes a schedule (ADR-0007). A drop that changes nothing is a `cancel`.
 */
import type { Minutes } from '../../engine/protocol';
import { createGestureMachine } from './machine';
import type { DragSnapper } from './snap';
import type {
	CancelReason,
	GestureConfig,
	GestureHooks,
	GestureMachine,
	GestureOutput,
	GestureState,
	GestureTarget,
	Modifiers,
	GestureInput,
} from './types';

export type DragMode = 'move' | 'resize-end' | 'progress' | 'row';
type BarTarget = Extract<GestureTarget, { kind: 'bar' }>;

export interface GestureEnv {
	/** Content x to minutes (`TimeScale.m`), read live so a zoom during a drag is respected. */
	minutesAt(x: number): Minutes;
	snap: DragSnapper;
	/**
	 * The minute of the edge being dragged: the start for `move`, the end for `resize-end`.
	 * Null or absent (an unscheduled row): the pointer's own minute at the press stands in.
	 */
	edgeMin?(bar: BarTarget, mode: 'move' | 'resize-end'): Minutes | null;
}

/** Snapped movement of a time drag. Null for drags that are not about time. */
export interface TimeDelta {
	readonly deltaMin: Minutes;
	readonly snappedMin: Minutes;
	/** Whole working days, for a move (what the `move` action takes); null for a resize. */
	readonly days: number | null;
}

type Pass = Extract<
	GestureOutput,
	{
		type:
			'tap' | 'long-press' | 'pan-native' | 'pinch' | 'pinch-end' | 'pan2' | 'capture' | 'release';
	}
>;

export type GestureIntent =
	| Pass
	| {
			readonly type: 'drag-start';
			readonly mode: DragMode;
			readonly hit: GestureTarget;
			readonly x: number;
			readonly y: number;
	  }
	| {
			readonly type: 'drag-move';
			readonly mode: DragMode;
			readonly x: number;
			readonly y: number;
			/** Pointer movement since the press, in content px. */
			readonly dx: number;
			readonly dy: number;
			readonly target: GestureTarget;
			readonly atOrigin: boolean;
			readonly time: TimeDelta | null;
	  }
	| {
			readonly type: 'drag-end';
			readonly mode: DragMode;
			readonly x: number;
			readonly y: number;
			readonly dx: number;
			readonly dy: number;
			readonly target: GestureTarget;
			readonly modifiers: Modifiers;
			readonly time: TimeDelta | null;
	  }
	| { readonly type: 'cancel'; readonly reason: CancelReason | 'no-change' | 'no-target' }
	| { readonly type: 'link-start'; readonly from: number; readonly x: number; readonly y: number }
	/** Every pointer move of a link drag (the rubber band); `link-hover` follows when the target changes. */
	| { readonly type: 'link-move'; readonly from: number; readonly x: number; readonly y: number }
	/** `target` is the bar under the pointer, or null off any bar. Sent when it changes. */
	| {
			readonly type: 'link-hover';
			readonly from: number;
			readonly target: BarTarget | null;
			readonly x: number;
			readonly y: number;
	  }
	| { readonly type: 'link-drop'; readonly from: number; readonly to: BarTarget };

export interface GestureController {
	send(e: GestureInput): readonly GestureIntent[];
	readonly state: GestureState;
	/** See `GestureMachine.timerAt`. */
	readonly timerAt: number | null;
	/** See `GestureMachine.claimsTouch`. */
	readonly claimsTouch: boolean;
}

interface Drag {
	readonly mode: DragMode | 'link';
	readonly x0: number;
	readonly y0: number;
	/** The minute under the pointer when the drag started, read once: a zoom or scroll must not move it. */
	readonly originMin: Minutes;
	/** The dragged edge's minute at the start of the drag. */
	readonly refMin: Minutes;
	readonly fromRow: number;
	hoverRow: number | null;
}

function classify(hit: GestureTarget): DragMode | 'link' | null {
	if (hit.kind === 'row-handle') return 'row';
	if (hit.kind !== 'bar') return null;
	switch (hit.part) {
		case 'end-handle':
			return 'resize-end';
		case 'link-dot':
			return 'link';
		case 'progress':
			return 'progress';
		default:
			return 'move';
	}
}

export function createGestureController(
	env: GestureEnv,
	config: Partial<GestureConfig> = {},
	hooks: GestureHooks = {},
): GestureController {
	const machine: GestureMachine = createGestureMachine(config, hooks);
	let drag: Drag | null = null;

	function begin(hit: GestureTarget, x: number, y: number): Drag | null {
		const mode = classify(hit);
		if (mode === null) return null;
		const row = hit.kind === 'bar' || hit.kind === 'row-handle' ? hit.row : -1;
		const originMin = env.minutesAt(x);
		const timed = mode === 'move' || mode === 'resize-end';
		const edge = timed && hit.kind === 'bar' ? env.edgeMin?.(hit, mode) : null;
		return {
			mode,
			x0: x,
			y0: y,
			originMin,
			refMin: edge ?? originMin,
			fromRow: row,
			hoverRow: null,
		};
	}

	function timeDelta(d: Drag, x: number, atOrigin: boolean): TimeDelta | null {
		if (d.mode !== 'move' && d.mode !== 'resize-end') return null;
		if (atOrigin) return { deltaMin: 0, snappedMin: d.refMin, days: d.mode === 'move' ? 0 : null };
		const raw = env.minutesAt(x) - d.originMin;
		if (d.mode === 'move') {
			const m = env.snap.move(d.refMin, raw);
			return { deltaMin: m.deltaMin, snappedMin: m.snappedMin, days: m.days };
		}
		const r = env.snap.resize(d.refMin, raw);
		return { deltaMin: r.deltaMin, snappedMin: r.snappedMin, days: null };
	}

	function map(o: GestureOutput, out: GestureIntent[]): void {
		switch (o.type) {
			case 'drag-start': {
				drag = begin(o.hit, o.x, o.y);
				if (!drag) return;
				if (drag.mode === 'link')
					out.push({ type: 'link-start', from: drag.fromRow, x: o.x, y: o.y });
				else out.push({ type: 'drag-start', mode: drag.mode, hit: o.hit, x: o.x, y: o.y });
				return;
			}
			case 'drag-move': {
				if (!drag) return;
				if (drag.mode === 'link') {
					const target = o.target.kind === 'bar' ? o.target : null;
					const row = target ? target.row : null;
					out.push({ type: 'link-move', from: drag.fromRow, x: o.x, y: o.y });
					if (row !== drag.hoverRow) {
						drag.hoverRow = row;
						out.push({ type: 'link-hover', from: drag.fromRow, target, x: o.x, y: o.y });
					}
					return;
				}
				out.push({
					type: 'drag-move',
					mode: drag.mode,
					x: o.x,
					y: o.y,
					dx: o.x - drag.x0,
					dy: o.y - drag.y0,
					target: o.target,
					atOrigin: o.atOrigin,
					time: timeDelta(drag, o.x, o.atOrigin),
				});
				return;
			}
			case 'drag-end': {
				const d = drag;
				drag = null;
				if (!d) return;
				if (d.mode === 'link') {
					if (o.target.kind === 'bar')
						out.push({ type: 'link-drop', from: d.fromRow, to: o.target });
					else out.push({ type: 'cancel', reason: 'no-target' });
					return;
				}
				const time = timeDelta(d, o.x, false);
				if (time && time.deltaMin === 0) {
					out.push({ type: 'cancel', reason: 'no-change' });
					return;
				}
				out.push({
					type: 'drag-end',
					mode: d.mode,
					x: o.x,
					y: o.y,
					dx: o.x - d.x0,
					dy: o.y - d.y0,
					target: o.target,
					modifiers: o.modifiers,
					time,
				});
				return;
			}
			case 'drag-cancel':
				drag = null;
				out.push({ type: 'cancel', reason: o.reason });
				return;
			default:
				out.push(o);
		}
	}

	return {
		get state() {
			return machine.state;
		},
		get timerAt() {
			return machine.timerAt;
		},
		get claimsTouch() {
			return machine.claimsTouch;
		},
		send(e) {
			const out: GestureIntent[] = [];
			for (const o of machine.send(e)) map(o, out);
			return out;
		},
	};
}
