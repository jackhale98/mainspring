// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt model (phase-2.md 6.3): the visible rows of the task tree joined with the engine's
 * dates, and the dependency links between them. The rows' structure comes from the outline (the
 * symbol index, so a rename, add or delete shows before the reschedule); the dates come from the
 * newest good result, joined by task id. This module only reads: it never computes a schedule
 * (ADR-0007 display rule), and it is rebuilt when the index or a result changes, never per frame.
 *
 * Two inputs are adapters that wait for bridge schema v2 (task T2):
 * - `links` is the list of dependencies to draw. `linksFromIndex` (links.ts) fills it from the
 *   `depends` and `precedes` the text declares; the engine's resolved list will join it later as
 *   links with no `site`, drawn dashed.
 * - `analysis` is the driving-path result (critical path, float). Nothing produces it yet, so
 *   the critical and float fields stay false and null. `GanttAnalysis` is the part of the T5
 *   `DrivingAnalysis` that the model reads, so T5's output fits without a change here.
 *
 * A collapsed container shows the links of its hidden children on its own bar, so a hidden
 * dependency is never silently lost.
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

export interface RawLink {
	readonly pred: TaskId;
	readonly succ: TaskId;
	/** The text site that declares it; null for one only the engine knows. */
	readonly site: DependencySite | null;
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
	/** The allocated resources' names, for the label beside the bar. */
	readonly people: readonly string[];
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
	readonly site: DependencySite | null;
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
	/** The plan's status date (`now`) and the wall-clock today, in minutes; null when unknown. */
	readonly statusMin: Minutes | null;
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
	/** `Date.now()`, passed in so the model stays pure. */
	nowMs: number | null;
	zones?: ZoneOffsets;
	locale?: string;
}

const MINUTE_MS = 60_000;
/** The timeline never ends sooner than this after the last task. */
const MIN_PAD_DAYS = 7;
/** Space before the first task, so a milestone at the very start is not cut in half. */
const LEFT_PAD_DAYS = 1;
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
	return [
		first - LEFT_PAD_DAYS * MIN_PER_DAY,
		frameEnd !== null && frameEnd > last ? Math.min(end, frameEnd) : end,
	];
}

export function buildGanttModel(i: ModelInput): GanttModel {
	const result = i.result;
	const project = result?.project ?? null;
	const scenario = result ? finishScenario(result) : null;
	const byId = new Map<string, TaskResult>();
	const resourceName = new Map<string, string>();
	if (result) {
		for (const t of result.tasks) byId.set(t.id, t);
		for (const r of result.resources) resourceName.set(r.id, r.name);
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
	const seen = new Set<string>();
	const links: GanttLink[] = [];
	for (const raw of i.links) {
		const predRow = rowFor(raw.pred);
		const succRow = rowFor(raw.succ);
		if (predRow === null || succRow === null || predRow === succRow) continue;
		const id = `${predRow}>${succRow}`;
		if (seen.has(id)) continue;
		seen.add(id);
		links.push({
			pred: raw.pred,
			succ: raw.succ,
			predRow,
			succRow,
			site: raw.site,
			critical: !!i.analysis?.criticalLinks.has(`${raw.pred}>${raw.succ}`),
		});
	}

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
		todayMin:
			project && i.nowMs !== null
				? Math.round((i.nowMs - Date.parse(project.start)) / MINUTE_MS)
				: null,
		scenario,
		dimmed: i.dimmed,
		revision: result?.revision ?? null,
		scheduled: result !== null && scenario !== null,
		calendar,
		project,
	};
}
