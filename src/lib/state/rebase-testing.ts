// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only setup for the ADR-0018 checks (edits-rebase.ts) and the view planners: a real
 * workspace and history, a `Kept` fed as the dispatcher feeds it, indexes published on demand, and
 * the `PlanBase` (a `Rebaser`) a call made on a version would get. Not imported by application code.
 */
import { ChangeSet } from '@codemirror/state';
import { applyEdit, applyIntent } from '../tjp/edit/apply';
import type { EditIntent } from '../tjp/edit/types';
import { buildIndex, type SymbolIndex } from '../tjp/index';
import { createHistory, type WorkspaceHistory } from '../workspace/history';
import { createWorkspace, type Workspace, type WorkspaceSeed } from '../workspace/workspace';
import { changesIds } from './edits-plan';
import { Kept, rebaser, type Rebaser } from './edits-rebase';

export interface World {
	readonly ws: Workspace;
	readonly history: WorkspaceHistory;
	readonly kept: Kept;
	/** The workspace version now. */
	version(): number;
	text(path?: string): string;
	/** Builds the index of the text now and publishes it, as the runner does; its version. */
	publish(): number;
	/** Applies an intent through the edit API on the text now (throws unless it is an edit). */
	apply(intent: EditIntent): void;
	/** Replaces [from, to) with `insert`, as the editor commits typing. */
	type(from: number, to: number, insert: string, path?: string): void;
	/** What a call made on `basedOn` gets on the text now. */
	base(basedOn: number): Rebaser;
	/** The index of the text now (not published). */
	fresh(): SymbolIndex;
}

export function world(
	seed: WorkspaceSeed | string,
	opts: { logLimit?: number; publish?: boolean } = {},
): World {
	const s = typeof seed === 'string' ? { entry: 'plan.tjp', files: { 'plan.tjp': seed } } : seed;
	const ws = createWorkspace(s, opts.logLimit === undefined ? {} : { logLimit: opts.logLimit });
	const history = createHistory(ws);
	const kept = new Kept(ws.snapshot().version);
	ws.subscribe((snap, origin, info) =>
		kept.changed(snap.version, changesIds(origin, info.edit?.intent)),
	);
	const fresh = (): SymbolIndex => buildIndex(ws.snapshot(), undefined, { cache: null });
	const w: World = {
		ws,
		history,
		kept,
		version: () => ws.snapshot().version,
		text: (path = s.entry) => ws.snapshot().files.get(path)?.text.toString() ?? '',
		publish: () => {
			const index = fresh();
			kept.publish(index);
			return index.version;
		},
		apply: (intent) => {
			const snap = ws.snapshot();
			const r = applyIntent(snap, fresh(), intent);
			if (r.status !== 'edit') throw new Error(`${intent.type}: ${JSON.stringify(r)}`);
			if (applyEdit(ws, r.edit) === 'stale') throw new Error('stale');
		},
		type: (from, to, insert, path = s.entry) => {
			const state = ws.state(path);
			const changes = ChangeSet.of({ from, to, insert }, state.doc.length);
			ws.commit(path, state.update({ changes }), 'typing');
		},
		base: (basedOn) => {
			const index = fresh();
			return rebaser(ws, kept, ws.snapshot(), index, basedOn);
		},
		fresh,
	};
	if (opts.publish !== false) w.publish();
	return w;
}
