// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The divider of Split mode (phase-2.md 9.2): pure rules for the two ratios and for moving them
 * by pointer or keyboard, so that the component only reads events.
 *
 * - `col` is the editor's share of the width when the editor and the Gantt sit side by side
 *   (desktop);
 * - `row` is the Gantt's share of the height when they are stacked, the Gantt above (tablet).
 *
 * Both are kept within MIN_RATIO and MAX_RATIO, so that neither panel can be dragged shut.
 */
export interface SplitRatios {
	readonly col: number;
	readonly row: number;
}

export type SplitAxis = keyof SplitRatios;

export const DEFAULT_RATIOS: SplitRatios = { col: 0.4, row: 0.5 };
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
/** An arrow key moves the divider by this much of the container, Shift by the larger step. */
export const STEP = 0.02;
export const BIG_STEP = 0.1;

/** Narrower limits than the default, for a divider whose panel has a real minimum (gantt/table.ts). */
export interface RatioLimits {
	readonly min: number;
	readonly max: number;
}
export const DEFAULT_LIMITS: RatioLimits = { min: MIN_RATIO, max: MAX_RATIO };

export function clampRatio(value: number, limits: RatioLimits = DEFAULT_LIMITS): number {
	if (!Number.isFinite(value)) return DEFAULT_RATIOS.col;
	return Math.min(limits.max, Math.max(Math.min(limits.min, limits.max), value));
}

/** The ratio for a pointer at `pos`, in a container that starts at `origin` and is `size` long. */
export function ratioFromPointer(
	pos: number,
	origin: number,
	size: number,
	limits: RatioLimits = DEFAULT_LIMITS,
): number {
	return size > 0 ? clampRatio((pos - origin) / size, limits) : DEFAULT_RATIOS.col;
}

/**
 * The ratio after a key, or null when the key does nothing here. For a side-by-side split the
 * arrows are Left and Right, for a stacked one Up and Down; Home and End go to the limits.
 */
export function stepRatio(
	current: number,
	key: string,
	axis: SplitAxis,
	big: boolean,
	limits: RatioLimits = DEFAULT_LIMITS,
): number | null {
	const less = axis === 'col' ? 'ArrowLeft' : 'ArrowUp';
	const more = axis === 'col' ? 'ArrowRight' : 'ArrowDown';
	const step = big ? BIG_STEP : STEP;
	if (key === less) return clampRatio(current - step, limits);
	if (key === more) return clampRatio(current + step, limits);
	if (key === 'Home') return clampRatio(limits.min, limits);
	if (key === 'End') return clampRatio(limits.max, limits);
	return null;
}

/** Reads stored ratios; anything malformed falls back to the default for that axis. */
export function parseRatios(text: string | null): SplitRatios {
	if (text === null) return DEFAULT_RATIOS;
	try {
		const v: unknown = JSON.parse(text);
		if (typeof v !== 'object' || v === null) return DEFAULT_RATIOS;
		const o = v as Record<string, unknown>;
		const pick = (k: SplitAxis): number =>
			typeof o[k] === 'number' && Number.isFinite(o[k]) ? clampRatio(o[k]) : DEFAULT_RATIOS[k];
		return { col: pick('col'), row: pick('row') };
	} catch {
		return DEFAULT_RATIOS;
	}
}

export function serializeRatios(r: SplitRatios): string {
	return JSON.stringify({ col: Number(r.col.toFixed(4)), row: Number(r.row.toFixed(4)) });
}
