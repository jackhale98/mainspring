// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The dependency graph the driving-path analysis reads (phase-2.md 6.2): the scheduled tasks of
 * one scenario, in declaration pre-order, with every resolved `depends` and `precedes` entry of
 * the engine's result (bridge schema v2) as one edge between two task ends.
 *
 * - A `depends` entry of s naming p is the edge p -> s into s's start, from p's end (`onEnd`, the
 *   default) or start (`onstart`). TaskJuggler computes s's start from it (earliestStart).
 * - A `precedes` entry of t naming q is the edge t -> q from t's end, into q's start (the default)
 *   or end (`onend`). TaskJuggler computes an ALAP t's end from it (latestEnd).
 *
 * Lists are taken after inheritance, so a container's entries are also on every descendant. Each
 * edge carries the key of the line the Gantt draws for it (gantt/links.ts draws an inherited entry
 * once, on the top-most ancestor that has it). Edges to or from a task that is not scheduled in
 * the scenario are left out. A result that is not ok may hold cycles; nothing here assumes a DAG.
 */
import type { Minutes, ScheduleResult, TaskScenarioResult } from '../../engine/protocol';

export interface Edge {
	readonly pred: number;
	/** Whether the edge leaves the predecessor's end (true) or its start. */
	readonly predEnd: boolean;
	readonly succ: number;
	/** Whether the edge enters the successor's end (true) or its start. */
	readonly succEnd: boolean;
	/** `gaplength`, working minutes. */
	readonly gapLength: number;
	/** `gapduration`, calendar minutes. */
	readonly gapDuration: number;
	/** The list it came from: `depends` of the successor or `precedes` of the predecessor. */
	readonly via: 'depends' | 'precedes';
	/** `${pred}>${succ}` of the line the Gantt draws for it (the declaring ancestor's). */
	readonly link: string;
}

export interface Graph {
	readonly scenario: string;
	/** Number of scheduled tasks (nodes). */
	readonly n: number;
	readonly ids: readonly string[];
	readonly index: ReadonlyMap<string, number>;
	readonly start: Float64Array;
	readonly end: Float64Array;
	/** 1 for an ALAP task (`direction`). */
	readonly alap: Uint8Array;
	/** 1 for a container (a task with children in the result). */
	readonly container: Uint8Array;
	/** The nearest scheduled ancestor, or -1. Always before the node (pre-order). */
	readonly parent: Int32Array;
	readonly children: ReadonlyArray<readonly number[]>;
	readonly edges: readonly Edge[];
	/** Edge indexes by successor, and by predecessor, in list order. */
	readonly into: ReadonlyArray<readonly number[]>;
	readonly out: ReadonlyArray<readonly number[]>;
	/** The latest end of a scheduled task; null when none is scheduled. */
	readonly finish: Minutes | null;
	/** The status date (`project.now`). */
	readonly status: Minutes;
	/** The project end. */
	readonly frameEnd: Minutes;
}

const MINUTE_MS = 60_000;

/** The graph of one scenario of a result. */
export function buildGraph(r: ScheduleResult, scenario: string): Graph {
	const project = r.project;
	const startMs = project ? Date.parse(project.start) : 0;
	const minutesOf = (iso: string | undefined): Minutes =>
		iso === undefined ? 0 : Math.round((Date.parse(iso) - startMs) / MINUTE_MS);

	const all = new Map<string, { parent: string | null; s: TaskScenarioResult | undefined }>();
	const hasChildren = new Set<string>();
	for (const t of r.tasks) {
		all.set(t.id, { parent: t.parent, s: t.scenarios[scenario] });
		if (t.parent !== null) hasChildren.add(t.parent);
	}

	const ids: string[] = [];
	const index = new Map<string, number>();
	const start: number[] = [];
	const end: number[] = [];
	const alap: number[] = [];
	const container: number[] = [];
	let finish: Minutes | null = null;
	for (const t of r.tasks) {
		const s = t.scenarios[scenario];
		if (!s?.scheduled || s.start === null || s.end === null) continue;
		index.set(t.id, ids.length);
		ids.push(t.id);
		start.push(s.start);
		end.push(s.end);
		alap.push(s.direction === 'alap' ? 1 : 0);
		container.push(hasChildren.has(t.id) ? 1 : 0);
		if (finish === null || s.end > finish) finish = s.end;
	}
	const n = ids.length;

	const parent = new Int32Array(n).fill(-1);
	const children: number[][] = Array.from({ length: n }, () => []);
	ids.forEach((id, i) => {
		for (let p = all.get(id)?.parent ?? null; p !== null; p = all.get(p)?.parent ?? null) {
			const pi = index.get(p);
			if (pi === undefined) continue;
			parent[i] = pi;
			children[pi]?.push(i);
			break;
		}
	});

	/** The top-most task from `id` up whose `list` names `other` the same way. */
	const declarer = (id: string, list: 'depends' | 'precedes', other: string, onEnd: boolean) => {
		let top = id;
		for (let p = all.get(id)?.parent ?? null; p !== null; p = all.get(p)?.parent ?? null) {
			const entries = all.get(p)?.s?.[list];
			if (Array.isArray(entries) && entries.some((d) => d.task === other && d.onEnd === onEnd)) {
				top = p;
			}
		}
		return top;
	};

	const edges: Edge[] = [];
	const into: number[][] = Array.from({ length: n }, () => []);
	const out: number[][] = Array.from({ length: n }, () => []);
	const add = (e: Edge): void => {
		into[e.succ]?.push(edges.length);
		out[e.pred]?.push(edges.length);
		edges.push(e);
	};
	ids.forEach((id, i) => {
		const s = all.get(id)?.s;
		for (const d of Array.isArray(s?.depends) ? (s?.depends ?? []) : []) {
			const p = index.get(d.task);
			if (p === undefined || p === i) continue;
			add({
				pred: p,
				predEnd: d.onEnd,
				succ: i,
				succEnd: false,
				gapLength: d.gapLengthMin,
				gapDuration: d.gapDurationMin,
				via: 'depends',
				link: `${d.task}>${declarer(id, 'depends', d.task, d.onEnd)}`,
			});
		}
		for (const d of Array.isArray(s?.precedes) ? (s?.precedes ?? []) : []) {
			const q = index.get(d.task);
			if (q === undefined || q === i) continue;
			add({
				pred: i,
				predEnd: true,
				succ: q,
				succEnd: d.onEnd,
				gapLength: d.gapLengthMin,
				gapDuration: d.gapDurationMin,
				via: 'precedes',
				link: `${declarer(id, 'precedes', d.task, d.onEnd)}>${d.task}`,
			});
		}
	});

	return {
		scenario,
		n,
		ids,
		index,
		start: Float64Array.from(start),
		end: Float64Array.from(end),
		alap: Uint8Array.from(alap),
		container: Uint8Array.from(container),
		parent,
		children,
		edges,
		into,
		out,
		finish,
		status: minutesOf(project?.now),
		frameEnd: minutesOf(project?.end),
	};
}
