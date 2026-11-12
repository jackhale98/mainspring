// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Stale positions (phase-1.md 6.6 step 4). Engine diagnostics are placed in the text that was
 * scheduled; when the text changes before the next result, `mapDiagnostics` maps them through
 * `Workspace.changesSince(sentVersion)` as CodeMirror maps a mark (the start sticks to the text
 * after it, the end to the text before it; a range whose text is deleted collapses to a point),
 * recomputes line and column against the current text, and marks them stale. The next result
 * replaces them.
 */
import type { ChangeSet, Text } from '@codemirror/state';
import type { WorkspacePath } from '../../engine/protocol';
import { lineColumn } from './diagnostics-lines';
import type { TjpDiagnostic } from './diagnostics-types';

const clamp = (n: number, max: number): number => Math.min(Math.max(0, n), max);

/** One range mapped through a change set; always inside `[0, changes.newLength]`. */
export function mapRange(
	from: number,
	to: number,
	changes: ChangeSet,
): { from: number; to: number } {
	const a = clamp(Math.min(from, to), changes.length);
	const b = clamp(Math.max(from, to), changes.length);
	if (a === b) {
		const p = changes.mapPos(a, -1);
		return { from: p, to: p };
	}
	const f = changes.mapPos(a, 1);
	const t = changes.mapPos(b, -1);
	return t < f ? { from: f, to: f } : { from: f, to: t };
}

/**
 * Diagnostics mapped through the changes made since they were computed. `current` gives each
 * file's text now (for line and column). With no non-empty change, the list is returned as is.
 */
export function mapDiagnostics(
	list: readonly TjpDiagnostic[],
	changes: ReadonlyMap<WorkspacePath, ChangeSet>,
	current: (path: WorkspacePath) => Text | null,
): readonly TjpDiagnostic[] {
	if (![...changes.values()].some((c) => !c.empty)) return list;
	return list.map((d) => {
		const cs = d.file === null ? undefined : changes.get(d.file);
		if (!cs || cs.empty) return { ...d, stale: true };
		const { from, to } = mapRange(d.from, d.to, cs);
		const doc = d.file === null ? null : current(d.file);
		const pos =
			d.precision === 'none' || !doc || doc.length !== cs.newLength
				? { line: null, column: null }
				: lineColumn(doc, from);
		return { ...d, from, to, line: pos.line, column: pos.column, stale: true };
	});
}
