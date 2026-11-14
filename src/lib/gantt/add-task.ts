// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where the Add task (+) control puts a new task (phase-3.md 6.8, 9.8; ADR-0013), and which
 * outline node is the new one once the edit is in. Pure: it reads the outline's tree, never the
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
		return node.id === null
			? null
			: { parent: node.id, parentKey: node.key, index: resolvedCount(tree, node.children) };
	}
	const place = placeNow(tree, node.key, roots);
	return place && { parent: place.parent, parentKey: place.parentKey, index: place.index + 1 };
}

/**
 * The key of the node the edit added: the one under `parentKey` that was not in the outline
 * before. Null while the index has not caught up with the text.
 */
export function newTaskKey(
	before: ReadonlySet<string>,
	nodes: ReadonlyArray<{ readonly key: string; readonly parent: string | null }>,
	parentKey: string | null,
): string | null {
	return nodes.find((n) => n.parent === parentKey && !before.has(n.key))?.key ?? null;
}
