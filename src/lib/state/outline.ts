// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The outline's data (phase-1.md 8.2): the task and resource trees of a symbol index as flat
 * lists in declaration order, so the view can render them as an ARIA tree with `aria-level`,
 * `aria-posinset` and `aria-setsize`, collapse them, and window them above `WINDOW_THRESHOLD`
 * rows. Pure functions; nothing here touches the DOM or the schedule.
 *
 * - A node is a task or resource that the index resolved, or an unresolved declaration (a macro
 *   id the engine has not named: it shows the id as written, e.g. `${content}${major}`). An
 *   unresolved node sits under its known parent, in its file's order among the siblings, and is
 *   always text only.
 * - `textOnly` is set when the index marks the declaration text-only or expanded-only, or when
 *   it is unresolved; the view shows the "text only" badge from it.
 * - `errorCounts` counts the error diagnostics inside each node's block, so a container shows
 *   the errors of its children too.
 */
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type {
	PropertyKind,
	ResourceSymbol,
	SourceRange,
	SymbolIndex,
	TaskSymbol,
	TextOnlyReason,
	UnresolvedDecl,
} from '../tjp/index';

export type OutlineReason = TextOnlyReason | 'unresolved';

export interface OutlineNode {
	/** Unique within one outline; stable while the id stays the same. */
	readonly key: string;
	readonly kind: PropertyKind;
	/** The full id, or null for an unresolved declaration. */
	readonly id: string | null;
	/** What the id is called locally, or the id as written for an unresolved declaration. */
	readonly localId: string;
	/** The name, or null when the declaration has none. */
	readonly name: string | null;
	/** 1-based depth. */
	readonly level: number;
	readonly parent: string | null;
	readonly children: readonly string[];
	readonly posinset: number;
	readonly setsize: number;
	readonly textOnly: OutlineReason | null;
	/** What selecting the node puts the cursor on: the declared id, else the header. */
	readonly at: SourceRange;
	/** The whole declaration, for counting the errors inside it. */
	readonly block: SourceRange;
}

export interface Outline {
	readonly tasks: readonly OutlineNode[];
	readonly resources: readonly OutlineNode[];
	readonly byKey: ReadonlyMap<string, OutlineNode>;
}

/** Reads the text of a range, for the written name of an unresolved declaration. */
export type TextOf = (range: SourceRange) => string | null;

export const EMPTY_OUTLINE: Outline = { tasks: [], resources: [], byKey: new Map() };

/** Above this many visible rows the view renders only the rows in view. */
export const WINDOW_THRESHOLD = 200;

type Symbolic = TaskSymbol | ResourceSymbol;

function keyOf(kind: PropertyKind, id: string): string {
	return `${kind}:${id}`;
}

function unquote(written: string | null): string | null {
	if (written === null) return null;
	const m = /^"([\s\S]*)"$/.exec(written.trim());
	const text = (m ? m[1] : written)?.trim() ?? '';
	return text === '' ? null : text;
}

function reasonOf(sym: Symbolic): OutlineReason | null {
	if (sym.textOnly) return sym.textOnly.reason;
	return sym.expandedOnly ? 'expanded-only' : null;
}

/** Position of an unresolved item among the siblings: after those of its file that start before it. */
function insertAt(siblings: readonly Draft[], item: Draft): number {
	let last = -1;
	siblings.forEach((s, i) => {
		if (s.block.file === item.block.file && s.block.from < item.block.from) last = i;
	});
	if (last >= 0) return last + 1;
	const firstInFile = siblings.findIndex((s) => s.block.file === item.block.file);
	return firstInFile >= 0 ? firstInFile : siblings.length;
}

interface Draft {
	key: string;
	kind: PropertyKind;
	id: string | null;
	localId: string;
	name: string | null;
	parentKey: string | null;
	textOnly: OutlineReason | null;
	at: SourceRange;
	block: SourceRange;
	kids: Draft[];
}

function draftOf(kind: PropertyKind, sym: Symbolic, local: string): Draft {
	return {
		key: keyOf(kind, sym.id),
		kind,
		id: sym.id,
		localId: local,
		name: sym.name,
		parentKey: sym.parent === null ? null : keyOf(kind, sym.parent),
		textOnly: reasonOf(sym),
		at: sym.decl.id ?? sym.decl.header,
		block: sym.decl.block,
		kids: [],
	};
}

function unresolvedDraft(u: UnresolvedDecl, n: number, textOf: TextOf): Draft {
	const nameText = u.decl.name ? unquote(textOf(u.decl.name)) : null;
	return {
		key: `${u.kind}:unresolved:${n}`,
		kind: u.kind,
		id: null,
		localId: u.localId ?? (u.decl.id ? textOf(u.decl.id) : null) ?? '',
		name: nameText,
		parentKey: u.parent === null ? null : keyOf(u.kind, u.parent),
		textOnly: 'unresolved',
		at: u.decl.id ?? u.decl.header,
		block: u.decl.block,
		kids: [],
	};
}

/** Flattens the drafts of one kind in pre-order. */
function flatten(roots: readonly Draft[]): OutlineNode[] {
	const out: OutlineNode[] = [];
	const walk = (list: readonly Draft[], level: number, parent: string | null): void => {
		list.forEach((d, i) => {
			out.push({
				key: d.key,
				kind: d.kind,
				id: d.id,
				localId: d.localId,
				name: d.name,
				level,
				parent,
				children: d.kids.map((k) => k.key),
				posinset: i + 1,
				setsize: list.length,
				textOnly: d.textOnly,
				at: d.at,
				block: d.block,
			});
			walk(d.kids, level + 1, d.key);
		});
	};
	walk(roots, 1, null);
	return out;
}

function treeOf(
	kind: PropertyKind,
	syms: ReadonlyMap<string, Symbolic>,
	unresolved: readonly UnresolvedDecl[],
	textOf: TextOf,
): OutlineNode[] {
	const drafts = new Map<string, Draft>();
	for (const [id, sym] of syms) {
		const local = 'localId' in sym ? sym.localId : id;
		drafts.set(keyOf(kind, id), draftOf(kind, sym, local));
	}
	const extra = unresolved
		.filter((u) => u.kind === kind)
		.map((u, n) => unresolvedDraft(u, n, textOf));
	const roots: Draft[] = [];
	// Known items first, in the index's order, then the unresolved ones among them.
	for (const d of [...drafts.values(), ...extra]) {
		const parent = d.parentKey === null ? undefined : drafts.get(d.parentKey);
		const siblings = parent ? parent.kids : roots;
		if (d.id === null) siblings.splice(insertAt(siblings, d), 0, d);
		else siblings.push(d);
	}
	return flatten(roots);
}

/** The outline of an index. `textOf` supplies the written names of unresolved declarations. */
export function buildOutline(index: SymbolIndex, textOf: TextOf = () => null): Outline {
	const tasks = treeOf('task', index.tasks, index.unresolved, textOf);
	const resources = treeOf('resource', index.resources, index.unresolved, textOf);
	const byKey = new Map<string, OutlineNode>();
	for (const n of tasks) byKey.set(n.key, n);
	for (const n of resources) byKey.set(n.key, n);
	return { tasks, resources, byKey };
}

export interface OutlineRow {
	readonly node: OutlineNode;
	readonly expandable: boolean;
	readonly expanded: boolean;
}

/** The rows that show when the keys in `collapsed` are closed, in order. */
export function visibleRows(
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

/** The error count of every node that has any (module comment). */
export function errorCounts(
	nodes: readonly OutlineNode[],
	diagnostics: readonly TjpDiagnostic[],
): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const d of diagnostics) {
		if (d.severity !== 'error' || d.file === null || d.precision === 'none') continue;
		for (const n of nodes) {
			const b = n.block;
			if (b.file === d.file && b.from <= d.from && d.to <= b.to) {
				counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
			}
		}
	}
	return counts;
}

export interface RowWindow {
	/** Index of the first rendered row. */
	readonly start: number;
	/** One past the last rendered row. */
	readonly end: number;
	/** Height of the space above and below the rendered rows, in the unit of `rowHeight`. */
	readonly before: number;
	readonly after: number;
}

/** The rows to render for a scroll position; everything when the list is short. */
export function windowRows(
	total: number,
	scrollTop: number,
	viewport: number,
	rowHeight: number,
	overscan = 10,
): RowWindow {
	if (total <= WINDOW_THRESHOLD || rowHeight <= 0 || viewport <= 0) {
		return { start: 0, end: total, before: 0, after: 0 };
	}
	const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
	const last = Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight);
	const start = Math.max(0, Math.min(total, first - overscan));
	const end = Math.max(start, Math.min(total, last + overscan));
	return { start, end, before: start * rowHeight, after: (total - end) * rowHeight };
}
