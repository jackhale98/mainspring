// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The test oracle for the driving-path analysis (critical.ts, float.ts): TaskJuggler's own slot
 * walks over the project scoreboard (TaskScenario#earliestStart and #latestEnd,
 * TaskScenario.rb:1173-1258), from the raw working-time pairs, without working-time.ts. On top of
 * it, an independent walk of the driving path with the rules of phase-2.md 6.2 (as critical.ts
 * documents them) and `checkAnalysis`, which lists every way an analysis departs from the oracle:
 * soundness (what it reports is true) and completeness (what is true is reported), so an analysis
 * that finds nothing fails as surely as one that finds too much.
 *
 * Test code only; the app never imports it.
 */
import type { DependencyResult, ProjectInfo, ScheduleResult } from '../../engine/protocol';
import type { DrivingAnalysis } from './critical';

export interface Oracle {
	/** TaskJuggler's earliestStart for one entry, from the predecessor's anchor `x`. */
	earliest(x: number, d: DependencyResult): number;
	/** TaskJuggler's latestEnd for one entry, from the successor's anchor `y`. */
	latest(y: number, d: DependencyResult): number;
	/** `b >= a` with no working slot in [a, b): the same instant as far as work goes. */
	same(a: number, b: number): boolean;
	/** Working minutes in [a, b) (0 when b <= a). */
	work(a: number, b: number): number;
	/** The slot walk of a gaplength of `w` working minutes, forward (w > 0) or back. */
	walk(x: number, w: number): number;
}

export function oracleOf(p: ProjectInfo): Oracle {
	const res = p.timingResolutionMin;
	const frameEnd = Math.round((Date.parse(p.end) - Date.parse(p.start)) / 60_000);
	const working = new Set<number>();
	for (const [a, b] of p.workingTime) for (let m = a; m < b; m += res) working.add(m);
	return {
		earliest(x, d) {
			let at = x;
			for (let n = d.gapLengthMin / res; n > 0 && at < frameEnd; at += res) {
				if (working.has(at)) n--;
			}
			return at > x + d.gapDurationMin ? at : x + d.gapDurationMin;
		},
		latest(y, d) {
			let at = y;
			for (let n = d.gapLengthMin / res; n > 0 && at > 0; at -= res) {
				if (working.has(at - res)) n--;
			}
			return at < y - d.gapDurationMin ? at : y - d.gapDurationMin;
		},
		same(a, b) {
			if (b < a) return false;
			for (let m = Math.ceil(a / res) * res; m < b; m += res) if (working.has(m)) return false;
			return true;
		},
		work(a, b) {
			let n = 0;
			for (let m = Math.ceil(a / res) * res; m < b; m += res) if (working.has(m)) n += res;
			return n;
		},
		walk(x, w) {
			const gap = { task: '', onEnd: true, gapLengthMin: Math.abs(w), gapDurationMin: 0 };
			return w >= 0 ? this.earliest(x, gap) : this.latest(x, gap);
		},
	};
}

interface OEdge {
	pred: string;
	predEnd: boolean;
	succ: string;
	succEnd: boolean;
	entry: DependencyResult;
	via: 'depends' | 'precedes';
	/** The line the Gantt draws for it: the declaring ancestor's. */
	link: string;
}

/** The scenario's scheduled tasks and every resolved entry between two of them, from the result. */
export function oracleModel(r: ScheduleResult, scenario: string) {
	const all = new Map(r.tasks.map((t) => [t.id, t] as const));
	const sc = (id: string) => all.get(id)?.scenarios[scenario];
	const dated = new Map<string, { start: number; end: number }>();
	for (const t of r.tasks) {
		const s = t.scenarios[scenario];
		if (s?.scheduled && s.start !== null && s.end !== null) {
			dated.set(t.id, { start: s.start, end: s.end });
		}
	}
	const parentOf = (id: string): string | null => all.get(id)?.parent ?? null;
	const children = new Map<string, string[]>();
	for (const t of r.tasks) {
		if (t.parent === null) continue;
		children.set(t.parent, [...(children.get(t.parent) ?? []), t.id]);
	}
	const declarer = (id: string, list: 'depends' | 'precedes', d: DependencyResult): string => {
		let top = id;
		for (let p = parentOf(id); p !== null; p = parentOf(p)) {
			if (sc(p)?.[list]?.some((e) => e.task === d.task && e.onEnd === d.onEnd)) top = p;
		}
		return top;
	};
	const edges: OEdge[] = [];
	for (const id of dated.keys()) {
		for (const d of sc(id)?.depends ?? []) {
			if (!dated.has(d.task) || d.task === id) continue;
			const link = `${d.task}>${declarer(id, 'depends', d)}`;
			edges.push({
				pred: d.task,
				predEnd: d.onEnd,
				succ: id,
				succEnd: false,
				entry: d,
				via: 'depends',
				link,
			});
		}
		for (const d of sc(id)?.precedes ?? []) {
			if (!dated.has(d.task) || d.task === id) continue;
			const link = `${declarer(id, 'precedes', d)}>${d.task}`;
			edges.push({
				pred: id,
				predEnd: true,
				succ: d.task,
				succEnd: d.onEnd,
				entry: d,
				via: 'precedes',
				link,
			});
		}
	}
	return { all, sc, dated, parentOf, children, edges };
}

/**
 * Late ends and starts by the rules float.ts documents, computed differently: relaxed to a fixed
 * point with the oracle's slot walks (float.ts orders the nodes and uses binary searches).
 */
export function oracleLate(r: ScheduleResult, scenario: string, o: Oracle) {
	const m = oracleModel(r, scenario);
	const ids = [...m.dated.keys()];
	const d = (id: string) => m.dated.get(id) as { start: number; end: number };
	let finish = -Infinity;
	for (const x of m.dated.values()) finish = Math.max(finish, x.end);
	const up = (id: string): string | null => {
		for (let p = m.parentOf(id); p !== null; p = m.parentOf(p)) if (m.dated.has(p)) return p;
		return null;
	};
	const kidsOf = new Map<string, string[]>();
	for (const c of ids) {
		const p = up(c);
		if (p !== null) kidsOf.set(p, [...(kidsOf.get(p) ?? []), c]);
	}
	const outOf = new Map<string, OEdge[]>();
	for (const x of m.edges) outOf.set(x.pred, [...(outOf.get(x.pred) ?? []), x]);
	const isContainer = (id: string) => (m.children.get(id) ?? []).length > 0;
	const span = new Map(ids.map((id) => [id, o.work(d(id).start, d(id).end)] as const));
	const le = new Map<string, number>();
	const ls = new Map<string, number>();
	const sb = new Map<string, number>();
	for (const id of ids) {
		le.set(id, Math.max(d(id).end, finish));
		ls.set(id, Math.max(d(id).start, o.walk(le.get(id) as number, -(span.get(id) as number))));
	}
	for (let round = 0, changed = true; changed && round < ids.length + 5; round++) {
		changed = false;
		// Successors mostly come later in pre-order: relax from the end.
		for (const id of [...ids].reverse()) {
			let e = finish;
			let s = Infinity;
			const p = up(id);
			if (p !== null) {
				e = Math.min(e, le.get(p) as number);
				if ((sb.get(p) ?? Infinity) < Infinity && o.same(d(p).start, d(id).start)) {
					s = sb.get(p) as number;
				}
			}
			for (const x of outOf.get(id) ?? []) {
				const y = (x.succEnd ? le.get(x.succ) : ls.get(x.succ)) as number;
				const b = o.latest(y, x.entry);
				if (x.predEnd) e = Math.min(e, b);
				else s = Math.min(s, b);
			}
			sb.set(id, s);
			if (s < Infinity) e = Math.min(e, o.walk(s, span.get(id) as number));
			e = Math.max(e, d(id).end);
			let st = o.walk(e, -(span.get(id) as number));
			if (isContainer(id))
				for (const c of kidsOf.get(id) ?? []) st = Math.min(st, ls.get(c) as number);
			st = Math.max(st, d(id).start);
			if (e !== le.get(id) || st !== ls.get(id)) changed = true;
			le.set(id, e);
			ls.set(id, st);
		}
	}
	// Float: own, then the least in the subtree.
	const float = new Map(ids.map((id) => [id, o.work(d(id).end, le.get(id) as number)] as const));
	for (const id of [...ids].reverse()) {
		const p = up(id);
		if (p !== null) float.set(p, Math.min(float.get(p) as number, float.get(id) as number));
	}
	return { lateEnd: le, lateStart: ls, float };
}

/** The driving path by the 6.2 rules, with the oracle's arithmetic and late dates. */
export function oraclePath(r: ScheduleResult, scenario: string, o: Oracle) {
	const m = oracleModel(r, scenario);
	const late = oracleLate(r, scenario, o);
	const at = (id: string, end: boolean): number => {
		const d = m.dated.get(id);
		return d ? (end ? d.end : d.start) : NaN;
	};
	/** An edge drives: the successor is placed where the edge puts it (6.2). */
	const drives = (e: OEdge): boolean =>
		e.via === 'depends'
			? o.same(o.earliest(at(e.pred, e.predEnd), e.entry), at(e.succ, false))
			: binds(e);
	/** An edge binds: the predecessor ends at the latest it allows from the engine's dates. */
	const binds = (e: OEdge): boolean =>
		o.same(at(e.pred, e.predEnd), o.latest(at(e.succ, e.succEnd), e.entry));
	/** ... and from the successor's late anchor: the predecessor has no working slack. */
	const bindsLate = (e: OEdge): boolean => {
		const y = (e.succEnd ? late.lateEnd : late.lateStart).get(e.succ) as number;
		return o.same(at(e.pred, e.predEnd), o.latest(y, e.entry));
	};
	let finish = -Infinity;
	for (const d of m.dated.values()) finish = Math.max(finish, d.end);
	const on = new Map<string, Set<'end' | 'start'>>();
	const walked = new Set<OEdge>();
	const stack: Array<[string, 'end' | 'start']> = [];
	for (const [id, d] of m.dated) if (o.same(d.end, finish)) stack.push([id, 'end']);
	while (stack.length > 0) {
		const [id, anchor] = stack.pop() as [string, 'end' | 'start'];
		// A container is a task with children in the result (graph.ts), scheduled or not.
		const leaf = (m.children.get(id) ?? []).length === 0;
		const kids = (m.children.get(id) ?? []).filter((c) => m.dated.has(c));
		const seen = on.get(id) ?? new Set();
		if (leaf ? seen.size > 0 : seen.has(anchor)) continue;
		on.set(id, seen.add(anchor));
		if (!leaf) {
			for (const c of kids) {
				if (
					anchor === 'end' ? o.same(at(c, true), at(id, true)) : o.same(at(id, false), at(c, false))
				) {
					stack.push([c, anchor]);
				}
			}
		}
		for (const e of m.edges) {
			if (e.succ !== id || (!leaf && e.succEnd !== (anchor === 'end'))) continue;
			if (!drives(e) || !bindsLate(e)) continue;
			walked.add(e);
			stack.push([e.pred, e.predEnd ? 'end' : 'start']);
		}
	}
	return { model: m, at, late, drives, finish, path: new Set(on.keys()), walked };
}

/** Every departure of an analysis from the oracle, as one line each; empty when it agrees. */
export function checkAnalysis(
	r: ScheduleResult,
	a: DrivingAnalysis,
	opts: { allExplained?: boolean } = {},
): string[] {
	const p = r.project;
	if (!p) return ['no project'];
	const o = oracleOf(p);
	const w = oraclePath(r, a.scenario, o);
	const { model: m, at } = w;
	const bad: string[] = [];
	const status = a.status ?? -Infinity;

	// Float: one finite value of at least 0 per scheduled task, and every critical task at 0.
	if (a.floatMin.size !== m.dated.size) bad.push(`float for ${a.floatMin.size} of ${m.dated.size}`);
	for (const [id, f] of a.floatMin) {
		if (!Number.isFinite(f) || f < 0) bad.push(`${id}: float ${f}`);
		if ((a.lateEnd.get(id) ?? -Infinity) < at(id, true)) bad.push(`${id}: late end before end`);
	}
	if (r.ok && a.clamped !== 0) bad.push(`clamped ${a.clamped}`);
	for (const [id, f] of w.late.float) {
		if (a.floatMin.get(id) !== f) bad.push(`${id}: float ${a.floatMin.get(id)}, oracle ${f}`);
	}
	for (const id of a.path)
		if (a.floatMin.get(id) !== 0) bad.push(`${id}: on the path, float ${a.floatMin.get(id)}`);
	for (const id of a.critical)
		if (a.floatMin.get(id) !== 0) bad.push(`${id}: critical, float ${a.floatMin.get(id)}`);

	// The path: every task ending at the finish is on it, and it is exactly the oracle's walk.
	for (const [id, d] of m.dated) {
		if (r.ok && o.same(d.end, w.finish) && !a.path.has(id))
			bad.push(`${id}: ends at the finish, not on the path`);
	}
	for (const id of w.path) if (!a.path.has(id)) bad.push(`${id}: missing from the path`);
	for (const id of a.path)
		if (!w.path.has(id)) bad.push(`${id}: on the path, but the oracle's walk does not reach it`);

	// Critical: the path after the status date and the containers holding it; links between them.
	const hot = new Set<string>();
	for (const id of w.path) {
		if (at(id, true) <= status) continue;
		for (let t: string | null = id; t !== null; t = m.parentOf(t)) if (m.dated.has(t)) hot.add(t);
	}
	for (const id of hot) if (!a.critical.has(id)) bad.push(`${id}: should be critical`);
	for (const id of a.critical) if (!hot.has(id)) bad.push(`${id}: should not be critical`);
	const links = new Set(
		[...w.walked].filter((e) => hot.has(e.pred) && hot.has(e.succ)).map((e) => e.link),
	);
	for (const k of links) if (!a.criticalLinks.has(k)) bad.push(`${k}: critical link missing`);
	for (const k of a.criticalLinks) if (!links.has(k)) bad.push(`${k}: not a critical link`);

	// Drivers: sound (on the oracle's bound) and complete (an explainable task is explained).
	for (const [id, d] of a.driver) {
		const s = m.sc(id);
		const alap = s?.direction === 'alap';
		const own = (alap ? s?.precedes : s?.depends) ?? [];
		const driving = own.filter(
			(e) =>
				m.dated.has(e.task) &&
				(alap
					? o.same(at(id, true), o.latest(at(e.task, e.onEnd), e))
					: o.same(o.earliest(at(e.task, e.onEnd), e), at(id, false))),
		);
		if (d.kind === 'dependency') {
			if (!driving.some((e) => e.task === d.pred))
				bad.push(`${id}: driver ${d.pred} is not on its bound`);
			if (d.via !== (alap ? 'precedes' : 'depends')) bad.push(`${id}: driver via ${d.via}`);
		} else if (driving.length > 0) {
			bad.push(`${id}: ${d.kind}, but ${driving.map((e) => e.task).join(', ')} explains it`);
		} else {
			const frame = alap
				? o.same(at(id, true), Math.round((Date.parse(p.end) - Date.parse(p.start)) / 60_000))
				: o.same(0, at(id, false));
			if (frame !== (d.kind === 'frame')) bad.push(`${id}: ${d.kind}, frame is ${frame}`);
			const leaf = (m.children.get(id) ?? []).length === 0;
			if (opts.allExplained && leaf && d.kind === 'unexplained') bad.push(`${id}: unexplained`);
		}
	}
	if (a.driver.size !== m.dated.size) bad.push(`drivers for ${a.driver.size} of ${m.dated.size}`);
	return bad;
}
