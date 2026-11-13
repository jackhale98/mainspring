// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Unified undo and redo for a workspace (phase-2.md 6.7, ADR-0008): one history across files and
 * edit sources, replacing CodeMirror's per-file history.
 *
 * - **Entries.** The history subscribes to the workspace. An `apply` (intent or format) is one
 *   entry with the edit's own changes and inverse; a format or intent the editor commits is one
 *   entry per commit; typing joins the open typing entry as CodeMirror groups it
 *   (history-steps.ts) and its inverse is inverted against the text before the group. The
 *   dispatcher may name an entry with the `historyLabel` annotation; otherwise the intent names
 *   it ("set effort"). A transaction annotated `Transaction.addToHistory.of(false)` is not
 *   recorded: it bypasses the history.
 * - **Undo** builds `undoEdit(entry.applied, snapshot)` and applies it with `applyEdit`, origin
 *   'history', user event 'undo', `tjpHistory.of('undo')` (so it is not recorded) and the
 *   selections from before the entry. **Redo** applies the changes again on the versions the undo
 *   left, with the selections from after it.
 * - **Re-stamping.** An undo or redo bumps file versions. Each version a step expects is replaced
 *   by the new version of the same text: every expectation of the old version, in both stacks,
 *   moves to the new one. The same happens when a file's version bumps with its text unchanged (a
 *   parse-context change, workspace.ts). So `undoEdit`'s version check still catches any change
 *   that bypassed the history; that case clears both stacks with the outcome `diverged`, and no
 *   inverse is ever applied to text it was not made for.
 * - **Reveal.** A done outcome names the range to show: for an undo the first range the undo
 *   changed, for a redo the edit's `select` or the first range it changed.
 * - Listeners hear about a change of `top()`, `redoTop()`, `canUndo` or `canRedo`, not about
 *   typing that only grows the top entry.
 *
 * The history must subscribe before any listener that edits in response to a change, so that it
 * sees changes in the order they happen; the app creates it right after the workspace.
 */
import { Annotation, Transaction, type AnnotationType, type Text } from '@codemirror/state';
import { applyEdit, newEditId, undoEdit } from '../tjp/edit/apply';
import type { SourceRange } from '../tjp/tree';
import {
	editRec,
	historyLabel,
	entryOf,
	extend,
	isTjpEdit,
	joins,
	labelOf,
	revealOf,
	stepOf,
	typingRec,
	type HistoryEntry,
	type HistoryIntent,
	type Rec,
	type Step,
} from './history-steps';
import type { WorkspacePath } from './paths';
import type { ChangeInfo, ChangeOrigin, Workspace, WorkspaceSnapshot } from './workspace';

export type { HistoryEdit, HistoryEntry, HistoryIntent, HistoryKind } from './history-steps';

export type HistoryOutcome =
	| {
			status: 'done';
			entry: HistoryEntry;
			direction: 'undo' | 'redo';
			/** The range to show, in the text as it is now. */
			reveal: SourceRange | null;
	  }
	| { status: 'empty' }
	/** A file changed outside the history: both stacks were cleared and nothing was applied. */
	| { status: 'diverged'; entry: HistoryEntry; direction: 'undo' | 'redo' };

export interface WorkspaceHistory {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	/** The entry `undo` would undo. */
	top(): HistoryEntry | null;
	/** The entry `redo` would redo. */
	redoTop(): HistoryEntry | null;
	undo(): HistoryOutcome;
	redo(): HistoryOutcome;
	subscribe(l: (h: WorkspaceHistory) => void): () => void;
	dispose(): void;
}

export interface HistoryOptions {
	/** Typing joins a group within this many ms of the previous keystroke (default 500). */
	groupMs?: number;
	/** At most this many undo steps are kept (default 500). */
	limit?: number;
}

/** Marks the transactions of an undo or redo, which the history does not record. */
export const tjpHistory: AnnotationType<'undo' | 'redo'> = Annotation.define<'undo' | 'redo'>();

export { historyLabel };

export function createHistory(ws: Workspace, opts: HistoryOptions = {}): WorkspaceHistory {
	return new History(ws, opts.groupMs ?? 500, opts.limit ?? 500);
}

const EMPTY: HistoryOutcome = { status: 'empty' };

class History implements WorkspaceHistory {
	readonly #ws: Workspace;
	readonly #groupMs: number;
	readonly #limit: number;
	#done: Rec[] = [];
	#undone: Rec[] = [];
	readonly #entries = new WeakMap<Rec, HistoryEntry>();
	/** Each file's version and text as the history last saw them. */
	readonly #seen = new Map<WorkspacePath, { version: number; text: Text }>();
	readonly #listeners = new Set<(h: WorkspaceHistory) => void>();
	readonly #off: () => void;
	#placeholder = -1;
	#signature = '|';

	constructor(ws: Workspace, groupMs: number, limit: number) {
		this.#ws = ws;
		this.#groupMs = groupMs;
		this.#limit = Math.max(1, limit);
		this.#see(ws.snapshot());
		this.#off = ws.subscribe((snap, origin, info) => this.#onChange(snap, origin, info));
	}

	get canUndo(): boolean {
		return this.#done.length > 0;
	}

	get canRedo(): boolean {
		return this.#undone.length > 0;
	}

	top(): HistoryEntry | null {
		const r = this.#done[this.#done.length - 1];
		return r ? this.#entry(r) : null;
	}

	redoTop(): HistoryEntry | null {
		const r = this.#undone[this.#undone.length - 1];
		return r ? this.#entry(r) : null;
	}

	undo(): HistoryOutcome {
		const r = this.#done[this.#done.length - 1];
		if (!r) return EMPTY;
		r.open = false;
		const entry = this.#entry(r);
		const inverse = undoEdit(entry.applied, this.#ws.snapshot());
		if (!inverse) return this.#diverge(entry, 'undo');
		// Off the stack first: a listener that edits in response records above it.
		this.#done.pop();
		const res = applyEdit(this.#ws, inverse, {
			origin: 'history',
			userEvent: 'undo',
			annotations: [tjpHistory.of('undo')],
			selection: entry.selectionBefore,
		});
		if (res === 'stale') return this.#diverge(entry, 'undo');
		this.#undone.push(r);
		for (const s of r.steps) this.#restamp(s.path, s.before, res.versions[s.path]);
		return this.#finish(r, 'undo');
	}

	redo(): HistoryOutcome {
		const r = this.#undone[this.#undone.length - 1];
		if (!r) return EMPTY;
		const entry = this.#entry(r);
		const snap = this.#ws.snapshot();
		for (const s of r.steps) {
			const f = snap.files.get(s.path);
			if (!f || f.version !== s.before || f.text.length !== s.changes.length) {
				return this.#diverge(entry, 'redo');
			}
		}
		this.#undone.pop();
		const res = applyEdit(
			this.#ws,
			{ ...entry.applied.edit, id: newEditId() },
			{
				origin: 'history',
				userEvent: 'redo',
				annotations: [tjpHistory.of('redo')],
				selection: entry.selectionAfter,
			},
		);
		if (res === 'stale') return this.#diverge(entry, 'redo');
		const top = this.#done[this.#done.length - 1];
		if (top) top.open = false;
		this.#done.push(r);
		for (const s of r.steps) this.#restamp(s.path, s.after, res.versions[s.path]);
		return this.#finish(r, 'redo');
	}

	subscribe(l: (h: WorkspaceHistory) => void): () => void {
		this.#listeners.add(l);
		return () => {
			this.#listeners.delete(l);
		};
	}

	dispose(): void {
		this.#off();
		this.#listeners.clear();
		this.#done = [];
		this.#undone = [];
	}

	#finish(r: Rec, direction: 'undo' | 'redo'): HistoryOutcome {
		this.#notify();
		return { status: 'done', entry: this.#entry(r), direction, reveal: revealOf(r, direction) };
	}

	#diverge(entry: HistoryEntry, direction: 'undo' | 'redo'): HistoryOutcome {
		this.#done = [];
		this.#undone = [];
		this.#notify();
		return { status: 'diverged', entry, direction };
	}

	#onChange(snap: WorkspaceSnapshot, origin: ChangeOrigin, info: ChangeInfo): void {
		// Files whose version moved with their text unchanged (a parse-context change).
		for (const [path, f] of snap.files) {
			const seen = this.#seen.get(path);
			if (!seen || seen.version === f.version || info.paths.includes(path)) continue;
			if (seen.text === f.text || seen.text.eq(f.text)) {
				this.#restamp(path, seen.version, f.version);
			}
		}
		const ours = info.transactions.some((t) => t.annotation(tjpHistory) !== undefined);
		if (!ours) {
			if (info.edit) this.#recordApply(snap, origin, info);
			else this.#recordCommit(snap, origin, info);
		}
		this.#see(snap);
		// An undo or redo notifies once it has moved the entry (`#finish`).
		if (!ours) this.#notify();
	}

	/** One entry for an `apply`; `transactions[i]` changed `paths[i]`. */
	#recordApply(snap: WorkspaceSnapshot, origin: ChangeOrigin, info: ChangeInfo): void {
		const edit = info.edit;
		if (!edit) return;
		if (info.transactions.some((t) => t.annotation(Transaction.addToHistory) === false)) {
			this.#seal();
			return;
		}
		const tjp = isTjpEdit(edit) ? edit : null;
		const steps: Step[] = [];
		info.paths.forEach((path, i) => {
			const tr = info.transactions[i];
			const after = snap.files.get(path)?.version;
			if (!tr || after === undefined) return;
			const before = edit.base[path] ?? this.#seen.get(path)?.version ?? -1;
			steps.push(stepOf(path, tr, before, after, tjp?.inverse[path] ?? null));
		});
		const intent: HistoryIntent = tjp?.intent ?? { type: 'text', file: info.paths[0] ?? '' };
		const label = info.transactions[0]?.annotation(historyLabel) ?? labelOf(intent);
		this.#push({
			id: edit.id,
			kind: origin === 'format' || intent.type === 'format' ? 'format' : 'intent',
			label,
			intent,
			steps,
			targets: tjp?.targets ?? null,
			select: tjp?.select ?? null,
			open: false,
			lastTime: 0,
		});
	}

	/** Typing groups, or one entry for a format or intent the editor committed. */
	#recordCommit(snap: WorkspaceSnapshot, origin: ChangeOrigin, info: ChangeInfo): void {
		const path = info.paths[0];
		if (path === undefined) return;
		const trs = info.transactions.filter((t) => t.docChanged);
		const last = snap.files.get(path)?.version ?? -1;
		let cur = this.#seen.get(path)?.version ?? -1;
		let whole: Rec | null = null;
		for (let i = 0; i < trs.length; i++) {
			const tr = trs[i];
			if (!tr) continue;
			const before = cur;
			const after = i === trs.length - 1 ? last : this.#placeholder--;
			cur = after;
			if (tr.annotation(Transaction.addToHistory) === false) {
				this.#seal();
				whole = null;
				continue;
			}
			const top = this.#done[this.#done.length - 1];
			if (origin === 'typing' || origin === 'history') {
				if (joins(top, path, tr, before, this.#groupMs)) {
					extend(top, tr, after);
					this.#entries.delete(top);
					this.#undone = [];
				} else {
					this.#push(typingRec(path, tr, before, after));
				}
			} else if (whole && whole === top && whole.steps[0]?.after === before) {
				// A format or intent: the batch is one entry.
				extend(whole, tr, after);
				this.#entries.delete(whole);
			} else {
				whole = editRec(path, tr, before, after, origin);
				this.#push(whole);
			}
		}
	}

	#push(rec: Rec): void {
		if (rec.steps.length === 0) return;
		this.#seal();
		this.#done.push(rec);
		this.#undone = [];
		if (this.#done.length > this.#limit) this.#done.splice(0, this.#done.length - this.#limit);
	}

	/** Closes the typing group on top, so nothing more joins it. */
	#seal(): void {
		const top = this.#done[this.#done.length - 1];
		if (top) top.open = false;
	}

	/** Every expectation of `from` for `path`, in both stacks, becomes `to` (module comment). */
	#restamp(path: WorkspacePath, from: number, to: number | undefined): void {
		if (to === undefined || from === to) return;
		for (const r of [...this.#done, ...this.#undone]) {
			let hit = false;
			for (const s of r.steps) {
				if (s.path !== path) continue;
				if (s.before === from) {
					s.before = to;
					hit = true;
				}
				if (s.after === from) {
					s.after = to;
					hit = true;
				}
			}
			if (hit) this.#entries.delete(r);
		}
	}

	#see(snap: WorkspaceSnapshot): void {
		for (const [path, f] of snap.files) this.#seen.set(path, { version: f.version, text: f.text });
	}

	#entry(r: Rec): HistoryEntry {
		let e = this.#entries.get(r);
		if (!e) this.#entries.set(r, (e = entryOf(r)));
		return e;
	}

	#notify(): void {
		const sig = `${this.top()?.id ?? ''}|${this.redoTop()?.id ?? ''}`;
		if (sig === this.#signature) return;
		this.#signature = sig;
		for (const l of [...this.#listeners]) l(this);
	}
}
