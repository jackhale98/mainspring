// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Driving links, the critical (driving) path and total float (phase-2.md 6.2, 5.2; ADR-0007),
 * derived on the main thread from one engine result. Display data only: the output is never sent
 * to the engine, never becomes a task's start or end, and is never shown as an engine date.
 * TaskJuggler's `criticalness` and `pathCriticalness` are resource-contention scores, not a CPM
 * path, and are not used (19.6).
 *
 * - **Driving link.** An edge drives when its successor sits where the edge alone would put it:
 *   for `depends`, the successor's start is the earliest start the edge allows (TaskJuggler's
 *   earliestStart: `gaplength` forward over working time or `gapduration` over calendar time,
 *   whichever is later) or the next working minute after it; for `precedes`, which places an ALAP
 *   predecessor, its end is the latest end the edge allows or the last working minute before it.
 *   "Within one timing slot" is: no whole working slot in between.
 * - **Driver** of a task: its first driving `depends` entry (ASAP), or its first driving `precedes`
 *   entry (ALAP); else `frame` when it starts at the project start (ASAP) or ends at the project
 *   end (ALAP) with no working time in between; else `unexplained` (a resource, leave, limit or
 *   date constraint: Phase 3 explains these).
 * - **Driving path.** From the tasks that end at the finish (no working time between), back along
 *   driving edges, into a container's child that sets its end (or start). It is the driving path,
 *   not a textbook CPM critical path: TaskJuggler levels resources, so a task whose start is
 *   set by its people ends the walk there (driver `unexplained`).
 *   The walk follows only driving edges that also *bind*: they leave the predecessor no working
 *   slack against the successor's late start or end from float.ts (`bindsLate`). The two differ
 *   when a `gapduration` meets non-working time. Wednesday 17:00 plus 2d is Friday 17:00, so the
 *   successor starts Monday 09:00 and the edge drives it, but the predecessor could end as late
 *   as Saturday 09:00, two working days later, without moving it. Likewise a successor placed in
 *   non-working time (Friday 17:00) can sit as late as the next working minute (Monday 09:00),
 *   and a calendar gap turns that into working slack for its predecessor. Such a predecessor has
 *   float and is not critical, so critical tasks always have zero float (the golden and generated
 *   property tests check it against an independent late pass).
 * - **Critical** tasks are those on the path that end after the status date ("from status date to
 *   the end", best practices), and the containers that hold them. Tasks on the path that end
 *   before it stay in `path` and are drawn, but not highlighted.
 * - **Float** is in float.ts: an upper bound that ignores resources and constraints.
 *
 * Cost: O(edges log pairs). It runs once per result, off the hot path (gantt/analysis.ts).
 */
import type { Minutes, Revision, ScheduleResult } from '../../engine/protocol';
import type { ZoneOffsets } from '../tjp/values/civil';
import { finishScenario } from './finish';
import { latePass, latestUnder, type LatePass } from './float';
import { buildGraph, type Edge, type Graph } from './graph';
import { workingTimeOf, type WorkingTime } from './working-time';

export type Driver =
	| { readonly kind: 'dependency'; readonly pred: string; readonly via: 'depends' | 'precedes' }
	/** Starts at the project start (ASAP) or ends at the project end (ALAP). */
	| { readonly kind: 'frame' }
	/** A resource, leave, limit or constraint: Phase 3 explains. */
	| { readonly kind: 'unexplained' };

export interface DrivingAnalysis {
	/** The revision of the result it was computed from (the Gantt draws it only over that one). */
	readonly revision: Revision;
	readonly scenario: string;
	/** The latest end in the scenario (`finishMinutes` for the first active one). */
	readonly finish: Minutes | null;
	/** The status date the highlight starts from (`project.now`). */
	readonly status: Minutes | null;
	/** Tasks on the driving path that end after the status date, and their containers. */
	readonly critical: ReadonlySet<string>;
	/** `${pred}>${succ}` of the drawn lines between critical tasks along the path. */
	readonly criticalLinks: ReadonlySet<string>;
	/** Every task on the driving path, those that end before the status date included. */
	readonly path: ReadonlySet<string>;
	readonly driver: ReadonlyMap<string, Driver>;
	/** Total float, working minutes, at least 0 (an estimate: float.ts). */
	readonly floatMin: ReadonlyMap<string, number>;
	/** Where the float tail ends: the end itself when the float is 0. */
	readonly lateEnd: ReadonlyMap<string, Minutes>;
	/** Late ends float.ts raised to the task's end: the engine and the estimate disagreed. */
	readonly clamped: number;
}

/** The earliest the successor's anchor may be, given the predecessor's anchor `x`. */
export function earliestUnder(e: Edge, x: Minutes, wt: WorkingTime): Minutes {
	const byLength = e.gapLength > 0 ? wt.addWorking(x, e.gapLength) : x;
	return Math.max(byLength, x + e.gapDuration);
}

const anchors = (g: Graph, e: Edge): [Minutes, Minutes] => [
	(e.predEnd ? g.end[e.pred] : g.start[e.pred]) as number,
	(e.succEnd ? g.end[e.succ] : g.start[e.succ]) as number,
];

/**
 * Whether an edge drives (phase-2.md 6.2): a `depends` successor starts at the earliest the edge
 * allows, or a `precedes` predecessor ends at the latest it allows, within one timing slot (no
 * whole working slot in between).
 */
export function isDriving(g: Graph, e: Edge, wt: WorkingTime): boolean {
	if (e.via === 'precedes') return binds(g, e, wt);
	const res = wt.resolution;
	const [x, y] = anchors(g, e);
	const b = earliestUnder(e, x, wt);
	return y - b > -res && wt.workingBetween(b, y) < res;
}

/** Whether `x` is the latest the edge allows given the successor's anchor `y`, within a slot. */
function atLatest(e: Edge, x: Minutes, y: Minutes, wt: WorkingTime): boolean {
	const b = latestUnder(e, y, wt);
	return b - x > -wt.resolution && wt.workingBetween(x, b) < wt.resolution;
}

/** Whether a precedes predecessor ends at the latest the edge allows from the engine's dates. */
export function binds(g: Graph, e: Edge, wt: WorkingTime): boolean {
	const [x, y] = anchors(g, e);
	return atLatest(e, x, y, wt);
}

/**
 * Whether an edge leaves its predecessor no working slack against the successor's late anchor
 * (float.ts), so that slipping the predecessor at all would push a task towards the finish.
 */
export function bindsLate(g: Graph, e: Edge, wt: WorkingTime, late: LatePass): boolean {
	const x = anchors(g, e)[0];
	const y = (e.succEnd ? late.lateEnd[e.succ] : late.lateStart[e.succ]) as number;
	return atLatest(e, x, y, wt);
}

const END = 1;
const START = 2;

/** The (node, anchor) pairs on the driving path, and the edges walked (`follow`ed). */
function walk(
	g: Graph,
	wt: WorkingTime,
	follow: Uint8Array,
): { on: Uint8Array; walked: Uint8Array } {
	const { n, start, end, container, children, edges, into } = g;
	const res = wt.resolution;
	const on = new Uint8Array(n);
	const walked = new Uint8Array(edges.length);
	const stack: number[] = [];
	const push = (i: number, anchor: number): void => {
		stack.push(i, anchor);
	};
	const finish = g.finish;
	if (finish === null) return { on, walked };
	for (let i = 0; i < n; i++) {
		const e = end[i] as number;
		if (e <= finish && wt.workingBetween(e, finish) < res) push(i, END);
	}
	while (stack.length > 0) {
		const anchor = stack.pop() as number;
		const i = stack.pop() as number;
		const leaf = !container[i];
		const bits = leaf ? END | START : anchor;
		if (((on[i] as number) & bits) === bits) continue;
		on[i] = (on[i] as number) | bits;
		if (!leaf) {
			// The child that sets this end (or start) of the container.
			for (const c of children[i] ?? []) {
				if (anchor === END) {
					const ce = end[c] as number;
					if (ce <= (end[i] as number) && wt.workingBetween(ce, end[i] as number) < res)
						push(c, END);
				} else {
					const cs = start[c] as number;
					if (cs >= (start[i] as number) && wt.workingBetween(start[i] as number, cs) < res) {
						push(c, START);
					}
				}
			}
		}
		for (const k of into[i] ?? []) {
			const e = edges[k] as Edge;
			if (!leaf && e.succEnd !== (anchor === END)) continue;
			if (!follow[k]) continue;
			walked[k] = 1;
			push(e.pred, e.predEnd ? END : START);
		}
	}
	return { on, walked };
}

/** The driver of each node (see the module comment). */
function drivers(g: Graph, wt: WorkingTime, driving: Uint8Array): Map<string, Driver> {
	const out = new Map<string, Driver>();
	const res = wt.resolution;
	const frame: Driver = { kind: 'frame' };
	const unexplained: Driver = { kind: 'unexplained' };
	for (let i = 0; i < g.n; i++) {
		const id = g.ids[i] as string;
		const alap = !!g.alap[i];
		let found: Driver | null = null;
		const list = alap ? g.out[i] : g.into[i];
		for (const k of list ?? []) {
			const e = g.edges[k] as Edge;
			if (e.via !== (alap ? 'precedes' : 'depends') || !driving[k]) continue;
			const other = g.ids[alap ? e.succ : e.pred] as string;
			found = { kind: 'dependency', pred: other, via: e.via };
			break;
		}
		if (!found) {
			const atFrame = alap
				? wt.workingBetween(g.end[i] as number, g.frameEnd) < res
				: wt.workingBetween(0, g.start[i] as number) < res;
			found = atFrame ? frame : unexplained;
		}
		out.set(id, found);
	}
	return out;
}

/** The analysis of one scenario of a result, with the project's working time. */
export function analyse(r: ScheduleResult, scenario: string, wt: WorkingTime): DrivingAnalysis {
	const g = buildGraph(r, scenario);
	const late = latePass(g, wt);
	const driving = new Uint8Array(g.edges.length);
	const follow = new Uint8Array(g.edges.length);
	g.edges.forEach((e, k) => {
		driving[k] = isDriving(g, e, wt) ? 1 : 0;
		follow[k] = driving[k] && bindsLate(g, e, wt, late) ? 1 : 0;
	});
	const { on, walked } = walk(g, wt, follow);

	// Highlight: on the path and ending after the status date, plus the containers holding them.
	const hot = new Uint8Array(g.n);
	for (let i = 0; i < g.n; i++) {
		if (!on[i] || (g.end[i] as number) <= g.status) continue;
		for (let p = i; p >= 0 && !hot[p]; p = g.parent[p] as number) hot[p] = 1;
	}
	const path = new Set<string>();
	const critical = new Set<string>();
	for (let i = 0; i < g.n; i++) {
		if (on[i]) path.add(g.ids[i] as string);
		if (hot[i]) critical.add(g.ids[i] as string);
	}
	const criticalLinks = new Set<string>();
	g.edges.forEach((e, k) => {
		if (walked[k] && hot[e.pred] && hot[e.succ]) criticalLinks.add(e.link);
	});

	const floatMin = new Map<string, number>();
	const lateEnd = new Map<string, Minutes>();
	for (let i = 0; i < g.n; i++) {
		const id = g.ids[i] as string;
		const f = late.float[i] as number;
		const e = g.end[i] as number;
		floatMin.set(id, f);
		// A container's float may come from a child: its tail is that much working time long.
		// A late end in non-working time is shown at the end of the last working minute before it.
		const le = late.lateEnd[i] as number;
		const own = Math.max(0, wt.workingBetween(e, le));
		const tail = f === own ? wt.snap(le, 'end') : wt.addWorking(e, f);
		lateEnd.set(id, f <= 0 ? e : Math.max(e, tail));
	}

	return {
		revision: r.revision,
		scenario,
		finish: g.finish,
		status: r.project ? g.status : null,
		critical,
		criticalLinks,
		path,
		driver: drivers(g, wt, driving),
		floatMin,
		lateEnd,
		clamped: late.clamped,
	};
}

/** The analysis of the first active scenario (the one the Gantt draws), or null without one. */
export function analyseResult(r: ScheduleResult, zones?: ZoneOffsets): DrivingAnalysis | null {
	const scenario = finishScenario(r);
	if (scenario === null || r.project === null) return null;
	return analyse(r, scenario, workingTimeOf(r.project, zones));
}
