// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the workspace history (history.ts): a plan in three files, typing as the
 * editor commits it (with a user event and a `Transaction.time`), intents through the edit API
 * and format through `apply` or as the editor commits it.
 */
import { Transaction, type TransactionSpec } from '@codemirror/state';
import { buildIndex } from '../../tjp/index';
import { applyEdit, applyIntent, formatFile } from '../../tjp/edit/apply';
import type { EditIntent, TjpEdit } from '../../tjp/edit/types';
import { tjpOrigin } from '../../tjp/cm/commands';
import { createWorkspace, tjpEditId, type Workspace } from '../workspace';

export const PLAN = [
	'project p "P" 2026-01-05 +2m {',
	'  now 2026-01-05',
	'}',
	'include "a.tji"',
	'include "b.tji"',
	'task top "Top" {',
	'  effort 2d',
	'}',
	'',
].join('\n');
export const A = [
	'task a "A" {',
	'  task a1 "A1" {',
	'    effort 1d',
	'  }',
	'  task a2 "A2" {',
	'    length 3d',
	'  }',
	'}',
	'',
].join('\n');
export const B = ['task b "B" {', 'effort 4d', '    depends a', '}', ''].join('\n');
export const FILES = { 'plan.tjp': PLAN, 'a.tji': A, 'b.tji': B } as const;
export type FilePath = keyof typeof FILES;
export const PATHS: readonly FilePath[] = ['plan.tjp', 'a.tji', 'b.tji'];

export function seedWorkspace(files: Readonly<Record<string, string>> = FILES): Workspace {
	return createWorkspace({ entry: 'plan.tjp', files });
}

export interface TypeOptions {
	time?: number;
	userEvent?: string;
	/** Extra spec fields, e.g. `annotations`. */
	spec?: TransactionSpec;
}

/** Replaces [from, to) with `insert` in a file, as the editor commits typing. */
export function type(
	ws: Workspace,
	path: string,
	from: number,
	insert: string,
	o: TypeOptions & { to?: number } = {},
): Transaction {
	const st = ws.state(path);
	const to = o.to ?? from;
	const tr = st.update({
		changes: { from, to, insert },
		selection: { anchor: from + insert.length },
		userEvent: o.userEvent ?? (insert === '' ? 'delete.backward' : 'input.type'),
		annotations: o.time === undefined ? [] : [Transaction.time.of(o.time)],
		...(o.spec ?? {}),
	});
	ws.commit(path, tr, 'typing');
	return tr;
}

/** Moves the cursor of a file (a selection-only commit). */
export function moveCursor(ws: Workspace, path: string, pos: number): void {
	ws.commit(
		path,
		ws.state(path).update({ selection: { anchor: pos }, userEvent: 'select' }),
		'typing',
	);
}

/** Plans an intent on the workspace as it is now; null when it is refused or a no-op. */
export function plan(ws: Workspace, intent: EditIntent): TjpEdit | null {
	const snap = ws.snapshot();
	const r = applyIntent(snap, buildIndex(snap, undefined, { cache: null }), intent);
	return r.status === 'edit' ? r.edit : null;
}

/** Plans and applies an intent; the edit, or null. */
export function intent(ws: Workspace, i: EditIntent): TjpEdit | null {
	const e = plan(ws, i);
	if (!e) return null;
	if (applyEdit(ws, e) === 'stale') throw new Error('stale');
	return e;
}

/** Formats a file through `apply`, or as the editor commits its format command. */
export function format(ws: Workspace, path: string, via: 'apply' | 'editor' = 'apply'): boolean {
	const r = formatFile(ws.snapshot(), path);
	if (r.status !== 'edit') return false;
	const cs = r.edit.changes[path];
	if (via === 'apply' || !cs) {
		if (applyEdit(ws, r.edit) === 'stale') throw new Error('stale');
		return true;
	}
	const tr = ws.state(path).update({
		changes: cs,
		annotations: [tjpOrigin.of('format'), tjpEditId.of(r.edit.id)],
		userEvent: 'input.tjp.format',
	});
	ws.commit(path, tr, 'format');
	return true;
}

export function textOf(ws: Workspace, path: string): string {
	return ws.texts()[path] ?? '';
}
