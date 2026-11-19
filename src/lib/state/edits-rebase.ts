// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * ADR-0018 decision 2: a target read in an older version, checked against the text now. The
 * dispatcher (edits-plan.ts `prepare`) runs these after planning and before `applyIntent`, and
 * gives a view planner the same answers through its `PlanBase`. A target either resolves to the
 * same logical target in the text now or the call is refused `target-changed`; it never names
 * another one.
 *
 * - **Ranges** (`LeaveRef`): a change that overlaps the open interval (from, to), or an insertion
 *   strictly inside it, touches the item; changes that only meet its ends do not. An untouched item
 *   maps to `(mapPos(from, 1), mapPos(to, -1))`, the same characters, and the ref is rewritten in the
 *   text now. The ref's own `basedOn` is the version mapped from.
 * - **Subject ids** (`subjectsOf`, every id an intent acts on except a `parent`): when a change
 *   that can change ids was made after the call's `basedOn` (`Kept.ids`), an id passes only when its
 *   declaration's `block.from` in the shown index maps exactly onto the fresh declaration's, and,
 *   when the character there was deleted (a declaration deleted or moved), it has the same name.
 *   An id the fresh index lacks passes to the edit API, which refuses it `unknown-target` as
 *   before; one the shown index lacks passes (it came from an outcome). A declaration only a
 *   macro makes, or one whose text gives several ids (`sharedWith`), fails it:
 *   its block cannot tell the ids apart.
 * - **Positions** (`parent`, `index` of `addTask`, `moveTask`, `addResource`, `moveResource`): the
 *   parent passes the id check, and its children as the edit API counts them (resolved ids, the
 *   moved item left out) are the same in the shown and the fresh index, each passing the id check
 *   or keeping the name the view showed (a reordered sibling's block cannot be followed).
 * - **The shown index** is one of the last `KEEP` published versions (`Kept`); a check that needs one no
 *   longer kept refuses, and so does a version whose changes the workspace no longer keeps
 *   (`changesSince` throws), or below 0 (`EMPTY_OUTLINE`).
 * - A `basedOn` at or past the fresh index's version needs no check, and neither does any id or
 *   position while nothing was ever published (the stamp fell back to the snapshot's version).
 */
import { MapMode, type ChangeSet } from '@codemirror/state';
import type { EditIntent, IntentOf, SourceRange } from '../tjp/edit/types';
import type { SymbolIndex } from '../tjp/index';
import type { Workspace, WorkspaceSnapshot } from '../workspace/workspace';
import type { PlanBase } from './edits-types';
import { buildOutline, type Outline } from './outline';

type Kind = 'task' | 'resource';

/** How many published indexes the dispatcher keeps for the checks (ADR-0018 decision 2). */
export const KEEP = 4;

/** The last published indexes, and the last version a change that can change ids produced. */
export class Kept {
	readonly #ring: SymbolIndex[] = [];
	/** The newest workspace version made by a change that can change ids. */
	#ids: number;

	constructor(version: number) {
		this.#ids = version;
	}

	/**
	 * Keeps `index`, one per version: a result republishes the version it has with new engine hints
	 * (run-derive.ts rebuilds the index at the same version), and the newer one replaces it. A view
	 * may have read the older one; ids only the hints give can then differ between the two, which
	 * the checks do not see (engine-named declarations are text only, so the edit API refuses most
	 * edits of them anyway).
	 */
	publish(index: SymbolIndex): void {
		const r = this.#ring;
		if (r[0]?.version === index.version) r[0] = index;
		else if (r.unshift(index) > KEEP) r.pop();
	}

	/** A workspace change produced `version`; `ids` when it can change ids. */
	changed(version: number, ids: boolean): void {
		if (ids) this.#ids = version;
	}

	/** The published index of `version`, while it is kept; `null` when none was ever published. */
	shown(version: number): SymbolIndex | null | undefined {
		return this.#ring.length === 0 ? null : this.#ring.find((i) => i.version === version);
	}

	/** Whether a change that can change ids was made after `version`. */
	ids(version: number): boolean {
		return this.#ids > version;
	}
}

/** One call's checks; also what its planner reads (`PlanBase`). */
export interface Rebaser extends PlanBase {
	/** The id check: true when the id passes (see the module comment). */
	same(kind: Kind, id: string): boolean;
	/** The position check of `parent`'s children, without `moved`. */
	place(kind: Kind, parent: string | null, moved: string | null): boolean;
}

const table = (index: SymbolIndex, kind: Kind) => (kind === 'task' ? index.tasks : index.resources);

/** `parent`'s children as the edit API counts them: resolved ids, without `moved`. */
function kids(
	index: SymbolIndex,
	kind: Kind,
	parent: string | null,
	moved: string | null,
): string[] {
	const t = table(index, kind);
	const all =
		parent === null
			? kind === 'task'
				? index.taskRoots
				: index.resourceRoots
			: (t.get(parent)?.children ?? []);
	return all.filter((id) => id !== moved && t.has(id));
}

/** A planner's outline, built at most once per index. */
const outlines = new WeakMap<SymbolIndex, Outline>();

/** The checks of a call made on `basedOn`, on `snap` and `fresh`, the index built from it. */
export function rebaser(
	ws: Pick<Workspace, 'changesSince'>,
	kept: Kept,
	snap: WorkspaceSnapshot,
	fresh: SymbolIndex,
	basedOn: number,
): Rebaser {
	const changes = (v: number): ReadonlyMap<string, ChangeSet> | null => {
		try {
			return v < 0 ? null : ws.changesSince(v);
		} catch {
			return null; // RangeError: no longer kept.
		}
	};
	const shown = kept.shown(basedOn);
	const off = basedOn >= fresh.version || shown === null;
	const same = (kind: Kind, id: string): boolean => {
		const now = table(fresh, kind).get(id);
		if (off || !now || !kept.ids(basedOn)) return true;
		if (!shown) return false;
		const was = table(shown, kind).get(id);
		if (!was) return true;
		// A declaration a macro makes shares the call site's block, and one text read in several
		// include visits gives several ids one block: the block cannot tell them apart.
		if (now.expandedOnly || was.expandedOnly || now.sharedWith.length > 0) return false;
		const b = was.decl.block;
		const all = changes(basedOn);
		if (!all || b.file !== now.decl.block.file) return false;
		const c = all.get(b.file);
		// Where the start maps; when the text there was deleted (a task deleted or moved, another in
		// its place), only a declaration with the name the view showed is taken for the same one.
		const intact = !c || c.mapPos(b.from, 1, MapMode.TrackAfter) !== null;
		return (
			(c ? c.mapPos(b.from, 1) : b.from) === now.decl.block.from &&
			(intact || was.name === now.name)
		);
	};
	return {
		snap,
		index: fresh,
		outline() {
			let o = outlines.get(fresh);
			if (!o) {
				const textOf = (r: SourceRange) =>
					snap.files.get(r.file)?.text.sliceString(r.from, r.to) ?? null;
				outlines.set(fresh, (o = buildOutline(fresh, textOf)));
			}
			return o;
		},
		mapRange(r, v) {
			if (v === fresh.version) return r;
			const cs = changes(v);
			const c = cs?.get(r.file);
			if (!c) return cs ? r : null;
			let touched = false;
			c.iterChangedRanges((a, b) => {
				if (a < r.to && b > r.from) touched = true;
			});
			return touched ? null : { file: r.file, from: c.mapPos(r.from, 1), to: c.mapPos(r.to, -1) };
		},
		isSame: (kind, id) => table(fresh, kind).has(id) && same(kind, id),
		same,
		place(kind, parent, moved) {
			if (off) return true;
			if (!shown || (parent !== null && !same(kind, parent))) return false;
			const was = kids(shown, kind, parent, moved);
			// The same ids in the same order, each still the same declaration (siblings can swap
			// declarations and keep their ids), or one with the name the view showed: a sibling moved
			// within the parent has its text deleted and written again, which the block cannot follow.
			const name = (i: SymbolIndex, id: string) => table(i, kind).get(id)?.name;
			return (
				was.join(' ') === kids(fresh, kind, parent, moved).join(' ') &&
				was.every((id) => same(kind, id) || name(shown, id) === name(fresh, id))
			);
		},
	};
}

/** The task ids and the resource ids an intent acts on. */
export type Subjects = readonly [tasks: readonly string[], resources: readonly string[]];

/**
 * Every id an intent acts on, except a `parent` (the position check's) and a leave item (the
 * range check's). Exhaustive: an intent type that is not named here does not compile.
 */
export function subjectsOf(i: EditIntent): Subjects {
	switch (i.type) {
		case 'setAttr':
		case 'removeAttr':
		case 'renameTask':
		case 'deleteTask':
		case 'moveTask':
			return [[i.task], []];
		case 'addDepends':
		case 'removeDepends':
		case 'setDependsGap':
		case 'gapToTask':
			return [[i.task, i.target], []];
		case 'allocate':
			return [[i.task], i.resources];
		case 'addAllocation':
		case 'removeAllocation':
			return [[i.task], [i.resource]];
		case 'replaceAllocation':
			return [[i.task], [i.from, i.to]];
		case 'deleteResource':
		case 'moveResource':
		case 'renameResource':
		case 'setResourceAttr':
		case 'removeResourceAttr':
			return [[], [i.resource]];
		case 'setWorkingHours':
		case 'addLeave':
		case 'clearLeave':
			return [[], i.scope.kind === 'resource' ? [i.scope.resource] : []];
		default:
			// The intents that act on no id (checked when this compiles; no code at run time).
			i satisfies IntentOf<
				| 'addTask'
				| 'addResource'
				| 'updateLeave'
				| 'removeLeave'
				| 'setProjectHeader'
				| 'setProjectAttr'
				| 'removeProjectAttr'
				| 'declareFlag'
				| 'format'
			>;
			return [[], []];
	}
}

/** The intent with its targets in the text now, or null when one changed (`target-changed`). */
export function rebase(i: EditIntent, r: Rebaser): EditIntent | null {
	if (i.type === 'updateLeave' || i.type === 'removeLeave') {
		const item = r.mapRange(i.leave.item, i.leave.basedOn);
		return item && { ...i, leave: { item, basedOn: r.index.version } };
	}
	const [tasks, resources] = subjectsOf(i);
	if (
		!tasks.every((id) => r.same('task', id)) ||
		!resources.every((id) => r.same('resource', id))
	) {
		return null;
	}
	if ('index' in i) {
		const moved = i.type === 'moveTask' ? i.task : i.type === 'moveResource' ? i.resource : null;
		const task = i.type === 'addTask' || i.type === 'moveTask';
		if (!r.place(task ? 'task' : 'resource', i.parent, moved)) return null;
	}
	return i;
}
