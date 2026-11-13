// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Slop and long-press rules (phase-2.md 7.2), as pure helpers over numbers and times.
 * Which targets a long-press applies to, and which handles drag at once, lives here so the
 * machine and its tests share one definition (ADR-0008 #4).
 */
import type { GestureConfig, GestureTarget, PointerKind } from './types';

export function slopFor(cfg: GestureConfig, kind: PointerKind): number {
	return cfg.slop[kind];
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
	return Math.hypot(bx - ax, by - ay);
}

/** True when the pointer moved strictly farther than the slop from where it went down. */
export function beyondSlop(
	cfg: GestureConfig,
	kind: PointerKind,
	x0: number,
	y0: number,
	x: number,
	y: number,
): boolean {
	return distance(x0, y0, x, y) > slopFor(cfg, kind);
}

/** The visible handles of a selected bar: they drag at once on touch (ADR-0008 #4). */
export function isBarHandle(hit: GestureTarget): boolean {
	return (
		hit.kind === 'bar' &&
		(hit.part === 'end-handle' || hit.part === 'link-dot' || hit.part === 'progress')
	);
}

/** Targets a press can drag at all, before the `canDrag` hook. */
export function isDragTarget(hit: GestureTarget): boolean {
	return hit.kind === 'bar' || hit.kind === 'row-handle';
}

/** How a press behaves once it is down. */
export type PressMode =
	/** Drags after the slop. */
	| 'immediate'
	/** Touch: a long-press timer runs; moving before it fires hands over to native scrolling. */
	| 'long-press'
	/** Nothing to drag: a tap on release, native scrolling (touch) on movement. */
	| 'none';

export function pressMode(kind: PointerKind, hit: GestureTarget, canDrag: boolean): PressMode {
	if (kind !== 'touch') return isDragTarget(hit) && canDrag ? 'immediate' : 'none';
	if (isBarHandle(hit) && canDrag) return 'immediate';
	// Text-only bars still long-press (they open the source sheet), they just never drag.
	return isDragTarget(hit) ? 'long-press' : 'none';
}

export function longPressDeadline(cfg: GestureConfig, downT: number): number {
	return downT + cfg.longPressMs;
}

export function longPressDue(deadline: number | null, t: number): boolean {
	return deadline !== null && t >= deadline;
}
