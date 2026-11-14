// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where the Add task (+) control puts a new task (phase-3.md 6.8, 9.8; ADR-0013), and which
 * outline node is the new one. Pure: it reads the outline's tree, never the
 * schedule or the text. The edit itself is the existing `addTask` intent, sent as the Gantt's
 * `add` action (the same one the row menu's "Add a task after" sends).
 *
 * - `after`: the selected task's parent, at its index plus one;
 * - at the end of the plan (parent null) when nothing is selected, or the plan has no tasks;
 * - `subtask`: the selected task as the parent, as its last child.
 *
 * Indexes count only the siblings the index resolved, as `moveTask` and `addTask` do: a
 * declaration built by a macro has no id the edit API can name.
 */
import type { TaskId } from '../tjp/index';
import { placeNow, type Tree } from './reorder';

export type AddMode = 'after' | 'subtask';

export interface AddSpot {
	readonly parent: TaskId | null;
	/** The parent's outline key, or null at the top level: the new task's place in the tree. */
	readonly parentKey: string | null;
	readonly index: number;
}

const resolvedCount = (tree: Tree, keys: readonly string[]): number =>
	keys.filter((k) => tree.get(k)?.id != null).length;

/** The place for a new task, or null when there is none (a subtask of a task with no id). */
export function addSpot(
	tree: Tree,
	roots: readonly string[],
	selected: string | null,
	mode: AddMode,
): AddSpot | null {
	const node = selected === null ? undefined : tree.get(selected);
	if (!node) {
		return mode === 'after'
			? { parent: null, parentKey: null, index: resolvedCount(tree, roots) }
			: null;
	}
	if (mode === 'subtask') {
		return !canAddSubtask(tree, node.key)
			? null
			: { parent: node.id, parentKey: node.key, index: resolvedCount(tree, node.children) };
	}
	const place = placeNow(tree, node.key, roots);
	return place && { parent: place.parent, parentKey: place.parentKey, index: place.index + 1 };
}

/** Whether the selected task can be given a subtask: it is in the outline and has an id. */
export function canAddSubtask(tree: Tree, selected: string | null): boolean {
	return selected !== null && (tree.get(selected)?.id ?? null) !== null;
}

/**
 * The outline key of the task an `addTask` edit wrote, from the text of its header
 * (`task <id> "<name>"`, the edit's `select` range after the edit) and the parent it went into:
 * the same full id the edit API made (`parent.id`). The outline lags the text, so the new node is
 * never found by comparing it with an earlier snapshot of the outline. Null when the text is not
 * a task header.
 */
export function newTaskKeyFromHeader(header: string, parent: TaskId | null): string | null {
	const id = /^task\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(header)?.[1];
	return id === undefined ? null : `task:${parent === null ? id : `${parent}.${id}`}`;
}
