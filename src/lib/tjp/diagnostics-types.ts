// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The diagnostic type of the document layer (phase-1.md 6.6), shared by the engine mapping
 * (diagnostics.ts), the refinement table (diagnostics-refine.ts), the local checks
 * (diagnostics-local.ts) and the position mapping (diagnostics-map.ts).
 *
 * Additions to the spec's interface (recorded in the T9 report):
 * - `precision` has a fourth value, 'statement', for a whole attribute statement or a
 *   declaration header (the spec's 'token' covers single tokens only here);
 * - `source` has 'value' (checkValue on typed statements) and 'attribute' (15.2);
 * - `hint` holds a suggestion such as "Did you mean effort?";
 * - `stale` marks engine diagnostics mapped through edits made after the run.
 */
import type { MessageLevel, Revision, WorkspacePath } from '../../engine/protocol';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticSource = 'engine' | 'syntax' | 'value' | 'attribute';
/**
 * How exactly the range places the problem: one token, a statement or declaration header, the
 * engine's line (trimmed), or no place at all (shown in the status strip only).
 */
export type DiagnosticPrecision = 'token' | 'statement' | 'line' | 'none';

export interface TjpDiagnostic {
	/** The file the range is in; unlocated engine messages go to the entry file. */
	readonly file: WorkspacePath | null;
	readonly from: number;
	readonly to: number;
	readonly severity: DiagnosticSeverity;
	readonly source: DiagnosticSource;
	/** TaskJuggler's message id, or the document layer's own (`syntax:unexpected`, …). */
	readonly messageId: string;
	readonly message: string;
	/** A suggestion to show after the message, or null. */
	readonly hint: string | null;
	readonly scenario: string | null;
	readonly precision: DiagnosticPrecision;
	/** Line (as TaskJuggler counts lines) and UTF-16 column of `from`, both 1-based; null with precision 'none'. */
	readonly line: number | null;
	readonly column: number | null;
	/** The run an engine diagnostic comes from; null for local diagnostics. */
	readonly revision: Revision | null;
	/** True once the text changed after the run; cleared by the next result. */
	readonly stale: boolean;
}

/** fatal and error are errors; debug messages are dropped (null). */
export function severityOf(level: MessageLevel): DiagnosticSeverity | null {
	switch (level) {
		case 'fatal':
		case 'error':
			return 'error';
		case 'warning':
			return 'warning';
		case 'info':
			return 'info';
		case 'debug':
			return null;
	}
}
