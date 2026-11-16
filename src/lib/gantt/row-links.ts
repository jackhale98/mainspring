// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the Gantt's task table says about a row besides its schedule (polish item 16): the row
 * number (the # column) and the tasks it waits for and the tasks that wait for it (the
 * Predecessors and Successors columns, MS Project style).
 *
 * It is derived once per model build (`buildGanttModel`), never per cell render, and only from data
 * the model already has: the outline's nodes and the dependency links the Gantt draws (links.ts:
 * the engine's result for the shown scenario, joined with the text's sites). Nothing is re-read
 * from the text, so a scenario-specific link, a macro's link and a link written in another file
 * show exactly as their lines do.
 *
 * - The number is the node's place in the whole outline, every task counted, collapsed ones
 *   included, so that collapsing a group never renumbers the rows below it. It stays with a task
 *   as long as the outline order is unchanged.
 * - A link is listed under the task that waits (its predecessor) and the task that is waited for
 *   (its successor), whatever the rows' collapse state. The list is in row order.
 * - A task that only inherits a dependency from its parent lists nothing: the engine's link is
 *   the parent's (links.ts), as is the line the Gantt draws.
 */
import type { ProjectInfo } from '../../engine/protocol';
import { gapText, typeOf, type GapKind, type LinkType } from '../inspector/links';
import type { OutlineNode } from '../state/outline';
import type { TaskId } from '../tjp/index';
import type { LinkState, RawLink } from './model';

/** The other end of a link, as one row of the table lists it. */
export interface RowLinkRef {
	/** The other task's full TaskJuggler id (for the hover text). */
	readonly id: TaskId;
	/** Its row number. */
	readonly number: number;
	readonly name: string;
	readonly type: LinkType;
	/** The gap, signed (a negative one is a lead): its kind and the text, "+2d" or "-4h". */
	readonly gap: { readonly kind: GapKind; readonly text: string } | null;
	readonly state: LinkState;
}

export interface RowInfo {
	/** 1-based, in outline order over every row of the outline. */
	readonly number: number;
	readonly predecessors: readonly RowLinkRef[];
	readonly successors: readonly RowLinkRef[];
}

/** The gap of a link: working time first (as the inspector does), else calendar time; signed. */
function gapOf(
	l: Pick<RawLink, 'gapLengthMin' | 'gapDurationMin'>,
	project: ProjectInfo | null,
): RowLinkRef['gap'] {
	const kind: GapKind | null =
		l.gapLengthMin !== 0 ? 'gaplength' : l.gapDurationMin !== 0 ? 'gapduration' : null;
	if (kind === null) return null;
	const minutes = kind === 'gaplength' ? l.gapLengthMin : l.gapDurationMin;
	const text = gapText(Math.abs(minutes), kind, project);
	return { kind, text: minutes < 0 ? `-${text}` : `+${text}` };
}

/**
 * The row numbers and link lists of every task of the outline, by the node's key. A link with an
 * end that is not a task of the outline is left out.
 */
export function rowInfoOf(
	nodes: readonly OutlineNode[],
	links: readonly RawLink[],
	project: ProjectInfo | null,
): ReadonlyMap<string, RowInfo> {
	const byId = new Map<TaskId, { number: number; name: string; key: string }>();
	nodes.forEach((n, i) => {
		if (n.id !== null) byId.set(n.id, { number: i + 1, name: n.name ?? n.localId, key: n.key });
	});
	const preds = new Map<string, RowLinkRef[]>();
	const succs = new Map<string, RowLinkRef[]>();
	for (const l of links) {
		const pred = byId.get(l.pred);
		const succ = byId.get(l.succ);
		if (!pred || !succ || pred === succ) continue;
		const common = { type: typeOf(l), gap: gapOf(l, project), state: l.state };
		const wait = preds.get(succ.key) ?? [];
		wait.push({ id: l.pred, number: pred.number, name: pred.name, ...common });
		preds.set(succ.key, wait);
		const follow = succs.get(pred.key) ?? [];
		follow.push({ id: l.succ, number: succ.number, name: succ.name, ...common });
		succs.set(pred.key, follow);
	}
	const byNumber = (a: RowLinkRef, b: RowLinkRef): number => a.number - b.number;
	const info = new Map<string, RowInfo>();
	nodes.forEach((n, i) => {
		info.set(n.key, {
			number: i + 1,
			// `sort` is stable: two links to one task keep the order the plan lists them.
			predecessors: (preds.get(n.key) ?? []).sort(byNumber),
			successors: (succs.get(n.key) ?? []).sort(byNumber),
		});
	});
	return info;
}
