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
 *   declaration's `block.from` in the shown index maps exactly onto the fresh declaration's (the
 *   character there not deleted). An id the fresh index lacks passes to the edit API, which refuses
 *   it `unknown-target` as before; one the shown index lacks passes (it came from an outcome).
 * - **Positions** (`parent`, `index` of `addTask`, `moveTask`, `addResource`, `moveResource`): the
 *   parent passes the id check, and its children as the edit API counts them (resolved ids, the
 *   moved item left out) are the same in the shown and the fresh index.
 * - **The shown index** is one of the last `KEEP` published ones (`Kept`); a check that needs one no
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

	publish(index: SymbolIndex): void {
		if (this.#ring[0] !== index && this.#ring.unshift(index) > KEEP) this.#ring.pop();
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
function kids(index: SymbolIndex, kind: Kind, parent: string | null, moved: string | null): string {
	const t = table(index, kind);
	const all =
		parent === null
			? kind === 'task'
				? index.taskRoots
				: index.resourceRoots
			: (t.get(parent)?.children ?? []);
	return all.filter((id) => id !== moved && t.has(id)).join(' ');
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
		const b = was.decl.block;
		const cs = changes(basedOn);
		const at = cs ? (cs.get(b.file)?.mapPos(b.from, 1, MapMode.TrackAfter) ?? b.from) : null;
		return b.file === now.decl.block.file && at === now.decl.block.from;
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
		place: (kind, parent, moved) =>
			off ||
			(!!shown &&
				(parent === null || same(kind, parent)) &&
				kids(shown, kind, parent, moved) === kids(fresh, kind, parent, moved)),
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
