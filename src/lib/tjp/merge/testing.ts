// SPDX-License-Identifier: GPL-2.0-or-later
// Helpers for the merge tests: a context from a plan's files, one-file merges, and resolving.
import { createWorkspace } from '../../workspace/workspace';
import { mergeFile, mergeWorkspace, resolve } from '../../sync/merge';
import {
	isUnresolved,
	type Files,
	type MergeContext,
	type Take,
	type WorkspaceMerge,
} from './types';

/** The context ours' workspace gives (its include graph). */
export function contextOf(entry: string, files: Readonly<Record<string, string>>): MergeContext {
	return { includes: createWorkspace({ entry, files }).snapshot().includes };
}

export const filesOf = (r: Readonly<Record<string, string>>): Files => new Map(Object.entries(r));

/** A merge of one entry file `plan.tjp`. */
export function merge1(base: string, ours: string, theirs: string): WorkspaceMerge {
	const ctx = contextOf('plan.tjp', { 'plan.tjp': ours });
	const m = mergeFile('plan.tjp', base, ours, theirs, ctx);
	return { files: new Map(m.text === null ? [] : [['plan.tjp', m.text]]), conflicts: m.conflicts };
}

/** A workspace merge with ours' context. */
export function mergeAll(
	entry: string,
	base: Readonly<Record<string, string>>,
	ours: Readonly<Record<string, string>>,
	theirs: Readonly<Record<string, string>>,
): WorkspaceMerge {
	return mergeWorkspace(filesOf(base), filesOf(ours), filesOf(theirs), contextOf(entry, ours));
}

/** Every conflict resolved with `take`; throws when some stay unresolved. */
export function resolveAll(m: WorkspaceMerge, take: Take): Files {
	const r = resolve(
		m,
		m.conflicts.map((c) => ({ conflict: c.id, take })),
	);
	if (isUnresolved(r)) throw new Error(`unresolved: ${r.unresolved.join(', ')}`);
	return r;
}
