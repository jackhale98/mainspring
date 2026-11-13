// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt model (phase-2.md 6.3): the visible rows of the task tree joined with the engine's
 * dates, and the dependency links between them. The rows' structure comes from the outline (the
 * symbol index, so a rename, add or delete shows before the reschedule); the dates come from the
 * newest good result, joined by task id. This module only reads: it never computes a schedule
 * (ADR-0007 display rule), and it is rebuilt when the index or a result changes, never per frame.
 *
 * Two inputs come from outside:
 * - `links` is the list of dependencies to draw, resolved by links.ts from the engine's result
 *   (the source of truth for which links exist, their type and gaps) and the text's sites (which
 *   say where each one is written).
 * - `analysis` is the driving-path result (critical path, float). Nothing produces it yet, so
 *   the critical and float fields stay false and null. `GanttAnalysis` is the part of the T5
 *   `DrivingAnalysis` that the model reads, so T5's output fits without a change here.
 *
 * A collapsed container shows the links of its hidden children on its own bar, so a hidden
 * dependency is never silently lost; links that land on one pair of rows are one line that keeps
 * every site.
 */
import type {
	Minutes,
	ProjectInfo,
	Revision,
	ScheduleResult,
	TaskResult,
} from '../../engine/protocol';
import { visibleRows, type OutlineNode, type OutlineReason } from '../state/outline';
import type { DependencySite, TaskId } from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values';
import { finishScenario } from '../schedule/finish';
import { MIN_PER_DAY } from './scale';
import type { GanttCalendar } from './ticks';

export interface GanttAnalysis {
	readonly critical: ReadonlySet<string>;
	/** `${pred}>${succ}` */
	readonly criticalLinks: ReadonlySet<string>;
	readonly floatMin: ReadonlyMap<string, number>;
	readonly lateEnd: ReadonlyMap<string, Minutes>;
}

/** Whether a marker line (today, status date) is on the drawn chart, off it, or unknown. */
export type LineState = 'on' | 'off' | null;

/** Which end of a bar a link attaches to. */
export type Anchor = 'start' | 'end';

/**
 * How sure the Gantt is of a link: 'declared' is in the text and the engine agrees (or there is
 * no engine data to disagree), 'engine' only the engine knows it (a macro, say), 'pending' the
 * text declares it but the schedule shown does not include it yet.
 */
export type LinkState = 'declared' | 'engine' | 'pending';

export interface RawLink {
	readonly pred: TaskId;
	readonly succ: TaskId;
	/** The predecessor's end the link leaves from, and the successor's end it enters. */
	readonly from: Anchor;
	readonly to: Anchor;
	readonly state: LinkState;
	/** Every text site that declares it; empty for an engine-only or a pending-free link. */
	readonly sites: readonly DependencySite[];
	readonly gapDurationMin: number;
	readonly gapLengthMin: number;
}

export interface GanttRow {
	/** The outline key, unique among rows. */
	readonly key: string;
	/** The full task id; null for a declaration the index could not name (macro-built). */
	readonly id: TaskId | null;
	/** The outline node: level, position and the declaration to reveal. For the treegrid (T18). */
	readonly node: OutlineNode;
	/** 0 for a top-level task. */
	readonly depth: number;
	readonly name: string;
	readonly localId: string;
	readonly kind: 'task' | 'container' | 'milestone';
	/** Null for a leaf. */
	readonly expanded: boolean | null;
	readonly start: Minutes | null;
	readonly end: Minutes | null;
	readonly scheduled: boolean;
	readonly allocated: readonly string[];
	/** `complete` in percent as the plan sets it; null when unset or before bridge v2. */
	readonly complete: number | null;
	/** The allocated resources' names, for the avatars beside the bar and for screen readers. */
	readonly people: readonly string[];
	/** Each person's place in the plan's resource list, which picks the avatar colour. */
	readonly peopleIndex: readonly number[];
	readonly critical: boolean;
	readonly floatMin: number | null;
	readonly lateEnd: Minutes | null;
	readonly textOnly: OutlineReason | null;
}

export interface GanttLink {
	readonly pred: TaskId;
	readonly succ: TaskId;
	/** The visible rows the link joins (a collapsed container stands for its children). */
	readonly predRow: number;
	readonly succRow: number;
	readonly from: Anchor;
	readonly to: Anchor;
	readonly state: LinkState;
	/** Every site behind the link, those of merged rows included. */
	readonly sites: readonly DependencySite[];
	readonly gapDurationMin: number;
	readonly gapLengthMin: number;
	readonly critical: boolean;
}

export interface GanttModel {
	/** Visible rows in pre-order, collapse applied. */
	readonly rows: readonly GanttRow[];
	/** Outline key to row index. */
	readonly rowOf: ReadonlyMap<string, number>;
	readonly links: readonly GanttLink[];
	/** The time frame drawn: minutes at x = 0 and at the right edge. */
	readonly originMin: Minutes;
	readonly endMin: Minutes;
	/** The plan's status date (`now`) in minutes; null when unknown. It comes from the result. */
	readonly statusMin: Minutes | null;
	/**
	 * The wall-clock today in minutes, only when `nowMs` was given to `buildGanttModel`. Prefer to
	 * keep the clock out of the model (`todayOf`, passed to the overlay): the clock changes every
	 * minute, and a model that depends on it is rebuilt, its layout made and every layer
	 * repainted each time.
	 */
	readonly todayMin: Minutes | null;
	readonly scenario: string | null;
	/** True when the schedule shown is not the newest outcome (errors): draw it dimmed. */
	readonly dimmed: boolean;
	readonly revision: Revision | null;
	/** False before the first good result: rows show no bars yet. */
	readonly scheduled: boolean;
	readonly calendar: GanttCalendar | null;
	readonly project: ProjectInfo | null;
}

export interface ModelInput {
	nodes: readonly OutlineNode[];
	collapsed: ReadonlySet<string>;
	/** The newest result with `ok: true`, or null before one. */
	result: ScheduleResult | null;
	dimmed: boolean;
	links: readonly RawLink[];
	analysis: GanttAnalysis | null;
	/**
	 * Transitional: `Date.now()`, which sets the model's `todayMin`. Leave it out and give the
	 * clock to the overlay and `markerState` through `todayOf`, so that a tick of the clock does
	 * not rebuild the model (phase-2.md 6.3).
	 */
	nowMs?: number | null;
	zones?: ZoneOffsets;
	locale?: string;
}

const MINUTE_MS = 60_000;
/** The timeline never ends sooner than this after the last task. */
const MIN_PAD_DAYS = 7;
const FALLBACK_SPAN_DAYS = 60;

export const EMPTY_MODEL: GanttModel = {
	rows: [],
	rowOf: new Map(),
	links: [],
	originMin: 0,
	endMin: FALLBACK_SPAN_DAYS * MIN_PER_DAY,
	statusMin: null,
	todayMin: null,
	scenario: null,
	dimmed: false,
	revision: null,
	scheduled: false,
	calendar: null,
	project: null,
};

const taskKey = (id: TaskId): string => `task:${id}`;

/** The wall-clock moment in minutes of the plan's own axis, or null without a plan or a clock. */
export function todayOf(
	project: ProjectInfo | null,
	nowMs: number | null | undefined,
): Minutes | null {
	if (!project || nowMs === null || nowMs === undefined) return null;
	return Math.round((nowMs - Date.parse(project.start)) / MINUTE_MS);
}

function minutesAt(project: ProjectInfo, iso: string): Minutes {
	return Math.round((Date.parse(iso) - Date.parse(project.start)) / MINUTE_MS);
}

/** The extent to draw: the schedule with some air after it, inside the project frame. */
function extentOf(
	tasks: readonly TaskResult[],
	scenario: string | null,
	project: ProjectInfo | null,
): [Minutes, Minutes] {
	let first = 0;
	let last: Minutes | null = null;
	if (scenario !== null) {
		for (const t of tasks) {
			const s = t.scenarios[scenario];
			if (!s?.scheduled || s.start === null || s.end === null) continue;
			if (s.start < first) first = s.start;
			if (last === null || s.end > last) last = s.end;
		}
	}
	const frameEnd = project ? minutesAt(project, project.end) : null;
	if (last === null) {
		const span = FALLBACK_SPAN_DAYS * MIN_PER_DAY;
		return [first, frameEnd !== null && frameEnd > first ? Math.min(frameEnd, span) : span];
	}
	const pad = Math.max(MIN_PAD_DAYS * MIN_PER_DAY, Math.round((last - first) * 0.04));
	const end = last + pad;
	return [first, frameEnd !== null && frameEnd > last ? Math.min(end, frameEnd) : end];
}

export function buildGanttModel(i: ModelInput): GanttModel {
	const result = i.result;
	const project = result?.project ?? null;
	const scenario = result ? finishScenario(result) : null;
	const byId = new Map<string, TaskResult>();
	const resourceName = new Map<string, string>();
	const resourceIndex = new Map<string, number>();
	if (result) {
		for (const t of result.tasks) byId.set(t.id, t);
		result.resources.forEach((r, n) => {
			resourceName.set(r.id, r.name);
			resourceIndex.set(r.id, n);
		});
	}

	const visible = visibleRows(i.nodes, i.collapsed);
	const rowOf = new Map<string, number>();
	const rows: GanttRow[] = visible.map((r, index) => {
		const n = r.node;
		rowOf.set(n.key, index);
		const task = n.id === null ? undefined : byId.get(n.id);
		const s = task && scenario !== null ? task.scenarios[scenario] : undefined;
		const dated = !!s?.scheduled && s.start !== null && s.end !== null;
		const id = n.id;
		return {
			key: n.key,
			id,
			node: n,
			depth: n.level - 1,
			name: n.name ?? n.localId,
			localId: n.localId,
			kind: r.expandable ? 'container' : task?.milestone ? 'milestone' : 'task',
			expanded: r.expandable ? r.expanded : null,
			start: dated ? (s?.start ?? null) : null,
			end: dated ? (s?.end ?? null) : null,
			scheduled: dated,
			allocated: s?.allocated ?? [],
			complete: s?.complete ?? null,
			people: (s?.allocated ?? []).map((id) => resourceName.get(id) ?? id),
			peopleIndex: (s?.allocated ?? []).map((id) => resourceIndex.get(id) ?? 0),
			critical: id !== null && !!i.analysis?.critical.has(id),
			floatMin: id === null ? null : (i.analysis?.floatMin.get(id) ?? null),
			lateEnd: id === null ? null : (i.analysis?.lateEnd.get(id) ?? null),
			textOnly: n.textOnly,
		};
	});

	const nodeByKey = new Map<string, OutlineNode>();
	for (const n of i.nodes) nodeByKey.set(n.key, n);
	/** The row of a task, or of its nearest visible ancestor when it is collapsed away. */
	const rowFor = (id: TaskId): number | null => {
		let key: string | null = taskKey(id);
		while (key !== null) {
			const row = rowOf.get(key);
			if (row !== undefined) return row;
			key = nodeByKey.get(key)?.parent ?? null;
		}
		return null;
	};
	// Links between the same two rows, the same way round, are one line: the rows of a collapsed
	// container stand for their children, so several links can land on one pair. It keeps every
	// site, the surest state, and is critical if any of them is.
	const STRENGTH: Record<LinkState, number> = { declared: 2, engine: 1, pending: 0 };
	const merged = new Map<string, GanttLink>();
	for (const raw of i.links) {
		const predRow = rowFor(raw.pred);
		const succRow = rowFor(raw.succ);
		if (predRow === null || succRow === null || predRow === succRow) continue;
		const critical = !!i.analysis?.criticalLinks.has(`${raw.pred}>${raw.succ}`);
		const key = `${predRow}>${succRow}|${raw.from}|${raw.to}`;
		const known = merged.get(key);
		if (!known) {
			merged.set(key, {
				pred: raw.pred,
				succ: raw.succ,
				predRow,
				succRow,
				from: raw.from,
				to: raw.to,
				state: raw.state,
				sites: raw.sites,
				gapDurationMin: raw.gapDurationMin,
				gapLengthMin: raw.gapLengthMin,
				critical,
			});
			continue;
		}
		merged.set(key, {
			...known,
			state: STRENGTH[raw.state] > STRENGTH[known.state] ? raw.state : known.state,
			sites: [...known.sites, ...raw.sites.filter((x) => !known.sites.includes(x))],
			critical: known.critical || critical,
		});
	}
	const links = [...merged.values()];

	const [originMin, endMin] = extentOf(result?.tasks ?? [], scenario, project);
	const calendar: GanttCalendar | null = project
		? {
				startEpoch: Date.parse(project.start) / 1000,
				env: { zone: project.timezone, ...(i.zones ? { zones: i.zones } : {}) },
				locale: i.locale,
			}
		: null;
	return {
		rows,
		rowOf,
		links,
		originMin,
		endMin,
		statusMin: project ? minutesAt(project, project.now) : null,
		todayMin: todayOf(project, i.nowMs),
		scenario,
		dimmed: i.dimmed,
		revision: result?.revision ?? null,
		scheduled: result !== null && scenario !== null,
		calendar,
		project,
	};
}
