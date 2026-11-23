// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Three-way merge of a plan's files with TJP-aware conflicts (phase-4.md 6.4, 8.3; ADR-0019).
 * Types and contracts only (T3); owner `grammar-specialist` (18.17). T6 implements them:
 * `src/lib/sync/merge.ts` exports `mergeWorkspace: MergeWorkspaceFn` and `resolve: ResolveFn`,
 * and this folder holds the grammar-aware part (`hints.ts`, `refine.ts`).
 *
 * ## Contract
 *
 * - **Text only.** Merges take and give text as the workspace holds it (store-types.ts codec).
 *   Lines split on '\n' only, so '\r' stays part of its line and CRLF files merge as written
 *   (document.ts). Nothing here schedules: the merged text is checked by the app's runner (6.5).
 * - **Per file, three-way on lines** with `node-diff3` (rule 1). A file added on one side only is
 *   taken as it is; added on both sides with the same text, taken; with different text, a `file`
 *   conflict `added-twice`. A file deleted on one side and unchanged on the other is deleted; a
 *   file deleted on one side and changed on the other is a `file` conflict.
 * - **Refinement** (rule 2). A conflicting hunk inside one task, resource or project block is
 *   merged again statement by statement over the Lezer trees of all three texts: a statement
 *   changed on one side merges cleanly, identical changes merge cleanly, and the same statement
 *   changed differently on both sides is one `attribute` conflict.
 * - **Never auto-pick a side** (rule 4). The merge resolves only what diff3 and rule 2 prove clean.
 * - **Laws** (13.1), for every file set: `merge(b, o, b)` is `o` and `merge(b, b, t)` is `t`, both
 *   clean; `merge(b, x, x)` is `x`, clean. Swapping ours and theirs gives the same conflicts with
 *   their sides swapped (`deleted-ours` <-> `deleted-theirs`), at the same subjects.
 * - **Stable ids.** `MergeConflict.id` is a function of the file, the subject and the base text of
 *   the conflicting region, so a merge computed again from newer text (8.3: "On Apply, the merge is
 *   computed again") gives the same id to the same conflict, and earlier choices carry over.
 * - **Cost** (rule 5). At most 50 ms p90 on desktop for `fedora-res`-sized files with 20 edits per
 *   side, and no task over 50 ms at 4x CPU: the work is chunked by file.
 * - **Pure.** No I/O, no clock, no randomness; safe in any task or worker.
 *
 * Contract notes (T3):
 * - `MergeConflict.both` is added: rule 3 offers "Keep both" for `text` conflicts and for blocks
 *   added on both sides with different ids, and the subject alone cannot tell different ids from
 *   the same id. The merge knows, so it says.
 * - A merged file set may differ from the workspace's files. A file added on our side only (a
 *   file made in the app, phase-4.md 21) is taken as it is, so it survives every merge. A file
 *   added on the remote is taken in through `Workspace.addFile` (T27a). The workspace cannot drop
 *   a file (nothing deletes, 21), so T7 decides how a file deleted on the remote is handled; it
 *   must not be deleted locally without the user, nor silently written back.
 * - For a `file` conflict whose merged side has no file, `at` is `{ file, from: 0, to: 0 }`.
 */
import type { SourceRange } from '../tree';
import type { WorkspacePath } from '../../workspace/paths';

/** Every plan file's text, by workspace path. */
export type Files = ReadonlyMap<WorkspacePath, string>;

/** The result of a workspace merge (6.4). */
export interface WorkspaceMerge {
	/**
	 * The merged text of every file the merge keeps. A file in conflict holds ours in each
	 * conflicting region, so `files` is always valid input for the next merge.
	 */
	readonly files: Files;
	/** Empty when the merge is clean. In file order, then by position. */
	readonly conflicts: readonly MergeConflict[];
}

/** sync/merge.ts (T6): `export const mergeWorkspace: MergeWorkspaceFn`. */
export type MergeWorkspaceFn = (base: Files, ours: Files, theirs: Files) => WorkspaceMerge;

/**
 * The block a conflict is in, as the conflict view names it ("Build API, effort"). `id` is the
 * full id as the symbol index forms it (`TaskId`, `ResourceId`; the project's id), null when it
 * cannot be read (a macro, a syntax error). `name` is the name as written, unquoted, or null.
 */
export interface Owner {
	readonly kind: 'project' | 'task' | 'resource' | 'other';
	readonly id: string | null;
	readonly name: string | null;
}

/** What a conflict is about (6.4). */
export type ConflictSubject =
	/**
	 * One statement of a block changed differently on both sides: "effort of Build API". `attr` is
	 * the statement's keyword, with its scenario prefix when it has one (`delayed:effort`).
	 */
	| { readonly kind: 'attribute'; readonly owner: Owner; readonly attr: string }
	/** A whole block: deleted on one side and changed on the other, added on both, or both edited. */
	| {
			readonly kind: 'block';
			readonly owner: Owner;
			readonly change: 'deleted-ours' | 'deleted-theirs' | 'added-twice' | 'both-edited';
	  }
	/** A whole file (rule 1). */
	| { readonly kind: 'file'; readonly change: 'deleted-ours' | 'deleted-theirs' | 'added-twice' }
	/** Outside any block: the header, comments, macros. */
	| { readonly kind: 'text' };

/** One conflict (6.4). */
export interface MergeConflict {
	/** Stable across a merge computed again (module comment); unique in its merge. */
	readonly id: string;
	readonly file: WorkspacePath;
	readonly subject: ConflictSubject;
	/**
	 * The region's text on each side, null where that side has none (deleted, or not there). For an
	 * `attribute` conflict, each is the whole statement as written (`effort 5d`).
	 */
	readonly base: string | null;
	readonly ours: string | null;
	readonly theirs: string | null;
	/** Where the region lands in the merged file (holding ours); see the contract notes for files. */
	readonly at: SourceRange;
	/** Whether `take: 'both'` is offered (rule 3; contract notes). */
	readonly both: boolean;
}

/**
 * The user's choice for one conflict (6.4): keep ours, take theirs, both (ours' lines, then
 * theirs'), or a text of their own for the region ("Edit…").
 */
export type Take = 'ours' | 'theirs' | 'both' | { readonly text: string };
export interface Resolution {
	/** A `MergeConflict.id`. */
	readonly conflict: string;
	readonly take: Take;
}

/**
 * sync/merge.ts (T6): `export const resolve: ResolveFn`. The merged files with every conflict's
 * region replaced by its choice, or the ids still unresolved, in `m.conflicts` order. A resolution
 * for an unknown id is ignored (a choice whose subject is gone); `both` on a conflict without
 * `both` leaves it unresolved; for one id, the last resolution wins. `theirs` on a `file` conflict
 * whose theirs is deleted drops the file.
 */
export type ResolveFn = (m: WorkspaceMerge, r: readonly Resolution[]) => Files | Unresolved;
export interface Unresolved {
	readonly unresolved: readonly string[];
}

/** Tells `ResolveFn`'s two results apart. */
export function isUnresolved(r: Files | Unresolved): r is Unresolved {
	return !(r instanceof Map);
}
