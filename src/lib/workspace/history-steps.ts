// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The records behind the workspace history (history.ts, phase-2.md 6.7): one `Step` per changed
 * file, grouped into a `Rec` per undo step, the typing-group rule, and the labels.
 *
 * - **Versions.** A step holds the file version at which the file has the text before the step
 *   (`before`) and after it (`after`). A batch of transactions in one `commit` bumps the version
 *   once, so the texts between them get placeholder versions below 0, which no file ever has;
 *   the history re-stamps them once an undo gives that text a real version.
 * - **Typing groups** follow CodeMirror's history (`@codemirror/commands` 6.11, `addChanges`): a
 *   typed transaction joins the open typing entry on top when it is in the same file, starts from
 *   the text and selection that entry left, has no user event or an `input.type…` or `delete…`
 *   one, comes less than `groupMs` after the previous one, and touches the range the group
 *   changed. A composition update (`input.type.compose`) always joins. `isolateHistory` is
 *   honoured. Unlike the spec's wording (6.7, "same user-event family"), a delete then a typed
 *   character join, as CodeMirror joins them: Backspace twice and "40d" is one undo step, which
 *   the Text-mode end-to-end tests rely on.
 */
import { isolateHistory } from '@codemirror/commands';
import {
	Annotation,
	Transaction,
	type AnnotationType,
	type ChangeSet,
	type EditorSelection,
	type Text,
} from '@codemirror/state';
import { historyStrings } from '../strings';
import { newEditId, type AppliedEdit } from '../tjp/edit/apply';
import type { SourceRange } from '../tjp/tree';
import type { EditIntent, TjpEdit } from '../tjp/edit/types';
import type { WorkspacePath } from './paths';
import { tjpEditId, type ChangeOrigin, type WorkspaceEdit } from './workspace';

/** An entry's label, set by the dispatcher on an `apply` (default: the intent's label). */
export const historyLabel: AnnotationType<string> = Annotation.define<string>();

export type HistoryKind = 'typing' | 'intent' | 'format';

/** An entry's intent: the edit API's, or `text` for typing and changes of no known intent. */
export type HistoryIntent = EditIntent | { readonly type: 'text'; readonly file: WorkspacePath };

/** A `TjpEdit` whose intent may be `text` (`applyEdit` and `undoEdit` take it as they are). */
export type HistoryEdit = Omit<TjpEdit, 'intent'> & { readonly intent: HistoryIntent };

export interface HistoryEntry {
	/** The TjpEdit id, or a fresh id for a typing group. */
	readonly id: string;
	readonly kind: HistoryKind;
	/** For tooltips, toasts and announcements ("set effort"). */
	readonly label: string;
	/** Changes, inverse, base versions and resulting versions, as `undoEdit` takes them. */
	readonly applied: AppliedEdit<HistoryEdit>;
	readonly selectionBefore: Readonly<Record<WorkspacePath, EditorSelection>>;
	readonly selectionAfter: Readonly<Record<WorkspacePath, EditorSelection>>;
}

/** One file's part of an undo step. */
export interface Step {
	readonly path: WorkspacePath;
	/** From the text before the step to the text after it. */
	changes: ChangeSet;
	/** The edit API's inverse, or null until it is inverted from `startDoc` (typing). */
	inverse: ChangeSet | null;
	/** The text before the step. */
	readonly startDoc: Text;
	before: number;
	after: number;
	readonly selBefore: EditorSelection;
	selAfter: EditorSelection;
}

/** One undo step. Mutable while it is an open typing group, and when re-stamped. */
export interface Rec {
	readonly id: string;
	readonly kind: HistoryKind;
	readonly label: string;
	readonly intent: HistoryIntent;
	readonly steps: Step[];
	/** The edit API's targets and post-edit selection; derived from the changes otherwise. */
	readonly targets: TjpEdit['targets'] | null;
	readonly select: SourceRange | null;
	/** An open typing group can take more typing. */
	open: boolean;
	/** `Transaction.time` of its last transaction. */
	lastTime: number;
}

/** True for the edit API's `TjpEdit`, which carries its intent, inverse and targets. */
export function isTjpEdit(e: WorkspaceEdit): e is TjpEdit {
	return 'inverse' in e && 'targets' in e && 'select' in e;
}

/** The step's inverse, inverted from the text before it when the edit API did not give one. */
export function inverseOf(step: Step): ChangeSet {
	step.inverse ??= step.changes.invert(step.startDoc);
	return step.inverse;
}

/** The label of an intent for tooltips and notes ("set effort"). */
export function labelOf(intent: HistoryIntent): string {
	switch (intent.type) {
		case 'text':
			return historyStrings.edit;
		case 'setAttr':
		case 'setResourceAttr':
		case 'setProjectAttr':
			return historyStrings.setAttr(intent.attr);
		case 'removeAttr':
		case 'removeResourceAttr':
		case 'removeProjectAttr':
			return historyStrings.removeAttr(intent.attr);
		default:
			return historyStrings.intent[intent.type];
	}
}

/** CodeMirror's `joinableUserEvent`. */
const JOINABLE = /^(input\.type|delete)($|\.)/;

/** Whether `next` (forward) touches a range that `group` (forward) changed (CodeMirror's `isAdjacent`). */
function adjacent(group: ChangeSet, next: ChangeSet): boolean {
	const ranges: number[] = [];
	group.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push(fromB, toB));
	let hit = false;
	next.iterChangedRanges((from, to) => {
		for (let i = 0; i < ranges.length && !hit; i += 2) {
			if (to >= (ranges[i] ?? 0) && from <= (ranges[i + 1] ?? 0)) hit = true;
		}
	});
	return hit;
}

/** The time a transaction carries (CodeMirror sets it on every transaction). */
export function timeOf(tr: Transaction): number {
	return tr.annotation(Transaction.time) ?? Date.now();
}

/**
 * Whether a typed transaction joins `top` (module comment). `before` is the version (or
 * placeholder) the file had right before `tr`.
 */
export function joins(
	top: Rec | undefined,
	path: WorkspacePath,
	tr: Transaction,
	before: number,
	groupMs: number,
): top is Rec {
	if (!top || !top.open || top.kind !== 'typing') return false;
	const step = top.steps[0];
	if (!step || step.path !== path || step.after !== before) return false;
	const iso = tr.annotation(isolateHistory);
	if (iso === 'before' || iso === 'full') return false;
	const event = tr.annotation(Transaction.userEvent);
	if (event === 'input.type.compose') return true;
	// A selection change in between (CodeMirror's `selectionsAfter`) starts a new group.
	if (!tr.startState.selection.eq(step.selAfter)) return false;
	if (event !== undefined && !JOINABLE.test(event)) return false;
	if (timeOf(tr) - top.lastTime >= groupMs) return false;
	return adjacent(step.changes, tr.changes);
}

/** Whether a transaction closes its typing group after it (`isolateHistory` after or full). */
export function isolatesAfter(tr: Transaction): boolean {
	const iso = tr.annotation(isolateHistory);
	return iso === 'after' || iso === 'full';
}

/** Adds a typed transaction to the group `joins` accepted. */
export function extend(rec: Rec, tr: Transaction, after: number): void {
	const step = rec.steps[0];
	if (!step) return;
	step.changes = step.changes.compose(tr.changes);
	step.inverse = null;
	step.after = after;
	step.selAfter = tr.state.selection;
	rec.lastTime = timeOf(tr);
	if (isolatesAfter(tr)) rec.open = false;
}

/** A step from a transaction of `path`, between two versions. */
export function stepOf(
	path: WorkspacePath,
	tr: Transaction,
	before: number,
	after: number,
	inverse: ChangeSet | null = null,
): Step {
	return {
		path,
		changes: tr.changes,
		inverse,
		startDoc: tr.startState.doc,
		before,
		after,
		selBefore: tr.startState.selection,
		selAfter: tr.state.selection,
	};
}

/** The changed ranges of a change set, before (`a`) or after (`b`) it, as source ranges. */
export function rangesOf(path: WorkspacePath, cs: ChangeSet, side: 'a' | 'b'): SourceRange[] {
	const out: SourceRange[] = [];
	cs.iterChangedRanges((fromA, toA, fromB, toB) =>
		out.push(
			side === 'a' ? { file: path, from: fromA, to: toA } : { file: path, from: fromB, to: toB },
		),
	);
	return out;
}

/** The entry of a record, as `undoEdit` and the toasts take it. */
export function entryOf(r: Rec): HistoryEntry {
	const base: Record<WorkspacePath, number> = {};
	const versions: Record<WorkspacePath, number> = {};
	const changes: Record<WorkspacePath, ChangeSet> = {};
	const inverse: Record<WorkspacePath, ChangeSet> = {};
	const targets: Record<WorkspacePath, readonly SourceRange[]> = {};
	const selectionBefore: Record<WorkspacePath, EditorSelection> = {};
	const selectionAfter: Record<WorkspacePath, EditorSelection> = {};
	for (const s of r.steps) {
		base[s.path] = s.before;
		versions[s.path] = s.after;
		changes[s.path] = s.changes;
		inverse[s.path] = inverseOf(s);
		targets[s.path] = r.targets?.[s.path] ?? rangesOf(s.path, s.changes, 'a');
		selectionBefore[s.path] = s.selBefore;
		selectionAfter[s.path] = s.selAfter;
	}
	const edit: HistoryEdit = {
		id: r.id,
		intent: r.intent,
		base,
		changes,
		inverse,
		targets,
		select: r.select,
	};
	return {
		id: r.id,
		kind: r.kind,
		label: r.label,
		applied: { edit, versions },
		selectionBefore,
		selectionAfter,
	};
}

/** A new typing group. */
export function typingRec(
	path: WorkspacePath,
	tr: Transaction,
	before: number,
	after: number,
): Rec {
	return {
		id: newEditId(),
		kind: 'typing',
		label: historyStrings.typing,
		intent: { type: 'text', file: path },
		steps: [stepOf(path, tr, before, after)],
		targets: null,
		select: null,
		open: !isolatesAfter(tr),
		lastTime: timeOf(tr),
	};
}

/** A format or intent the editor committed (no `TjpEdit` reaches the history). */
export function editRec(
	path: WorkspacePath,
	tr: Transaction,
	before: number,
	after: number,
	origin: ChangeOrigin,
): Rec {
	const intent: HistoryIntent =
		origin === 'format' ? { type: 'format', file: path } : { type: 'text', file: path };
	return {
		id: tr.annotation(tjpEditId) ?? newEditId(),
		kind: origin === 'format' ? 'format' : 'intent',
		label: tr.annotation(historyLabel) ?? labelOf(intent),
		intent,
		steps: [stepOf(path, tr, before, after)],
		targets: null,
		select: null,
		open: false,
		lastTime: timeOf(tr),
	};
}

/** The range to show after an undo or redo of `r`: the first range it changed, or `select`. */
export function revealOf(r: Rec, direction: 'undo' | 'redo'): SourceRange | null {
	if (direction === 'redo' && r.select) return r.select;
	const step = r.steps.find((s) => s.path === r.select?.file) ?? r.steps[0];
	if (!step) return null;
	const cs = direction === 'undo' ? inverseOf(step) : step.changes;
	return rangesOf(step.path, cs, 'b')[0] ?? null;
}
