// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A range of the index's text in the text as it is now. The index may be older than the text
 * (typing, an edit whose result has not come back), so the range is mapped forward through
 * `changesSince(indexVersion)`. T15's `sourceOf` (phase-2.md 6.10) is the same rule for a task's
 * declaration.
 */
import type { SourceRange } from '../tjp/index';
import type { Workspace } from '../workspace/workspace';

export function currentRange(
	ws: Pick<Workspace, 'changesSince'>,
	indexVersion: number | undefined,
	r: SourceRange,
): SourceRange {
	let changes;
	try {
		changes = indexVersion === undefined ? undefined : ws.changesSince(indexVersion).get(r.file);
	} catch {
		changes = undefined;
	}
	if (!changes) return r;
	const from = changes.mapPos(r.from, 1);
	const to = changes.mapPos(r.to, -1);
	return { file: r.file, from, to: Math.max(from, to) };
}
