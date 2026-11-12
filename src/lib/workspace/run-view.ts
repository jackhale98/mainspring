// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the schedule runner (schedule-runner.ts) shows for the text as it is now, derived from
 * the last results and the snapshots they were scheduled from (phase-1.md 6.4, 6.6, 6.8):
 *
 * - hints: the hint base's engine hints mapped through the edits made since its snapshot
 *   (run-lines.ts), so a line touched since then has none until the next result;
 * - index: `buildIndex` of the current snapshot with those hints;
 * - diagnostics: the diagnostic base's engine diagnostics mapped through the same kind of edits
 *   (`mapDiagnostics`, stale until the next result), merged with the local diagnostics of the
 *   current snapshot (`localDiagnostics`, `mergeDiagnostics`).
 *
 * A result that stopped while parsing (ok false, no task and no resource) names no ids, so it is
 * no hint base: the earlier hints stay, mapped from their own snapshot. When the workspace no
 * longer keeps the changes since a base's snapshot (`changesSince` throws RangeError), that
 * base's hints or engine diagnostics are dropped until the next result.
 */
import type { ChangeSet } from '@codemirror/state';
import type { ScheduleResult, WorkspacePath } from '../../engine/protocol';
import {
	localDiagnostics,
	mapDiagnostics,
	mergeDiagnostics,
	type TjpDiagnostic,
} from '../tjp/diagnostics';
import {
	buildIndex,
	hintsFromResult,
	NO_HINTS,
	type EngineHints,
	type SymbolIndex,
} from '../tjp/index';
import { lineMap } from './run-lines';
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

export interface View {
	/** The workspace version everything here describes. */
	readonly version: number;
	readonly hints: EngineHints;
	readonly index: SymbolIndex;
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

/** The base's hints in the lines of `now`. */
export function hintsNow(
	ws: Workspace,
	now: WorkspaceSnapshot,
	base: HintBase | null,
): EngineHints {
	if (!base) return NO_HINTS;
	if (base.snapshot.version === now.version) return base.hints;
	const changes = changesFrom(ws, now, base.snapshot.version);
	if (!changes) return NO_HINTS;
	const map = lineMap(base.snapshot, now, changes);
	return hintsFromResult(base.result, map.mapLine, map.sentLine);
}

/** The base's engine diagnostics in the texts of `now`; stale when the text changed. */
export function engineDiagnosticsNow(
	ws: Workspace,
	now: WorkspaceSnapshot,
	base: DiagnosticBase | null,
): readonly TjpDiagnostic[] {
	if (!base) return [];
	if (base.snapshot.version === now.version) return base.diagnostics;
	const changes = changesFrom(ws, now, base.snapshot.version);
	if (!changes) return [];
	return mapDiagnostics(base.diagnostics, changes, (p) => now.files.get(p)?.text ?? null);
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

/** The index of `now` with the hint base's hints. */
export function indexNow(
	ws: Workspace,
	now: WorkspaceSnapshot,
	hintBase: HintBase | null,
): { hints: EngineHints; index: SymbolIndex } {
	const hints = hintsNow(ws, now, hintBase);
	return { hints, index: buildIndex(now, hints) };
}

/** Everything shown for `now`; `prepared` reuses an index of `now` built by `indexNow`. */
export function viewNow(
	ws: Workspace,
	now: WorkspaceSnapshot,
	hintBase: HintBase | null,
	diagnosticBase: DiagnosticBase | null,
	prepared?: { hints: EngineHints; index: SymbolIndex },
): View {
	const { hints, index } =
		prepared && prepared.index.version === now.version ? prepared : indexNow(ws, now, hintBase);
	const engine = engineDiagnosticsNow(ws, now, diagnosticBase);
	const diagnostics = mergeDiagnostics(engine, localDiagnostics(now, index));
	return { version: now.version, hints, index, diagnostics, counts: countDiagnostics(diagnostics) };
}
