// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The editor view's side of Text mode (phase-1.md 8.2, 15.21): one `EditorView` that shows the
 * workspace's `EditorState` for the open file. The workspace owns the states (text, cursor, lint
 * marks; undo is the workspace history's); the view only displays one of them, and every transaction goes through
 * `workspaceDispatch`, so the view never owns the text.
 *
 * - `sync` brings the view back to the workspace's state when something changed that file without
 *   the view (`Workspace.apply`: the edit dispatcher, undo and redo; or a reconfiguration).
 *   Everything that dispatches (diagnostics, reveals, format) calls it first, because a
 *   transaction that starts from another state than the workspace's would throw in `commit`.
 *   It follows the workspace with `view.update` on the transactions the workspace announced for
 *   the shown file (`ChangeInfo.transactions`), so the view keeps its DOM, scroll, focus and
 *   plugin state (phase-2.md 6.8). Only when they do not chain from the view's state to the
 *   workspace's (a reconfiguration, `attachEditor`, a switch of file) does it fall back to
 *   `setState`.
 * - The edit dispatcher does not apply an edit to the shown file while an Android key is held
 *   (`keyHeld`, tjp/cm/android-key.ts), so `sync` never meets one; it does not wait itself,
 *   because CodeMirror's flush of the key must start from the workspace's state.
 * - `show` gives the view another file's state and puts its scroll position back, unless a
 *   reveal follows (the reveal scrolls to its target, and a restore after it would undo that).
 * - `reveal` waits while an Android key is held (a selection change would drop it), then selects a range and scrolls it to the middle, or, with `select` false, keeps the
 *   selection and scrolls only as far as needed (`nearest`, so an undo on screen does not jump);
 *   with `focus` it then focuses the editor, after an open modal dialog (the tablet drawer) has
 *   closed, since a modal makes the editor inert.
 * - `mark` shows a selection that came from a visual (phase-2.md 6.10): it sets the selected-source
 *   highlight of a file, and for a new selection scrolls the block to the middle and, only when the
 *   editor does not have the focus, puts the cursor on it. Its transactions carry `selectionSync`,
 *   and wait on the Android key guard like `reveal`. A highlight in a file other than the shown
 *   one is set in the workspace's state of that file, so a file switch shows it; the controller
 *   keeps at most one highlighted file. A scroll asked while the editor is hidden (Visual mode)
 *   is done when the editor is shown (`becameVisible()`).
 * - `onCursor` hears where the cursor is after the user moved it or typed (text to visual): after
 *   a click, an arrow key or a search straight away (one callback per task), after typing once
 *   `TYPING_QUIET_MS` of quiet has passed. Transactions annotated `selectionSync` are the app's
 *   own and are ignored, so a selection never comes back round as a new one.
 * - Diagnostics go on the lint layer's two channels. The engine channel is pushed when a result
 *   arrives (the layer maps it through later edits and marks it stale), the local channel
 *   whenever the document layer's checks change.
 */
import {
	EditorSelection,
	type EditorState,
	type StateEffect,
	type Transaction,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { WorkspacePath } from '../../engine/protocol';
import { afterAndroidKey, androidKeyPending } from '../tjp/cm/android-key';
import {
	formatCommand,
	selectionSync,
	setEngineDiagnostics,
	setLocalDiagnostics,
	setSourceHighlight,
	sourceHighlightField,
	workspaceDispatch,
} from '../tjp/cm';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type { ChangeInfo, Workspace } from '../workspace/workspace';
import type { SourceMark } from './selection.svelte';

/**
 * The transactions in `queued` that lead from `from` to `to` one after another, or null when they
 * do not (module comment).
 */
export function chainOf(
	from: EditorState,
	queued: readonly Transaction[],
	to: EditorState,
): Transaction[] | null {
	const start = queued.findIndex((t) => t.startState === from);
	if (start < 0) return null;
	const chain: Transaction[] = [];
	let at: EditorState = from;
	for (let i = start; i < queued.length; i++) {
		const t = queued[i];
		if (!t || t.startState !== at) return null;
		chain.push(t);
		at = t.state;
		if (at === to) return chain;
	}
	return null;
}

/** How long typing must pause before the cursor's task is looked up. */
export const TYPING_QUIET_MS = 120;

export interface EditorControllerOptions {
	/** The cursor's place after the user moved it or typed (module comment). */
	readonly onCursor?: (file: WorkspacePath, pos: number) => void;
}

export class EditorController {
	readonly view: EditorView;
	readonly #ws: Workspace;
	readonly #scrolls = new Map<WorkspacePath, number>();
	readonly #off: () => void;
	#shown: WorkspacePath;
	#restore = 0;
	/** The shown file's transactions announced since the last sync (module comment). */
	#queued: Transaction[] = [];
	#cancelReveal: () => void = () => undefined;
	#cancelMark: () => void = () => undefined;
	/** The file that holds the selected-source highlight, if any. */
	#highlighted: WorkspacePath | null = null;
	/** A scroll to the highlight was asked while the editor was hidden. */
	#scrollPending = false;
	readonly #onCursor: EditorControllerOptions['onCursor'];
	#cursorTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		ws: Workspace,
		parent: HTMLElement,
		path: WorkspacePath,
		opts: EditorControllerOptions = {},
	) {
		this.#ws = ws;
		this.#shown = path;
		this.#onCursor = opts.onCursor;
		const dispatch = workspaceDispatch(ws, () => this.#shown);
		this.view = new EditorView({
			parent,
			state: ws.state(path),
			dispatchTransactions: (trs, view) => {
				dispatch(trs, view);
				this.#noteCursor(trs);
			},
		});
		// Edits made without the view leave it behind the workspace: catch up once they are done.
		this.#off = ws.subscribe((_s, _o, info) => {
			this.#collect(info);
			queueMicrotask(() => this.sync());
		});
	}

	/** True while CodeMirror holds an Android key and one of `paths` is the shown file. */
	keyHeld(paths: readonly WorkspacePath[]): boolean {
		return paths.includes(this.#shown) && this.view.dom.isConnected && androidKeyPending(this.view);
	}

	#collect(info: ChangeInfo): void {
		if (info.edit) {
			info.paths.forEach((p, i) => {
				const t = info.transactions[i];
				if (p === this.#shown && t) this.#queued.push(t);
			});
		} else if (info.paths[0] === this.#shown) {
			this.#queued.push(...info.transactions);
		}
	}

	/** The file whose state the view shows. */
	get shown(): WorkspacePath {
		return this.#shown;
	}

	/** Shows the workspace's current state of the open file; true when the view was behind. */
	sync(): boolean {
		const current = this.#ws.state(this.#shown);
		const queued = this.#queued;
		this.#queued = [];
		if (this.view.state === current) return false;
		const chain = chainOf(this.view.state, queued, current);
		if (chain) this.view.update(chain);
		else this.view.setState(current);
		return true;
	}

	/** Shows another file (module comment). */
	show(path: WorkspacePath, opts: { restoreScroll?: boolean } = {}): void {
		if (path === this.#shown) {
			this.sync();
			return;
		}
		this.#scrolls.set(this.#shown, this.view.scrollDOM.scrollTop);
		this.#shown = path;
		this.#queued = [];
		this.view.setState(this.#ws.state(path));
		const top = this.#scrolls.get(path) ?? 0;
		const token = ++this.#restore;
		if (opts.restoreScroll === false) return;
		requestAnimationFrame(() => {
			if (token === this.#restore) this.view.scrollDOM.scrollTop = top;
		});
	}

	/** Selects a range of a file and scrolls it to the middle (module comment). */
	reveal(file: WorkspacePath, from: number, to: number, focus: boolean, select = true): void {
		this.#cancelReveal();
		this.#cancelReveal = afterAndroidKey(
			() => androidKeyPending(this.view),
			() => this.#reveal(file, from, to, focus, select),
		);
	}

	#reveal(file: WorkspacePath, from: number, to: number, focus: boolean, select: boolean): void {
		// The file may already have been switched to (the open-file effect runs first) with a scroll
		// restore waiting: this reveal supersedes it.
		this.#restore++;
		this.show(file, { restoreScroll: false });
		this.sync();
		const length = this.view.state.doc.length;
		const start = Math.min(Math.max(0, from), length);
		const end = Math.min(Math.max(start, to), length);
		this.view.dispatch(
			select
				? {
						selection: { anchor: start, head: end },
						effects: EditorView.scrollIntoView(start, { y: 'center' }),
						userEvent: 'select',
					}
				: // On screen already (an undo of typing just done): do not recenter.
					{ effects: EditorView.scrollIntoView(start, { y: 'nearest' }) },
		);
		// After a switch the new state has not been laid out yet, and the scroll above may find no
		// layout to scroll in: ask again once the view has measured it.
		requestAnimationFrame(() => {
			if (this.#shown === file && (!select || this.view.state.selection.main.from === start)) {
				this.view.dispatch({
					effects: EditorView.scrollIntoView(start, { y: select ? 'center' : 'nearest' }),
				});
			}
		});
		if (!focus) return;
		const dialog = this.view.dom.ownerDocument.querySelector('dialog[open]');
		if (dialog) dialog.addEventListener('close', () => this.view.focus(), { once: true });
		else this.view.focus();
	}

	/**
	 * Shows a selection that came from a visual, or clears it (null). Waits while an Android key is
	 * held (module comment).
	 */
	mark(m: SourceMark | null): void {
		this.#cancelMark();
		this.#cancelMark = afterAndroidKey(
			() => androidKeyPending(this.view),
			() => this.#mark(m),
		);
	}

	/** Puts a highlight into one file's state: through the view when it shows that file. */
	#highlight(file: WorkspacePath, span: { from: number; to: number } | null): void {
		const effect = setSourceHighlight.of(span);
		if (file === this.#shown) {
			this.sync();
			this.view.dispatch({ effects: effect, annotations: selectionSync.of(true) });
		} else {
			this.#ws.commit(file, this.#ws.state(file).update({ effects: effect }), 'typing');
		}
	}

	#mark(m: SourceMark | null): void {
		const before = this.#highlighted;
		if (before !== null && before !== m?.file) {
			this.#highlight(before, null);
			this.#highlighted = null;
		}
		if (!m) return;
		if (m.scroll && m.file !== this.#shown) {
			this.#restore++;
			this.show(m.file, { restoreScroll: false });
		}
		if (m.file !== this.#shown) {
			this.#highlight(m.file, { from: m.from, to: m.to });
			this.#highlighted = m.file;
			return;
		}
		this.sync();
		const len = this.view.state.doc.length;
		const from = Math.min(Math.max(0, m.from), len);
		const to = Math.min(Math.max(from, m.to), len);
		const effects: StateEffect<unknown>[] = [setSourceHighlight.of({ from, to })];
		if (m.scroll) effects.push(EditorView.scrollIntoView(from, { y: 'center' }));
		// The cursor moves only when the user is not in the editor (a click in the text is theirs).
		const c = m.cursor;
		const cursor =
			m.scroll && c && !this.view.hasFocus
				? EditorSelection.single(Math.min(c.from, len), Math.min(Math.max(c.from, c.to), len))
				: null;
		this.view.dispatch({
			effects,
			annotations: selectionSync.of(true),
			...(cursor ? { selection: cursor, userEvent: 'select' } : {}),
		});
		this.#highlighted = m.file;
		if (!m.scroll) return;
		this.#scrollPending = this.view.scrollDOM.clientHeight === 0;
		// After a switch the new state has not been laid out yet, and the scroll may find no layout.
		requestAnimationFrame(() => {
			if (this.#shown !== m.file || this.view.scrollDOM.clientHeight === 0) return;
			this.#cancelMark = afterAndroidKey(
				() => androidKeyPending(this.view),
				() =>
					this.view.dispatch({
						effects: EditorView.scrollIntoView(Math.min(from, this.view.state.doc.length), {
							y: 'center',
						}),
						annotations: selectionSync.of(true),
					}),
			);
		});
	}

	/** The editor was shown (a mode switch): scrolls to the highlight a hidden editor could not. */
	becameVisible(): void {
		if (!this.#scrollPending || this.view.scrollDOM.clientHeight === 0) return;
		this.#scrollPending = false;
		const span = this.view.state.field(sourceHighlightField, false);
		if (!span) return;
		afterAndroidKey(
			() => androidKeyPending(this.view),
			() =>
				this.view.dispatch({
					effects: EditorView.scrollIntoView(span.from, { y: 'center' }),
					annotations: selectionSync.of(true),
				}),
		);
	}

	/** Tells `onCursor` where the cursor is, once the user has moved it or typed (module comment). */
	#noteCursor(trs: readonly Transaction[]): void {
		if (!this.#onCursor) return;
		let typed = false;
		let moved = false;
		for (const t of trs) {
			if (t.annotation(selectionSync)) continue;
			if (t.docChanged) typed = true;
			else if (!t.startState.selection.eq(t.newSelection)) moved = true;
		}
		if (!typed && !moved) return;
		if (this.#cursorTimer !== null) clearTimeout(this.#cursorTimer);
		this.#cursorTimer = setTimeout(
			() => {
				this.#cursorTimer = null;
				if (this.view.dom.isConnected) {
					this.#onCursor?.(this.#shown, this.view.state.selection.main.head);
				}
			},
			typed ? TYPING_QUIET_MS : 0,
		);
	}

	/** Pushes the engine's diagnostics (the engine channel) to the open file's marks. */
	setEngine(list: readonly TjpDiagnostic[]): void {
		this.sync();
		setEngineDiagnostics(this.view, list, () => this.sync());
	}

	/** Pushes the document layer's diagnostics (the local channel). */
	setLocal(list: readonly TjpDiagnostic[]): void {
		this.sync();
		setLocalDiagnostics(this.view, list, () => this.sync());
	}

	/** Runs the format command on the open file. */
	format(): boolean {
		this.sync();
		return formatCommand(this.view);
	}

	destroy(): void {
		this.#cancelReveal();
		this.#cancelMark();
		if (this.#cursorTimer !== null) clearTimeout(this.#cursorTimer);
		this.#off();
		this.view.destroy();
	}
}
