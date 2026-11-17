// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A cursor inside a `resource` block selects that person (phase-3.md 6.7, T17), as a cursor inside a
 * task selects the task (selection.svelte.ts `taskAtCursor`, whose rule this repeats for the
 * resource tree; that file is over its line budget already). The index may be older than the text
 * (typing, an edit whose result has not come back), so each declaration's block (a supplement's too)
 * is mapped forward through `changesSince(indexVersion)` into the text now and the smallest block
 * around the position wins. A declaration whose header was deleted is gone from the text and never
 * matches. Null when the position is in no resource, or the changes since the index are no longer
 * kept.
 */
import type { WorkspacePath } from '../../engine/protocol';
import type { ResourceId } from '../tjp/index';
import type { RunView } from './selection.svelte';
import type { Workspace } from '../workspace/workspace';

export function resourceAtCursor(
	run: Pick<RunView, 'index' | 'indexVersion'>,
	ws: Pick<Workspace, 'changesSince'>,
	file: WorkspacePath,
	pos: number,
): ResourceId | null {
	let changes;
	try {
		changes = ws.changesSince(run.indexVersion).get(file);
	} catch {
		return null;
	}
	let best: ResourceId | null = null;
	let size = Infinity;
	for (const sym of run.index.resources.values()) {
		for (const site of [sym.decl, ...sym.supplements]) {
			const b = site.block;
			if (b.file !== file) continue;
			const head = site.header;
			if (changes && changes.mapPos(head.from, 1) >= changes.mapPos(head.to, -1)) continue;
			const from = changes ? changes.mapPos(b.from, 1) : b.from;
			const to = changes ? changes.mapPos(b.to, -1) : b.to;
			if (from <= pos && pos <= to && to - from < size) {
				best = sym.id;
				size = to - from;
			}
		}
	}
	return best;
}
