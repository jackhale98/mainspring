// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Three-way merge of a plan's files with TJP-aware conflicts (phase-4.md 6.4, 8.3; ADR-0019).
 * Types and contracts only (T3); owner `grammar-specialist` (18.17). T6 implements them:
 * `src/lib/sync/merge.ts` exports `mergeWorkspace: MergeWorkspaceFn`, `mergeFile: MergeFileFn`
 * and `resolve: ResolveFn`, and this folder holds the grammar-aware part (`hints.ts`, `refine.ts`).
 *
 * ## The guarantee (T6 review round 4)
 *
 * A **block** is any brace body the grammar parses (task, resource, project, supplement, shift,
 * account, report, `extend`, `journalentry`, `limits`, the body of `depends a { … }` or
 * `allocate r { … }`, and every other `{ … }`), a task, resource, project or supplement written
 * without a body (a block with an empty body, where a side may add one), the file's top level,
 * and a task or resource together with its supplements in the same file.
 *
 * - **G1.** A clean merge never holds two statements that set the same single-valued attribute of
 *   the same block where one was added or changed by each side (what one side alone says twice
 *   comes through as that side wrote it). Single-valued is every keyword tjp/merge/keywords.ts does
 *   not list as repeatable (unknown ones included; the sizing criteria are one value); a repeatable
 *   one sets the same value as another when their items meet (`depends`/`precedes` by target,
 *   `workinghours` by weekday in every form TaskJuggler reads, others by text; a statement whose
 *   items cannot be read, a macro call in it or a day list this module does not know, meets every
 *   other one), and `purge X` with a change to `X`; a declaration (a nested block, `macro`,
 *   `include` by path, `account` …) with the same kind and id is the same value. A `shift` declared
 *   by both sides with one id at different places is not caught here: the engine refuses it
 *   (`shift_exists`, G3).
 * - **G2.** A block both sides changed whose changes the keyword table cannot key (a macro call)
 *   or prove independent, any block both sides changed that has an error node where a side changed
 *   it, and any block both sides changed whose kind the table does not cover (every brace body
 *   but task, resource, project and supplement bodies, the top level, and a declaration with its
 *   supplements), is a conflict.
 * - **G3 (a requirement on the caller).** The merge does not see, by design: interactions across
 *   different blocks or files (a supplement in another file; a parent's attribute and a child's,
 *   as inheritance; `purge` in a child of what its parent allocates; a move to another file whose
 *   id also changes, unless `MergeContext.others` shows the move), and meanings that span keywords
 *   (`start`/`end`/`duration` together, `scheduling` against `start` or `end`, `depends` against
 *   `precedes`, `shifts` against `workinghours`). These are left to the schedule check on the
 *   merged text: the caller (the sync controller, T7) must schedule the merged text and treat any
 *   error or warning beyond what ours and theirs had (count(merged) > count(ours) + count(theirs)
 *   - count(base), by level and id) as "needs review", never as clean. Message ids seen to catch
 *   such merges: `attr_overwrite`, `marco_redefinition`, `task_depend_multi`,
 *   `task_overspecified`, `task_exists`, `resource_exists`, `account_exists`, `shift_exists`,
 *   `booking_conflict`, `shift_assignment_overlap`, `multiple_durations`, `allocate_no_assigned`,
 *   and `sched_runaway` with `runaway` and `unscheduled_task(s)` (two sides' working hours on
 *   different days, merged cleanly, leaving too little time). Known to pass the engine **silently** (no message; only a person can tell): a later
 *   `workinghours` or `shifts` for the same days in another block of the same resource (a
 *   supplement in another file, a parent and a child); a parent's attribute changed by one side
 *   and the child's by the other; a `scheduling` direction against a `start` or `end`; a moved
 *   task whose full id changed (`t` to `q.t`) when the move is not seen (both copies schedule);
 *   `copyright` and other report-only attributes said twice in different files. The engine
 *   property (tests/fidelity/merge.property.test.ts) checks the message rule on every clean
 *   merge and, for edits typed into one block, that both orders of the two edits schedule alike.
 *
 * ## Contract
 *
 * - **Text only.** Merges take and give text as the workspace holds it (store-types.ts codec).
 *   Lines split on '\n' only, so '\r' stays part of its line and CRLF files merge as written
 *   (document.ts). Nothing here schedules: the merged text is checked by the app's runner (6.5).
 * - **Per file, three-way on lines** with `node-diff3` (rule 1). Files present on some sides only
 *   (the table; "base, ours, theirs" says which sides have the file):
 *
 *   | Sides | Result |
 *   | --- | --- |
 *   | ours | ours, clean (added here, e.g. `Workspace.addFile`, 21) |
 *   | theirs | theirs, clean (added there) |
 *   | ours, theirs | equal texts: that text, clean; else `file` `added-twice`, holding ours |
 *   | base, ours | ours unchanged: **kept** with its base text, clean; else `file` `deleted-theirs` |
 *   | base, theirs | the mirror: kept with its base text, or `file` `deleted-ours`, holding theirs |
 *   | base | not in the result (no side has it) |
 *
 *   **Nothing is deleted** (8.1 #5, 21): a file one side deleted is never dropped from the result.
 *   The workspace cannot drop a file, so a merge never asks it to. What the sync controller does
 *   with a kept file (it is not written back) is sync/types.ts, "Files deleted on the provider".
 * - **Refinement** (rule 2). A conflicting hunk inside one task, resource or project block, or
 *   among a file's top-level statements (contract notes), is merged again statement by statement
 *   over the Lezer trees of all three texts. So is **every block both sides changed statements
 *   of** (a block as "The guarantee" defines it, in any layout: one-line bodies, `{` on its own
 *   line, tasks without ids), even where the line merge is clean (review rounds 3 and 4): which
 *   blocks those are is decided from the base tree, by mapping each side's changed line regions
 *   to the blocks they lie in or reach into, never from the text's layout (blocks.ts). Such a
 *   block merges cleanly only when every pair of the two sides' changes is provably independent
 *   under the keyword table (check.ts, G1); anything else makes it a conflict (G2): a task,
 *   resource, project or supplement body is then one conflict, a top level one conflict over what
 *   the two sides changed there, a declaration with its supplements one conflict from its first
 *   block to its last, and any other brace body an `attribute` conflict of the statement that
 *   owns it. Statements are
 *   matched across sides by their key: the keyword (with its scenario prefix, `delayed:effort`)
 *   and, for a block, its id, or for a task or resource without one its name and position among
 *   its siblings; the sizing criteria (`effort`, `duration`, `length`, `milestone`) match each
 *   other. Then:
 *   - a statement changed, added or removed on one side only merges cleanly; identical changes
 *     merge cleanly;
 *   - the same statement changed differently on both sides is one `attribute` conflict (a block
 *     edited on both sides is refined inside it in turn, else `block` `both-edited`);
 *   - a block deleted on one side and changed on the other is `block` `deleted-*`;
 *   - a block added on both sides with the same id is `block` `added-twice`, never a silent
 *     duplicate (rule 3); blocks with different ids added at the same place are one `block`
 *     `added-twice` conflict with `both` (their order is the user's choice, rule 4);
 *   - **additive statements merge** (rule 3; user, 2026-11-23): statements that add to each
 *     other (`depends`, `allocate`, `flags`, `booking` and the others tjp/merge/keywords.ts lists
 *     from TaskJuggler's list attributes and accumulating rules) that the two sides each added
 *     to the same block merge cleanly, ours first; identical additions are kept once. The same
 *     existing statement changed differently on both sides is still an `attribute` conflict;
 *   - **single-valued statements** (every other keyword, unknown ones included; the sizing
 *     criteria `effort`, `duration`, `length`, `milestone` are one value) added on both sides to
 *     one block, at the same place or not, are one `attribute` conflict: the merged block never
 *     says a value twice (TaskJuggler would keep the later one silently or with only an
 *     `attr_overwrite` warning); identical ones are kept once;
 *   - **items, not lines**: `depends` and `precedes` are keyed by target (`a` and `!a` are one
 *     target; one target with different gaps is an `attribute` conflict); `workinghours` by its
 *     set of weekdays (ranges expanded): sets that intersect are an `attribute` conflict, as a
 *     later `workinghours` replaces the hours of its days; disjoint sets keep both; `purge X` on
 *     one side with any change to `X` on the other is a conflict (the order decides what is
 *     purged); `extend` and `projectids` are single-valued; overlapping `booking`s and `shifts`
 *     merge and are left to the engine's checks.
 *   Refinement runs only where every side's region parses without error nodes; otherwise the
 *   hunk stays a line conflict (`text`, or `block` `both-edited` when it lies inside one block).
 *   A mismatch can only cost a conflict: it never gives a clean result that drops or doubles a
 *   side's change.
 * - **Never auto-pick a side** (rule 4). The merge resolves only what diff3 and rule 2 prove clean.
 * - **Laws** (13.1), for every file set and context: `merge(b, o, b).files` is `o` and
 *   `merge(b, b, t).files` is `t`, both clean, plus any file of `b` the other side lacks, kept
 *   with its base text (the table); `merge(b, x, x)` is `x`, clean. Swapping ours and theirs gives
 *   the same conflicts with their sides swapped (`deleted-ours` <-> `deleted-theirs`), at the same
 *   subjects. Every change made on one side only is in a clean result.
 * - **Stable ids.** `MergeConflict.id` is computed from: the file; the subject's kind with its
 *   `attr` or `change`; the region's character range in the **base** text (an empty range where
 *   the base has none); the region's **theirs** text; and, only to tell apart conflicts equal in
 *   all of those, their order. It never depends on ours, on positions in ours or in the merged
 *   text, or on an owner's id or name (ours may rename it). While a conflict waits, the base and
 *   theirs are fixed (store-types.ts `StoredConflict`), so a merge computed again from newer local
 *   text (8.3: "On Apply, the merge is computed again") gives the same id to the same conflict,
 *   and earlier choices carry over; only a local edit that widens the conflicting region gives it
 *   a new id. When theirs moves to a newer head, a conflict whose theirs text changed gets a new
 *   id, so no choice is applied to remote text the user did not see.
 * - **Cost** (rule 5; user, 2026-11-23). The whole merge at most 50 ms p90 on `fedora-res` on
 *   desktop with 20 edits per side, and no single step over 50 ms at 4x CPU. A step is a piece of
 *   `mergeFileSteps` between two pauses (it pauses after the line merge, every few hundred parser
 *   steps of each parse, and after refinement); a caller that must not block (the sync
 *   controller) runs the steps in separate tasks and assembles the result exactly as
 *   `mergeWorkspace` does. `mergeFile` and `mergeWorkspace` run the same steps without pausing.
 *   Passing ours' parsed files (`MergeContext.files`) saves a parse.
 * - **Pure.** No I/O, no clock, no randomness; safe in any task or worker. Where the steps pause
 *   depends on the work done, never on time, and the result never depends on how they are run.
 *   Recent parse trees are kept between merges (a cache keyed by context and text, invisible to
 *   callers).
 *
 * Contract notes (T3):
 * - `MergeConflict.both` is added: rule 3 offers "Keep both" for `text` conflicts and for blocks
 *   added on both sides with different ids, and the subject alone cannot tell different ids from
 *   the same id. It is true exactly for those two cases, except a `text` conflict whose two sides
 *   hold the same task or resource (a block reordered, wrapped or moved), where keeping both
 *   would declare it twice (T6 review, L1).
 * - `MergeConflict.atOurs` is added: "Edit…" opens the texts in the editor (8.3), which holds
 *   ours, and `at` is a position in the merged text.
 * - `MergeContext` is added to 6.4's signature: a `.tji` parses in the context of its include
 *   site (`task x { include "a.tji" }`), and an owner's full id needs the include's prefixes, so
 *   the merge needs the include graph. It takes ours' (the workspace's), for all three sides.
 * - Refinement also covers a file's top-level statements (owner kind `other`, id null), which
 *   6.4 rule 2 does not list. It applies rule 2's own test there, and 13.1's commutation property
 *   needs it: intents on two different top-level tasks can touch adjacent lines (an attribute
 *   appended before one task's `}` and a task added after it).
 * - "Keep both" puts ours' lines first, then theirs'. 13.1's commutation property holds for
 *   intents whose changes do not insert at the same place in the same parent; two adds there are
 *   rule 3's conflict, or for additive statements its clean ours-first merge.
 * - (T6 review, user 2026-11-23) Two new `depends` lines added on both sides merge (rule 3,
 *   additive statements); before, they were an `attribute` conflict without `both`.
 * - (T6 review) `MergeContext.files` (ours' parsed files, checked against ours' text; it
 *   replaced a `trees` map trusted on length, N7) and `mergeFileSteps` are added for the cost
 *   rule (rule 5).
 * - (T6 review round 3) Rule 2 also covers every block both sides changed statements of, decided
 *   from the base tree; `workinghours`, `purge`, `depends`/`precedes` targets, `extend` and
 *   `projectids` follow the item rules above (before, `extend` and `projectids` were additive,
 *   and two `workinghours` lines merged as additive). A task moved on one side (to another block
 *   or file) and edited on the other, whose id is not unique or which ours moved to another file,
 *   is a `text` conflict without `both`.
 * - (T6 review round 4) "The guarantee" (G1-G3) is added, and a block is any brace body, a
 *   declaration without one, the top level, and a declaration with its supplements in the file.
 *   `MergeConflict.only` is added: a task one side moved (its id not unique in the file, or to
 *   another file) and the other edited offers only the moving side's choice and Edit…, as the
 *   other would leave a second copy; `resolve` refuses the other side. `MergeContext.others` is
 *   added so a move to another file by either side is seen (also with a new full id, `t` to
 *   `q.t`).
 */
import type { Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import type { SourceRange } from '../tree';
import type { IncludeGraph } from '../../workspace/includes';
import type { WorkspacePath } from '../../workspace/paths';

/** Every plan file's text, by workspace path. */
export type Files = ReadonlyMap<WorkspacePath, string>;

/** What the merge needs besides the texts (contract notes). */
export interface MergeContext {
	/**
	 * Ours' include graph (`WorkspaceSnapshot.includes`). Each file is parsed on every side in the
	 * top context `includes.tops` gives it ('global' for a file it does not reach), and owners'
	 * full ids use the prefixes of the file's first visit. Other sides' include graphs are not
	 * known: a side whose file would parse in another context is parsed in ours' all the same,
	 * where its text then has error nodes, and those hunks stay line conflicts (rule 2).
	 */
	readonly includes: IncludeGraph;
	/**
	 * Ours' parsed files (`WorkspaceSnapshot.files`, each a `TjpFile`: its text and tree, parsed
	 * in the context `includes` gives); optional (T6 review N7). A file's tree is used only when
	 * its text is ours' text for that path (the same string, else equal text); otherwise it is
	 * ignored and the merge parses. It saves one parse per file (rule 5), and tells the merge
	 * which tasks ours declares in other files (a task moved to another file, review L4).
	 */
	readonly files?: ReadonlyMap<WorkspacePath, ParsedFile>;
	/**
	 * All three sides' files (T6 review round 4, L4), so the merge of one file sees a task or
	 * resource a side moved to another file: that side declares it there more often than the base
	 * does. `mergeWorkspace` passes them itself; a caller that assembles `mergeWorkspace`'s result
	 * from `mergeFileSteps` (the sync controller) passes them too. Without them, only
	 * ours' moves are seen, from `files`, as ours declaring it in another file at all.
	 */
	readonly others?: { readonly base: Files; readonly ours: Files; readonly theirs: Files };
}

/** A file as the workspace holds it (`TjpFile`'s text and tree). */
export interface ParsedFile {
	readonly text: string | Text;
	readonly tree: Tree;
}

/** The result of a workspace merge (6.4). */
export interface WorkspaceMerge {
	/**
	 * The merged text of every file the merge keeps (the table in the module comment): every path
	 * of ours and of theirs, and every base path that one side lacks. A file in conflict holds
	 * ours in each conflicting region (theirs for a `deleted-ours` file), so `files` is always
	 * valid input for the next merge.
	 */
	readonly files: Files;
	/** Empty when the merge is clean. By `file` (code-unit order), then by `at.from`. */
	readonly conflicts: readonly MergeConflict[];
}

/** sync/merge.ts (T6): `export const mergeWorkspace: MergeWorkspaceFn`. */
export type MergeWorkspaceFn = (
	base: Files,
	ours: Files,
	theirs: Files,
	ctx: MergeContext,
) => WorkspaceMerge;

/** One file's merge (`mergeFile`); a side is null where it has no such file. */
export interface FileMerge {
	/** The merged text; null when neither ours nor theirs has the file (the table). */
	readonly text: string | null;
	/** This file's conflicts, by `at.from`. */
	readonly conflicts: readonly MergeConflict[];
}

/** sync/merge.ts (T6): `export const mergeFile: MergeFileFn`, what `mergeWorkspace` loops over. */
export type MergeFileFn = (
	file: WorkspacePath,
	base: string | null,
	ours: string | null,
	theirs: string | null,
	ctx: MergeContext,
) => FileMerge;

/**
 * sync/merge.ts (T6 review): `export const mergeFileSteps: MergeFileStepsFn`, `mergeFile` in
 * steps (rule 5): each `next()` runs one step; the generator's return value is `mergeFile`'s.
 */
export type MergeFileStepsFn = (
	file: WorkspacePath,
	base: string | null,
	ours: string | null,
	theirs: string | null,
	ctx: MergeContext,
) => Generator<void, FileMerge, void>;

/**
 * The block a conflict is in, as the conflict view names it ("Build API, effort"). `id` is the
 * full id as the symbol index forms it (`TaskId`; a resource's own id, as resource ids are global;
 * the project's id), null when it
 * cannot be read (a macro, a syntax error) and for a file's top level (`other`). `name` is the name
 * as written, unquoted, or null. Read from ours where ours has the block, else theirs, else base.
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
	/**
	 * A whole block: deleted on one side and changed on the other, added on both, or edited on
	 * both where refinement cannot split it. For `added-twice` with the same id, `owner` is that
	 * block; with different ids (`both`), it is the block they were added in (`other` at top level).
	 */
	| {
			readonly kind: 'block';
			readonly owner: Owner;
			readonly change: 'deleted-ours' | 'deleted-theirs' | 'added-twice' | 'both-edited';
	  }
	/** A whole file (rule 1, the table in the module comment). */
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
	 * The region's text on each side, null where that side has none (deleted, or not there).
	 * - `text` and `block`: whole lines, each with its '\n' (a file's last line may lack one).
	 * - `attribute`: the statement from its first to its last character (`effort 5d`), without
	 *   indentation or line end.
	 * - `file`: the whole file.
	 */
	readonly base: string | null;
	readonly ours: string | null;
	readonly theirs: string | null;
	/**
	 * Where the region lands in the merged file, which holds ours there (theirs for `deleted-ours`);
	 * an empty range where that side has none (an attribute theirs added). `file`: the whole file.
	 */
	readonly at: SourceRange;
	/** Where the region is in ours' text (the workspace's), for "Edit…"; null without ours' file. */
	readonly atOurs: SourceRange | null;
	/** Whether `take: 'both'` is offered (rule 3; contract notes). */
	readonly both: boolean;
	/**
	 * The only side a choice may take, or null when both may be taken (T6 review round 4, L4). A
	 * task or resource one side moved (to another place in this file while its id occurs more than
	 * once here, or to another file) and the other side edited in place is a `text` conflict whose
	 * other choice would leave a second copy: `only` names the moving side ('ours': Take mine and
	 * Edit… are offered; 'theirs': Take theirs and Edit…). `resolve` leaves a conflict unresolved
	 * when it is given the other side.
	 */
	readonly only: 'ours' | 'theirs' | null;
}

/**
 * The user's choice for one conflict (6.4, 8.3): Keep mine (`ours`), Take theirs (`theirs`), Keep
 * both (`both`: ours' lines, then theirs'), or the region's text as the user wrote it ("Edit…"),
 * in the unit of the conflict's sides (`MergeConflict.base`); '' removes the region (for an
 * `attribute`, the statement, and its line when nothing else is on it).
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
 * `both`, and the side `only` does not name, leave it unresolved; for one id, the last resolution wins. An `attribute` theirs added
 * goes on its own line with the block's indentation (in a one-line body, on that line). **No choice removes a file**: on a `file`
 * conflict whose chosen side has no file (`theirs` on `deleted-theirs`, `ours` on
 * `deleted-ours`), the file keeps its base text, which the sync controller never writes back
 * (sync/types.ts, "Files deleted on the provider").
 */
export type ResolveFn = (m: WorkspaceMerge, r: readonly Resolution[]) => Files | Unresolved;
export interface Unresolved {
	readonly unresolved: readonly string[];
}

/** Tells `ResolveFn`'s two results apart. */
export function isUnresolved(r: Files | Unresolved): r is Unresolved {
	return !(r instanceof Map);
}
