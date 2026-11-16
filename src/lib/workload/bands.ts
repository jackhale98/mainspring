// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's bands (phase-3.md 6.2, 18.3; ADR-0014 #3 and its 2026-11-16 amendment). With
 * u = 100 x booked / available, the rules are evaluated in order and the first match wins (the T2
 * ruling in types.ts):
 *
 * 1. `off`: available and booked are both 0, even when work is held or unmet in the bucket (the
 *    cell's details still list it);
 * 2. `over`: booked > available, held > 0, unmet > 0, or u > `overAbove`;
 * 3. `spare`: u < `spareBelow`;
 * 4. `full`: everything else.
 *
 * TaskJuggler counts an overtime-booked slot as working time, so booked never exceeds available
 * in an engine result; the first `over` clause stays as a guard (amendment). The comparisons are
 * made without division (100 x booked against threshold x available), so a boundary such as
 * exactly 80 % or exactly 100 % falls the same way whatever the minutes are: 80 % is not spare,
 * 100 % is not over.
 */
import type { Band, Thresholds } from './types';

/** One cell's minutes, as the model holds them. */
export interface CellMinutes {
	readonly booked: number;
	readonly available: number;
	readonly held: number;
	readonly unmet: number;
}

/** The clauses of rule 2 that make a cell over, in the rule's order. */
export type OverCause = 'booked' | 'held' | 'unmet' | 'threshold';

export function bandOf(c: CellMinutes, t: Thresholds): Band {
	if (c.available === 0 && c.booked === 0) return 'off';
	if (overCauses(c, t).length > 0) return 'over';
	return 100 * c.booked < t.spareBelow * c.available ? 'spare' : 'full';
}

/**
 * Why a cell is over (the cell's "why", 5.4): every clause of rule 2 that holds. Empty for an
 * `off` cell, since rule 1 comes first.
 */
export function overCauses(c: CellMinutes, t: Thresholds): OverCause[] {
	if (c.available === 0 && c.booked === 0) return [];
	const out: OverCause[] = [];
	if (c.booked > c.available) out.push('booked');
	if (c.held > 0) out.push('held');
	if (c.unmet > 0) out.push('unmet');
	if (c.available > 0 && 100 * c.booked > t.overAbove * c.available) out.push('threshold');
	return out;
}

/** Booked as a percentage of available (the heatmap's percent unit); null when available is 0. */
export function percentOf(booked: number, available: number): number | null {
	return available > 0 ? (100 * booked) / available : null;
}
