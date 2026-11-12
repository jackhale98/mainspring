// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Editor commands and the editor-to-workspace path (phase-1.md 6.2, 6.7, 7.3).
 *
 * `formatCommand` formats the file (or the lines a non-empty selection touches). When the
 * editor shows a workspace file whose text the workspace holds, it goes through the edit API
 * (edit/apply.ts `formatFile(snapshot, path)`, a `TjpEdit` of intent `format`) and reuses the
 * workspace's tree; an editor outside a workspace formats a fresh parse with format.ts. The
 * edit's change set goes out as one view transaction annotated `tjpOrigin.of('format')` and
 * `tjpEditId.of(edit.id)` (user event `input.tjp.format`, as `Workspace.apply` labels it), with
 * `isolateHistory.of('full')` so it is its own undo step and typing right after it is not
 * joined to it. `workspaceDispatch` commits it with origin 'format'. Dispatching through the
 * view rather than `Workspace.apply` keeps the view and the workspace on one state. It is
 * refused as 'stale' when the view's state is not the workspace's state for the file, or the
 * edit's base version is not the file's (as `apply` checks). A file with syntax errors is
 * refused. A read-only editor does not format (the command returns false). Otherwise the command
 * reports what happened through the editor options' `onFormat` and returns true.
 *
 * Key bindings (`tjpKeymap`, labels in strings.ts `editorStrings.commands`):
 * - Format: Shift-Alt-f on Windows and Linux (spec 6.7). On macOS Option-Shift-F types "Ï", so
 *   binding it would swallow text input; there it is Cmd-Option-Shift-f, which types nothing.
 * - Show documentation at the cursor: Mod-k Mod-i (docs-tooltip.ts), Escape closes it.
 * - Enter inside a quoted string inserts a bare line break (indent.ts `enterInString`).
 * - F8 and Mod-Shift-m come from @codemirror/lint (lint.ts).
 */
import { isolateHistory } from '@codemirror/commands';
import {
	Annotation,
	type EditorState,
	type Transaction,
	type TransactionSpec,
} from '@codemirror/state';
import type { Command, EditorView, KeyBinding } from '@codemirror/view';
import type { WorkspacePath } from '../../../engine/protocol';
import type { ChangeOrigin, Workspace } from '../../workspace/workspace';
import { tjpEditId } from '../../workspace/workspace';
import { createFile, type TjpFile } from '../document';
import { formatFile as editFormatFile } from '../edit/apply';
import { detectIndentUnit, formatFile, type FormatOptions } from '../format';
import { tjpEnv, workspaceFile, type FormatOutcome } from './env';
import { hideDocsCommand, showDocsCommand } from './docs-tooltip';
import { enterInString, setIndentUnit } from './indent';

/** The workspace origin of an editor transaction that is not typing. */
export const tjpOrigin = Annotation.define<ChangeOrigin>();

/** The origin to commit a batch of editor transactions with: 'format', 'intent' or 'typing'. */
export function originOf(trs: readonly Transaction[]): ChangeOrigin {
	let origin: ChangeOrigin = 'typing';
	for (const tr of trs) {
		const o = tr.annotation(tjpOrigin);
		if (o === 'format') return 'format';
		if (o === 'intent' || tr.annotation(tjpEditId) !== undefined) origin = 'intent';
	}
	return origin;
}

/**
 * A `dispatchTransactions` for an `EditorView` that shows a workspace file: it commits the
 * transactions to the workspace (which must hold the view's state for `path()`), then updates
 * the view. When the workspace's state then differs from the view's (it reconfigured the file
 * for a new parse context), the view takes the workspace's state.
 */
export function workspaceDispatch(
	workspace: Workspace,
	path: () => WorkspacePath,
): (trs: readonly Transaction[], view: EditorView) => void {
	return (trs, view) => {
		const p = path();
		workspace.commit(p, trs, originOf(trs));
		view.update(trs);
		const current = workspace.state(p);
		if (view.state !== current) view.setState(current);
	};
}

type Formatted = { spec: TransactionSpec | null; outcome: FormatOutcome };

const UNCHANGED: Formatted = { spec: null, outcome: { status: 'unchanged' } };
const STALE: Formatted = { spec: null, outcome: { status: 'refused', reason: 'stale', at: [] } };

/** The annotations of a format transaction; `id` is the TjpEdit's. */
function formatAnnotations(id?: string) {
	const base = [tjpOrigin.of('format'), isolateHistory.of('full')];
	return id === undefined ? base : [...base, tjpEditId.of(id)];
}

/** Through the edit API, on the workspace snapshot whose file the editor shows. */
function viaEditApi(
	ws: Workspace,
	state: EditorState,
	file: TjpFile,
	range: FormatOptions,
): Formatted {
	if (ws.state(file.path) !== state) return STALE;
	const r = editFormatFile(ws.snapshot(), file.path, range);
	if (r.status === 'noop') return UNCHANGED;
	if (r.status === 'refused') {
		return { spec: null, outcome: { status: 'refused', reason: r.reason, at: r.at } };
	}
	const changes = r.edit.changes[file.path];
	if (r.edit.base[file.path] !== file.version) return STALE;
	if (!changes || changes.empty) return UNCHANGED;
	const unit = detectIndentUnit(file);
	let count = 0;
	changes.iterChanges(() => count++);
	return {
		spec: {
			changes,
			effects: setIndentUnit.of(unit),
			annotations: formatAnnotations(r.edit.id),
			userEvent: 'input.tjp.format',
		},
		outcome: { status: 'formatted', changes: count, unit },
	};
}

/** With format.ts on a fresh parse, for an editor outside a workspace. */
function standalone(state: EditorState, range: FormatOptions): Formatted {
	const env = state.facet(tjpEnv);
	const result = formatFile(createFile(env.path, state.doc, env.top), range);
	if (result.status === 'refused') {
		return { spec: null, outcome: { status: 'refused', reason: result.reason, at: result.at } };
	}
	if (result.changes.length === 0) return UNCHANGED;
	return {
		spec: {
			changes: [...result.changes],
			effects: setIndentUnit.of(result.unit),
			annotations: formatAnnotations(),
			userEvent: 'input.tjp.format',
		},
		outcome: { status: 'formatted', changes: result.changes.length, unit: result.unit },
	};
}

/**
 * The transaction spec that formats the state's file (or the lines the selection touches), and
 * what it did; a null spec when nothing changes or format refuses (module comment).
 */
export function formatTransaction(state: EditorState): Formatted {
	const sel = state.selection.main;
	const range: FormatOptions = sel.empty ? {} : { from: sel.from, to: sel.to };
	const ws = state.facet(tjpEnv).workspace();
	const file = workspaceFile(state);
	return ws && file ? viaEditApi(ws, state, file, range) : standalone(state, range);
}

/** Formats the file or the selected lines (module comment). */
export const formatCommand: Command = (view) => {
	if (view.state.readOnly) return false;
	const { spec, outcome } = formatTransaction(view.state);
	if (spec) view.dispatch(spec);
	view.state.facet(tjpEnv).onFormat(outcome);
	return true;
};

/** The editor's own keys (module comment); `tjp()` adds them at high precedence. */
export const tjpKeymap: readonly KeyBinding[] = [
	{ key: 'Shift-Alt-f', mac: 'Mod-Alt-Shift-f', run: formatCommand, preventDefault: true },
	{ key: 'Mod-k Mod-i', run: showDocsCommand, preventDefault: true },
	{ key: 'Escape', run: hideDocsCommand },
	{ key: 'Enter', run: enterInString },
];
