// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What every health check reads (phase-3.md section 12, 6.4): one run's view of the result in the
 * shown scenario (the driving analysis's), the task tree, and the text-only reasons that disable a
 * fix. Display data (ADR-0007): nothing here edits the text or schedules.
 *
 * - **Checked tasks.** Leaves and milestones; a container is not checked itself (section 12).
 * - **Working days** are working minutes of the project's calendar over `dailyWorkingHours`, the
 *   plan's own day: TaskJuggler's `slotsToDays` for `length` and `gaplength` (TaskScenario.rb).
 * - **Disabled fixes** (`Fix.disabled`) give the text-only reason the edit API refuses the fix's
 *   intent with, read from the same index facts its handlers read: a task declared only through
 *   macro expansion (`expanded-only`, deps-links.ts `linkTasks`, allocation.ts `ownLists`), a
 *   declaration whose whole block is text-only (an unresolved macro id), and the edited site's
 *   own range (an attribute, a dependency item or an allocation item written with a macro).
 */
// T11: a declaration whose macro id the engine hints resolved keeps a text-only range over its id
// and name only (X4, `within` the declaration). Its body edits go through, so such a task's fixes
// stay enabled; only an X4 range with no `within` (the id is still unknown) disables them.
// T11: `Fix.disabled` holds text-only reasons only. The edit API's other refusals (`macro-in-body`
// for a body macro that may write the edited list, `inherited`, `cycle`, `unsupported-form`)
// still come from the dispatch when the fix runs, with their sentence; the panel shows those.
// T11: a task in the result that the index has no symbol for is declared by text the index cannot
// name (an unresolved macro id); its fixes are disabled as `expanded-only`, "Declared by a macro".
import type {
	Minutes,
	ProjectInfo,
	ScheduleResult,
	TaskScenarioResult,
} from '../../engine/protocol';
import { scenarioChainOf } from '../schedule/explain-text';
import type { WorkingTime } from '../schedule/working-time';
import type {
	AttrSite,
	ResourceId,
	SourceRange,
	SymbolIndex,
	TaskId,
	TextOnlyReason,
} from '../tjp/index';
import type { HealthInput, HealthSettings } from './types';

export interface Run {
	readonly index: SymbolIndex;
	readonly result: ScheduleResult;
	readonly project: ProjectInfo;
	readonly scenario: string;
	/** The shown scenario and its parents, nearest first. */
	readonly chain: readonly string[];
	readonly wt: WorkingTime;
	readonly settings: HealthSettings;
	/** Minutes in one working day (`dailyWorkingHours`). */
	readonly dayMin: number;
	/** Task ids in result (declaration pre-order). */
	readonly order: readonly TaskId[];
	readonly parent: ReadonlyMap<TaskId, TaskId | null>;
	readonly containers: ReadonlySet<TaskId>;
	readonly milestones: ReadonlySet<TaskId>;
	/** The task's result in the shown scenario. */
	scenarioOf(id: TaskId): TaskScenarioResult | null;
}

/** The run of one `checkPlan` call; null when the result has no project. */
export function runOf(i: HealthInput): Run | null {
	const project = i.result.project;
	if (!project) return null;
	const scenario = i.analysis.scenario;
	const parent = new Map<TaskId, TaskId | null>();
	const containers = new Set<TaskId>();
	const milestones = new Set<TaskId>();
	const byId = new Map<TaskId, TaskScenarioResult>();
	for (const t of i.result.tasks) {
		parent.set(t.id, t.parent);
		if (t.parent !== null) containers.add(t.parent);
		if (t.milestone) milestones.add(t.id);
		const s = t.scenarios[scenario];
		if (s) byId.set(t.id, s);
	}
	return {
		index: i.index,
		result: i.result,
		project,
		scenario,
		chain: scenarioChainOf(project, scenario),
		wt: i.wt,
		settings: i.settings,
		dayMin: Math.max(1, project.dailyWorkingHours * 60),
		order: i.result.tasks.map((t) => t.id),
		parent,
		containers,
		milestones,
		scenarioOf: (id) => byId.get(id) ?? null,
	};
}

/** The task and its ancestors, nearest first. */
export function selfAndAncestors(run: Run, id: TaskId): TaskId[] {
	const out: TaskId[] = [];
	for (
		let at: TaskId | null = id;
		at !== null && !out.includes(at);
		at = run.parent.get(at) ?? null
	) {
		out.push(at);
	}
	return out;
}

/** Leaves and milestones: the tasks section 12 checks. */
export function checkedTasks(run: Run): TaskId[] {
	return run.order.filter((id) => !run.containers.has(id));
}

/** Working days of the project's calendar in [a, b) (either order), unrounded. */
export function workingDays(run: Run, a: Minutes, b: Minutes): number {
	return Math.abs(run.wt.workingBetween(a, b)) / run.dayMin;
}

/** A day count for facts and sentences: one decimal. */
export const roundDays = (d: number): number => Math.round(d * 10) / 10;

/** Where a task is in the text: its declaration header (TaskJuggler's message line), or null. */
export function taskAt(run: Run, id: TaskId): SourceRange | null {
	return run.index.tasks.get(id)?.decl.header ?? null;
}

/** Whether a statement applies in the shown scenario (no prefix, or the scenario or a parent). */
export function applies(run: Run, a: Pick<AttrSite, 'scenario'>): boolean {
	return a.scenario === null || run.chain.includes(a.scenario);
}

/** Why edits of the task's body are refused as text-only, or null (module comment). */
export function taskReason(run: Run, id: TaskId): TextOnlyReason | null {
	const sym = run.index.tasks.get(id);
	if (!sym) return 'expanded-only';
	if (sym.expandedOnly) return 'expanded-only';
	if (sym.textOnly && sym.textOnly.within === null) return sym.textOnly.reason;
	return null;
}

/** Why a site of the text (an attribute, an item) is text-only, or null. */
export function siteReason(
	run: Run,
	site: { readonly textOnly: { readonly reason: TextOnlyReason } | null },
	range: SourceRange,
): TextOnlyReason | null {
	return (
		site.textOnly?.reason ?? run.index.blocking(range.file, range.from, range.to)?.reason ?? null
	);
}

/** The first reason of several, or null. */
export const firstReason = (...rs: ReadonlyArray<TextOnlyReason | null>): TextOnlyReason | null =>
	rs.find((r) => r !== null) ?? null;

/** Leaf people of a resource (itself, or a group's members, recursively). */
export function leavesOf(result: ScheduleResult): (id: ResourceId) => ResourceId[] {
	const kids = new Map<ResourceId, ResourceId[]>();
	const group = new Set<ResourceId>();
	for (const r of result.resources) {
		if (r.group) group.add(r.id);
		if (r.parent !== null) {
			const list = kids.get(r.parent) ?? [];
			list.push(r.id);
			kids.set(r.parent, list);
		}
	}
	const memo = new Map<ResourceId, ResourceId[]>();
	const walk = (id: ResourceId, seen: Set<ResourceId>): ResourceId[] => {
		const hit = memo.get(id);
		if (hit) return hit;
		if (seen.has(id)) return [];
		seen.add(id);
		const out = group.has(id) ? (kids.get(id) ?? []).flatMap((k) => walk(k, seen)) : [id];
		memo.set(id, out);
		return out;
	};
	return (id) => walk(id, new Set());
}

/**
 * The resource as the task's `allocate` names it, for "Replace person…": the candidate whose
 * people include `person` (a group, or the person), or the person when none does.
 */
export function writtenCandidate(
	s: TaskScenarioResult,
	person: ResourceId,
	leaves: (id: ResourceId) => ResourceId[],
): ResourceId {
	for (const item of s.allocate) {
		for (const c of item.candidates) if (c === person) return c;
	}
	for (const item of s.allocate) {
		for (const c of item.candidates) if (leaves(c).includes(person)) return c;
	}
	return person;
}

/**
 * Why "Replace person…" would be refused as text-only: the task; then its own item naming `from`;
 * with none, an own item written with a macro call that may name it (allocation.ts `notPresent`).
 */
export function replaceReason(run: Run, task: TaskId, from: ResourceId): TextOnlyReason | null {
	const mine = run.index.allocations.filter((a) => a.task === task);
	const own = mine.find((a) => a.resource === from);
	const hidden = mine.some(
		(a) => a.resource === null && (a.textOnly?.reason === 'macro-call' || /\$[{(]/.test(a.written)),
	);
	return firstReason(
		taskReason(run, task),
		own ? siteReason(run, own, own.item) : hidden ? 'macro-call' : null,
	);
}
