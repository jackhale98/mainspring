// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Engine protocol: the shared types (phase-0 spec 3.1) and the worker messages (spec 3.2).
 * Decisions on `now`, `bookings`, late results and dates are in ADR-0002.
 * This module holds types only; it has no runtime code.
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
}
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
	line: number;
	/** TaskJuggler 3.8.4 records no columns, so the bridge emits null (T4). */
	column: number | null;
}

export interface TaskResult {
	/** Full path, e.g. "app.editor". */
	id: string;
	name: string;
	parent: string | null;
	source: SourceRef;
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
}

export interface ResourceResult {
	id: string;
	name: string;
	parent: string | null;
	source: SourceRef;
	group: boolean;
	scenarios: Record<string, { efficiency: number }>;
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
}

export interface SyntaxDocs {
	tjVersion: string;
	keywords: KeywordDoc[];
}
/** Filled from TaskJuggler's own keyword documentation. Phase 1 may extend it. */
export interface KeywordDoc {
	/** E.g. "effort" or "limits.dailymax". */
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
