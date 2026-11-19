// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The resource table's data (phase-3.md 9.6): the rows of the outline's resource tree with what
 * each shows (id, name, group, efficiency, hours booked in the frame, text-only), where a new
 * person or group goes (W7), and the rows as the row drag and the keys see them (`DropRow`,
 * `Tree`; gantt/reorder.ts is the same rule for tasks). Pure: it reads the outline, the index and
 * the schedule the People views show, and never changes either.
 *
 * - **Efficiency** is the engine's, after inheritance, so a group's value that its members take
 *   shows on each of them; before the first result it is the text's own or nothing.
 * - **Booked** is the exact sum of the first scenario's bookings in the frame, a group's the sum of
 *   its members (`bookedMinutes`), and null before the first result.
 * - **A new person** goes at the end of the selected group, else after the selected person, else at
 *   the end of the top level; **a new group** goes after the selected row (a sibling) or at the end
 *   of the top level. Indexes count only the siblings the index resolved, as `moveResource` and
 *   `addResource` do.
 * - **`dropRows`** marks a row a container when people may go under it (`canTake`: a group, or a
 *   resource nothing allocates), so a drag offers exactly the drops the planner accepts.
 */
import type { Minutes, ScheduleResult } from '../../engine/protocol';
import { finishScenario } from '../schedule/finish';
import type { DropRow, Tree } from '../gantt/reorder';
import { placeNow, rootsOf } from '../gantt/reorder';
import type { OutlineNode, OutlineRow } from '../state/outline';
import type { ResourceId, SymbolIndex } from '../tjp/index';
import { bookedMinutes, isAllocated } from './person';
import { canTake } from './regroup';

export interface TableRow {
	readonly node: OutlineNode;
	readonly expandable: boolean;
	readonly expanded: boolean;
	/** The engine's efficiency, as text ("1", "0.8"); null before a result or for an unresolved row. */
	readonly efficiency: string | null;
	readonly booked: Minutes | null;
	readonly groupName: string | null;
	/** An `allocate` names it: it cannot take members. */
	readonly allocated: boolean;
}

/** `0.8`, `1`: at most two decimals. */
const plain = (n: number): string => String(Math.round(n * 100) / 100);

/** The rows of the table for the visible outline rows. */
export function tableRows(
	rows: readonly OutlineRow[],
	index: SymbolIndex | null,
	result: ScheduleResult | null,
): TableRow[] {
	const scenario = result ? finishScenario(result) : null;
	const booked = bookedMinutes(result);
	const engine = new Map(
		(result?.resources ?? []).map((r) => [
			r.id,
			scenario === null ? undefined : r.scenarios[scenario],
		]),
	);
	return rows.map(({ node, expandable, expanded }) => {
		const id = node.id;
		const parent = id === null ? null : (index?.resources.get(id)?.parent ?? null);
		const e = id === null ? undefined : engine.get(id);
		return {
			node,
			expandable,
			expanded,
			efficiency: e ? plain(e.efficiency) : null,
			booked: id === null || result === null ? null : (booked.get(id) ?? 0),
			groupName: parent === null ? null : (index?.resources.get(parent)?.name ?? parent),
			allocated: id !== null && index !== null && isAllocated(index, id),
		};
	});
}

/** "38 h", "37.75 h": minutes as hours without a trailing zero. */
export function hoursText(minutes: Minutes): string {
	return `${Math.round((minutes / 60) * 100) / 100} h`;
}

/** The outline's resource nodes as the tree the row drag and the keys walk. */
export const treeOf = (nodes: readonly OutlineNode[]): ReadonlyMap<string, OutlineNode> =>
	new Map(nodes.map((n) => [n.key, n]));

/** The rows as the drag sees them: a container is a row people may be dropped under. */
export function dropRows(rows: readonly TableRow[], index: SymbolIndex | null): DropRow[] {
	return rows.map((r) => {
		const id = r.node.id;
		const container =
			id !== null && index !== null && r.node.textOnly === null && canTake(index, id);
		return {
			key: r.node.key,
			depth: r.node.level - 1,
			kind: container ? 'container' : 'task',
			expanded: r.expandable ? r.expanded : null,
		};
	});
}

export interface AddSpot {
	readonly parent: ResourceId | null;
	readonly index: number;
}

const resolved = (tree: Tree, keys: readonly string[]): number =>
	keys.filter((k) => tree.get(k)?.id != null).length;

/**
 * Where "Add person" and "Add group" put a new resource (module comment); null when the selection
 * sits under a parent the index could not name (no place the edit API can name, never the end).
 */
export function addSpot(
	nodes: readonly OutlineNode[],
	selected: string | null,
	kind: 'person' | 'group',
	index: SymbolIndex | null,
): AddSpot | null {
	const tree = treeOf(nodes);
	const roots = rootsOf(
		tree,
		nodes.map((n) => n.key),
	);
	const node = selected === null ? undefined : tree.get(selected);
	const end: AddSpot = { parent: null, index: resolved(tree, roots) };
	if (!node || node.id === null) return end;
	if (kind === 'person' && node.children.length > 0 && index !== null && canTake(index, node.id)) {
		return { parent: node.id, index: resolved(tree, node.children) };
	}
	if (node.parent !== null && tree.get(node.parent)?.id == null) return null;
	const place = placeNow(tree, node.key, roots);
	return place && { parent: place.parent, index: place.index + 1 };
}

/** The table mounts only the rows in view above this many rows (phase-3.md 8.2). */
export const TABLE_WINDOW_THRESHOLD = 100;

export interface TableWindow {
	/** Index of the first mounted row, and one past the last. */
	readonly start: number;
	readonly end: number;
	/** The height of the space above and below the mounted rows, in px. */
	readonly before: number;
	readonly after: number;
}

/** The rows to mount for a scroll position: all of them while the list is short. */
export function tableWindow(
	total: number,
	scrollTop: number,
	viewport: number,
	rowHeight: number,
	overscan = 10,
): TableWindow {
	if (total <= TABLE_WINDOW_THRESHOLD || rowHeight <= 0 || viewport <= 0) {
		return { start: 0, end: total, before: 0, after: 0 };
	}
	const top = Math.max(0, scrollTop);
	const first = Math.floor(top / rowHeight);
	const last = Math.ceil((top + viewport) / rowHeight);
	const start = Math.max(0, Math.min(total, first - overscan));
	const end = Math.max(start, Math.min(total, last + overscan));
	return { start, end, before: start * rowHeight, after: (total - end) * rowHeight };
}

/**
 * The rows that show when the keys in `collapsed` are closed, in order. The same rule as the
 * outline's `visibleRows` (state/outline.ts), repeated here so that this lazy chunk does not import
 * a module the first load also has: the bundler would cut it out as a chunk of its own (phase-3.md 23.1).
 */
export function openRows(
	nodes: readonly OutlineNode[],
	collapsed: ReadonlySet<string>,
): OutlineRow[] {
	const rows: OutlineRow[] = [];
	let hideBelow = Infinity;
	for (const node of nodes) {
		if (node.level > hideBelow) continue;
		hideBelow = Infinity;
		const expandable = node.children.length > 0;
		const expanded = expandable && !collapsed.has(node.key);
		rows.push({ node, expandable, expanded });
		if (expandable && !expanded) hideBelow = node.level;
	}
	return rows;
}
