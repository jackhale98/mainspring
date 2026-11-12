// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * "Go to the next problem" across files (phase-1.md 8.2): the error and warning diagnostics that
 * have a place in the text, ordered by file (in workspace order) and position, and the one after
 * the cursor, wrapping at the end. A cursor already on a diagnostic's start moves on to the
 * following one, so repeated presses walk through the list.
 */
import type { WorkspacePath } from '../../engine/protocol';
import type { TjpDiagnostic } from '../tjp/diagnostics';

export interface Cursor {
	readonly file: WorkspacePath;
	readonly pos: number;
}

/** The diagnostics the editor can mark, in the order of the files and then of the text. */
export function locatedProblems(
	diagnostics: readonly TjpDiagnostic[],
	files: readonly WorkspacePath[],
): TjpDiagnostic[] {
	const rank = new Map(files.map((f, i) => [f, i] as const));
	return diagnostics
		.filter(
			(d) =>
				d.file !== null &&
				d.precision !== 'none' &&
				(d.severity === 'error' || d.severity === 'warning') &&
				rank.has(d.file),
		)
		.sort(
			(a, b) =>
				(rank.get(a.file ?? '') ?? 0) - (rank.get(b.file ?? '') ?? 0) ||
				a.from - b.from ||
				a.to - b.to,
		);
}

/** The next located problem after `cursor`, or the first one; null when there is none. */
export function nextProblem(
	diagnostics: readonly TjpDiagnostic[],
	files: readonly WorkspacePath[],
	cursor: Cursor,
): TjpDiagnostic | null {
	const list = locatedProblems(diagnostics, files);
	if (list.length === 0) return null;
	const rank = new Map(files.map((f, i) => [f, i] as const));
	const here = rank.get(cursor.file) ?? 0;
	const after = list.find((d) => {
		const r = rank.get(d.file ?? '') ?? 0;
		return r > here || (r === here && d.from > cursor.pos);
	});
	return after ?? list[0] ?? null;
}
