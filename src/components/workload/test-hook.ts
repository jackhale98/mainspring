// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A read-only hook for the end-to-end tests of the heatmap (phase-3.md 13.2, 16.1):
 * `/app?hooks=workload` installs `window.__mainspringWorkload`, which says where cells are on the
 * screen (viewport px, to press, drag and touch the real canvas), scrolls a cell into view, reads
 * the newest good result (the gate's oracle walks its bookings independently of the view) and the
 * counts of the model. It changes nothing and does what a person could do; without the parameter
 * nothing is installed. A test combines it with `hooks=edits` as a list (`edits,workload`).
 */
import type { ScheduleResult } from '../../engine/protocol';
import type { Cell, HeatLayout } from '../../lib/workload/heat-layout';
import type { BucketKind, LoadModel } from '../../lib/workload/types';

export const WORKLOAD_HOOK_KEY = '__mainspringWorkload';

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface WorkloadHook {
	/** The centre of a person's cell in viewport px; null when the person or column is not there. */
	cell(person: string, col: number): Point | null;
	/** Scrolls a person's cell into view, and rebuilds the ARIA mirror now. */
	reveal(person: string, col: number): boolean;
	/** Scrolls so that a person's cell is the plot's top left, and rebuilds the ARIA mirror now. */
	scrollTo(person: string, col: number): boolean;
	/** The newest good result the heatmap draws. */
	result(): ScheduleResult | null;
	/** Rows (ids in order), the number of columns, the zoom, and the scroller's box. */
	shape(): {
		rows: string[];
		cols: number;
		zoom: BucketKind;
		viewport: { left: number; top: number; right: number; bottom: number } | null;
		plot: { left: number; top: number };
		cell: { w: number; h: number };
	} | null;
	/** The model's own minutes for a cell (what the canvas draws), for comparing with the mirror. */
	minutes(person: string, col: number): { booked: number; available: number } | null;
}

export interface HookView {
	readonly model: LoadModel | null;
	readonly layout: HeatLayout;
	readonly result: ScheduleResult | null;
	readonly origin: { readonly left: number; readonly top: number };
	readonly scroller: HTMLElement | undefined;
	readonly zoom: BucketKind;
	reveal(c: Cell): void;
	scrollToCell(c: Cell): void;
	rebuildMirror(): void;
}

/** Installs the hook when `params` asks for it (`hooks=workload`, alone or in a list). */
export function installWorkloadHook(
	params: URLSearchParams,
	view: () => HookView,
	target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): () => void {
	const asked = (params.get('hooks') ?? '').split(',').map((s) => s.trim());
	if (!asked.includes('workload')) return () => undefined;
	const rowOf = (v: HookView, person: string): number =>
		v.model?.rows.findIndex((r) => r.id === person) ?? -1;
	const hook: WorkloadHook = {
		cell(person, col) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || col < 0 || col >= v.layout.cols) return null;
			const b = v.layout.box({ row, col });
			return { x: v.origin.left + b.x + b.w / 2, y: v.origin.top + b.y + b.h / 2 };
		},
		reveal(person, col) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || col < 0 || col >= v.layout.cols) return false;
			v.reveal({ row, col });
			v.rebuildMirror();
			return true;
		},
		scrollTo(person, col) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || col < 0 || col >= v.layout.cols) return false;
			v.scrollToCell({ row, col });
			v.rebuildMirror();
			return true;
		},
		result: () => view().result,
		shape() {
			const v = view();
			if (!v.model) return null;
			const r = v.scroller?.getBoundingClientRect();
			return {
				rows: v.model.rows.map((x) => x.id),
				cols: v.layout.cols,
				zoom: v.zoom,
				viewport: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
				plot: { left: v.origin.left, top: v.origin.top },
				cell: { w: v.layout.colWidth, h: v.layout.rowHeight },
			};
		},
		minutes(person, col) {
			const v = view();
			const row = rowOf(v, person);
			if (row < 0 || !v.model) return null;
			return {
				booked: v.model.booked[row]?.[col] ?? 0,
				available: v.model.available[row]?.[col] ?? 0,
			};
		},
	};
	target[WORKLOAD_HOOK_KEY] = hook;
	return () => {
		if (target[WORKLOAD_HOOK_KEY] === hook) delete target[WORKLOAD_HOOK_KEY];
	};
}
