// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A read-only hook for the end-to-end tests of the lanes (phase-3.md 13.2): `/app?hooks=lanes`
 * installs `window.__mainspringLanes`, which says where bars and lanes are on the screen (viewport
 * px, to press, drag and touch the real canvas), scrolls to a bar, and reads the model's own bars,
 * leave and bands (what the canvas draws) and the newest good result (the spec's oracle walks its
 * bookings independently of the view). It changes nothing and does what a person could do; without
 * the parameter nothing is installed. A test combines it with `hooks=edits` as a list.
 */
import type { EngineLeaveType, ScheduleResult } from '../../engine/protocol';
import { barBox, barZone, xOfMinute } from '../../lib/lanes/lane-geom';
import type { LanesModel } from '../../lib/lanes/lane-model';
import type { LaneTheme } from '../../lib/lanes/lane-theme';
import type { Cell, HeatLayout } from '../../lib/workload/heat-layout';
import type { Band, BucketKind, Thresholds } from '../../lib/workload/types';

export const LANES_HOOK_KEY = '__mainspringLanes';

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface BarInfo {
	readonly task: string;
	readonly from: number;
	readonly to: number;
	readonly minutes: number;
	readonly movable: boolean;
	readonly textOnly: boolean;
}

export interface LanesHook {
	/** A person's bars, as the model has them (ordered by start). */
	bars(person: string): BarInfo[];
	/** A person's leave blocks by type, as the model has them. */
	leaves(
		person: string,
	): Array<{ type: EngineLeaveType; runs: Array<{ from: number; to: number }> }>;
	/** The band of each period of a person's lane, under the shared thresholds. */
	bands(person: string): Band[];
	/** The leave types of the plan. */
	leaveTypes(): EngineLeaveType[];
	/**
	 * The centre of a bar in viewport px, or null when it is not on the screen. A bar is found by
	 * its task and `nth` (the nth bar of that task in the lane).
	 */
	barPoint(person: string, task: string, nth?: number, inset?: number): Point | null;
	/** Scrolls so that a bar starts near the plot's left, rebuilding the mirror; false if no such bar. */
	revealBar(person: string, task: string, nth?: number): boolean;
	/** Scrolls so that a minute is near the plot's left, in a person's lane; the point of it in viewport px. */
	revealMinute(person: string, minute: number): Point | null;
	/** The centre of a person's lane (at a content x of the plot), in viewport px. */
	lanePoint(person: string, x: number): Point | null;
	/** The centre of a person's period, in viewport px. */
	cell(person: string, col: number): Point | null;
	/** Scrolls a person's lane into view (and rebuilds the mirror). */
	revealPerson(person: string): boolean;
	result(): ScheduleResult | null;
	shape(): {
		rows: string[];
		cols: number;
		zoom: BucketKind;
		viewport: { left: number; top: number; right: number; bottom: number } | null;
		plot: { left: number; top: number };
		cell: { w: number; h: number };
		/** The local-midnight bounds of the buckets (`BucketAxis.bounds`), in minutes. */
		bounds: number[];
	} | null;
}

export interface HookView {
	readonly lanes: LanesModel | null;
	readonly layout: HeatLayout;
	readonly result: ScheduleResult | null;
	readonly lane: LaneTheme;
	readonly origin: { readonly left: number; readonly top: number };
	readonly scroller: HTMLElement | undefined;
	readonly zoom: BucketKind;
	readonly thresholds: Thresholds;
	reveal(c: Cell): void;
	scrollToX(x: number, pad?: number): void;
	rebuildMirror(): void;
}

/** Installs the hook when `params` asks for it (`hooks=lanes`, alone or in a list). */
export function installLanesHook(
	params: URLSearchParams,
	view: () => HookView,
	target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): () => void {
	const asked = (params.get('hooks') ?? '').split(',').map((s) => s.trim());
	if (!asked.includes('lanes')) return () => undefined;
	const rowOf = (v: HookView, person: string): number =>
		v.lanes?.load.rows.findIndex((r) => r.id === person) ?? -1;
	const barOf = (v: HookView, person: string, task: string, nth: number) => {
		const row = rowOf(v, person);
		if (row < 0 || !v.lanes) return null;
		const bar = v.lanes.runs(row).filter((b) => b.task === task)[nth];
		return bar ? { row, bar, lanes: v.lanes } : null;
	};
	const hook: LanesHook = {
		bars(person) {
			const v = view();
			const row = rowOf(v, person);
			return row < 0 || !v.lanes ? [] : v.lanes.runs(row).map((b) => ({ ...b }));
		},
		leaves(person) {
			const v = view();
			const row = rowOf(v, person);
			return row < 0 || !v.lanes
				? []
				: v.lanes.leaves(row).map((l) => ({ type: l.type, runs: l.runs.map((r) => ({ ...r })) }));
		},
		bands(person) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || !v.lanes) return [];
			const m = v.lanes.load;
			return Array.from({ length: m.axis.count }, (_, c) => m.band(row, c, v.thresholds));
		},
		leaveTypes: () => [...(view().lanes?.leaveTypes() ?? [])],
		barPoint(person, task, nth = 0, inset) {
			const v = view();
			const f = barOf(v, person, task, nth);
			if (!f || !v.scroller) return null;
			const b = barBox(v.layout, f.lanes.load.axis, v.lane, f.row, f.bar);
			const r = v.scroller.getBoundingClientRect();
			const x = v.origin.left + b.x + (inset ?? Math.min(b.w / 2, 40));
			const y = v.origin.top + b.y + b.h / 2;
			const ok = x > r.left && x < r.right && y > r.top && y < r.bottom;
			return ok ? { x, y } : null;
		},
		revealBar(person, task, nth = 0) {
			const v = view();
			const f = barOf(v, person, task, nth);
			if (!f) return false;
			const b = barBox(v.layout, f.lanes.load.axis, v.lane, f.row, f.bar);
			v.reveal({ row: f.row, col: 0 });
			v.scrollToX(b.x, 40);
			v.rebuildMirror();
			return true;
		},
		revealMinute(person, minute) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || !v.lanes || !v.scroller) return null;
			v.scrollToX(xOfMinute(v.layout, v.lanes.load.axis, minute), 120);
			hook.revealPerson(person);
			v.rebuildMirror();
			const zone = barZone(v.layout, v.lane, row);
			return {
				x: v.origin.left + xOfMinute(v.layout, v.lanes.load.axis, minute),
				y: v.origin.top + zone.y + zone.h / 2,
			};
		},
		lanePoint(person, x) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0) return null;
			return {
				x: v.origin.left + x,
				y: v.origin.top + v.layout.rowTop(row) + (v.layout.rowHeight - v.lane.overHeight) / 2,
			};
		},
		cell(person, col) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || col < 0 || col >= v.layout.cols) return null;
			const b = v.layout.box({ row, col });
			return { x: v.origin.left + b.x + b.w / 2, y: v.origin.top + b.y + b.h / 2 };
		},
		revealPerson(person) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0) return false;
			// Vertical only: a bar the test scrolled to stays where it is. The time header covers the
			// plot's top 60 px or so.
			const sc = v.scroller;
			if (!sc) return false;
			const box = sc.getBoundingClientRect();
			const y = v.origin.top + v.layout.rowTop(row);
			if (y < box.top + 60) sc.scrollTop -= box.top + 60 - y;
			else if (y + v.layout.rowHeight > box.bottom - 10) {
				sc.scrollTop += y + v.layout.rowHeight - (box.bottom - 10);
			}
			v.rebuildMirror();
			return true;
		},
		result: () => view().result,
		shape() {
			const v = view();
			if (!v.lanes) return null;
			const r = v.scroller?.getBoundingClientRect();
			return {
				rows: v.lanes.load.rows.map((x) => x.id),
				cols: v.layout.cols,
				zoom: v.zoom,
				viewport: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
				plot: { left: v.origin.left, top: v.origin.top },
				cell: { w: v.layout.colWidth, h: v.layout.rowHeight },
				bounds: Array.from(v.lanes.load.axis.bounds),
			};
		},
	};
	target[LANES_HOOK_KEY] = hook;
	return () => {
		if (target[LANES_HOOK_KEY] === hook) delete target[LANES_HOOK_KEY];
	};
}
