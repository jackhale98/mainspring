// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Diagnostics (phase-1.md 6.6, ADR-0003 #2): engine messages, which carry a file and a line but
 * no column (14.1), become ranges in the text that was scheduled, with a derived column and a
 * `precision`; local checks (syntax, values, custom attributes) appear without the engine.
 *
 * - `engineDiagnostics(result, sent, index)`: one diagnostic per message (debug dropped). The
 *   engine line is read as TaskJuggler counts lines (`\r\n`, `\r` and `\n`), refined by
 *   diagnostics-refine.ts. A message without a file in the workspace, or without a line, is
 *   placed on the entry file's project header with precision 'none' (status strip only).
 * - `localDiagnostics(ws, index)` (diagnostics-local.ts).
 * - `mergeDiagnostics(engine, local)`: a local diagnostic that reports the same problem as an
 *   engine one (same message id, or a syntax or attribute diagnostic and an engine parse
 *   error, at overlapping ranges; never a stale or less severe engine entry) is dropped; that
 *   engine diagnostic keeps its text and takes the local hint, and the local range when that is
 *   narrower and inside it.
 * - `mapDiagnostics(list, changes, current)` (diagnostics-map.ts): stale positions.
 *
 * `sent` is the snapshot whose texts were scheduled (the runner keeps it until the result is
 * handled; spec 6.6 passes the texts, the trees are needed as well). The index is used only when
 * it was built from that snapshot.
 */
import type { EngineMessage, ScheduleResult, WorkspacePath } from '../../engine/protocol';
import type { TjpFile } from './document';
import { engineLine, lineColumn, type Span } from './diagnostics-lines';
import { headerOf } from './diagnostics-find';
import { refineMessage } from './diagnostics-refine';
import { severityOf, type TjpDiagnostic } from './diagnostics-types';
import type { SymbolIndex } from './index/types';
import { sortDiagnostics } from './diagnostics-local';
import { statementsIn } from './tree';

export type {
	DiagnosticPrecision,
	DiagnosticSeverity,
	DiagnosticSource,
	TjpDiagnostic,
} from './diagnostics-types';
export {
	attributeDiagnostics,
	localDiagnostics,
	sortDiagnostics,
	syntaxDiagnostics,
	valueDiagnostics,
} from './diagnostics-local';
export { mapDiagnostics, mapRange } from './diagnostics-map';

/** What was scheduled: a WorkspaceSnapshot fits. */
export interface SentWorkspace {
	readonly entry: WorkspacePath;
	readonly version?: number;
	readonly files: ReadonlyMap<WorkspacePath, TjpFile>;
}

/** The entry file's project header, or its start. */
function entryHeader(file: TjpFile | undefined): Span {
	if (!file) return { from: 0, to: 0 };
	const top = file.tree.topNode;
	const project = statementsIn(top).find((s) => s.name === 'ProjectStatement');
	if (!project) return { from: 0, to: 0 };
	const interval = project.getChild('Interval');
	return interval ? { from: project.from, to: interval.to } : headerOf(project);
}

function engineDiagnostic(
	m: EngineMessage,
	revision: number,
	sent: SentWorkspace,
	index: SymbolIndex | null,
): TjpDiagnostic | null {
	const severity = severityOf(m.level);
	if (severity === null) return null;
	const common = {
		severity,
		source: 'engine' as const,
		messageId: m.id,
		message: m.text,
		hint: null,
		scenario: m.scenario,
		revision,
		stale: false,
	};
	const file = m.file === null ? undefined : sent.files.get(m.file);
	if (!file || m.line === null || m.line < 1) {
		const at = entryHeader(sent.files.get(sent.entry));
		return {
			...common,
			file: sent.entry,
			...at,
			precision: 'none',
			line: null,
			column: null,
		};
	}
	const line = engineLine(file.text, m.line);
	const r = refineMessage({ file, line, id: m.id, text: m.text, scenario: m.scenario, index });
	const pos = lineColumn(file.text, r.from);
	return { ...common, file: file.path, from: r.from, to: r.to, precision: r.precision, ...pos };
}

/** Diagnostics for a schedule result, in the scheduled texts; see the module comment. */
export function engineDiagnostics(
	result: ScheduleResult,
	sent: SentWorkspace,
	index?: SymbolIndex | null,
): TjpDiagnostic[] {
	const idx =
		index && (sent.version === undefined || index.version === sent.version) ? index : null;
	const out: TjpDiagnostic[] = [];
	for (const m of result.messages) {
		const d = engineDiagnostic(m, result.revision, sent, idx);
		if (d) out.push(d);
	}
	return out;
}

const RANK = { info: 0, warning: 1, error: 2 } as const;

/** Engine ids of parse errors, which a local syntax or attribute diagnostic can repeat. */
const PARSE_ERRORS: ReadonlySet<string> = new Set([
	'no_reduce',
	'unexpctd_token',
	'runaway_token',
	'no_token_match',
	'junk_after_cut',
]);

const overlap = (a: TjpDiagnostic, b: TjpDiagnostic): boolean =>
	a.file === b.file && a.from <= b.to && b.from <= a.to;

/**
 * Whether local diagnostic `l` reports the same problem as engine diagnostic `e`: the same
 * message id (value checks carry TaskJuggler's id) or a parse error the tree also has, at
 * overlapping ranges, in a fresh engine entry at least as severe.
 */
function sameProblem(e: TjpDiagnostic, l: TjpDiagnostic): boolean {
	if (e.stale || e.precision === 'none' || RANK[e.severity] < RANK[l.severity]) return false;
	if (!overlap(e, l)) return false;
	if (l.messageId === e.messageId) return true;
	return (l.source === 'syntax' || l.source === 'attribute') && PARSE_ERRORS.has(e.messageId);
}

const NARROWER: ReadonlySet<string> = new Set(['line', 'statement']);

/** Engine and local diagnostics together, without duplicates; see the module comment. */
export function mergeDiagnostics(
	engine: readonly TjpDiagnostic[],
	local: readonly TjpDiagnostic[],
): TjpDiagnostic[] {
	const merged = engine.map((e) => ({ ...e }));
	const kept: TjpDiagnostic[] = [];
	for (const l of local) {
		const i = merged.findIndex((e) => sameProblem(e, l));
		const e = merged[i];
		if (!e) {
			kept.push(l);
			continue;
		}
		const inside = l.from >= e.from && l.to <= e.to && l.to - l.from < e.to - e.from;
		merged[i] = {
			...e,
			hint: e.hint ?? l.hint,
			...(inside && NARROWER.has(e.precision)
				? { from: l.from, to: l.to, precision: 'token' as const, line: l.line, column: l.column }
				: {}),
		};
	}
	return sortDiagnostics([...merged, ...kept]);
}
