// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine protocol: the shared types (phase-0 spec 3.1) and the worker messages (spec 3.2).
 * Decisions on `now`, `bookings`, late results and dates are in ADR-0002.
 * This module holds types only; it has no runtime code.
 *
 * Result schema v2 (phase-2 spec 6.1) adds fields only; every v1 field keeps its meaning:
 * `ProjectInfo.dailyWorkingHours` and `workingTime`, and per task scenario `direction`,
 * `complete`, `depends` and `precedes` (`DependencyResult`). The worker messages are unchanged.
 *
 * Fast path (phase-2 spec 6.12, spike T19, ADR-0010): `ScheduleRequest.retain` and `fast`, and the
 * fast-path fields of `Timings`. `files` always carries the full text; a request the bridge cannot
 * run fast runs in full, with the same result.
 *
 * Result schema v3 (phase-3 spec 6.1, ADR-0014) adds fields only, for the workload, calendar and
 * explainer: `ProjectInfo.weekStartsMonday` and `leaves`, per resource scenario `workingTime` and
 * `leaves` (`ResourceScenarioResult`), and per task scenario `allocate`. Every v2 field keeps its
 * meaning. The v3 fields are optional (`?`) for now: T2 merges the types before the serializer,
 * and the engine still writes v2, so a consumer must not rely on them yet. T6 (bridge schema v3)
 * writes them, makes them required, and moves `GoldenFile.schemaVersion` to 3 in the same change.
 * Until then nothing reads them; the derived modules that do (src/lib/workload, explain, demand)
 * are built after T6.
 */

/** Strictly increasing per EngineClient. */
export type Revision = number;
/** Integer minutes since ProjectInfo.start (a UTC instant). See 11.14. */
export type Minutes = number;
/** Workspace-relative POSIX path: no leading '/', no '..', no backslashes. */
export type WorkspacePath = string;

export interface ScheduleRequest {
	/** Full workspace text, UTF-8. */
	files: Readonly<Record<WorkspacePath, string>>;
	/** The .tjp to schedule; must be a key of `files`. */
	entry: WorkspacePath;
	revision: Revision;
	/** EXTENSION to the plan, see 11.4 and ADR-0002. */
	options?: ScheduleOptions;
	/**
	 * Keep this run's parsed project as the base of later fast runs (engine/bridge/fast_path.rb).
	 * It costs a copy of the project (`Timings.retainMs`). The worker keeps one base: only the next
	 * run with `retain` replaces it.
	 */
	retain?: boolean;
	/** Run by rewriting values in the kept base instead of parsing `files` (ADR-0010). */
	fast?: FastPatch;
}

/** In-place value rewrites relative to the text of the run `base` (phase-2 spec 6.12). */
export interface FastPatch {
	/** The revision of a full run sent with `retain: true`. */
	base: Revision;
	edits: FastEdit[];
}

export interface FastEdit {
	/** The task's full id. */
	task: string;
	attribute: FastAttr;
	/** Top scenario only: null. */
	scenario: null;
	/** The value as written in the new text ('7d', '2026-03-09'). */
	value: string;
	/** Where the statement is: its only line, unchanged in count. */
	file: WorkspacePath;
	/** 1-based. */
	line: number;
}

export type FastAttr = 'effort' | 'length' | 'duration' | 'start' | 'end' | 'priority' | 'complete';
export interface ScheduleOptions {
	/** ISO 8601 UTC ("2026-01-05T09:00:00Z"). Used only when the plan has no `now`. Golden/test use. */
	now?: string;
}

export interface ScheduleResult {
	revision: Revision;
	/** False if a fatal or error message stopped scheduling. */
	ok: boolean;
	/** Null if parsing failed before the project header. */
	project: ProjectInfo | null;
	/** Declaration pre-order. */
	tasks: TaskResult[];
	/** Declaration pre-order. */
	resources: ResourceResult[];
	/** Canonical order, see spec 6.3. */
	bookings: BookingResult[];
	/** Emission order. */
	messages: EngineMessage[];
	/** Never compared. */
	timings: Timings;
}

export interface ProjectInfo {
	id: string;
	name: string;
	version: string | null;
	/** ISO 8601 UTC with 'Z'. */
	start: string;
	/** ISO 8601 UTC with 'Z'. */
	end: string;
	/** ISO 8601 UTC with 'Z'. */
	now: string;
	/** As written in the plan; null if unset. */
	timezone: string | null;
	timingResolutionMin: number;
	/** Declaration pre-order. */
	scenarios: ScenarioInfo[];
	/**
	 * v2. Hours in a working day (`dailyworkinghours`, default 8).
	 *
	 * Working durations (`effort`, `effortdone`, `effortleft`, `length`, `gaplength`, limits) are
	 * converted by TaskJuggler's workingDuration rule (TjpSyntaxRules.rb:7667-7682) to scoreboard
	 * slots: `slots = round(value * factor / (timingResolutionMin * 60))`, with `factor` in seconds:
	 * - 'min': 60; 'h': 3600;
	 * - 'd': 3600 * dailyWorkingHours;
	 * - 'w': 3600 * dailyWorkingHours * weeklyWorkingDays;
	 * - 'm': 3600 * dailyWorkingHours * monthlyWorkingDays;
	 * - 'y': 3600 * dailyWorkingHours * yearlyWorkingDays.
	 *
	 * The products are taken left to right in doubles, as here. Ruby keeps an integer value times
	 * an integer factor an Integer and then divides as integers, truncating before the rounding;
	 * that changes the result only for a whole number of minutes that is not a multiple of the
	 * resolution ('10min' at 15-minute resolution is 0 slots). `duration` is calendar time instead:
	 * `trunc(value * f / (timingResolutionMin * 60))` with f 60, 3600, 86400, 604800, 2628002.88
	 * and 31536000 s (TjpSyntaxRules.rb:562-574); `gapduration` is in `gapDurationMin`.
	 */
	dailyWorkingHours: number;
	/**
	 * v2. Working days per week for the 'w' unit, as Project#weeklyWorkingDays computes it
	 * (Project.rb:542-545): the weekly hours of the global working hours, in whole hours
	 * (WorkingHours.rb:168-176 divides integers), divided by `dailyworkinghours` (also as integers
	 * when the plan writes an integer). 5 for the default 40 h and 8 h. Null only when that is not
	 * finite (`dailyworkinghours 0.0`).
	 */
	weeklyWorkingDays: number | null;
	/**
	 * v2. Working days per month for the 'm' unit: `yearlyworkingdays / 12` as the rule computes
	 * it (TjpSyntaxRules.rb:7674-7675), so an integer `yearlyworkingdays 260` gives 21, not 21.67.
	 */
	monthlyWorkingDays: number;
	/** v2. `yearlyworkingdays` (default 260.714, Project.rb:106), the 'y' unit's day count. */
	yearlyWorkingDays: number;
	/**
	 * v2. Global working time over the project frame as [start, end) pairs: ascending, disjoint,
	 * touching pairs merged, every bound a multiple of `timingResolutionMin`. Read slot by slot
	 * from TaskJuggler's project scoreboard (`Project#isWorkingTime`): the global working hours
	 * minus global leaves, in the plan's time zone, so DST is already applied. Empty when parsing
	 * failed, because TaskJuggler builds the scoreboard only when it schedules.
	 */
	workingTime: Array<[start: Minutes, end: Minutes]>;
	/**
	 * v3 (optional until T6; see the module comment). `weekstartsmonday` (default true): week
	 * buckets start on Monday, else on Sunday, at local midnight in the plan's time zone.
	 */
	weekStartsMonday?: boolean;
	/**
	 * v3 (optional until T6). The global leaves as declared (`project['leaves']`), in plan order.
	 * A `vacation` reads as `holiday`, with the name null (TaskJuggler drops it).
	 */
	leaves?: ProjectLeave[];
}

/**
 * v3. TaskJuggler's leave types (`LeaveList::Types`), in its order: project 1, annual 2, special 3,
 * sick 4, unpaid 5, holiday 6, unemployed 7. The index is what bits 2 to 5 of a resource
 * scoreboard slot hold. A slot holds one type; which one wins where leaves overlap is
 * TaskJuggler's precedence (ResourceScenario#initScoreboard), not decided here.
 */
export type EngineLeaveType =
	'project' | 'annual' | 'special' | 'sick' | 'unpaid' | 'holiday' | 'unemployed';

/** v3. One global leave (`ProjectInfo.leaves`). */
export interface ProjectLeave {
	type: EngineLeaveType;
	/** The leave's name as written, or null when it has none. */
	name: string | null;
	/** [start, end) as declared. */
	// T2: "as declared" is read as not clipped to the project frame: the bounds may be negative or
	// past the frame's end. The scoreboard fields (`ResourceScenarioResult`) are inside the frame.
	interval: [start: Minutes, end: Minutes];
}
export interface ScenarioInfo {
	id: string;
	name: string;
	parent: string | null;
	active: boolean;
}

/** Line and column are 1-based. */
export interface SourceRef {
	file: WorkspacePath;
	/** Null when TaskJuggler reports line 0 (no line information). */
	line: number | null;
	/** TaskJuggler 3.8.4 records no columns, so the bridge emits null (T4). */
	column: number | null;
}

export interface TaskResult {
	/** Full path, e.g. "app.editor". */
	id: string;
	name: string;
	parent: string | null;
	/** Null when TaskJuggler has no source file information for the property. */
	source: SourceRef | null;
	milestone: boolean;
	/** Keyed by scenario id; active scenarios only. */
	scenarios: Record<string, TaskScenarioResult>;
}
export interface TaskScenarioResult {
	scheduled: boolean;
	start: Minutes | null;
	end: Minutes | null;
	/** Resource ids, sorted by resource pre-order. */
	allocated: string[];
	criticalness: number;
	/** Null when scheduling stopped before TaskJuggler computed it (it starts as nil). */
	pathCriticalness: number | null;
	/**
	 * v2. Scheduling direction as TaskJuggler holds it after scheduling (its `forward` flag). The
	 * last of `scheduling`, `start` and `depends` (asap) or `end` and `precedes` (alap) in the task
	 * wins, otherwise the parent's value, and `effortdone`/`effortleft` force asap. Containers
	 * report the value they hold too.
	 */
	direction: 'asap' | 'alap';
	/**
	 * v2. `complete` in percent as TaskJuggler holds it for this scenario after scheduling: the
	 * plan's value, or null when unset. TaskJuggler computes a completion only when something
	 * queries it; the engine runs no reports, so only a `fail` or `warn` condition that reads
	 * completion can make it non-null without a `complete` in the plan.
	 */
	complete: number | null;
	/**
	 * v2. This task's start waits on these (`depends` after inheritance: the parent's entries,
	 * then the task's own), in TaskJuggler's order. When `ok` is false the dependency graph may
	 * contain cycles: TaskJuggler's loop check runs after resolution (Project.rb:1103-1113), and a
	 * run that stopped earlier never made it. Walk it with a visited set.
	 */
	depends: DependencyResult[];
	/** v2. This task's end must come before these (`precedes` after inheritance), in
	 *  TaskJuggler's order. */
	precedes: DependencyResult[];
	/**
	 * v3 (optional until T6; see the module comment). The task's `allocate` items after
	 * inheritance (TaskScenario 'allocate'), in TaskJuggler's order. `allocated` lists only the
	 * people who were booked; this is what the task asked for.
	 */
	allocate?: AllocateItem[];
}

/** v3. One `allocate` item of a task scenario (`TaskScenarioResult.allocate`). */
export interface AllocateItem {
	/**
	 * Resource ids in order: first the written resource, then its alternatives. A group stays
	 * the group's id, as written; it is not expanded into its members.
	 */
	candidates: string[];
}

/**
 * v2. One resolved `depends` or `precedes` entry of a task scenario. Entries TaskJuggler rejects
 * are left out: an id that names no task, the task itself, its child or parent, and a task an
 * earlier entry of the same list names (TaskScenario#checkDependency). TaskJuggler reports these
 * as `task_depend_*` errors. When `ok` is false, `depends` and `precedes` may form cycles, so
 * consumers must not assume a DAG (see `TaskScenarioResult.depends`).
 */
export interface DependencyResult {
	/** The other task's full id. */
	task: string;
	/**
	 * Whether the edge attaches to the other task's end (true) or start (false). The default is
	 * true for `depends` (after the predecessor's end) and false for `precedes` (before the
	 * successor's start); `onend` and `onstart` change it.
	 */
	onEnd: boolean;
	/** `gapduration`: calendar minutes. 0 when unset. */
	gapDurationMin: number;
	/** `gaplength`: working minutes (scoreboard slots x `timingResolutionMin`). 0 when unset. */
	gapLengthMin: number;
}

export interface ResourceResult {
	id: string;
	name: string;
	parent: string | null;
	/** Null when TaskJuggler has no source file information for the property. */
	source: SourceRef | null;
	group: boolean;
	/** Keyed by scenario id; active scenarios only. */
	scenarios: Record<string, ResourceScenarioResult>;
}

/** One resource in one scenario. All interval lists are inside the project frame. */
export interface ResourceScenarioResult {
	efficiency: number;
	/**
	 * v3 (optional until T6; see the module comment). The slots the resource could work, free or
	 * booked (ResourceScenario#getWorkSlots semantics: its working hours or shifts, minus global
	 * and its own leaves), as [start, end) pairs: ascending, disjoint, touching pairs merged.
	 * Leaf resources only; [] for groups (their roll-ups are the sums of their members).
	 */
	workingTime?: Array<[start: Minutes, end: Minutes]>;
	/**
	 * v3 (optional until T6). The slots that carry a leave type on the resource's scoreboard (bits 2
	 * to 5), merged per type, types in `EngineLeaveType` order. Global leaves are on every
	 * resource's scoreboard, so they appear here too, and each slot counts for the one type the
	 * scoreboard holds. Off-hours slots inside a leave are included, so a leave reads as one run.
	 */
	// T2: 6.1 says "leaf resources only; [] for groups" for `workingTime` and nothing for `leaves`.
	// Read the same way: TaskJuggler passes a group's `leaves` down to its members (the attribute
	// is inherited from the parent), so the members' entries already show them. Also read: a type
	// with no slots has no entry (no empty `intervals`).
	leaves?: ResourceLeaves[];
}

/** v3. The slots of one leave type on a resource's scoreboard (`ResourceScenarioResult.leaves`). */
export interface ResourceLeaves {
	type: EngineLeaveType;
	/** [start, end): ascending, disjoint, touching pairs merged. */
	intervals: Array<[start: Minutes, end: Minutes]>;
}

/** Allocated time from the scoreboard after scheduling, including user `booking`s. See 11.5. */
export interface BookingResult {
	scenario: string;
	resource: string;
	task: string;
	/** Ascending, contiguous slots merged. */
	intervals: Array<[start: Minutes, end: Minutes]>;
}

export type MessageLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
export interface EngineMessage {
	level: MessageLevel;
	/** TaskJuggler message id. */
	id: string;
	/** No ANSI codes, no absolute paths. */
	text: string;
	file: WorkspacePath | null;
	line: number | null;
	column: number | null;
	scenario: string | null;
}

export interface Timings {
	writeFsMs: number;
	parseMs: number;
	scheduleMs: number;
	serializeMs: number;
	totalMs: number;
	/** Which run gave the result; absent from engines before the fast path. */
	path?: 'full' | 'fast';
	/** A full run with `retain`: copying the parsed project, and the size of the copy kept. */
	retainMs?: number;
	retainBytes?: number;
	/** A full run with `retain` whose project could not be copied: why (nothing is kept). */
	retainError?: string;
	/** A fast run: loading the kept copy, and applying the edits. */
	cloneMs?: number;
	applyMs?: number;
	/** A request with `fast` that ran in full: why. */
	fastFallback?: string;
}

export interface SyntaxDocs {
	tjVersion: string;
	keywords: KeywordDoc[];
}
/** Filled from TaskJuggler's own keyword documentation. Phase 1 may extend it. */
export interface KeywordDoc {
	/** The keyword itself, e.g. "effort" or "dailymax"; `contexts` says where it is valid (e.g. "limits", "limits.resource", "limits.task"). */
	keyword: string;
	contexts: string[];
	syntax: string;
	summary: string;
	doc: string;
	scenarioSpecific: boolean;
	seeAlso: string[];
}

/**
 * How the client reacts to each kind (contract for the worker, T6):
 * - `boot`: the worker could not start (manifest, hash check, Ruby boot). Sent with no `revision`
 *   or `id` before `ready`; the engine goes to `failed` for good.
 * - `crash`: wasm traps, out-of-memory and anything else that leaves Ruby unusable must use this
 *   kind. The client terminates the worker and starts a new one.
 * - `internal`: a bridge exception confined to one request. With a `revision` or `id`, only that
 *   request fails and the worker keeps running; with neither, the client restarts the worker.
 * - `invalid-request`: the request itself was bad (e.g. `entry` not in `files`); as `internal`.
 * - `timeout`: produced by the client only.
 */
export type EngineErrorKind = 'boot' | 'crash' | 'internal' | 'timeout' | 'invalid-request';
export interface EngineError {
	kind: EngineErrorKind;
	message: string;
	detail?: string;
}

/** Main thread to worker (spec 3.2). */
export type ToWorker =
	| { type: 'schedule'; request: ScheduleRequest }
	| { type: 'syntax'; id: number }
	/**
	 * Never posted by the current client: it keeps pending requests itself and sends one schedule
	 * at a time, so the worker may treat `cancel` as a no-op. A worker that does skip a request
	 * must still answer it, or the client waits until its reply timeout.
	 */
	| { type: 'cancel'; revision: Revision };

/** Worker to main thread (spec 3.2). */
export type FromWorker =
	| { type: 'ready'; versions: EngineVersions; bootMs: number }
	| { type: 'scheduled'; result: ScheduleResult }
	| { type: 'syntax'; id: number; result: SyntaxDocs }
	/** `revision` or `id` names the request that failed; see EngineErrorKind for the rules. */
	| { type: 'failed'; revision?: Revision; id?: number; error: EngineError };

export interface EngineVersions {
	tj: '3.8.4';
	tjCommit: string;
	rubyWasm: string;
	bundleHash: string;
}
