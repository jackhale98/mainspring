// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The reasons only the plan's text can give for a task that the dependency picker lists but cannot
 * link (depends-picker.ts has the rest), read from the same facts `addDepends` reads
 * (tjp/edit/deps.ts), so the picker and the edit API agree without a dry run per task:
 * - `inherited`: the link already exists through a container's list. TaskJuggler inherits
 *   `depends` and `precedes` down the tree, so `task build { depends design.gate … }` already makes
 *   every task in Build wait for the gate, and the resolved links the inspector lists leave that
 *   out (`inheritedLink`, deps-links.ts: the successor's inherited `depends` naming the predecessor,
 *   or the predecessor's inherited `precedes` naming the successor);
 * - `macro-in-body`: a macro call in the body of the successor (`depends`) or of the predecessor
 *   (`precedes`) may write the list the new item goes in (`linkTasks`, deps-links.ts).
 * Pure over the workspace snapshot and its index; nothing here edits or schedules.
 */
import type { WorkspaceSnapshot } from '../workspace/workspace';
import type { SymbolIndex, TaskId } from '../tjp/index';
import { stateReader } from '../tjp/edit/dep-graph';
import { checkBodyMacros } from '../tjp/edit/lists';
import type { PickRole, Unavailable } from './depends-picker';

/** The reason for each other task, for `task` in `role` (what the chosen task is to it). */
export function dependsBlocks(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	role: PickRole,
): (other: TaskId) => Unavailable | null {
	// One graph behind every reading, built once.
	const read = stateReader(ws, index);
	const me = index.tasks.get(task);
	const mine = read(task).inherited;
	return (other) => {
		const them = index.tasks.get(other);
		if (!me || !them) return null;
		const predecessor = role === 'predecessor';
		// The successor's own `depends` and the predecessor's own `precedes` are the lists written.
		const succ = predecessor ? me : them;
		const pred = predecessor ? them : me;
		if (
			checkBodyMacros(ws, index, succ, ['depends']) ??
			checkBodyMacros(ws, index, pred, ['precedes'])
		) {
			return 'macro-in-body';
		}
		const theirs = read(other).inherited;
		const succInherited = predecessor ? mine : theirs;
		const predInherited = predecessor ? theirs : mine;
		const succId = predecessor ? task : other;
		const predId = predecessor ? other : task;
		const through =
			(succInherited?.depends.some((d) => d.target === predId) ?? false) ||
			(predInherited?.precedes.some((d) => d.target === succId) ?? false);
		return through ? 'inherited' : null;
	};
}
