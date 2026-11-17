// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The dependency picker's data (polish item 11): which tasks the details' "Waits for" and
 * "Followed by" Add buttons offer, and how a typed query narrows them. Pure: no DOM, no schedule.
 *
 * ## Contract (for the Health panel, T18: the H1 and H2 fixes `{ kind: 'pick', role, task }`)
 *
 * The picker is opened for a task and a role through `app.openDependencyPicker(task, role)`
 * (state/app.svelte.ts): it selects the task, opens its details and asks the details' "Waits for"
 * (`role: 'predecessor'`) or "Followed by" (`'successor'`) section to open its picker, which takes
 * the focus. `role` says what the CHOSEN task is to `task`: a predecessor is a task `task` waits
 * for, a successor a task that waits for `task`. Choosing sends the Gantt action
 * `link { pred, succ }` (`linkAction`) through the inspector's dispatcher, exactly as drawing a
 * link on the chart does: `addDepends` is written on the successor, one undo step, the same toast
 * and the same refusals (a loop, a task and its own container, text-only).
 *
 * ## Which tasks, and which are disabled
 *
 * Every task of the outline that has an id, in declaration order, except the task itself (never a
 * candidate). Some can only be refused or do nothing, so they are listed but disabled, each with
 * its reason, rather than hidden: a person looking for a container or for a task they have already
 * linked is told why it cannot be picked instead of wondering where it went. The reasons follow
 * the edit API (tjp/edit/deps.ts `addDependsPlan`):
 * - `ancestor` / `descendant`: a dependency between a task and its container or one of its
 *   subtasks is `cycle` (TaskJuggler's task_depend_parent and task_depend_child);
 * - `linked`: the two are already linked this way (`already-linked`, a no-op);
 * - `expanded-only`: declared only through a macro expansion (`text-only`).
 * A loop that goes through other tasks is found only by the edit API (it needs the whole graph),
 * so it is refused when chosen, with the toast and the place in the text, and nothing changes.
 */
import type { GanttAction } from '../gantt/intents';
import type { Outline, OutlineNode } from '../state/outline';
import type { TaskId } from '../tjp/index';

export type PickRole = 'predecessor' | 'successor';

/** Why a listed task cannot be picked. */
export type Unavailable = 'ancestor' | 'descendant' | 'linked' | 'expanded-only';

export interface Candidate {
	readonly id: TaskId;
	readonly name: string;
	/** The names of the containers it is in, outermost first, joined with " › "; "" at the top. */
	readonly path: string;
	readonly disabled: Unavailable | null;
	/** The folded text a query is matched against. */
	readonly foldedName: string;
	readonly foldedId: string;
	readonly foldedPath: string;
}

/** Lower case with accents removed, for comparing what a person types. */
export function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

const label = (n: OutlineNode): string => n.name ?? n.localId;

/** The action that makes `other` a predecessor or a successor of `task`. */
export function linkAction(
	role: PickRole,
	task: TaskId,
	other: TaskId,
): Extract<GanttAction, { type: 'link' }> {
	return role === 'predecessor'
		? { type: 'link', pred: other, succ: task }
		: { type: 'link', pred: task, succ: other };
}

/**
 * The candidates for `task`. `linked` is the ids it already has in this role (the tasks it waits
 * for, or the tasks that wait for it).
 */
export function dependsCandidates(
	outline: Pick<Outline, 'tasks' | 'byKey'>,
	task: TaskId,
	linked: ReadonlySet<TaskId>,
): Candidate[] {
	/** The containers of a node, outermost first. */
	const chain = (n: OutlineNode): OutlineNode[] => {
		const out: OutlineNode[] = [];
		for (
			let p = n.parent === null ? undefined : outline.byKey.get(n.parent);
			p && !out.includes(p);
			p = p.parent === null ? undefined : outline.byKey.get(p.parent)
		) {
			out.unshift(p);
		}
		return out;
	};
	const self = outline.byKey.get(`task:${task}`);
	const mine = new Set(self ? chain(self).map((n) => n.id) : []);
	const out: Candidate[] = [];
	for (const n of outline.tasks) {
		if (n.id === null || n.id === task) continue;
		const above = chain(n);
		const disabled: Unavailable | null = mine.has(n.id)
			? 'ancestor'
			: above.some((a) => a.id === task)
				? 'descendant'
				: n.textOnly === 'expanded-only'
					? 'expanded-only'
					: linked.has(n.id)
						? 'linked'
						: null;
		const name = label(n);
		const path = above.map(label).join(' › ');
		out.push({
			id: n.id,
			name,
			path,
			disabled,
			foldedName: fold(name),
			foldedId: fold(n.id),
			foldedPath: fold(path),
		});
	}
	return out;
}

/**
 * The candidates a query keeps: every word must be found in the name, the id or the path (case
 * and accents ignored), so "design research" finds `design.research`. Those whose name or own id
 * (its last part) has a word starting with the first typed word come first, then the rest; the
 * plan's order holds within each group.
 */
export function filterCandidates(all: readonly Candidate[], query: string): Candidate[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	const first = words[0];
	if (first === undefined) return [...all];
	const starts = (text: string): boolean => text.startsWith(first) || text.includes(` ${first}`);
	const kept: Array<{ c: Candidate; rank: number }> = [];
	for (const c of all) {
		const hay = `${c.foldedName} ${c.foldedId} ${c.foldedPath}`;
		if (!words.every((w) => hay.includes(w))) continue;
		const local = c.foldedId.slice(c.foldedId.lastIndexOf('.') + 1);
		kept.push({ c, rank: starts(`${c.foldedName} ${local}`) ? 0 : 1 });
	}
	return kept.sort((a, b) => a.rank - b.rank).map((k) => k.c);
}

/**
 * The index of the next enabled option from `from` in direction `step`, wrapping round; -1 when
 * none is enabled. `from` is -1 when nothing is active yet (Down then finds the first, Up the
 * last), and may be a disabled option.
 */
export function stepEnabled(list: readonly Candidate[], from: number, step: 1 | -1): number {
	const n = list.length;
	const start = from < 0 && step < 0 ? 0 : from;
	for (let k = 1; k <= n; k++) {
		const i = (((start + step * k) % n) + n) % n;
		if (list[i]?.disabled === null) return i;
	}
	return -1;
}
