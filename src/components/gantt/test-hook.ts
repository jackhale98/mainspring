// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A read-only hook for the end-to-end tests of the gestures (phase-2.md 13.2): `/app?hooks=gantt`
 * installs `window.__mainspringGantt`, which says where things are on the screen, in viewport
 * pixels, so that a test can press, drag and touch the real canvas at them. It reads the layout
 * the painter and the hit test use and changes nothing; without the parameter nothing is
 * installed. (`?hooks=edits`, edit-hooks.ts, reads the text and the engine's dates; a test uses
 * both with `?hooks=edits,gantt`.)
 */
import { dotCentre, knobCentre } from '../../lib/gantt/handles';
import type { GanttLayout } from '../../lib/gantt/layout';
import type { GanttModel } from '../../lib/gantt/model';

export const GANTT_HOOK_KEY = '__mainspringGantt';

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface BarPoints {
	readonly row: number;
	/** The bar's box in viewport px. */
	readonly box: { x: number; y: number; w: number; h: number };
	/** Where to press: the middle of the body, the size handle of each edge, the dot, the knob. */
	readonly body: Point;
	readonly startEdge: Point;
	readonly endEdge: Point;
	readonly dot: Point;
	readonly knob: Point;
}

export interface GanttHook {
	/** Where a task's bar and handles are on the screen; null when it has no bar. */
	bar(task: string): BarPoints | null;
	/** A point on a dependency line, clear of both bars, in viewport px; null when it has none. */
	link(pred: string, succ: string): Point | null;
	/** The viewport x of a minute since the project start. */
	x(minute: number): number;
	/** The minute at a viewport x. */
	minute(clientX: number): number;
	/** The viewport box of the scroll container. */
	scroller(): { left: number; top: number; right: number; bottom: number } | null;
	/** Scrolls the chart so that a task's bar is in view, clear of the task column. */
	reveal(task: string): void;
}

export interface HookView {
	readonly model: GanttModel;
	readonly layout: GanttLayout;
	readonly origin: { readonly left: number; readonly top: number };
	readonly pxPerDay: number;
	readonly scroller: HTMLElement | undefined;
}

/** Installs the hook when `params` asks for it (`hooks=gantt`, alone or in a list); returns the uninstall. */
export function installGanttHook(
	params: URLSearchParams,
	view: () => HookView,
	target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): () => void {
	const asked = (params.get('hooks') ?? '').split(',').map((s) => s.trim());
	if (!asked.includes('gantt')) return () => undefined;
	const hook: GanttHook = {
		bar(task) {
			const v = view();
			const row = v.model.rowOf.get(`task:${task}`);
			if (row === undefined) return null;
			const b = v.layout.barRect(row);
			if (!b) return null;
			const at = (p: Point): Point => ({ x: v.origin.left + p.x, y: v.origin.top + p.y });
			const mid = b.y + b.h / 2;
			const dot = dotCentre(b, v.layout.metrics);
			const knob = knobCentre(b, v.model.rows[row]?.complete ?? 0);
			return {
				row,
				box: { x: v.origin.left + b.x, y: v.origin.top + b.y, w: b.w, h: b.h },
				body: at({ x: b.x + b.w / 2, y: mid }),
				startEdge: at({ x: b.x + 3, y: mid - 3 }),
				endEdge: at({ x: b.x + b.w - 3, y: mid - 3 }),
				dot: at(dot),
				knob: at({ x: knob.x, y: knob.y + 2 }),
			};
		},
		link(pred, succ) {
			const v = view();
			const link = v.model.links.find((l) => l.pred === pred && l.succ === succ);
			if (!link) return null;
			const path = v.layout.linkPath(link);
			// The middle of the longest leg that shows: a line runs under the bars it crosses, and a
			// point inside a bar's hit area would select the bar. Legs longest first, from the middle out.
			const hidden = (x: number, y: number): boolean => {
				for (
					let r = Math.min(link.predRow, link.succRow);
					r <= Math.max(link.predRow, link.succRow);
					r++
				) {
					const h = v.layout.hitRect(r);
					if (h && x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return true;
				}
				return false;
			};
			const legs = path
				.slice(1)
				.map((b, i) => ({ a: path[i] as Point, b }))
				.sort(
					(p, q) =>
						Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y),
				);
			let best: { x: number; y: number } | null = null;
			for (const { a, b } of legs) {
				for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
					const x = a.x + (b.x - a.x) * t;
					const y = a.y + (b.y - a.y) * t;
					if (!hidden(x, y)) {
						best = { x, y };
						break;
					}
				}
				if (best) break;
			}
			return best ? { x: v.origin.left + best.x, y: v.origin.top + best.y } : null;
		},
		x: (m) => view().origin.left + view().layout.scale.x(m),
		minute: (x) => view().layout.scale.m(x - view().origin.left),
		scroller() {
			const r = view().scroller?.getBoundingClientRect();
			return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
		},
		reveal(task) {
			const v = view();
			const row = v.model.rowOf.get(`task:${task}`);
			if (row === undefined || !v.scroller) return;
			const h = v.layout.metrics.rowHeight;
			const top = row * h;
			const room = v.scroller.clientHeight - v.layout.metrics.headerHeight;
			if (top < v.scroller.scrollTop) v.scroller.scrollTop = top;
			else if (top + h > v.scroller.scrollTop + room) v.scroller.scrollTop = top + h - room;
			const bar = v.layout.barRect(row);
			if (bar) v.scroller.scrollLeft = Math.max(0, bar.x - 60);
		},
	};
	target[GANTT_HOOK_KEY] = hook;
	return () => {
		if (target[GANTT_HOOK_KEY] === hook) delete target[GANTT_HOOK_KEY];
	};
}
