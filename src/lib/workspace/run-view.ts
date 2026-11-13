// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the schedule runner (schedule-runner.ts) shows for the text as it is now, derived from
 * the last results and the snapshots they were scheduled from (phase-1.md 6.4, 6.6, 6.8):
 *
 * - hints: the hint base's engine hints mapped through the edits made since its snapshot
 *   (run-lines.ts), so a line touched since then has none until the next result; every hint is
 *   dropped once a change touched a macro definition;
 * - index: `buildIndex` with those hints;
 * - diagnostics: the diagnostic base's engine diagnostics mapped through the edits since its
 *   snapshot (`mapDiagnostics`, stale until the next result), merged with the local diagnostics
 *   (syntax for every file, value and attribute checks from the index) as `localDiagnostics`
 *   and `mergeDiagnostics` do.
 *
 * A view has three parts, each of its own workspace version (phase-2.md 6.9): the index part
 * (hints and index, `indexVersion`), the value and attribute checks (`checksVersion`, at most
 * `indexVersion`) and the diagnostics (`version`, the newest). `composeView` puts the parts
 * together for a snapshot, mapping the checks to it (marked stale when the text changed). The
 * runner brings the parts up to date one at a time in idle tasks (run-derive.ts): the index with
 * `prepareIndex`, then the checks with `checksOf`. `fullView` derives every part at once.
 * `quickView`, for a keystroke, keeps the previous view's index part and checks and recomputes
 * only what must follow the text at once: engine diagnostic positions and syntax diagnostics
 * (6.6 #5), cached per file version so only the edited file is walked again.
 *
 * A result that stopped while parsing (ok false, no task and no resource) names no ids, so it is
 * no hint base: the earlier hints stay, mapped from their own snapshot. When the workspace no
 * longer keeps the changes since a base's snapshot (`changesSince` throws RangeError), that
 * base's hints or engine diagnostics are dropped until the next result, and so are checks.
 */
import type { ChangeSet } from '@codemirror/state';
import type { EngineState } from '../../engine/client';
import type { ScheduleResult, WorkspacePath } from '../../engine/protocol';
import type { TjpFile } from '../tjp/document';
import {
	attributeDiagnostics,
	mapDiagnostics,
	mergeDiagnostics,
	sortDiagnostics,
	syntaxDiagnostics,
	valueDiagnostics,
	type TjpDiagnostic,
} from '../tjp/diagnostics';
import {
	buildIndex,
	hintsFromResult,
	NO_HINTS,
	type EngineHints,
	type HintEntry,
	type SymbolIndex,
} from '../tjp/index';
import type { ZoneOffsets } from '../tjp/values';
import { changesMacroDefinition, lineMap } from './run-lines';
import type { Workspace, WorkspaceSnapshot } from './workspace';

/** Engine hints from one result, in the lines of the snapshot it was scheduled from. */
export interface HintBase {
	readonly snapshot: WorkspaceSnapshot;
	readonly result: ScheduleResult;
	readonly hints: EngineHints;
}

/** Engine diagnostics from one result, in the texts of the snapshot it was scheduled from. */
export interface DiagnosticBase {
	readonly snapshot: WorkspaceSnapshot;
	readonly diagnostics: readonly TjpDiagnostic[];
}

export interface DiagnosticCounts {
	readonly errors: number;
	readonly warnings: number;
	readonly infos: number;
}

/** The index part of a view: hints and index of one version. */
export interface Prepared {
	readonly indexVersion: number;
	/** The snapshot of `indexVersion`, which its checks are computed on. */
	readonly snapshot: WorkspaceSnapshot;
	readonly hints: EngineHints;
	readonly index: SymbolIndex;
}

/** Value and attribute diagnostics, in the texts of the version they were computed at. */
export interface Checks {
	readonly version: number;
	readonly list: readonly TjpDiagnostic[];
}

export interface View extends Prepared {
	/** The workspace version `diagnostics` describe. */
	readonly version: number;
	/** Value and attribute diagnostics of `checksVersion` (at most `indexVersion`), in its texts. */
	readonly checks: readonly TjpDiagnostic[];
	readonly checksVersion: number;
	readonly diagnostics: readonly TjpDiagnostic[];
	readonly counts: DiagnosticCounts;
}

const NO_CHANGES: ReadonlyMap<WorkspacePath, ChangeSet> = new Map();

/** Whether a result names ids: it got past parsing. */
export function isHintSource(r: ScheduleResult): boolean {
	return r.ok || r.tasks.length > 0 || r.resources.length > 0;
}

/** Hints from a result, against the snapshot that was sent. */
export function sentHints(r: ScheduleResult, sent: WorkspaceSnapshot): EngineHints {
	const map = lineMap(sent, sent, NO_CHANGES);
	return hintsFromResult(r, map.mapLine, map.sentLine);
}

const sameEntries = (a: readonly HintEntry[], b: readonly HintEntry[]): boolean =>
	a.length === b.length &&
	a.every((e, i) => {
		const f = b[i];
		return (
			f !== undefined &&
			e.id === f.id &&
			e.parent === f.parent &&
			e.file === f.file &&
			e.line === f.line &&
			e.text === f.text
		);
	});

export function sameHints(a: EngineHints, b: EngineHints): boolean {
	return a === b || (sameEntries(a.tasks, b.tasks) && sameEntries(a.resources, b.resources));
}

/** The per-file changes since `version`, or null when the workspace no longer keeps them. */
export function changesFrom(
	ws: Workspace,
	now: WorkspaceSnapshot,
	version: number,
): ReadonlyMap<WorkspacePath, ChangeSet> | null {
	if (version === now.version) return NO_CHANGES;
	try {
		return ws.changesSince(version);
	} catch (error) {
		if (error instanceof RangeError) return null;
		throw error;
	}
}

/** The base's hints in the lines of `now`; none once a macro definition was changed. */
export function hintsNow(
	ws: Workspace,
	now: WorkspaceSnapshot,
	base: HintBase | null,
): EngineHints {
	if (!base) return NO_HINTS;
	if (base.snapshot.version === now.version) return base.hints;
	const changes = changesFrom(ws, now, base.snapshot.version);
	if (!changes || changesMacroDefinition(base.snapshot, now, changes)) return NO_HINTS;
	const map = lineMap(base.snapshot, now, changes);
	return hintsFromResult(base.result, map.mapLine, map.sentLine);
}

/** Diagnostics computed at `version`, in the texts of `now`; stale when the text changed. */
function mappedFrom(
	ws: Workspace,
	now: WorkspaceSnapshot,
	version: number,
	list: readonly TjpDiagnostic[],
): readonly TjpDiagnostic[] {
	if (version === now.version || list.length === 0) return list;
	const changes = changesFrom(ws, now, version);
	if (!changes) return [];
	return mapDiagnostics(list, changes, (p) => now.files.get(p)?.text ?? null);
}

/** The base's engine diagnostics in the texts of `now`. */
export function engineDiagnosticsNow(
	ws: Workspace,
	now: WorkspaceSnapshot,
	base: DiagnosticBase | null,
): readonly TjpDiagnostic[] {
	return base ? mappedFrom(ws, now, base.snapshot.version, base.diagnostics) : [];
}

export function countDiagnostics(list: readonly TjpDiagnostic[]): DiagnosticCounts {
	let errors = 0;
	let warnings = 0;
	let infos = 0;
	for (const d of list) {
		if (d.severity === 'error') errors++;
		else if (d.severity === 'warning') warnings++;
		else infos++;
	}
	return { errors, warnings, infos };
}

/** Syntax diagnostics per file version (a new version is a new object). */
const syntaxOf = new WeakMap<TjpFile, readonly TjpDiagnostic[]>();

function syntax(now: WorkspaceSnapshot): TjpDiagnostic[] {
	const out: TjpDiagnostic[] = [];
	for (const file of now.files.values()) {
		let list = syntaxOf.get(file);
		if (!list) {
			list = syntaxDiagnostics(file);
			syntaxOf.set(file, list);
		}
		out.push(...list);
	}
	return out;
}

const overlaps = (a: TjpDiagnostic, b: TjpDiagnostic): boolean =>
	a.file === b.file && a.from <= b.to && b.from <= a.to;

/** `localDiagnostics` from its parts: checks that overlap a syntax diagnostic are dropped. */
function local(now: WorkspaceSnapshot, checks: readonly TjpDiagnostic[]): TjpDiagnostic[] {
	const s = syntax(now);
	const kept = checks.filter((d) => !s.some((x) => overlaps(x, d)));
	return sortDiagnostics([...s, ...kept]);
}

/**
 * The view of `now` from an index part and checks of earlier or equal versions: the checks and
 * the base's engine diagnostics are mapped to `now` and merged with its syntax diagnostics.
 */
export function composeView(
	ws: Workspace,
	now: WorkspaceSnapshot,
	part: Prepared,
	checks: Checks,
	base: DiagnosticBase | null,
): View {
	const engine = engineDiagnosticsNow(ws, now, base);
	const mapped = mappedFrom(ws, now, checks.version, checks.list);
	const diagnostics = mergeDiagnostics(engine, local(now, mapped));
	const { indexVersion, snapshot, hints, index } = part;
	return {
		version: now.version,
		indexVersion,
		snapshot,
		hints,
		index,
		checks: checks.list,
		checksVersion: checks.version,
		diagnostics,
		counts: countDiagnostics(diagnostics),
	};
}

/** The value and attribute checks of an index part, in the texts of its version. */
export function checksOf(p: Prepared): Checks {
	return {
		version: p.indexVersion,
		list: [...valueDiagnostics(p.snapshot, p.index), ...attributeDiagnostics(p.snapshot, p.index)],
	};
}

/** A view's checks with their version. */
export function checksOfView(v: View): Checks {
	return { version: v.checksVersion, list: v.checks };
}

/**
 * The index of `now` with the hint base's hints (and `zones`, the time-zone data that zone names
 * and zone-dependent value checks need; without it they are skipped as uncheckable). `reuse` (an
 * earlier view or index part) is returned when it is of the same version and its hints are equal,
 * so its index needs no rebuild.
 */
export function prepareIndex(
	ws: Workspace,
	now: WorkspaceSnapshot,
	hintBase: HintBase | null,
	reuse?: Prepared | null,
	zones?: ZoneOffsets,
): Prepared {
	const hints = hintsNow(ws, now, hintBase);
	if (reuse && reuse.indexVersion === now.version && sameHints(reuse.hints, hints)) return reuse;
	return {
		indexVersion: now.version,
		snapshot: now,
		hints,
		index: buildIndex(now, hints, zones === undefined ? {} : { zones }),
	};
}

/** Every part derived for `now`; `prepared` (from `prepareIndex` for `now`) saves the index. */
export function fullView(
	ws: Workspace,
	now: WorkspaceSnapshot,
	hintBase: HintBase | null,
	diagnosticBase: DiagnosticBase | null,
	prepared?: Prepared,
	zones?: ZoneOffsets,
): View {
	const p =
		prepared && prepared.indexVersion === now.version
			? prepared
			: prepareIndex(ws, now, hintBase, null, zones);
	return composeView(ws, now, p, checksOf(p), diagnosticBase);
}

/** For a keystroke: `prev`'s index part and checks kept, diagnostics brought to `now`. */
export function quickView(
	ws: Workspace,
	now: WorkspaceSnapshot,
	prev: View,
	diagnosticBase: DiagnosticBase | null,
): View {
	return composeView(ws, now, prev, checksOfView(prev), diagnosticBase);
}

export type RunnerStatus = 'idle' | 'scheduling' | 'ok' | 'errors' | 'failed';

/** The status rule of `RunnerState.status` (schedule-runner.ts). */
export function runnerStatus(s: {
	engine: EngineState;
	pending: boolean;
	failed: boolean;
	/** The latest result's `ok`, or null before the first result. */
	latestOk: boolean | null;
	errors: number;
}): RunnerStatus {
	if (s.engine === 'failed') return 'failed';
	if (s.pending) return 'scheduling';
	if (s.failed) return 'failed';
	if (s.latestOk === null) return 'idle';
	return !s.latestOk || s.errors > 0 ? 'errors' : 'ok';
}
