// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Selection and two-way sync between the text and the visual views (phase-2.md 6.10).
 *
 * `Selection` is the one thing the plan has selected: a task, or a link between two tasks. It has
 * an `origin`, which stops feedback loops: a selection that came from the text (the cursor moved
 * into a task) never moves the editor again, and one that came from a visual (a click on a bar, a
 * row, the outline, the inspector) puts the source on show in the editor (the app does that from
 * `AppState.sourceMark`). A link comes only from a visual.
 *
 * The text side is two pure functions over the runner's state and the workspace:
 * - `taskAtCursor`: the task whose declaration or supplement holds a position of the text now.
 *   The index may be older than the text (typing, an edit whose result has not come back), so each
 *   declaration's block is mapped forward through `changesSince(indexVersion)` into the text now
 *   and matched against the position (a deleted declaration never matches).
 * - `sourceOf` (and `linkSource`): a task's declaration block (or a link's `depends` statement) in
 *   the text now, mapped forward through `changesSince(indexVersion)` (inspector/range.ts is the
 *   same rule). A task the index cannot name falls back to its engine source line.
 *
 * `SelectionState` holds the selection as a rune. `AppState` owns one, and `InspectorState` reads
 * and writes the link half of it. The Gantt selects only through `AppState.selectTask(key)` and
 * `InspectorState.showLink(pred, succ)`, and reads `AppState.selectedTask`, which follow this state.
 * A selection that came from the text also leaves a `follow` request: the row to scroll into view
 * (without taking focus), which the Gantt reads once.
 *
 * Renames (phase-2.md 6.8): while a `moveTask` is pending the dispatcher publishes old id to new id
 * in `pending.renames`; `followRenames` moves the selection to the new id, a descendant of the
 * moved task included.
 *
 * Phase 3 (phase-3.md 6.7) adds the People kinds (`PeopleSelection`: a person, a heatmap cell, a
 * run of calendar days) and the view types `View` and `PeopleSegment`. A cursor inside a
 * `resource` block will select that person (Split mode), as tasks do. View, zoom, unit (hours or
 * percent), thresholds and the collapsed groups are UI preferences per plan (ADR-0008 #3).
 */
// T2: 6.7's `Selection` is the Phase 2 kinds plus `PeopleSelection`. `Selection` stays the Phase 2
// union here, so that this interface change changes no behaviour: `followRenames` and `AppState`'s
// `#onSelection`, `#onIndex`, `#placeOf` and `#remark` read every non-task selection as a link and
// every selection as having an `origin` (widening it fails the typecheck in those five places).
// T13 widens it (`Selection = ... | PeopleSelection`) in the change that teaches them the new
// kinds.
import type { Minutes, WorkspacePath } from '../../engine/protocol';
import type { LeavePaint } from '../calendar/paint';
import { currentRange } from '../inspector/range';
import type { ResourceId, SourceRange, TaskId } from '../tjp/index';
import type { BucketKind } from '../workload/types';
import type { RunnerState } from '../workspace/run-types';
import type { Workspace } from '../workspace/workspace';

export type Selection =
	| { kind: 'task'; id: TaskId; origin: 'text' | 'visual' }
	| { kind: 'link'; pred: TaskId; succ: TaskId; origin: 'visual' }
	| null;

/** Phase 3 kinds (6.7), not yet part of `Selection` (see the T2 note above). */
export type PeopleSelection =
	| { kind: 'resource'; id: ResourceId; origin: 'text' | 'visual' }
	/** A heatmap cell: `bucket` is the column index in the axis of kind `axis`. */
	| { kind: 'cell'; resource: ResourceId; bucket: number; axis: BucketKind }
	/** Calendar days, whole local days `[from, to)`. */
	| { kind: 'days'; scope: LeavePaint['scope']; from: Minutes; to: Minutes };

/** The visual views: the desktop and tablet view switcher (18.10). */
export type View = 'gantt' | 'workload' | 'resources' | 'calendar';
/** The segments of the phone People tab: Load, Lanes, Calendar, Team (18.10). */
export type PeopleSegment = 'load' | 'lanes' | 'calendar' | 'team';

/** The two tasks of a selected link. */
export interface LinkSelection {
	readonly pred: TaskId;
	readonly succ: TaskId;
}

/** What the mapping reads from the runner's state. */
export type RunView = Pick<RunnerState, 'index' | 'indexVersion' | 'latest' | 'lastGood'>;
/** What the mapping reads from the workspace. */
export type TextView = Pick<Workspace, 'changesSince' | 'snapshot'>;

/** A place in the text now: the block to show, and where the cursor goes (a part of it). */
export interface Place {
	readonly block: SourceRange;
	readonly at: SourceRange;
}

/**
 * The task whose declaration (or supplement) holds `pos` of `file` in the text now, using an index
 * that may lag the text. Null when the position is in no task, or cannot be mapped (the changes
 * since the index are no longer kept).
 *
 * Each declaration's block is mapped forward into the text now (as `sourceOf` does) and the
 * smallest one around `pos` wins. Mapping the cursor back instead would send a position on the
 * edge of an insertion or deletion to the start of a block that begins there, and so name a task
 * that was deleted or a neighbour. A declaration whose header was deleted is gone from the text
 * and never matches.
 */
export function taskAtCursor(
	run: Pick<RunView, 'index' | 'indexVersion'>,
	ws: Pick<Workspace, 'changesSince'>,
	file: WorkspacePath,
	pos: number,
): TaskId | null {
	let changes;
	try {
		changes = ws.changesSince(run.indexVersion).get(file);
	} catch {
		return null;
	}
	let best: TaskId | null = null;
	let size = Infinity;
	for (const sym of run.index.tasks.values()) {
		for (const site of [sym.decl, ...sym.supplements]) {
			const b = site.block;
			if (b.file !== file) continue;
			const head = site.header;
			if (changes && changes.mapPos(head.from, 1) >= changes.mapPos(head.to, -1)) continue;
			const from = changes ? changes.mapPos(b.from, 1) : b.from;
			const to = changes ? changes.mapPos(b.to, -1) : b.to;
			if (from <= pos && pos <= to && to - from < size) {
				best = sym.id;
				size = to - from;
			}
		}
	}
	return best;
}

/**
 * A line of the text a result was scheduled from, in the text now: the line's own text, without
 * its indent. Exact when nothing changed in the file; with changes only while the line starts
 * before the first of them (the text before it is the same), else null, because a line number of
 * old text cannot be placed after an edit (the old text is gone).
 */
function engineLine(
	ws: TextView,
	file: WorkspacePath,
	line: number,
	version: number,
): Place | null {
	const snap = ws.snapshot();
	const doc = snap.files.get(file)?.text;
	if (!doc || line < 1 || line > doc.lines) return null;
	const l = doc.line(line);
	if (version !== snap.version) {
		let first = Infinity;
		try {
			ws.changesSince(version)
				.get(file)
				?.iterChangedRanges((fromA) => {
					first = Math.min(first, fromA);
				});
		} catch {
			return null;
		}
		if (l.from >= first) return null;
	}
	const lead = l.text.length - l.text.trimStart().length;
	const text = l.text.trim();
	if (text === '') return null;
	const range = { file, from: l.from + lead, to: l.from + lead + text.length };
	return { block: range, at: range };
}

/** The engine's own line for a task the index cannot name (expanded-only, or a stale index). */
function engineSource(run: RunView, ws: TextView, id: TaskId): Place | null {
	const rec = run.latest?.result.ok ? run.latest : run.lastGood;
	const src = rec?.result.tasks.find((t) => t.id === id)?.source;
	if (!rec || !src || src.line === null) return null;
	return engineLine(ws, src.file, src.line, rec.workspaceVersion);
}

/**
 * The declaration block of a task in the text now, and where the cursor goes: its id, else its
 * header. The block is mapped forward through the changes since the index. Null when neither the
 * index nor the engine's source line can place it.
 */
export function placeOf(run: RunView, ws: TextView, id: TaskId): Place | null {
	const sym = run.index.tasks.get(id);
	if (!sym) return engineSource(run, ws, id);
	const block = currentRange(ws, run.indexVersion, sym.decl.block);
	const at = currentRange(ws, run.indexVersion, sym.decl.id ?? sym.decl.header);
	return { block, at };
}

/** The task's declaration block in current coordinates, or its engine source line (module comment). */
export function sourceOf(run: RunView, ws: TextView, id: TaskId): SourceRange | null {
	return placeOf(run, ws, id)?.block ?? null;
}

/** The `depends` (or `precedes`) statement behind a link, in the text now. */
export function linkPlace(run: RunView, ws: TextView, link: LinkSelection): Place | null {
	const site = run.index.dependencies.find((d) => d.pred === link.pred && d.succ === link.succ);
	if (!site) return null;
	const block = currentRange(ws, run.indexVersion, site.statement);
	return { block, at: { file: block.file, from: block.from, to: block.from } };
}

/** Where a descendant of a renamed task goes: the prefix is replaced. */
function renamed(id: TaskId, renames: ReadonlyMap<TaskId, TaskId>): TaskId {
	const to = renames.get(id);
	if (to !== undefined) return to;
	for (const [from, next] of renames) {
		if (id.startsWith(`${from}.`)) return next + id.slice(from.length);
	}
	return id;
}

/**
 * A selection that came from a visual, in the text now: the block to highlight and where the
 * cursor goes. `scroll` is true once per selection (the editor scrolls and, without the focus,
 * moves its cursor); a mark made again from a fresher index only moves the highlight.
 */
export interface SourceMark {
	readonly file: WorkspacePath;
	readonly from: number;
	readonly to: number;
	readonly scroll: boolean;
	readonly cursor: { readonly from: number; readonly to: number } | null;
}

/** What a selection asked of the Gantt: scroll this row into view; `nonce` makes repeats distinct. */
export interface FollowRequest {
	/** The outline key (`task:app.code`). */
	readonly key: string;
	readonly nonce: number;
}

export class SelectionState {
	current = $state.raw<Selection>(null);
	/** Set when the text moved the selection: the Gantt scrolls this row into view, once. */
	follow = $state.raw<FollowRequest | null>(null);
	readonly #onChange: (s: Selection) => void;
	#nonce = 0;

	/** `onChange` hears every change at once (the app maps the selection into the editor). */
	constructor(onChange: (s: Selection) => void = () => undefined) {
		this.#onChange = onChange;
	}

	/** The selected task's id, or null (a link or nothing is selected). */
	readonly task = $derived(this.current?.kind === 'task' ? this.current.id : null);
	/** Its outline key (`task:` and the id), the Gantt's name for a row. */
	readonly taskKey = $derived(this.task === null ? null : `task:${this.task}`);
	/** The selected link, one object per selection. */
	readonly link = $derived<LinkSelection | null>(
		this.current?.kind === 'link' ? { pred: this.current.pred, succ: this.current.succ } : null,
	);
	/** The row the keyboard focus returns to: the task's, or a link's successor's. */
	readonly rowKey = $derived(
		this.current?.kind === 'link' ? `task:${this.current.succ}` : this.taskKey,
	);

	#set(next: Selection): void {
		this.current = next;
		this.#onChange(next);
	}

	/**
	 * Selects a task. From the text it changes nothing when that task is already selected (a burst
	 * of typing in its block), keeps the Gantt informed and does not move the editor; from a visual
	 * it always counts, so a second click on the same row shows its source again.
	 */
	selectTask(id: TaskId, origin: 'text' | 'visual'): boolean {
		const cur = this.current;
		if (origin === 'text') {
			if (cur?.kind === 'task' && cur.id === id) return false;
			this.follow = { key: `task:${id}`, nonce: ++this.#nonce };
		} else {
			this.follow = null;
		}
		this.#set({ kind: 'task', id, origin });
		return true;
	}

	selectLink(pred: TaskId, succ: TaskId): void {
		this.follow = null;
		this.#set({ kind: 'link', pred, succ, origin: 'visual' });
	}

	/** Drops a selected link (the inspector's own edits do); a selected task stays. */
	clearLink(): void {
		if (this.current?.kind === 'link') this.#set(null);
	}

	clear(): void {
		this.follow = null;
		if (this.current !== null) this.#set(null);
	}

	/** Moves the selection to the new ids of a pending `moveTask` (module comment). */
	followRenames(renames: ReadonlyMap<TaskId, TaskId>): boolean {
		const cur = this.current;
		if (!cur || renames.size === 0) return false;
		if (cur.kind === 'task') {
			const id = renamed(cur.id, renames);
			if (id === cur.id) return false;
			this.#set({ ...cur, id });
			return true;
		}
		const pred = renamed(cur.pred, renames);
		const succ = renamed(cur.succ, renames);
		if (pred === cur.pred && succ === cur.succ) return false;
		this.#set({ ...cur, pred, succ });
		return true;
	}
}
