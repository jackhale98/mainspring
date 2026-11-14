// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The leave-paint planner's types (phase-3.md 6.6, 7.1 W3 to W5; 18.5, 18.6; ADR-0014 #7). A
 * painted or erased run of days on the calendar becomes one edit intent. Types and the contract
 * only, merged first (T2); T12 adds `planLeavePaint` to this module, with the type
 * `PlanLeavePaintFn`.
 *
 * ## Contract
 *
 * - `planLeavePaint(p, ctx)` is pure: it reads the index and the shown result, and never applies
 *   anything or schedules.
 * - **Paint** becomes `updateLeave` when the range touches or overlaps an item of the same type and
 *   name in that scope (the merged item). Otherwise it becomes `addLeave`.
 * - **Erase** becomes `clearLeave` (6.5, T8).
 * - Days are whole local days of the plan's zone, `[from, to)`. Dates are written with `dateText`;
 *   the interval form is the edit API's (18.5): `<type> "<name>" <start> - <end>`, the end being
 *   the exclusive next day. Defaults: `annual` for a person, `holiday` for Everyone. A `vacation`
 *   stays readable and is edited as `holiday`. Leave days the engine shows but no text item names
 *   (shifts, macros) are text-only.
 */
// T2: 6.6 types the result as `Planned`. The only `Planned` is the Gantt's (gantt/intents.ts), so
// that one is used as it is: paint never asks for the move preference (`ask-move-preference`
// does not occur) and its `constraint` is always false.
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import type { Planned } from '../gantt/intents';
import type { LeaveType } from '../tjp/edit/types';
import type { ResourceId, SymbolIndex } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values/civil';

/** Everyone (global leaves, after the project header), or one person's declaration body. */
// T2: 6.6 writes the scope inline in `paint` and as `LeavePaint['scope']` in `erase`, which does
// not compile (TS2502: the union refers to itself). It is named instead; `LeavePaint['scope']` is
// the same type, and 6.7 uses it so.
export type PaintScope = { kind: 'global' } | { kind: 'resource'; resource: ResourceId };

export type LeavePaint =
	/** Whole local days, `[from, to)`. */
	| {
			type: 'paint';
			scope: PaintScope;
			from: Minutes;
			to: Minutes;
			leave: LeaveType;
			name?: string;
	  }
	| { type: 'erase'; scope: PaintScope; from: Minutes; to: Minutes };

/** What `planLeavePaint` reads. */
export interface LeavePaintContext {
	index: SymbolIndex;
	result: ScheduleResult;
	zones: ZoneOffsets;
}

/** T12: `export const planLeavePaint: PlanLeavePaintFn`. */
export type PlanLeavePaintFn = (p: LeavePaint, ctx: LeavePaintContext) => Planned;
