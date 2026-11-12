// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the edit API: a workspace with its index and edit context, statement spans
 * found by text, and the texts an edit result produces.
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import { createWorkspace, type Workspace } from '../../workspace/workspace';
import type { TjpFile } from '../document';
import { buildIndex, type SymbolIndex } from '../index';
import { statementAt } from '../tree';
import { fileText } from './lines';
import type { EditContext, EditOptions, EditResult, Span } from './types';

export interface Setup {
	readonly workspace: Workspace;
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly ctx: EditContext;
	file(path?: string): TjpFile;
}

export function setupWorkspace(workspace: Workspace, opts: EditOptions = {}): Setup {
	const snap = workspace.snapshot();
	const index = buildIndex(snap, undefined, { cache: null });
	return {
		workspace,
		snap,
		index,
		ctx: { ws: snap, index, opts },
		file(path = snap.entry) {
			const f = snap.files.get(path);
			if (!f) throw new Error(`no file ${path}`);
			return f;
		},
	};
}

export function setup(
	files: Record<string, string> | string,
	opts: EditOptions = {},
	entry = 'plan.tjp',
): Setup {
	const all = typeof files === 'string' ? { [entry]: files } : files;
	return setupWorkspace(createWorkspace({ entry, files: all }), opts);
}

/** The statement that starts at the `nth` occurrence of `needle` (its first character). */
export function stmt(file: TjpFile, needle: string, nth = 0): Span {
	const text = fileText(file);
	let at = -1;
	for (let i = 0; i <= nth; i++) {
		at = text.indexOf(needle, at + 1);
		if (at < 0) throw new Error(`no ${JSON.stringify(needle)} in ${file.path}`);
	}
	const s = statementAt(file.tree, at, 1);
	if (!s) throw new Error(`no statement at ${JSON.stringify(needle)}`);
	return { from: s.from, to: s.to };
}

/** The span of the `nth` occurrence of `needle`. */
export function span(file: TjpFile, needle: string, nth = 0): Span {
	const text = fileText(file);
	let at = -1;
	for (let i = 0; i <= nth; i++) {
		at = text.indexOf(needle, at + 1);
		if (at < 0) throw new Error(`no ${JSON.stringify(needle)} in ${file.path}`);
	}
	return { from: at, to: at + needle.length };
}

/** Every file's text after an edit result (unchanged files as they were); throws unless 'edit'. */
export function textsAfter(snap: WorkspaceSnapshot, r: EditResult): Record<string, string> {
	if (r.status !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(r)}`);
	const out: Record<string, string> = {};
	for (const [path, file] of snap.files) {
		const cs = r.edit.changes[path];
		out[path] = cs ? cs.apply(file.text).toString() : file.text.toString();
	}
	return out;
}
