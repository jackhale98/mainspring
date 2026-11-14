// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Reordering and reparenting rows (phase-2.md 7.1 R5): where a dragged row would go, and the
 * `reorder` action for it (`moveTask(task, parent, index)`, intents.ts). Pure: it reads the
 * visible rows and the outline's tree, never the schedule or the text.
 *
 * - `dropTarget` is the pointer's drop: the row boundary the pointer is nearest to, and a depth
 *   from how far it moved sideways (one indent step each). The depths a boundary allows run from
 *   the depth of the row after it (the dragged row stays with its siblings) to one deeper than
 *   the row before it, when that is a container (it becomes that container's first child).
 *   The dragged row's own subtree is out of the way: it cannot be dropped into itself.
 * - `stepTarget` is the keyboard's: one place up or down among the siblings, one level deeper
 *   (the last child of the sibling above) or one level out (right after the parent).
 * - `index` counts the parent's other children, as `moveTask` does, and only those the index
 *   resolved (a macro-built declaration has no id the edit API can name).
 */
import type { TaskId } from '../tjp/index';

/** What the tree needs of an outline node. */
export interface TreeNode {
	readonly key: string;
	readonly id: string | null;
	readonly parent: string | null;
	readonly children: readonly string[];
}
export type Tree = ReadonlyMap<string, TreeNode>;

/** What a visible row is to the drop. */
export interface DropRow {
	readonly key: string;
	readonly depth: number;
	readonly kind: 'task' | 'container' | 'milestone';
	/** False for a collapsed container: it shows no children, and a drop in it opens it. */
	readonly expanded: boolean | null;
}

export interface Place {
	readonly parent: TaskId | null;
	readonly parentKey: string | null;
	readonly index: number;
}

export interface Drop extends Place {
	/** Where the line is drawn: before this visible row (the row count for the end). */
	readonly lineRow: number;
	readonly depth: number;
	/** The row the dragged one would nest into when it is collapsed: it opens after a pause. */
	readonly opens: string | null;
	/** Nothing would change: the row is dropped where it is. */
	readonly same: boolean;
}

/** The indent step of the outline in pointer movement, in px. */
export const INDENT_PX = 16;

const resolved = (tree: Tree, keys: readonly string[], except: string): TreeNode[] =>
	keys
		.filter((k) => k !== except)
		.map((k) => tree.get(k))
		.filter((n): n is TreeNode => n !== undefined && n.id !== null);

/** The top-level node keys, in order (nodes with no parent). */
export function rootsOf(tree: Tree, order: readonly string[]): string[] {
	return order.filter((k) => tree.get(k)?.parent === null);
}

function placeOf(tree: Tree, parent: string | null, index: number): Place {
	return {
		parent: parent === null ? null : (tree.get(parent)?.id ?? null),
		parentKey: parent,
		index,
	};
}

/** The current place of a node: its parent and its index among the other siblings. */
export function placeNow(tree: Tree, key: string, roots: readonly string[]): Place | null {
	const node = tree.get(key);
	if (!node) return null;
	const all = node.parent === null ? roots : (tree.get(node.parent)?.children ?? []);
	const index = resolved(tree, all.slice(0, all.indexOf(key)), key).length;
	return placeOf(tree, node.parent, index);
}

const same = (a: Place, b: Place): boolean => a.parentKey === b.parentKey && a.index === b.index;

export type Step = 'up' | 'down' | 'indent' | 'outdent';

/** The place a key moves a node to, or null when there is nowhere to go. */
export function stepTarget(
	tree: Tree,
	key: string,
	step: Step,
	roots: readonly string[],
): Place | null {
	const node = tree.get(key);
	if (!node || node.id === null) return null;
	const parentKey = node.parent;
	const all = parentKey === null ? roots : (tree.get(parentKey)?.children ?? []);
	const at = all.indexOf(key);
	const before = resolved(tree, all.slice(0, at), key).length;
	const after = resolved(tree, all.slice(at + 1), key).length;
	switch (step) {
		case 'up':
			return before === 0 ? null : placeOf(tree, parentKey, before - 1);
		case 'down':
			return after === 0 ? null : placeOf(tree, parentKey, before + 1);
		case 'indent': {
			const prev = resolved(tree, all.slice(0, at), key).at(-1);
			if (!prev) return null;
			return placeOf(tree, prev.key, resolved(tree, prev.children, key).length);
		}
		case 'outdent': {
			if (parentKey === null) return null;
			const parent = tree.get(parentKey);
			if (!parent) return null;
			const up = parent.parent;
			const level = up === null ? roots : (tree.get(up)?.children ?? []);
			const idx = resolved(tree, level.slice(0, level.indexOf(parentKey) + 1), key).length;
			return placeOf(tree, up, idx);
		}
	}
}

/**
 * Where a row dropped at the row boundary `boundary` (0 is above the first row, `rows.length`
 * below the last), wanting depth `want`, would go. `roots` is the order of the top-level nodes.
 */
export function dropTarget(
	rows: readonly DropRow[],
	tree: Tree,
	roots: readonly string[],
	dragged: string,
	boundary: number,
	want: number,
): Drop | null {
	const d = rows.findIndex((r) => r.key === dragged);
	const node = tree.get(dragged);
	if (d < 0 || !node || node.id === null) return null;
	const top = (rows[d] as DropRow).depth;
	let size = 1;
	while (rows[d + size] && (rows[d + size] as DropRow).depth > top) size++;
	// The rows with the dragged subtree taken out, and where the boundary falls among them.
	const rest = [...rows.slice(0, d), ...rows.slice(d + size)];
	const b = Math.max(0, Math.min(rows.length, boundary));
	const at = b <= d ? b : b >= d + size ? b - size : d;
	const prev = rest[at - 1];
	const next = rest[at];
	const max = prev ? prev.depth + (prev.kind === 'container' ? 1 : 0) : 0;
	const min = Math.min(max, next ? next.depth : 0);
	const depth = Math.max(min, Math.min(max, want));
	// The row at this depth that the dropped one follows, and the parent it would have.
	let before: DropRow | undefined = prev;
	let parentKey: string | null = null;
	let index = 0;
	if (prev && depth > prev.depth) {
		parentKey = prev.key;
		// Into a collapsed container, whose children are out of sight: the last place.
		if (prev.expanded === false)
			index = resolved(tree, tree.get(prev.key)?.children ?? [], dragged).length;
	} else {
		let key: string | undefined = prev?.key;
		const upto = (k: string | undefined): DropRow | undefined => rest.find((r) => r.key === k);
		while (key !== undefined && (upto(key) as DropRow).depth > depth) {
			key = tree.get(key)?.parent ?? undefined;
		}
		before = upto(key);
		parentKey = before ? (tree.get(before.key)?.parent ?? null) : null;
		if (before) {
			const kids = parentKey === null ? roots : (tree.get(parentKey)?.children ?? []);
			index = resolved(tree, kids.slice(0, kids.indexOf(before.key) + 1), dragged).length;
		}
	}
	const place = placeOf(tree, parentKey, index);
	const now = placeNow(tree, dragged, roots);
	const lineAt = next ? rows.findIndex((r) => r.key === next.key) : rows.length;
	const into = prev && depth > prev.depth && prev.expanded === false ? prev.key : null;
	return {
		...place,
		lineRow: lineAt,
		depth,
		opens: into,
		same: now !== null && same(now, place),
	};
}

/** The depth a pointer moved sideways asks for, from the row's own depth. */
export function wantedDepth(own: number, dx: number): number {
	return own + Math.round(dx / INDENT_PX);
}

/** The nearest row boundary to a y in the rows' coordinates (0 at the top of the first row). */
export function boundaryAt(y: number, rowHeight: number, rows: number): number {
	return Math.max(0, Math.min(rows, Math.round(y / rowHeight)));
}
