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
 * - Diagnostics go on the lint layer's two channels. The engine channel is pushed when a result
 *   arrives (the layer maps it through later edits and marks it stale), the local channel
 *   whenever the document layer's checks change.
 */
import type { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { WorkspacePath } from '../../engine/protocol';
import { afterAndroidKey, androidKeyPending } from '../tjp/cm/android-key';
import {
	formatCommand,
	setEngineDiagnostics,
	setLocalDiagnostics,
	workspaceDispatch,
} from '../tjp/cm';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type { ChangeInfo, Workspace } from '../workspace/workspace';

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

	constructor(ws: Workspace, parent: HTMLElement, path: WorkspacePath) {
		this.#ws = ws;
		this.#shown = path;
		this.view = new EditorView({
			parent,
			state: ws.state(path),
			dispatchTransactions: workspaceDispatch(ws, () => this.#shown),
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
		this.#off();
		this.view.destroy();
	}
}
