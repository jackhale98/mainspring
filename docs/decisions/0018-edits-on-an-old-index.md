# ADR-0018: Edits planned on an old index: resolve in the dispatcher, or refuse

Status: Accepted, 2026-11-19 (approved by the user as written, to run now as task T27, ahead of the
workload items). On 2026-11-19 the user chose the direction: fix edits planned on a stale index in
the shared edit layer, not in each component.
Source: the read-only audit of 2026-11-19 and the reviewer's recommendation, both checked against
the tree on `claude/new-session-6tly46`; ADR-0008; `docs/phases/phase-2.md` 6.8;
`docs/phases/phase-3.md` 6.6, 6.8, 7.1.

## Context

- **The index lags the text.** Every change bumps the workspace version at once. The index is
  derived later, in idle tasks (`schedule-runner.ts` 35-47, `run-types.ts` 8-17). `run.indexVersion`
  trails `run.version`:
  - by up to about 4 s on a slow WebKit runner;
  - until the next change when a derive step throws. `#indexFailed` (`run-derive.ts` 137, 245,
    297-298, 343) then keeps the old view.

  `app.index` and `app.outline` are both read from that published index (`app.svelte.ts` 209-223).
- **The dispatcher plans on the fresh index, but views send targets read from the old one.**
  `prepare()` calls `ensureIndex()` (`edits-plan.ts` 68) and replans only when the text moves while
  it plans (`stale`, 94-95, 107; `MAX_PLANS` 3, `edits.svelte.ts` 126, 314-333). The targets inside
  an intent come from what the view showed.

  The audit's findings, checked:

  | Target kind | Intents | Where it goes wrong today |
  | --- | --- | --- |
  | Id | `setAttr`, depends, allocations, renames, deletes; health fixes, the depends picker, inspector fields, lanes, rebalance | Refused (`unknown-target`) when the id is gone. Safe, but the action is lost. (See finding 1 below.) |
  | Range | `updateLeave`, `removeLeave` | `findItem` matches by exact range (`calendar-leaves.ts` 167-184, 172). An old range is refused, or names **another item** when that item now sits exactly there. |
  | Position | `moveTask`, `addTask`, `moveResource`, `addResource` | **Wrong edits:** `reorder` runs `stepTarget` on `app.outline` with no wait (`interactions.svelte.ts` 346-354, tree at 103-111). `moveTo` (row drop, `row-drag.svelte.ts` 215) passes parent and index from the shown tree with no guard (357-366). `add` (389-399) and `commitAdd` (`resource-table.svelte.ts` 214-236, `addSpot` at 218) place from the outline. |

- **Per-component patches so far.**
  - Three copies of a polling wait (50 tries of 30 ms, about 1.5 s) that go on with old data when
    they time out: `Calendar.svelte` 220-226, `ResourceLeaves.svelte` 78-84 and
    `resource-table.svelte.ts` 113-120.
  - `ResourceTable.step` waits on `#fresh` (105eb230).
  - `regroup` refuses a drop when the shown version differs. It waits first (167, then 170), so it
    refuses every drop made while the index lagged, whether or not the change was related.
  - `LeaveCard` holds changes while `stale` and disables Remove (1a914cc5, dc4cbf85).
  - Cards are keyed by `file:from` (`ResourceLeaves.svelte` 115, `DayDetails.svelte` 95-96). That
    key shifts when an earlier item changes length, and the remount silently drops a queued change.
- **What the audit missed** (found while checking it):
  1. **Ids are not always safe.** Two id-changing changes inside one lag can hand an id to another
     task. Example: rename task `a` to `c`, then `b` to `a` (or Redo twice). An inspector still
     showing the old `a` then edits task B.
  2. **No Undo or Redo is needed for the position bug.** Three quick Alt+Shift+Up presses plan the
     second and third on the outline from before the first press.
  3. **Strokes have the range bug too.** Calendar strokes plan `updateLeave` from ranges
     (`paint.ts` 283). Only the polling wait protects them.
  4. **`addSpot` falls back silently.** It puts a task at the end of the plan when its anchor is
     not in the tree (`gantt/add-task.ts` 37-41). On a stale tree, "anchor gone" therefore becomes
     "add at the end".
  5. **The proposed name is taken.** A refusal reason `stale` already exists, with its own meaning
     ("the text moved while planning; plan again") and copy (`strings.ts` 185). The new reason needs
     another name.
  6. **Display only:** `app.outline` reads the names of unresolved declarations from the text now,
     using ranges from the index's version (`app.svelte.ts` 215-221).
- **The change history already exists.** `Workspace.changesSince(version)` (`workspace.ts` 304-315)
  composes, per file, every `commit` and `apply` since a version: typing, intents, format, and undo
  and redo, which apply through `apply`. It keeps 10,000 log entries, and a version older than that
  throws `RangeError` (330-337). Selection, the inspector (`inspector/range.ts`) and toasts
  (`edits-settle.ts` 123-133) already map ranges through it. Nothing new is needed for mapping.

## The reviewer's recommendation, evaluated

1. **Version the range and position intents (`basedOn`) and resolve them in `prepare()`.** Adopted,
   with four changes:
   - **Extended to ids** (finding 1), through a version the dispatcher stamps itself, so most call
     sites do not change.
   - **Ranges use the untouched-span rule, not outward mapping.**
     - An item rewritten in place has other text. `planLeaveEdit` builds `to` partly from the old
       item's written start and end (`leave-edit.ts` 155-166), so applying it to the new text writes
       a mix.
     - Outward mapping also takes in text inserted at an item's edge, such as the `, annual …` a
       paint appends. The range then matches nothing, so the common case would be refused.
     - The one legitimate "replaced in place" case is a card's own last edit. The card follows that
       itself (decision 5).
   - **The new refusal is `target-changed`**, because `stale` is taken (finding 5).
   - **Relative steps become view planners that the dispatcher runs**, not new `EditIntent`s.
     - The history and `renamedBy` (`edits-plan.ts` 176-185) need the concrete `moveTask`.
     - New `GanttAction` members would pull `reorder.ts` and `add-task.ts` into the Text-first load.
2. **One shared freshness helper instead of the three polling copies.** Not adopted.
   - Once the dispatcher resolves every target, no edit path needs to wait.
   - A wait without a time-out hangs when deriving throws (`#indexFailed` keeps the index old until
     the next change). A wait with a time-out is today's silent fall-back.
   - The three copies are deleted and nothing replaces them. If a later view needs "the shown index
     is current" for display, it gets a promise then, with no time-out fall-back.

## Decision

1. **A target travels with the version it was read in.** On the text now, the dispatcher either
   resolves it to the same logical target or refuses it with `target-changed`. It never plans a
   different target.
   - "Same logical target" means:
     - for a range, the same characters (an untouched span);
     - for an id, the same declaration;
     - for a position, the same neighbours under the same parent.
   - When `basedOn` equals the fresh index's version, nothing extra runs. That is the common case.
2. **Three checks in `prepare()`, after planning and before `applyIntent`.** They run for every job
   whose `basedOn` is older than the fresh index. Each needs the changes since `basedOn`
   (`changesSince`; a `RangeError` means refuse).
   - **Ranges** (`LeaveRef`). A changed range that overlaps the open interval (from, to), or an
     insertion strictly inside it, means **touched**, which means refuse. Changes that only meet the
     item's ends do not count. Otherwise the item maps to `(mapPos(from, 1), mapPos(to, -1))`, which
     holds the same characters. The ref is rewritten with `basedOn` set to the fresh version, and
     `findItem`'s exact match then finds it.
   - **Subject ids** (`subjectsOf(intent)`, an exhaustive switch over every id an intent acts on,
     except `parent`):
     - an id missing from the fresh index is refused `unknown-target`, as today;
     - if nothing that can change ids happened since `basedOn`, the id passes;
     - otherwise it passes only when the declaration's `block.from` in the shown index maps exactly
       onto the fresh declaration's `block.from`, else it is refused;
     - an id absent from the shown index passes (the view took it from an edit's outcome, for
       example the task just added).

     Changes that can change ids: `addTask`, `deleteTask`, `addResource`, `deleteResource`,
     `gapToTask`, a `renameTask` with `id`, a `moveTask` to another parent, and typing. An undo or
     redo is classified by its history entry's intent. A change that cannot be classified counts as
     id-changing.
   - **View-built positions** (`parent`, `index` on the four positional intents, from a drop or any
     view-computed place). They pass when three things hold:
     - the parent passes the id check;
     - the parent's children, as the edit API counts them, are the same ids in the same order in the
       shown and the fresh index;
     - the moved item is left out of that comparison.

     Otherwise the intent is refused.
   - **The shown index.** The dispatcher already subscribes to runner states. It keeps the published
     index for each of the last 4 published index versions. A check that needs a shown index which is
     no longer kept refuses.
3. **Relative commands are planned on the text now (`dispatchPlan`).** A view that needs the current
   tree to decide passes a pure planner. The dispatcher calls it on the fresh index on every plan, and
   on the gesture's base for a coalesced call.
   - **Gantt:** Alt+Shift+arrows and the row menu's Up, Down, Indent and Outdent become
     `stepTaskPlan`; Insert, Ctrl or Cmd+Enter, the row menu's Add and the toolbar + become
     `addTaskPlan`.
   - **Resources:** W6 keys and menu become `stepResourcePlan`; W7 + becomes `addResourcePlan`.
   - **Calendar:** W3 and W4 strokes become `paintPlan`.
   - **Leave cards:** a card's changes become `leaveEditPlan`.
   - **At an edge**, the view still checks the shown tree first and announces "It cannot move that
     way." as today, without dispatching. When the shown tree allows the step but the fresh one does
     not, the planner returns `unchanged` with that sentence, which shows as a short no-op toast or
     strip.
   - **An anchor that is gone, or no longer the same task** (`on.isSame`), is refused. It never
     falls back to "end of plan" (finding 4).
4. **Views stop waiting.** The three `fresh()` copies go. `regroup`'s version refusal and
   `R.table.changedMeanwhile` go. The `stale` and `lags` props of `LeaveCard`, `DayDetails` and
   `ResourceLeaves` go.
5. **A leave card follows its own edit.**
   - Every commit is sent at once as `leaveEditPlan(ref, fields)`. The planner maps `ref` and plans
     against the item as the fresh index shows it, so "unchanged" and the written forms are judged
     against the text now.
   - Only while the card's own dispatch is in flight are changes merged. They go out when its outcome
     arrives:
     - after an applied edit, on the rewritten item (`edit.select` at `outcome.version`, which
       `CommitResult.ref` carries);
     - otherwise, on the card's current item.
   - The 2,500 ms timer, `lapsed`, the "Waiting…" note and the disabled Remove go. Remove is disabled
     only while a dispatch is in flight.
   - Nothing waits for an index publish, so a remount cannot drop a change. The only window left is
     the user closing the details while a dispatch is in flight. Blur commits fire before the unmount.
6. **One new refusal reason, `target-changed`, in the edit API's `RefusalReason`.**
   - `applyIntent` also refuses a `LeaveRef` whose `basedOn` is not `ctx.index.version`. This is the
     safety net for a direct caller.
   - Its `at` is the old range, located at `basedOn`, so "Show in text" goes to where that range is
     now.

## Intent contract

```ts
// src/lib/tjp/edit/types.ts
export interface LeaveRef {
	readonly item: SourceRange;
	/** The workspace version `item` was read in (the index's `version`). Required. */
	readonly basedOn: number;
}
export type RefusalReason = /* … */ | 'target-changed';

// src/lib/state/edits-types.ts
export interface DispatchOptions {
	/* … */
	/**
	 * The index version the view read its targets in. Default: the published `indexVersion` when
	 * `dispatch*` is called. A call made again after an answer passes the outcome's `basedOn`.
	 */
	readonly basedOn?: number;
}
export type ActionDispatchOptions =
	Pick<DispatchOptions, 'coalesceKey' | 'confirmShared' | 'defer' | 'basedOn'>;
export type DispatchRefusal = ActionRefusal | 'unprepared' | 'planner';
//   'confirm-shared' and 'ask-move-preference' outcomes gain `readonly basedOn: number`.

/** What a planner reads: the text now and its index (`index.version === snap.version`). */
export interface PlanBase {
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	/** The outline of `index`, built at most once per index. */
	outline(): Outline;
	/** `r`, read in version `basedOn`, in the text now; null when touched (decision 2). */
	mapRange(r: SourceRange, basedOn: number): SourceRange | null;
	/** Whether `id` names the same declaration as in the call's `basedOn` (decision 2). */
	isSame(kind: 'task' | 'resource', id: string): boolean;
}
export type ViewPlanned =
	| { readonly status: 'intent'; readonly intent: EditIntent; readonly label: ToastLabel;
	    readonly constraint?: boolean }
	| { readonly status: 'unchanged'; readonly message?: string }
	| { readonly status: 'not-possible'; readonly message: string; readonly at: readonly SourceRange[] };
/** Pure: reads only `on` and the plain data it was made from. Called on every plan of the call. */
export type ViewPlanner = (on: PlanBase) => ViewPlanned;

// EditDispatcher (edits.svelte.ts); Job gains kind 'plan'.
dispatchPlan(plan: ViewPlanner, o?: Omit<DispatchOptions, 'label'>, preview?: PendingMark):
	Promise<DispatchOutcome>;

// src/lib/state/outline.ts, src/lib/calendar/paint-items.ts
interface Outline   { /* … */ readonly version: number } // the index version it was built from
interface PaintItem { /* … */ readonly version: number } // the index version `range` is in
```

- **Planner factories** are pure, take plain data only, and live in the lazy chunk of their view:
  - `stepTaskPlan(task, step)` and `addTaskPlan(anchor | null, mode, name)` in `src/lib/gantt/`;
  - `stepResourcePlan(id, step)` and `addResourcePlan(selected | null, kind, name)` in
    `src/lib/resources/`;
  - `paintPlan(stroke, result, zones)` in `src/lib/calendar/run.ts`;
  - `leaveEditPlan(ref, fields)` and `leaveRemovePlan(ref)` in `src/lib/calendar/leave-edit.ts`.

  They reuse `stepTarget`, `addSpot`, `planRegroup`, `planLeavePaint` and `planLeaveEdit` unchanged.
- **What a view passes:**
  - **id intents:** nothing new; the stamp is enough;
  - **drops:** `basedOn: outline.version`, because the tree under the pointer is the basis;
  - **leave refs:** `{ item: item.range, basedOn: item.version }`;
  - **retry loops** (`gantt/actor.svelte.ts`, `inspector/actions.ts`, `calendar/run.ts`,
    `rebalance-adapter.ts`): the first outcome's `basedOn`.
- **After a step or an add**, the focus follows the outcome's concrete intent (`renamedBy`), not the
  view's guess.
- **Unchanged:** the `GanttAction` union and `planAction` (intents.ts 37, "add members; do not
  change").

## Refusal copy

- `refusalStrings['target-changed']` in `strings.ts`, which the first load needs because the
  dispatcher is there: "That part of the plan changed before this edit was made. Nothing was
  changed; check it and try again."
- Planner refusals keep their own sentences, in their view's strings module (`R.table.nowhere`, the
  paint messages).
- Removed: `R.table.changedMeanwhile` (`strings-resources.ts` 40) and `C.details.waiting`
  (`strings-calendar.ts` 102).
- `gestureStrings.live.noPlace` (`strings.ts` 440) stays.

## Undo, redo and coalescing

- **Undo and redo are unchanged** (ADR-0008). They apply inverse change sets with version checks and
  never re-plan.
  - What the history records is the concrete, resolved intent: a mapped `LeaveRef`, or the
    `moveTask` a step became. Labels, `renamedBy` and `pending.renames` work as now.
- **An undo or redo is a change like any other** in `changesSince`.
  - An item an undo rewrote counts as touched.
  - A change followed by its undo composes into a replacement of the same text, so it also counts as
    touched. This is conservative: it refuses, it never misdirects.
- **Coalescing (`COALESCE_MS` 300, nudge bursts) is unchanged.**
  - The checks apply to a gesture's first call. Its later calls name the same target and plan on
    `g.base` after `#unwind` (`edits.svelte.ts` 340-365).
  - Step commands are not coalesced: each press is one undo step, as today. Three presses now make
    three steps.
- **The `stale` re-plan (`MAX_PLANS` 3) is unchanged.** Each re-plan maps again from the same
  `basedOn`.

## First-load JS caps (gzip; Visual 330,000, Text 440,000, total 650,000)

- **Headroom is thin.** The last figures recorded (`phase-3-gate.md` 145-148) are Visual-first
  327,865 (2.1 KB headroom) and Text-first 439,222 (0.8 KB).
- **First-load additions:** the three checks, the index ring, `dispatchPlan`, the `PlanBase` helpers
  and one sentence. Target: at most 700 bytes gzip on each first load.
- **Lazy chunks:** the planner factories live in the Gantt, Resources and Calendar chunks. What
  those chunks lose (three waits, the card's timers) offsets them there.
- **If Text-first does not fit** without raising a cap, the fallback is to move the range and
  position checks into the planners of the lazy views that produce those intents. The edit API's
  `basedOn` refusal stays as the safety net. The user is asked before any cap changes.
- **Measured** with `js-sizes.mjs --serve`, before and after, in the gate file.
- **Amendment (user, 2026-11-19):** T27a and T27b measured about 1,360 bytes gzip on each first load,
  over the 700-byte target; the user accepted it. The caps are unchanged.

## Tests

- **Unit, edit API** (`calendar-leaves.test.ts`, `types.test.ts`):
  - a `basedOn` mismatch is refused `target-changed`;
  - `updateLeave`'s `select` equals the rewritten item's range in the next index, on every leave
    fixture.
- **Unit, the checks** (`src/lib/state/edits-rebase.test.ts`).
  - **Ranges:**
    - an insertion before, after, or exactly at either end of the item;
    - a deletion that ends at `from`;
    - a replacement inside the item, and a replacement covering it;
    - an edit and its undo;
    - a version below the log floor.
  - **Ids:**
    - the rename chain (`a` to `c`, `b` to `a`) is refused;
    - a same-parent reorder followed by `setAttr` passes;
    - an id taken from an add outcome passes;
    - a shown index no longer kept means refuse.
  - **Positions:** an unchanged child list passes; a reordered or renamed sibling refuses.
- **Unit, the dispatcher** (`edits.svelte.test.ts`, `edits-gestures.test.ts`):
  - a planner runs on the fresh base on each re-plan, and on `g.base` for a gesture;
  - only a gesture's first call is checked;
  - `basedOn` round-trips through `confirm-shared` and the move question;
  - a call with no `basedOn` gets the stamp.
- **Unit, the planners**, beside each factory:
  - steps at the edges and past unresolved siblings;
  - a gone anchor is refused, not sent to the end;
  - a leave edit then its reverse at once leaves the original text.
- **Component** (`LeaveCard.svelte.test.ts`):
  - two quick changes both land;
  - a change made while a dispatch is in flight goes out on the rewritten item;
  - a remount between changes loses nothing;
  - Remove works while the index lags.
- **Property** (`edits-rebase.property.test.ts`, fast-check over the existing arbitraries):
  - a plan made on version v0 with a random target (a leave item, a slot, an id) is followed by a
    random mix of intents, undo, redo and typing up to vN;
  - **safety:** it either refuses, or resolves to the same logical target, checked with markers
    (unique names, and byte-identical item text);
  - **liveness:** when nothing touched the target (its span, or the parent's child list), it
    resolves.
- **e2e** (`tests/e2e/stale-index.spec.ts`, merge tier, desktop Chrome, Pixel 7 and iPhone 14).
  - **Holding the index.** The specs assert on the text through `__mainspringEdits.text()`, not on
    copy. `__mainspringEdits` gains `holdIndex()` and `releaseIndex()`.
    - With `?hooks=edits`, `AppState` passes the runner a `timers.requestIdle` that queues while
      held.
    - Production pages build the runner exactly as now.
    - `ensureIndex` is synchronous, so the dispatcher still sees the fresh text.
  - **Alt+Shift+Up right after Redo, in the Gantt** (on phones, the row menu's Move up). The task
    ends one place above where the text had it. A second case: three quick presses make three places.
  - **A row drop right after Undo:**
    - when the undo reordered the drop's parent, the drop is refused and the text is the post-undo
      text;
    - when the undo changed another part, the drop lands in the slot that was shown.
  - **A leave edit after a rename, with the index held.** The fixture has two leave items of one
    resource, of equal length. The resource's name grows by exactly one item plus `, `, so the old
    range of the second item becomes the new range of the first. Editing the second item's end
    rewrites the second item only.
  - **More leave cases:** two quick changes to one leave both land, and Remove removes the right
    item while the index lags.
  - **Resources:** Alt+Shift+Up (phones: the menu) right after Undo in the resource table.
  - **The bug is shown first.** Each reproduction is run on the commit before the fix and must fail
    there. That run is recorded as evidence.
- **Screenshots:** a phone-emulation screenshot (Pixel 7 and iPhone 14) of the `target-changed`
  strip and of a leave card while the index lags.

## Owners, order and effort

| Task | Owner | Files | Depends on | Effort |
| --- | --- | --- | --- | --- |
| T27a Interface: the types above, contract comments, the string | `grammar-specialist` | `tjp/edit/types.ts`, `state/edits-types.ts`, `state/edits.svelte.ts` (contract), `state/outline.ts`, `calendar/paint-items.ts`, `strings.ts` | Approval | 0.5 d |
| T27b The checks, the index ring, `dispatchPlan`, the edit API's refusal, the planner factories | `grammar-specialist` | `state/edits-plan.ts`, new `state/edits-rebase.ts`, `tjp/edit/apply.ts`, `calendar-leaves.ts`, `gantt/*-plan.ts`, `resources/plans.ts`, `calendar/run.ts`, `calendar/leave-edit.ts` | T27a merged | 2 to 2.5 d |
| T27c Unit and property tests; hold hook; e2e reproductions (written first, failing on the old commit) | `test-writer` | Beside each module; `state/edit-hooks.ts`, `app.svelte.ts` (test-only wiring), `tests/e2e/stale-index.spec.ts` | T27a; the specs alongside T27b | 2 d |
| T27d Views: Gantt steps, add and drop; resource table; Calendar; `ResourceLeaves`; `LeaveCard`; retry loops; waits removed; screenshots | `ui-builder` | `components/gantt/*`, `components/resources/*`, `components/calendar/*`, `components/inspector/ResourceLeaves.svelte`, `components/workload/rebalance-adapter.ts`, `lib/inspector/actions.ts` | T27b merged | 1.5 d |
| T27e Review with reproduction: the e2e reproductions on both commits, plus the property test | `reviewer` | Read-only | T27b to T27d | 0.5 d |

- About 6.5 agent-days. Two tracks at most: T27b with T27c, then T27d with the e2e work in T27c.
  About 4 working days end to end.
- T27a merges first, so that no consumer builds on a guessed interface.

## Risks

- **Over-refusal.** The touched rule refuses an item that an undo restored byte for byte, and a drop
  whose parent gained an unrelated child. The liveness property bounds it, the copy says to try
  again, and the view catches up within seconds.
- **A planner that reads view state** brings the bug back. Mitigations:
  - factories take plain data only and are unit-tested with data only;
  - the reviewer checks each call site;
  - `PlanBase` is the only state a planner gets.
- **Memory** for four kept indexes on `fedora-res`. Measure the heap with the gate spec; keep two if
  it costs more than 5 MB.
- **Classifying history entries as id-changing.** An entry that cannot be classified counts as
  id-changing, which only adds declaration checks.
- **Leave scope.** An untouched item keeps its characters. If typing changed which resource
  encloses it, the edit still changes those characters, and the label names the owner the view
  showed.
- **Behaviour change.** A step follows the text now, not a lagging screen. A drop on a lagging screen
  is refused only when its parent's children changed.
- **First-load bytes** (Text-first headroom 0.8 KB): see the fallback above.

## What does not change

- ADR-0008: one undo stack, inverses and version checks, toasts, `COALESCE_MS` 300 and gesture
  semantics.
- The `stale` re-plan.
- The workspace and its change log, and the runner's contract (`indexVersion` still lags;
  `ensureIndex` is unchanged).
- Every edit intent except `LeaveRef`, every handler and every patch, so golden parity and the engine
  (`engine/tj/`, the bridge).
- `GanttAction`, `planAction` and `checkAction` dry runs.
- The text editor.
- The JS caps.
- Text-only rules and the `shared-declaration` confirmation.

## Fit with the plan, and conflicts for the user to confirm

1. **Scope.** This is not a task in `docs/phases/phase-3.md`. It is proposed as T27. The priority
   note (CLAUDE.md, 2026-11-16) lets bugs jump the queue, and these are wrong edits. Recommendation:
   run it now, before the open workload items and the rest of the ADR-0016 pass. Slow WebKit makes
   the lag routine on iPhone 14, so the polling waits are also a likely flake source.
2. **The branch's stopgaps.** `LeaveCard`'s `stale` gating (1a914cc5, dc4cbf85, on this branch) and
   105eb230 are safe. Recommendation: merge them as they are; T27d removes them.
3. **Phase 2, 6.8 (the dispatcher's contract).** It gains `dispatchPlan`, `basedOn`, the
   `target-changed` and `planner` refusals, and `basedOn` on two outcomes. All of this is additive
   apart from the new defaults.
4. **Phase 1, 6.5, and `types.ts`.** "`LeaveRef` names a leave by its item range" becomes a range
   plus a required `basedOn`. Every caller is in the repo. `moveTask(taskId, newParentId, index)`
   (build plan, line 190) is unchanged.
5. **Phase 3, 6.8, and ADR-0013.** "The Add task control uses the existing `addTask` through
   `app.edits.dispatch`". It still ends as `addTask`, at the same three positions. The positions are
   now worked out by a planner on the text now. That planner refuses a gone anchor instead of adding
   at the end.
6. **Phase 3, 6.6 and 7.1 (W3 to W6).** `planLeavePaint` and `planRegroup` keep their signatures.
   The dispatcher now calls them on the fresh index, through planners. W5's card no longer waits
   while the index lags. W6's drop refusal now depends on the parent's children, not on any lag.
7. **The reviewer's "new `stale` reason".** It is named `target-changed`, because `stale` already
   means "plan again" (finding 5).
8. **Display finding 6 (`app.outline`'s unresolved names)** is outside this decision. It is a
   three-line fix (map through `currentRange`). Fold it into T27d, or list it separately.
