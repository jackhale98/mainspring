# Phase 3: Resources, workload and plan health

Status: **draft for the user's approval**, 2026-11-14. Sources:
- `docs/BUILD_PLAN.md`: "Phase 3"; "Planning best practices the app builds in"; "Product scope" (Resources, Workload, Plan health); "UX and interaction design" (views 2 to 4, direct manipulation "Rebalance load", gesture rules, layouts, design system); "Performance budgets"; "Architecture" (engine worker, edit pipeline, rendering); "Testing and quality"; "Claude Code execution plan".
- `docs/phases/phase-2.md`, especially 6.2, 6.6, 6.8, 7, 8, 9.3, 18.3, 18.9, 18.10 and 19.9.
- Phase 2 as built: `phase-2-gate.md` (T6 timings), `phase-2-test-audit.md`, `phase-2-perf-a11y.md` (T22, T23), `phase-2-polish.md`, `docs/backlog.md`.
- ADR-0007, ADR-0008 (with amendments), ADR-0010, ADR-0012.
- Code: `src/engine/protocol.ts`, `engine/bridge/serialize.rb`, `engine/tj/lib/taskjuggler/ResourceScenario.rb` (read only), `src/lib/tjp/index/types.ts`, `src/lib/tjp/edit/types.ts`, `allocation.ts`, `calendar-leaves.ts`, `task-place.ts`, `src/lib/state/edits.svelte.ts`, `app.svelte.ts`, `src/lib/schedule/critical.ts`, `src/components/app/{TabBar,PlanChip}.svelte`, `GanttToolbar.svelte`, and the golden manifest.
- The user's addition of 2026-11-14 on authoring on phones (section 9.8, ADR-0013 stub in Appendix A).

Section 18 lists the open questions, each with a recommended answer. Section 19 lists the conflicts with the build plan. This spec does not settle any of them silently.

## 1. Scope

| In scope | From |
| --- | --- |
| **Authoring on phones** (an early, small track): an Add task (+) control with "Add subtask", "New plan…" in the plan chooser, and empty states | User, 2026-11-14 (out of the original scope: ADR-0013, 18.11) |
| **Workload heatmap**: people (rows) by day, week or month (columns), hours or percent per cell, group rows that roll up their members, adjustable thresholds, a drill-in to the cell's tasks | Phase 3 bullet 1; Views 3; best practice "Watch capacity"; Product scope Workload (MVP) |
| **Drag to rebalance**: drag a task from a cell (or from a lane) to another person or another week. The drop becomes `replaceAllocation`, or a move as in Phase 2's R2 | Phase 3 bullet 1; direct-manipulation row "Rebalance load" (R7's gesture, deferred by phase-2 18.3) |
| **Resources view**: one lane per person, assignments as bars, leaves as hatched blocks, overload marked in red on the lane | Phase 3 bullet 1; Views 2 |
| **Calendar view**: holidays, leaves and milestones by month; paint leaves by dragging across days | Phase 3 bullet 1; Views 4; Product scope Resources (leaves and holidays, working hours) |
| **Resource table and groups**: add, rename, delete and regroup people; a person details sheet (efficiency, rate, email, managers, working hours, leaves) | Phase 3 bullet 1; Product scope Resources (MVP); phase-2 18.9 |
| **The rest of the project settings sheet**: global working hours, `dailyworkinghours`, `weekstartsmonday`, `timeformat`, `currency` | Phase 2 19.9 ("the rest of the project frame is Phase 3") |
| **Plan health panel**: the checks in section 12, each with a sentence, its place in the text and one-tap fixes where the plan names one | Phase 3 bullet 2; best practices; Product scope Plan health (MVP) |
| **"Why is this here?"**: why a task starts (ASAP) or ends (ALAP) where it does, and why its bar has gaps (dependency, busy person, leave, working time, constraint, project frame, possible limit) | Phase 3 bullet 2; best practice "Review leveling output"; ADR-0007's `unexplained` driver |
| **Gantt filter by person and by flag** | phase-2 18.10, accepted ("Filters in Phase 3 with people") |
| **Engine data**: bridge schema v3 (resource availability and leaves, project leaves, week start, requested allocations), with golden re-record and a native cross-check of weekly load | Architecture ("resource load per day"); the gate |
| Phone, tablet and desktop layouts, light and dark; the phone tab bar gains **People** | Layouts; phase-2 19.18; CLAUDE.md "Mobile counts" |

## 2. Non-goals

- **No v1 resource features** (Phase 5): placeholders and the swap-in action, shifts editing, limits editing or "limits shown as caps", allocation alternatives, `select`, `mandatory` and `persistent`. The engine's numbers already include shifts and limits, because they come from TaskJuggler's scoreboard. In the views these features stay text-only:
  - an allocation with a body (`allocate a { alternative b }`) is refused as `unsupported-form`, with "This allocation has alternatives. Edit it in the text."
- **No scenario switcher.** Every view draws the first active scenario, as the Gantt does.
- **No skills tags, "find someone free", cross-project pools or utilisation summary per group** (Later and v1 columns). A group row is a roll-up. It is not a summary panel.
- **No custom health checks** (Later), and no health checks that need tracking (status date, behind schedule: Phase 5).
- **No storage.** A new plan lives in the tab (ADR-0013). Saving is Phase 4.
- **No change to `engine/tj/`.** Everything new in the engine is bridge code.
- **No new runtime dependency.** The heatmap and lanes use the Phase 2 canvas approach. The calendar and the tables are DOM.
- **No computed schedule.** Load, availability, causes and health findings are display data derived from the engine result (ADR-0007, extended by ADR-0014). They are never sent to the engine and never become a task's date.
- **No "what-if" preview of the new load during a drag.** The drop shows a pending ghost. The hours change when the engine answers (5.2).
- **No real-device run** (Phase 6). Phone figures come from emulation, as in Phase 2's waiver (section 8.5).

## 3. Starting point

- **Engine (schema v2).**
  - `bookings` already holds every scoreboard allocation per scenario, resource and task, as merged `[start, end)` minute intervals: exact slots, user `booking`s included.
  - `ResourceResult` has `group` and `efficiency` per scenario, and nothing else.
  - `ProjectInfo.workingTime` is the global working time.
  - What is missing: each person's own available time (their working hours or shifts, minus global and personal leaves), leave intervals by type, the project's `weekstartsmonday`, and the requested allocations after inheritance.
  - 29 of the 40 golden plans have bookings. **`upstream-fedora-20` declares no resources: its `resources` and `bookings` are empty** (19.1).
- **TaskJuggler's resource scoreboard** (`ResourceScenario.rb:830-910`, read only). A slot holds one of:
  - `nil`: free working time;
  - a `Task`: booked;
  - an Integer: bit 1 means off hours, and bits 2 to 5 hold the leave type index (`LeaveList::Types`: project 1, annual 2, special 3, sick 4, unpaid 5, holiday 6, unemployed 7).

  `getWorkSlots` counts `nil` and `Task` slots. A resource is never booked twice in one slot (`book` refuses a slot that is not `available?`). Only a user `booking` with `overtime` can book off hours or leave (`bookBooking`, 221-258). This shapes what "over" can mean (5.4, 18.3).
- **Edit API.** These intents exist, are tested in the fidelity suite and take 3 to 8 ms at p90 on Fedora+res (T6 table):
  - `allocate`, `addAllocation`, `removeAllocation`, `replaceAllocation`;
  - `addResource`, `deleteResource`, `moveResource`, `renameResource`, `setResourceAttr`, `removeResourceAttr`;
  - `setWorkingHours` (project or resource scope);
  - `addLeave`, `updateLeave`, `removeLeave` (global or resource scope; a `vacation` interval reads as `holiday`);
  - `addTask`, which places a root at the end of the entry file when there are no siblings (`task-place.ts`).

  The index has `resources`, `allocations`, `leaves` and `workingHours` sites.
- **Dispatcher, history and phone patterns (Phase 2 as built).**
  - `EditDispatcher.dispatch` and `dispatchAction` give one undo step per edit, a toast (a quiet message strip on phones, with no success toasts), `refused` with a sentence and "Show in text", and `confirm-shared`.
  - Coalescing sends cumulative totals per `coalesceKey`. A burst ends on Enter, on blur or after 1.2 s, and is one undo step.
  - Phones have Undo and Redo in the top bar with a History sheet, and the status button in the top bar.
  - On phones and tablets, a tap selects and a second tap opens the details.
- **Analysis.** `analyse` gives drivers, the critical path and float. A start that the dependencies do not explain is `{ kind: 'unexplained' }`, and the inspector says "Held by resources or calendars". That is the hook for 6.3.
- **App shell.**
  - Plans open only from the built-in samples (`PlanChip`, a native `<select>`).
  - Adding a task needs a selected row, then the row menu (`...`, Add) or Insert. An empty plan has no visual way to add its first task.
  - A header-only plan gives the engine error `no_tasks` (`bridge-header-only`).
- **Budgets carried in.**
  - JS total: 424,010 of the 450,000-byte gzip cap, so about 26 KB of headroom.
  - Phone emulation is paint-bound: the T22 Gantt scroll is about 64% on time at 4x CPU. About 55% of main-thread time goes to style, layout and paint, and much of it to the DOM treegrid rows and `getClientRects` (polish item 12).

## 4. Module layout

```text
engine/bridge/serialize.rb               # schema v3 fields (6.1)
engine/golden/cross-check-load.tji       # weekly resource report (5.3)
engine/golden/generators/fedora-res.mjs  # Fedora 20 plus a generated resource pool (19.1)
src/engine/protocol.ts                   # v3 types
src/lib/workload/
  axis.ts            # buckets (day, week, month) in the project zone, week start (6.2)
  availability.ts    # per person: working time, leave, booked, free, as interval sets
  load.ts, bands.ts  # LoadModel, group roll-ups, thresholds and bands
  rebalance.ts       # RebalanceAction -> EditIntent or GanttAction (6.6)
  prefs.ts           # thresholds, unit, zoom, view (localStorage, ADR-0008 #3)
src/lib/schedule/
  explain.ts         # placement causes, interruptions (6.3)
  demand.ts          # held and unmet windows per person (6.3)
src/lib/health/
  types.ts, checks/*.ts, report.ts, settings.ts                # section 12, 6.4
src/lib/calendar/paint.ts                # LeavePaint -> EditIntent (6.6)
src/lib/tjp/edit/leave-clear.ts          # clearLeave (6.5)
src/lib/tjp/edit/gap-task.ts             # gapToTask (6.5)
src/lib/tjp/new-plan.ts                  # newPlanText (6.8)
src/lib/gantt/filter.ts                  # person and flag filter
src/components/people/                   # PeopleView (switcher, segments), lazy chunk entry
src/components/workload/                 # Heatmap.svelte (canvas), NameColumn, AxisHeader, CellDetails, Thresholds, LoadGrid (ARIA mirror)
src/components/resources/                # Lanes.svelte (canvas), ResourceTable (treegrid), ResourceDetails
src/components/calendar/                 # MonthGrid.svelte (DOM grid), PaintBar, LeaveDetails
src/components/health/                   # HealthPanel, Finding, WhySection
src/components/app/NewPlanSheet.svelte, EmptyState.svelte
tests/fixtures/workload/**, tests/fixtures/health/<check>/{pass,fail}/**
tests/e2e/{authoring,workload,rebalance,calendar,resources,health,workload-gate,workload-perf}.spec.ts
```

The People views, `workload/*`, `schedule/explain.ts`, `demand.ts` and `health/*` load as a lazy chunk (8.3). Every `src/lib` module has its `*.test.ts` beside it.

## 5. Engine data for the workload

### 5.1 Where each item comes from

| The views need | Source | Why |
| --- | --- | --- |
| People, groups, names, text-only state, declaration sites | Symbol index | The text is the source of truth; edits show at once |
| Booked time per person, per task | `bookings` (v1, unchanged) | These are the exact scoreboard slots. Load is derived from them, so no separate load field is added (19.2) |
| A person's available time (their working hours or shifts, minus global and own leaves) | **Bridge v3** `ResourceScenarioResult.workingTime` | Only TaskJuggler knows shifts, `workinghours` inheritance, leave precedence and DST |
| A person's leaves by type, as they ended up on the scoreboard | **Bridge v3** `ResourceScenarioResult.leaves` | Leaves from shifts, macros and `vacation` and leave precedence come out right |
| Global leaves with type and name | **Bridge v3** `ProjectInfo.leaves` | The calendar's holiday names |
| Week start | **Bridge v3** `ProjectInfo.weekStartsMonday` | Week buckets must match TaskJuggler's weekly report |
| Requested allocations after inheritance (candidates per `allocate` item) | **Bridge v3** `TaskScenarioResult.allocate` | Explaining a task that waits for, or runs without, a person it asked for. `allocated` lists only the people who got booked |
| Leave text items to paint, trim and remove | Index `LeaveSite.items` | Edits map to text. A day whose leave the engine shows but no text item names (a shift or macro) is text-only |
| Utilisation, bands, roll-ups, held and unmet work, causes, health findings | **Derived on the main thread** (6.2 to 6.4) | Display data (5.2) |

### 5.2 Derived display data (ADR-0007, extended by ADR-0014)

The ADR-0007 rule holds: these are pure functions of a `ScheduleResult` and the index. Their output is never sent to the engine, never becomes a task's date, and is never shown as a date the engine produced. In addition:

- **Booked hours and available hours are exact sums** of engine intervals, in integer minutes. They are not estimates, and the gate checks them (16.1).
- **Held and unmet work and the causes are interpretations** of the result: "TaskJuggler's schedule shows Dev 1 booked on Build API while Login waits". They are labelled as read from the schedule ("about" where they estimate minutes), and the explanation says when it cannot tell (`unknown`).
- **No preview recomputes load.** A rebalance drop shows a pending ghost of the moved task in the target cell. The numbers change only when the engine's result arrives.

### 5.3 Golden impact

- `GoldenFile.schemaVersion` becomes 3. Every golden is re-recorded by `npm run golden:record`, and golden parity must stay green.
- The goldens stay provisional on Ruby 3.3.6 (ADR-0003 #5, amended). If the Ruby 3.4 re-record is still open when T6 merges, the user records once after T6, as for schema v2.
- **Cross-check (new): `cross-check-load.tji`.** A `resourcereport` in CSV with a `weekly` column, `loadunit hours`, a `numberformat` with 6 fraction digits, the plan's own `timezone` and the frame as its period. `record-native.mjs` checks, for every golden with resources and every active scenario:
  - tj3's weekly effort per leaf resource equals the sum of the golden's bookings in that local week times the resource's `efficiency`, at the printed precision (TaskJuggler's `effort` query is weighted, `ResourceScenario#getEffectiveWork`);
  - if a `celltext` query can print `freetime` per week, the golden's `workingTime` minus its bookings equals it. If it cannot, the gate says so, as Phase 2 did for gaps.

  This is the independent check of the new serializer fields. Parity alone cannot catch serializer bugs.
- **New goldens:** `fedora-res` (19.1), the workload fixtures and the health pass and fail fixtures (T7), as manifest kinds `workload` and `health`.
- **Fast path.** Golden runs never use it. The serializer change alters the full result that the fast-path equivalence suite compares, so that suite is re-run on v3 before T6 merges (11.2).

### 5.4 What "over" means when TaskJuggler never double-books

TaskJuggler levels as it schedules, so booked time never exceeds available time, except for `overtime` bookings. A heatmap that turns red only above 100% would almost never be red. Demand that exceeds capacity shows in TaskJuggler as **work that waits**, or **work that runs without its people**:

- **Held:** an effort task whose start is later than its dependencies, frame and constraints allow, while every person it asked for was booked elsewhere or on leave in between.
- **Unmet:** a `length` or `duration` task that runs while a person it asked for is booked on another task, so that part of the span is done without them. TaskJuggler warns `allocate_no_assigned` only when nobody was booked at all.

ADR-0014 makes a cell **over** when its utilisation is above the upper threshold, **or** when work is held or unmet for that person in it (18.3). The cell says why: "Full, and 2 tasks wait for Dev 1".

## 6. Interfaces

All times are integer `Minutes` since `ProjectInfo.start`. The interface task (T2) merges these types and contract comments before any consumer is built (CLAUDE.md, 2026-11-13: interface first).

### 6.1 Protocol, schema v3 (`src/engine/protocol.ts`)

```ts
export type EngineLeaveType =
  'project' | 'annual' | 'special' | 'sick' | 'unpaid' | 'holiday' | 'unemployed';

export interface ProjectInfo {
  // ... v2 fields unchanged
  /** v3. `weekstartsmonday` (default true): week buckets start Monday, else Sunday, local midnight. */
  weekStartsMonday: boolean;
  /** v3. Global leaves as declared (project['leaves'], vacation included as holiday), plan order. */
  leaves: Array<{ type: EngineLeaveType; name: string | null; interval: [Minutes, Minutes] }>;
}

export interface ResourceResult {
  // ... v2 fields; `scenarios` values gain fields:
  scenarios: Record<string, ResourceScenarioResult>;
}
export interface ResourceScenarioResult {
  efficiency: number;
  /** v3. Slots the resource could work: free or booked (ResourceScenario#getWorkSlots semantics),
   *  merged [start, end), ascending. Leaf resources only; [] for groups (roll-ups are summed). */
  workingTime: Array<[Minutes, Minutes]>;
  /** v3. Slots carrying a leave type on the resource scoreboard (bits 2-5), merged per type, types
   *  in LeaveList order. Off-hours slots inside a leave are included, so a leave reads as one run. */
  leaves: Array<{ type: EngineLeaveType; intervals: Array<[Minutes, Minutes]> }>;
}

export interface TaskScenarioResult {
  // ... v2 fields unchanged
  /** v3. The task's `allocate` items after inheritance (TaskScenario 'allocate'): each item's
   *  candidates in order (first = the written resource, then alternatives). Groups as written. */
  allocate: Array<{ candidates: string[] }>;
}
```

Rules for the bridge (T6):
- Read through public `ResourceScenario` and `Project` methods where their cost allows it. If one raw pass over the scoreboard is needed for speed (as `bookings` does with `bookedTask`), the serializer's header says why, as it does for `getBookings`.
- Classify each slot once, in the same pass as the booking runs.
- Calling `getWorkSlots` on a resource with no scoreboard builds one (`countSlots` calls `initScoreboard`). TaskJuggler's own reports do the same, and it happens after scheduling.
- Cost: `serializeMs` before and after for every golden. Targets: at most 10% more total engine time on `syn-20-scale-1000` and `gantt-500`, about none on Fedora.

### 6.2 Workload model (`src/lib/workload/`)

```ts
export type BucketKind = 'day' | 'week' | 'month';
export interface BucketAxis {
  readonly kind: BucketKind;
  /** Local-midnight starts in the project zone (DST-correct, via ZoneOffsets), plus the frame end. */
  readonly bounds: Int32Array;               // length count + 1
  readonly count: number;
  indexOf(m: Minutes): number;               // -1 outside the frame
}
export function bucketAxis(p: ProjectInfo, zones: ZoneOffsets, kind: BucketKind): BucketAxis;

export interface Thresholds { spareBelow: number; overAbove: number }  // percent; defaults 80, 100 (18.3)
export type Band = 'off' | 'spare' | 'full' | 'over';
export interface LoadRow {
  readonly id: ResourceId; readonly name: string; readonly depth: number;
  readonly group: boolean; readonly expanded: boolean | null; readonly textOnly: TextOnlyReason | null;
}
export interface LoadModel {
  readonly revision: Revision; readonly scenario: string; readonly axis: BucketAxis;
  readonly rows: readonly LoadRow[];               // pre-order, collapse applied
  /** Per row, per bucket, integer minutes. Groups are the sums of their leaf members. */
  readonly booked: readonly Int32Array[];
  readonly available: readonly Int32Array[];
  readonly leave: readonly Int32Array[];           // leave minutes on working days, for the hatch
  readonly held: readonly Int32Array[];            // from DemandMarks (6.3); zeros until it exists
  readonly unmet: readonly Int32Array[];
  band(row: number, col: number, t: Thresholds): Band;
  /** The cell's tasks: booked minutes per task, then held or unmet tasks. Computed on demand. */
  cellTasks(row: number, col: number): readonly CellTask[];
  readonly dimmed: boolean;                        // RunnerState.outdated
}
export interface CellTask {
  readonly task: TaskId; readonly minutes: number;
  readonly kind: 'booked' | 'held' | 'unmet'; readonly movable: boolean;
}
export function buildLoad(i: { result: ScheduleResult; index: SymbolIndex; zones: ZoneOffsets;
  kind: BucketKind; collapsed: ReadonlySet<ResourceId>; demand: DemandMarks | null }): LoadModel;
```

- **Band rule.**
  - `off`: available and booked are both 0.
  - `over`: booked > available, held > 0, unmet > 0, or 100 x booked / available > `overAbove`.
  - `spare`: 100 x booked / available < `spareBelow`.
  - `full`: everything else.
- **Hours shown** are booked time, not weighted by efficiency (18.2). The cell details show the effective effort beside them.
- **Cost.** It runs once per result in an idle task, after the Gantt's analysis. Targets: at most 15 ms on desktop for `fedora-res` and `scale-1000`, and no task over 50 ms at 4x (chunked by rows).

### 6.3 Explainer and demand (`src/lib/schedule/explain.ts`, `demand.ts`)

```ts
export type Cause =
  | { kind: 'dependency'; pred: TaskId; via: 'depends' | 'precedes'; gap: boolean }
  | { kind: 'frame' }
  | { kind: 'constraint'; attr: 'start' | 'minstart' | 'end' | 'maxend'; inherited: boolean }
  | { kind: 'busy'; resource: ResourceId; window: [Minutes, Minutes];
      on: ReadonlyArray<{ task: TaskId; minutes: number }> }
  | { kind: 'leave'; resource: ResourceId | null; type: EngineLeaveType; window: [Minutes, Minutes] }
  | { kind: 'off-hours'; resource: ResourceId | null; window: [Minutes, Minutes] }
  | { kind: 'limit'; site: SourceRange }   // a `limits` statement on the task or its people: "may"
  | { kind: 'unknown' };                   // the schedule does not show why
export interface Placement {
  readonly task: TaskId; readonly anchor: 'start' | 'end';
  /** The earliest start (ASAP) or latest end (ALAP) that dependencies, frame and constraints allow. */
  readonly bound: Minutes | null; readonly at: Minutes | null;
  readonly causes: readonly Cause[];       // why `at` differs from `bound`, in time order
  readonly inside: readonly Cause[];       // gaps inside the bar (effort tasks): busy, leave, off hours
}
export interface DemandMarks {
  readonly held: ReadonlyMap<ResourceId, ReadonlyArray<{ task: TaskId; window: [Minutes, Minutes] }>>;
  readonly unmet: ReadonlyMap<ResourceId, ReadonlyArray<{ task: TaskId; window: [Minutes, Minutes] }>>;
}
export function explainTask(id: TaskId, ctx: ExplainContext): Placement;   // on demand, at most 5 ms
export function demandOf(ctx: ExplainContext): DemandMarks;                 // all tasks, idle
export interface ExplainContext { result: ScheduleResult; scenario: string; index: SymbolIndex;
  analysis: DrivingAnalysis; wt: WorkingTime; availability: Availability }
```

Rules (T10; checked against hand-computed fixtures):

1. `bound` uses Phase 2's `earliestUnder` and `latestEnd` over the resolved edges, the frame, and a written `start` or `minstart` (or `end` or `maxend` for ALAP).
   - If `at` equals `bound` and the binding item is a dependency, the cause is `dependency`.
   - If the binding item is the frame, the cause is `frame`.
   - If it is a written date, the cause is `constraint`.
2. If `at` is later than `bound`, look at the window `[bound, at)` for each person in `allocate`:
   - their free time is `workingTime` minus all their bookings;
   - if no candidate had free time in the window, the window is split into `busy`, `leave` and `off-hours` causes per person, from the engine intervals, and the task is **held** for those people;
   - if a candidate had free time, the cause is `limit` when a `limits` statement exists on the task or on that person in the text, else `unknown`.
3. **Unmet:** for a `length` or `duration` leaf, the parts of `[start, end)` where an `allocate` candidate had working time but was booked on another task.
4. **Inside:** for an effort leaf, the gaps between its bookings inside `[start, end)`, explained the same way.
5. The explainer never says "would have started on …". It names what the schedule shows.

### 6.4 Health (`src/lib/health/types.ts`)

```ts
export type CheckId = 'no-predecessor' | 'no-successor' | 'hard-constraint' | 'constraint-warning'
  | 'long-gap' | 'long-task' | 'held-by-people' | 'work-without-people' | 'resource-warning';
export type Subject = { kind: 'task'; id: TaskId } | { kind: 'link'; pred: TaskId; succ: TaskId }
  | { kind: 'message'; index: number };
export type Fix =
  | { kind: 'intent'; label: string; intent: EditIntent }            // through dispatch
  | { kind: 'pick'; role: 'predecessor' | 'successor'; task: TaskId } // the dependency picker (polish 11)
  | { kind: 'replace-person'; task: TaskId; from: ResourceId }        // the chip's "Replace with…"
  | { kind: 'open'; view: 'workload' | 'calendar'; resource: ResourceId; at: Minutes }
  | { kind: 'why'; task: TaskId } | { kind: 'show' };
export interface Finding { readonly check: CheckId; readonly severity: 'info' | 'warning' | 'error';
  readonly subject: Subject; readonly at: SourceRange | null; readonly fixes: readonly Fix[] }
export interface HealthSettings { longGapDays: number /* 5 */; longTaskDays: number /* 20 */;
  enabled: Readonly<Record<CheckId, boolean>> }
export interface HealthReport { readonly revision: Revision; readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<CheckId, number>> }
export function checkPlan(i: { index: SymbolIndex; result: ScheduleResult; analysis: DrivingAnalysis;
  demand: DemandMarks; wt: WorkingTime; settings: HealthSettings }): HealthReport;
```

Sentences live in `strings.ts` (`healthStrings`), keyed by check. Settings are UI preferences per plan (ADR-0008 #3).

### 6.5 New edit intents (`src/lib/tjp/edit/types.ts`; grammar-specialist, T8)

```ts
| /** Removes [start, end) from every leave item of the scope it overlaps: an item inside goes, an
     item over one edge is trimmed, an item spanning the range is split in two. One edit. */
  { type: 'clearLeave'; scope: { kind: 'global' } | Scope; start: string; end: string }
| /** `task` depends on `target` with a gap: insert a waiting task before `task` that depends on
     `target` and lasts the gap (gaplength -> length, gapduration -> duration), and point `task`'s
     item at it, gap removed. One edit. */
  { type: 'gapToTask'; task: TaskId; target: TaskId; name: string; id?: string }
```

- **`clearLeave`** shares `calendar-leaves.ts`'s checks (macros, text-only, zone and granularity, the vacation rule).
  - It is a noop `not-present` when nothing overlaps.
  - A `vacation` interval that would be split is refused as `unsupported-form`.
  - **Engine test:** after the edit, the resource's v3 `leaves` no longer cover `[start, end)` and are otherwise unchanged.
- **`gapToTask`** is refused as `unsupported-form` for `onstart` or `onend` items and for items with both gaps. It also gets the usual refusals: `inherited`, `macro-in-body`, `shared-declaration`, `id-collision`.
  - **Engine test:** the successor's start and end are unchanged on every fixture without resources.
  - Fidelity families for both intents, as for the Phase 1 intents.
- **Allocation alternatives get no intent.** The caller's list mentions them, but the plan places them in Phase 5 (19.13).

### 6.6 Rebalance and leave-paint planners

```ts
// src/lib/workload/rebalance.ts
export type RebalanceAction =
  | { type: 'reassign'; task: TaskId; from: ResourceId; to: ResourceId }
  | { type: 'shift'; task: TaskId; fromBucket: Minutes; toBucket: Minutes };
export type RebalanceRefusal = 'via-group' | 'not-a-person' | 'not-booked' | 'same-place';
export function planRebalance(a: RebalanceAction, ctx: ActionContext):
  | { status: 'intent'; intent: EditIntent; label: ToastLabel }       // reassign
  | { status: 'action'; action: GanttAction }                         // shift -> { type: 'move', days }
  | { status: 'not-possible'; reason: RebalanceRefusal; at: readonly SourceRange[] };
```

- **`reassign`** becomes `replaceAllocation(task, from, to)`. If `to` is already on the task, the edit API drops the item, and the label says "Dev 3 already works on Login; Dev 1 removed".
  - `via-group`: `from` is booked through a group allocation (`allocate team`). The sentence says "Booked through Team. Change the task's people in its details."
  - `not-a-person`: the drop landed on a group row.
  - The edit API's `inherited`, `unsupported-form` (alternatives) and `text-only` come through unchanged.
- **`shift`** becomes Phase 2's `move` action. `days` is the number of working days (project working time) between the two buckets' starts, signed. The dispatcher plans it with `planAction`, so the move preference (start, gap, or end for ALAP), the clamps and the one-time constraint warning all apply as in R2.

```ts
// src/lib/calendar/paint.ts
export type LeavePaint =
  | { type: 'paint'; scope: { kind: 'global' } | { kind: 'resource'; resource: ResourceId };
      from: Minutes; to: Minutes; leave: LeaveType; name?: string }   // whole local days, [from, to)
  | { type: 'erase'; scope: LeavePaint['scope']; from: Minutes; to: Minutes };
export function planLeavePaint(p: LeavePaint, ctx: { index: SymbolIndex; result: ScheduleResult;
  zones: ZoneOffsets }): Planned;
```

- **Paint** becomes `updateLeave` when the range touches or overlaps an item of the same type and name in that scope (the merged item). Otherwise it becomes `addLeave`.
- **Erase** becomes `clearLeave`.
- Dates are written with `dateText`. The interval form is the edit API's (18.5).

### 6.7 Selection and view state

```ts
export type Selection =
  | /* Phase 2 kinds */ { kind: 'task'; id: TaskId; origin: 'text' | 'visual' } | { kind: 'link'; pred: TaskId; succ: TaskId; origin: 'visual' }
  | { kind: 'resource'; id: ResourceId; origin: 'text' | 'visual' }
  | { kind: 'cell'; resource: ResourceId; bucket: number; axis: BucketKind }
  | { kind: 'days'; scope: LeavePaint['scope']; from: Minutes; to: Minutes }
  | null;
export type View = 'gantt' | 'workload' | 'resources' | 'calendar';
export type PeopleSegment = 'load' | 'lanes' | 'calendar' | 'team';      // phone People tab
```

- A cursor inside a `resource` block selects that person (Split mode), as tasks do.
- View, zoom, unit (hours or percent), thresholds and the collapsed groups are UI preferences per plan (ADR-0008 #3).

### 6.8 Authoring (ADR-0013)

```ts
// src/lib/tjp/new-plan.ts
export interface NewPlanSpec { name: string; start: string /* yyyy-mm-dd */; timezone: string | null }
/** A minimal valid plan: `project <id> "<name>" <start> +1y { timezone "<zone>" }`, nothing else
 *  (18.11). Id from the name (TaskJuggler id rules; 'plan' if none). Strings through the values
 *  printer; `unsafe-text` rules apply. */
export function newPlanText(s: NewPlanSpec): { entry: 'plan.tjp'; files: Record<'plan.tjp', string> };

// src/lib/state/app.svelte.ts
openNewPlan(spec: NewPlanSpec): Promise<boolean>;   // asks first when dirty (confirmSwitch)
// Sample.id widens to SampleId | 'new'; preferences for new plans use the key 'new'.
```

The Add task control uses the existing `addTask` through `app.edits.dispatch`. The positions are:
- after the selected task: its parent, at its index plus 1;
- at the end of the plan (parent `null`, index `taskRoots.length`) when nothing is selected or the plan is empty;
- "Add subtask": the selected task as parent, at `children.length`.

## 7. Gestures and intents

### 7.1 Mapping

Each row goes through the dispatcher, so it is one undo step, appears in History, and shows a toast (desktop) or the quiet message strip (phone).

| # | Action | Desktop | Touch | Keyboard or non-drag alternative (WCAG 2.5.7) | Intent | Expected patch (fixture example) | Refusals and notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W1 | Rebalance: another person | Drag a cell (or a lane bar) onto another person's row, same column | Long-press the cell or bar, then drag | Cell details: a task's "Move to person…" menu; Alt+Up/Down moves it one person per press (coalesce key `rebalance:<task>:<from>`, cumulative offset) | `replaceAllocation` | `allocate dev1` becomes `allocate dev3` (one id token) | `via-group`, `not-a-person`, `inherited`, `unsupported-form` (alternatives), `shared-declaration` confirm. A cell with several movable tasks asks "Move which task?" on drop (18.9) |
| W2 | Rebalance: another week | Drag along the same row to another column | Same, long-press first | Cell details: "Move to week…"; Alt+Left/Right moves one bucket per press (coalesce key `shift:<task>`, cumulative days) | `move` action, so `setAttr start`, `setAttr end` (ALAP) or `setDependsGap` | As R2: `start 2026-03-16` inserted or rewritten, or `{ gaplength 5d }` | Move preference asked once (ADR-0008 #2); constraint warning once; R2 clamps |
| W3 | Paint leave | Calendar in Paint mode: drag across days | Long-press a day, then drag | Shift+arrows select days, L opens the type picker, Enter; "Add leave" in the person's details | `addLeave` or `updateLeave` (merge) | `leaves annual 2026-03-02 - 2026-03-07` inserted in `resource dev1 { … }`, or `, annual …` appended | `shared-declaration` confirm for a resource in a shared `.tji`; macro and text-only refusals |
| W4 | Erase leave | Erase mode: drag across days | Long-press, then drag | Select days, then Delete | `clearLeave` | The item removed, trimmed (`- 2026-03-05`) or split into two | A `vacation` split: `unsupported-form`. A shift or macro leave: text-only, "Show in text" |
| W5 | Change a leave | Click the leave, then edit type, name and dates in its details | Tap, tap again | The same fields | `updateLeave`, `removeLeave` | One item rewritten or removed | As W3 |
| W6 | Regroup a person | Drag a table row; the indent sets the group | Long-press the row handle, drag | Alt+Shift+Up/Down/Left/Right on the row; details "Group" select | `moveResource` | The block cut and re-inserted in the group | Into a person who has allocations: `not-a-group` (planner, 18.7) |
| W7 | Add, rename, delete a person | + in the People toolbar; F2; Delete | + ; details fields | The same keys; details | `addResource`, `renameResource`, `deleteResource` | As phase-1 7.1 | The edit API's (references, `unfixable-reference`) |
| W8 | Person fields | Details: efficiency stepper, rate, email, managers chips, working-hours editor | Details sheet, 44 px steppers | The same | `setResourceAttr`, `removeResourceAttr`, `setWorkingHours` | `efficiency 0.8` inserted or rewritten | Steppers coalesce (`res:<id>:efficiency`, cumulative) |
| W9 | Add task, Add subtask | + in the Gantt toolbar (a menu with "Add subtask" when a task is selected) | The same, 44 px | Insert, Ctrl or Cmd+Enter (exists); the + is a button | `addTask` | A task block after the selected one, or at the end of the entry file | The edit API's; the details then open with the name field focused (9.8) |
| W10 | Health fixes | Buttons on a finding | The same | The same | `addDepends`, `removeAttr`, `setDependsGap`, `gapToTask`, `replaceAllocation` | Per fix (section 12) | As each intent |
| W11 | New plan | Plan chooser, "New plan…" | The same | The same | none: a new workspace | `newPlanText` output | Asks first when the open plan was edited |
| W12 | Navigate the heatmap, lanes and calendar | Scroll; Shift+scroll; Ctrl+scroll zooms (heatmap: day, week, month) | Pan; pinch steps day, week, month | Arrows, PageUp/PageDown, Home/End, T (today) | none | The text is unchanged | |

### 7.2 Rules

- Phase 2's gesture machine (`src/lib/gesture/`) is reused unchanged: 350 ms long-press on touch, slop to native pan, Escape and `pointercancel` cancel, edge auto-scroll.
- **Axis lock.** A rebalance drag locks to the axis of the larger movement once past the slop: rows change the person (W1), columns change the week (W2). Going back over the origin unlocks it. One drop is one intent (18.9).
- **Feedback.** The ghost and the live label ("To Dev 3", or "2 weeks later, start Mon 16 Mar") are visual only. No edit API call runs per move. One dry run happens per target change, in an idle task, to show allowed or not allowed (as R3).
- **Phones.** Tap selects. A second tap opens the details: cell details, task details, person details or day details. Long-press then drag is the only drag. No success toasts are shown; the quiet message strip and Undo in the top bar cover it.

## 8. Rendering and performance

### 8.1 Heatmap and lanes

- **Structure.** The Gantt's structure is reused: one native scroll container with a sized spacer, sticky canvas layers (cells or bars, then an overlay for selection, focus ring and the drag ghost), `min(dpr, 2)` backing, and the time scale and ticks from `src/lib/gantt/`.
- **Virtualisation.** Only visible rows and columns are painted, with a 2-column and 3-row overscan on a coarse pointer and 10 on a fine one. The frozen name column mounts visible rows only.
- **The T22 lessons, applied from the start:**
  - no `getClientRects` or layout reads in the paint path: sizes come from a cached `ResizeObserver`;
  - `contain: strict` on the name column and the ARIA mirror;
  - the canvases redraw only on a model change, a zoom, or a scroll past the overscan;
  - cell text is drawn only when a cell is at least 32 px wide.
- **ARIA mirror.** It holds the visible window only (at most 30 rows x 20 columns of cells) and is rebuilt 150 ms after scrolling stops, never during scroll frames.
- **Per-frame work.** At most 600 `fillRect` calls and the overlay; script at most 4 ms on desktop and 8 ms at 4x.

### 8.2 Calendar, tables, health

These are DOM: a month is 42 day cells, and the tables and lists are short.
- The resource table virtualises beyond 100 rows.
- The health list virtualises beyond 200 findings.

### 8.3 Work outside frames, and bundle

- **Order per result, each in its own idle task:**
  1. the Gantt's analysis (Phase 2);
  2. the load model;
  3. demand;
  4. health.

  Each task stays under 50 ms at 4x, chunked where needed. Targets on desktop: load at most 15 ms, demand at most 25 ms, health at most 15 ms on `fedora-res` and `scale-1000`. These are recorded, not enforced. CI's enforced rule is the responsiveness job: no task over 50 ms after ready, extended to `fedora-res` with the Workload view open.
- **Bundle.**
  - The People views and the insight modules (`workload`, `explain`, `demand`, `health`) are one lazy chunk, loaded when a People view opens or in idle after the first result (for the health count).
  - Total `/app` JS stays under 450,000 bytes gzip, and Visual-first initial JS grows by at most 5 KB.
  - `scripts/js-sizes.mjs` reports the new chunk.

### 8.4 Measured in CI (emulation) and on the desktop

New `workload-perf.spec.ts` uses T22's harness (`tests/e2e/lib/perf.ts`) on `fedora-res` and `scale-1000`, Workload at day and week zoom.
- **Scenarios:**
  - vertical scroll through all rows;
  - horizontal pan across the frame;
  - pinch through day, week and month;
  - a 3 s rebalance drag;
  - a scroll during which a result arrives.
- **Enforced on desktop** as regression catchers: at least 95% of frames on time and none over 50 ms in at least one of three runs; drag script time p95 under 8 ms.
- **Enforced on Pixel 7 emulation:** at most 800 DOM nodes in the mounted Workload view. This is deterministic, and it is the cost T22 found.
- **Recorded on Pixel 7 at 4x:** frames on time. The target is 90% (fewer DOM rows than the Gantt). A miss is a finding, not a gate failure (8.5).

### 8.5 Real devices

As in Phase 2 (T26 waiver, 2026-11-13), there is no real-device run in Phase 3. Phone criteria are judged under emulation, and the gate file says so. The real-device pass, and the OffscreenCanvas question of phase-2 8.1, belong to Phase 6.

## 9. UI and layouts

### 9.1 Where things live

- **Desktop and tablet.** A view switcher in the view toolbar: Gantt, Workload, Resources and Calendar. Split mode puts the editor beside any view.
  - **Resources** is the resource table on the left and the lanes on the right, with the Gantt's table divider.
  - **Workload** is the name column and the heatmap.
  - **Calendar** is a month list with a scope picker ("Everyone" for global holidays, or a person).
- **Phone.** The tab bar becomes **Plan, Gantt, People, Text** (the plan's own four tabs). People has a segmented control: Load, Lanes, Calendar and Team (the resource list).
- **Health.**
  - Desktop: a "Health" button with a count in the top bar opens the right panel's Health tab, beside Details.
  - Phone: the status button's card gains a "Plan health: N" row that opens a full-height Health sheet (18.10).
- **Person details.** On desktop, the right panel's Details shows the person when a resource is selected. On phone and tablet, it is the bottom sheet, opened by the second tap.

### 9.2 Per breakpoint

| Width | Workload | Resources | Calendar | Health |
| --- | --- | --- | --- | --- |
| Desktop, 1024 px and up | Toolbar: zoom (Day, Week, Month), Hours or %, Thresholds popover, Today, legend. 28 px rows, cells 56 px at week zoom. Hover shows the cell line; a click selects and shows the cell details in the right panel | Table pane (id, name, group, efficiency, hours booked) with the divider; lanes timeline sharing the Gantt's zoom presets | Three months per screen, vertical scroll; Paint toolbar: mode (Select, Paint, Erase), type, scope | Right panel tab: findings grouped by check, filters by severity, settings (thresholds, checks on and off) |
| Tablet, 600 to 1023 px | As desktop with 40 px rows and 44 px cells; details in the bottom sheet | Table collapses to the name column; details sheet | One month, swipe or buttons for the next | Bottom sheet from the Health button |
| Phone, under 600 px | People > Load: a compact chip row (zoom, unit, thresholds sheet), a 96 px frozen name column, 44 x 44 cells. The cell line pill floats at the foot (as the Gantt's task pill). The second tap opens cell details at half height | People > Lanes: a 96 px name column and lanes; the second tap on a bar opens task details | People > Calendar: one month, 44 px days, the Paint bar above the tab bar | The status button, then "Plan health", then a full-height sheet |

New semantic tokens, separate from the accent, checked in `tests/ci/palette.test.ts` in both themes and under colour-vision simulation:
- `--load-spare`, `--load-full`, `--load-over`, `--load-off`, `--leave-hatch`, `--held`.

Bands are never shown by colour alone (WCAG 1.4.1):
- over has a diagonal hatch and a corner mark;
- spare is lighter;
- each cell's text and its accessible name state the band.

### 9.3 Workload heatmap

- **Cells.** Hours (`38h`; quarter hours as `37.75h`) or percent of available time. A group row sums its members.
- **Cell details** (drill-in):
  - the person and period;
  - booked, available and effective effort;
  - the band and why ("2 tasks wait for Dev 1");
  - the booked tasks with hours, then the held and unmet tasks;
  - per task: "Move to person…", "Move to week…", "Why here?" and "Show in Gantt" (which sets the person filter).
- **Thresholds.** Two number fields with steppers (spare below, over above), default 80 and 100. They are stored per plan (18.3).
- **Dimmed** when the result is outdated, as the Gantt is. Before the first result, "Scheduling…".
- **Empty states:** "No people in this plan yet", with "Add person". Fedora shows this (19.1).

### 9.4 Resources lanes

- One lane per leaf person; a group row shows the roll-up as a thin band.
- Booking runs are drawn as bars, merged per task per day, with the task's name when it fits. TaskJuggler never double-books, so a lane needs no stacking.
- Leaves are hatched, by type.
- Over buckets are a red band under the lane, using the same rule as the heatmap at the lanes' zoom bucket.
- Bars drag for W1 and W2. Text-only tasks show the badge and do not drag.

### 9.5 Calendar

- Each day shows:
  - global holidays, with the name from `ProjectInfo.leaves`;
  - the selected person's leaves, by type, from v3 `leaves`;
  - non-working days, from the working time;
  - milestones, as a diamond with the name; a tap selects the task.
- Paint mode: W3 and W4. The type picker offers `annual`, `special`, `sick`, `unpaid`, `unemployed` for a person, and `holiday` for Everyone. A leave that no text item names shows "From a shift or macro. Edit as text."

### 9.6 Resource table, person details, project sheet

- **Table** (treegrid): id (monospace), name, group, efficiency, booked hours in the frame, and a text-only badge. Row menu: Add person, Add group, Rename, Delete, Indent and Outdent (W6, W7).
  - "Add group" is `addResource` with a name. People are moved into it with W6 (18.7).
- **Person details:** name, id, group, efficiency (stepper, 0.05 steps), rate, email, managers (chips), the working-hours editor, leaves (list with Edit and Remove, and "Add leave"), and booked tasks. Fields follow the Phase 2 rules: inherited badge, text-only with reason, commit on Enter or blur, steppers coalesce.
- **Working-hours editor** (shared by person and project): per weekday, "off" or one or more ranges. It writes `setWorkingHours` for the days changed.
- **Project sheet additions:** global working hours, `dailyworkinghours` (stepper), `weekstartsmonday` (switch; it changes the week columns), `timeformat` and `currency` (`setProjectAttr`).

### 9.7 Health panel and "Why is this here?"

- **A finding** is a row with a severity glyph, the sentence, the task (a tap selects it), and its fixes as buttons (section 12).
  - The panel's header holds the counts per check and a settings button.
  - With nothing to report: "No problems found."
  - With no tasks: "Nothing to check yet."
- **Why here?** The task details' Schedule block replaces Phase 2's "Held by resources or calendars" with a "Why here?" section that lists `Placement.causes`, then "Inside the bar" for gaps. Examples:
  - "Waits for Design (ends Tue 3 Mar)."
  - "Dev 1 is booked on Build API, Wed 4 Mar to Fri 13 Mar (64 h)."
  - "Dev 1 is on annual leave, Mon 16 to Fri 20 Mar."
  - "`start 2026-03-23` is written on this task (a constraint)."
  - "A `limits` statement on Dev 1 may hold it."
  - "The schedule does not show why."

  Each cause links to the task, the person's heatmap cell or the text.

### 9.8 Authoring on phones and empty states (track A; ADR-0013)

- **Add task (+).** A + button in the Gantt toolbar on every layout (44 px on a coarse pointer). It is also on the phone's Plan tab header.
  - With no task selected, or in an empty plan, it adds at the end of the plan.
  - With a task selected it opens a two-item menu: "Add task after" (the default) and "Add subtask".
  - After the edit, the new task is selected, the details open (the sheet at half height on a phone), and the name field is focused with its text selected, ready to type.
  - The name is committed by `renameTask`, a second undo step (18.11).
  - The edit API's refusals apply unchanged.
- **New plan.** The plan chooser's list gets "New plan…" first, then a "Samples" group.
  - Choosing it opens a sheet (a dialog on desktop) with three fields: Name (required); Start (a date input, today by default); Time zone (a select of `Intl.supportedValuesOf('timeZone')`, the device zone by default, "None (UTC)" allowed).
  - "Create" writes `newPlanText` and opens it as a new in-tab workspace with an empty history.
  - The chooser then lists it as "Name (new)" above the samples.
  - Choosing "New plan…" again, or a sample, replaces it, and asks first (`confirmSwitch`) once it was edited.
  - The existing note "Changes stay in this tab until saving arrives…" shows for it as for samples.
- **Empty plan.** A header-only plan gives the engine message `no_tasks` and `ok: false`. That one case is treated as **empty, not an error**:
  - the status reads "No tasks yet" (neutral glyph);
  - deleting the last task settles as "Deleted. The plan has no tasks." rather than "no longer schedules";
  - no error pin.

  What each layout shows:
  - Gantt (desktop chart area, tablet, phone): a centred prompt, "No tasks yet", with a primary "Add task" button and "or write them in Text" (in Split mode, the editor is beside it);
  - phone Plan tab: the same prompt;
  - People views: "No people yet" with "Add person";
  - Health: "Nothing to check yet";
  - Text mode is unchanged.

## 10. Accessibility

- **Heatmap: an ARIA grid mirror.**
  - `role="grid"`, with `aria-rowcount` and `aria-colcount` for the whole model.
  - Row headers are people, with `aria-level` for groups. Column headers are periods.
  - Each cell's name is, for example, "Dev 1, week of 9 March: 38 of 40 hours, full". Over cells add "2 tasks wait".
  - The roving focus cell matches a 3 px canvas focus ring.
  - Keys: arrows, Home/End, PageUp/PageDown, Enter (details), T. In the details: Alt+arrows (W1, W2), each with a button too.
- **Lanes.** The canvas is `aria-hidden`. The resource table is the mirror, and each row's description lists its assignments in the visible period.
- **Calendar.** A real DOM grid with days as `gridcell` elements, `aria-selected` for the painted range, and Shift+arrows, L and Delete (W3, W4). Paint mode and its type are announced.
- **Health.** A list grouped by check (headings). The count in the top bar is in the button's name. New findings after a reschedule are announced politely, once per result, as a count ("2 new problems").
- **Targets.** 44 x 44 on a coarse pointer for cells, days, chips and buttons. Lane rows are 40 px, the Phase 2 exemption.
- **No drag without an alternative** (WCAG 2.5.7): see 7.1.
- **axe** on every new state, light and dark, desktop and Pixel 7. Real screen readers wait for Phase 6.

## 11. Carried-in items: what Phase 3 depends on

| Item | Depends? | Plan |
| --- | --- | --- |
| Engine memory growth, about 1.1 MB per full run (fix in progress) | **Sequencing only.** Phase 3 adds no extra runs per gesture, but painting and rebalancing are run-heavy sessions, and the gate's e2e runs many schedules in one worker | T6 waits for the fix to merge if the fix touches `serialize.rb` or `request.rb`, and is rebased on it otherwise. The gate records the worker's heap growth over the gate spec |
| Fast-path final review (ADR-0010; merged, switched off) | **No** functional dependency: no Phase 3 intent is eligible (`allocate`, leaves and resource attributes are not among the seven), except W2's `setAttr start`, which benefits once it is on | The review finishes before T6 merges, or its equivalence suite is re-run on schema v3 (5.3) |
| `gantt-500` cold analysis at 13 to 26 ms against 10 ms | **No**, but it shares the idle budget | Phase 3's derived work runs after the analysis, in its own tasks (8.3). The fix stays a separate item |
| First schedule of 200 tasks at about 5 s against 4 s | **No** | The wasm code cache is Phase 4. New plans are tiny |
| Polish item 11 (dependency picker in task details) | **Yes**, for the H1 and H2 fixes | Merge it before T11's fixes are wired (T18) |
| Polish item 8 (phone layout) | Touches the same top bar and toolbar as T3 and T13 | T3 merges first. Item 8 adapts to the + button |

## 12. Health checks (Phase 3 set; 18.8)

Leaves and milestones are checked. Containers are not checked themselves: their dependencies count for their children through inheritance. Text-only tasks are reported, and their fixes are disabled with the reason. Every check has a `pass` and a `fail` fixture (T7), and the failing fixture names the expected findings.

| # | Check | Rule | Severity | Fixes |
| --- | --- | --- | --- | --- |
| H1 | No predecessor | The task's resolved `depends` is empty, no task `precedes` it or an ancestor, and no ancestor has a predecessor. A milestone at the project start is exempt (the start milestone) | warning | "Add predecessor…" (picker, `addDepends`) |
| H2 | No successor | No task depends on it or on an ancestor, and its own and its ancestors' `precedes` are empty. A milestone that ends at the scenario finish is exempt (the finish milestone) | warning | "Add successor…" (picker, `addDepends` on the picked task) |
| H3 | Hard constraint | A `start`, `end`, `minstart` or `maxend` written on the task (own or inherited) | info | "Remove" (`removeAttr`, with the date it held), "Why here?" |
| H4 | Constraint warning | TaskJuggler's `minstart`, `maxstart`, `minend` and `maxend` warnings, explained in a sentence ("Starts 3 days after its latest allowed start"), pinned to the message's line | warning | "Show in text", "Why here?" |
| H5 | Long gap | A dependency's `gaplength` or `gapduration` over `longGapDays` working days (default 5; calendar days at the gap's own rate for `gapduration`) | warning | "Convert gap to task" (`gapToTask`), "Edit gap" (`setDependsGap`) |
| H6 | Long task | A leaf whose engine span has more than `longTaskDays` working days (default 20, the plan's) | info | "Show in text". There is no split intent; "Add subtask" is refused on an effort leaf by the edit API |
| H7 | Held by people | `DemandMarks.held` for the task: "Waits 6 working days for Dev 1 (booked on Build API)" | warning | "Replace person…" (`replaceAllocation`), "Open in Workload", "Why here?" |
| H8 | Work without its people | `DemandMarks.unmet`: a length or duration task that ran without a person it asked for, for N hours | warning | "Replace person…", "Open in Workload" |
| H9 | TaskJuggler resource warnings | Messages `allocate_no_assigned`, `priority_inversion` (with its info lines), `overbooked_effort`, `overbooked_length`, `overbooked_duration`, each with its own sentence | warning | "Show in text", and "Replace person…" for `allocate_no_assigned` |

The best-practice rows that need no check of their own: "Show the driving path" (Phase 2's critical path), "Level resources…" (H7, H8 and the explainer), "Review leveling output" (Why here?), "Watch capacity" (the heatmap), "Balance by reassigning or moving work" (W1, W2). Placeholders, baselines, the status date and documenting changes belong to later phases (19.4).

## 13. Tests and CI

### 13.1 Unit and property (`test:unit`, beside each module)

| Module | Tests |
| --- | --- |
| `workload/axis` | Buckets on syn-09 (Berlin DST weeks of 167 and 169 h), syn-11, syn-21 (New York gap and overlap), syn-10 (Kathmandu); `weekstartsmonday` both ways; months |
| `workload/load`, `bands` | **Oracle test over every golden with bookings** (29, plus `fedora-res`, the workload fixtures) at day, week and month: booked minutes per person per bucket equal an independent slot-by-slot walk written in the test (no shared code); groups equal member sums; band rule boundaries; property: shuffled bookings give the same model |
| `schedule/explain`, `demand` | Hand-computed fixtures: dependency, frame, `start` constraint, busy person (priority contention, syn-17), leave (syn-13), off hours (syn-14), efficiency, part-time, length task without its person, `limits` (syn-03, "may"), an unexplained case; property on generated plans: causes partition `[bound, at)` and never extend outside it |
| `health/*` | Each check on its pass and fail fixtures (exact findings), settings thresholds, exemptions, text-only fixes disabled |
| `tjp/edit` `clearLeave`, `gapToTask` | Unit, refusals, fidelity families (only the target range changes, still parses, schedules without new errors), engine tests in 6.5; timings added to the T6 table (target under 50 ms p90 on Fedora+res) |
| `workload/rebalance`, `calendar/paint` | One test per W1 to W4 outcome and refusal; the days computation against `WorkingTime` |
| `tjp/new-plan` | Round trip through the Lezer grammar; dates and zone parse back; ids from awkward names; the engine gives exactly `no_tasks` for the output, and schedules after one `addTask` |
| Selection, prefs | Resource cursor sync with a lagging index; per-plan preferences, key `new` |

### 13.2 End-to-end (desktop Chrome, Pixel 7; iPhone 14 for the drag rows with dispatched events)

- **`authoring.spec.ts`:**
  - + on an empty new plan;
  - + after the selected task;
  - Add subtask;
  - the name is focused;
  - undo and redo of each;
  - New plan form;
  - switching away from an edited new plan asks;
  - empty states on each layout.
- **`rebalance.spec.ts`:** W1 and W2 from a heatmap cell and from a lane bar, with real input; the "Move which task?" chooser; the keyboard and menu alternatives; the refusals (`via-group`, alternatives). Each step follows Phase 2's rig: exact text of every changed file, Undo restores the bytes, Redo the patch, the heatmap matches the engine after the result, screenshot.
- **`calendar.spec.ts`:** W3 to W5 (paint, merge, erase, split, type change), global and per person, with the same rig; text-only leave days.
- **`resources.spec.ts`:** W6 to W8, the working-hours editor, the project sheet additions.
- **`health.spec.ts`:** each fix button produces its patch and is undoable; Why here? lists the expected causes on the fixtures; the badge count; the phone path through the status button.
- **`workload-gate.spec.ts`:** criterion 1 (16.1).
- **`gantt-filter.spec.ts`:** filter by person and by flag; the cleared state.
- **a11y:** axe in every new state, both schemes; the keyboard walkthrough of W1 to W12; 44 px probes; reduced motion.
- **Screenshots:** every new view and state, light and dark, desktop, tablet and phone, in `docs/phases/screenshots/phase-3/`.

### 13.3 CI changes

| Job | Change |
| --- | --- |
| `check` | New unit tests; the fedora-res generator `--check` |
| `golden` | Schema v3; the new goldens |
| `fidelity` | Families for `clearLeave` and `gapToTask`; the fast-path suite on v3 |
| `e2e` | New specs on the existing matrix; `workload-perf` desktop caps and the Pixel 7 DOM-node cap; `js-sizes` reports the People chunk |
| `responsiveness` | Adds `fedora-res` with the Workload view open |
| `nightly.yml` | `workload-perf` throttled, with history |

Locally, run only the checks for what changed: typecheck, format, the touched unit tests and the touched e2e specs. Push in batches. CI runs the full sharded suite and is the gate.

## 14. Tasks

Every task runs in its own worktree. A task's report includes end-to-end evidence: a run, a screenshot or a trace, not only unit tests.
- **Engine, bridge, edit API and planners** (T6, T8, T9, T10, T12) get a `reviewer` pass with a native or engine reproduction.
- **UI tasks** get one review before merge. The main session checks behaviour and phone and desktop screenshots during the work.
- Fixes of a few lines are made in the main session, with their test.

| # | Task | Owner | Files | Depends on |
| --- | --- | --- | --- | --- |
| T1 | ADR-0013 (authoring on phones) and ADR-0014 (schema v3, workload semantics, display data, new intents, health set) from the user's answers to section 18 | **User** decides; `docs-writer` formats | `docs/decisions/0013-*.md`, `0014-*.md` | Answers. ADR-0013 before T3 and T4; ADR-0014 before T2 |
| T2 | **Interface PR, types and contracts only** (6.1 to 6.7 types; no serializer, no handlers). Merged before any consumer | `engine-specialist` (protocol, explain, demand); `grammar-specialist` (health, rebalance, paint, selection) | `src/engine/protocol.ts`, `src/lib/workload/types.ts`, `src/lib/schedule/explain-types.ts`, `src/lib/health/types.ts`, `src/lib/state/selection.svelte.ts` (types) | T1 |
| T3 | Add task (+) and Add subtask, all layouts; focus the name (9.8) | `ui-builder` | `GanttToolbar.svelte`, `Gantt.svelte`, `OutlinePanel.svelte`, `strings.ts` | T1 (ADR-0013) |
| T4 | New plan: `newPlanText` with tests; chooser entry, sheet, in-tab workspace, `new` preferences key, the confirm | `grammar-specialist` (`new-plan.ts`); `ui-builder` (UI) | `src/lib/tjp/new-plan.ts`, `app.svelte.ts`, `PlanChip.svelte`, `NewPlanSheet.svelte`, `samples.ts` | T1 |
| T5 | Empty states; `no_tasks` as empty (status, settle wording) | `ui-builder`; main session for the status and settle lines | `EmptyState.svelte`, `status.ts`, `edits-settle.ts` | T3, T4 |
| T6 | Bridge schema v3 (6.1); `cross-check-load.tji` and its checks (5.3); `schemaVersion` 3; provisional re-record; `serializeMs` table | `engine-specialist`; `fixture-maker` runs `golden:record`; **user** records on Ruby 3.4 | `engine/bridge/serialize.rb`, `src/engine/protocol.ts`, `engine/golden/**`, `tests/golden/**` | T2; 11 (leak fix, fast-path review) |
| T7 | Fixtures: `fedora-res` generator and plan (19.1); workload fixtures (DST weeks, 15-minute resolution, part-time hours, efficiency, groups, every leave type, overtime booking, held effort task, length task without its person, group allocation, alternatives); health pass and fail fixtures for H1 to H9; manifest; `fedora-res` as a lazy sample | `fixture-maker`, from the recipes here | `engine/golden/generators/fedora-res.mjs`, `tests/fixtures/workload/**`, `tests/fixtures/health/**`, `manifest.json`, `samples.ts` | T2; record after T6 |
| T8 | `clearLeave`, `gapToTask` (6.5) with unit, fidelity and engine tests and timings | `grammar-specialist` | `src/lib/tjp/edit/leave-clear.ts`, `gap-task.ts`, `types.ts`, `strings.ts` | T2 |
| T9 | Axis, availability, load model, bands (6.2); the golden oracle test | `engine-specialist` | `src/lib/workload/{axis,availability,load,bands}.ts` | T6 |
| T10 | Explainer and demand (6.3) | `engine-specialist` | `src/lib/schedule/explain.ts`, `demand.ts` | T6, T9 |
| T11 | Health checks H1 to H9 with fixes and settings (section 12) | `grammar-specialist` | `src/lib/health/**` | T7, T8, T10 |
| T12 | Rebalance and leave-paint planners (6.6) | `grammar-specialist` | `src/lib/workload/rebalance.ts`, `src/lib/calendar/paint.ts` | T8 (paint); T9 (rebalance) |
| T13 | People shell: view switcher, phone People tab and segments, lazy chunk, preferences, "No people" state, Add person (+) | `ui-builder` | `src/components/people/**`, `TabBar.svelte`, `App.svelte`, `src/lib/workload/prefs.ts` | T2, T5 |
| T14 | Workload heatmap (9.3, 8.1): canvas, name column, header, thresholds, unit, cell details, ARIA mirror, W1 and W2 with keys and menus | `ui-builder` | `src/components/workload/**` | T9, T10, T12, T13 |
| T15 | Resources lanes (9.4), sharing T14's layout and drag code | `ui-builder` | `src/components/resources/Lanes*.svelte` | T14 |
| T16 | Calendar and leave painting (9.5), W3 to W5 | `ui-builder` | `src/components/calendar/**` | T6, T12, T13 |
| T17 | Resource table, groups, person details, working-hours editor, project sheet additions (9.6), W6 to W8 | `ui-builder` | `src/components/resources/Table*.svelte`, `src/components/inspector/Resource*.svelte`, `ProjectSheet.svelte` | T13 |
| T18 | Health panel, the phone path, "Why here?" in task details (9.7) | `ui-builder` | `src/components/health/**`, `ScheduleBlock.svelte`, `StatusButton.svelte` | T10, T11, T13; polish 11 |
| T19 | Gantt filter by person and flag | `ui-builder` | `src/lib/gantt/filter.ts`, `GanttToolbar.svelte` | T13 |
| T20 | Unit and property tests (13.1), written alongside each owner's task | `test-writer` | Beside each module | Per module |
| T21 | E2E specs (13.2), the gate spec, screenshots | `test-writer` | `tests/e2e/*.spec.ts` | T3 to T5 early; T14 to T19 |
| T22 | Perf (8.4) and accessibility (10) audit | `perf-a11y-auditor` | `workload-perf.spec.ts`, a11y specs, fixes | T14 to T18 |
| T23 | CI changes (13.3) | `test-writer`; `engine-specialist` reviews golden and fidelity | `.github/workflows/*.yml`, `scripts/js-sizes.mjs` | As suites land |
| T24 | Gate evidence | Main session; `test-runner` runs suites | `docs/phases/phase-3-gate.md` | All |

### 14.1 Waves (at most three tracks at once)

| Wave | Track A (UI) | Track B (engine) | Track C (edit API, lib) |
| --- | --- | --- | --- |
| 0 | User answers section 18; T1 | | |
| 1 | T3 | T2 (with C; short, merged first) | T2 |
| 2 | T4, then T5 | T6; T7 alongside (mechanical) | T8 |
| 3 | T13, then T17 | T9, then T10 | T12 (paint, then rebalance after T9) |
| 4 | T14 | T16 (second `ui-builder`; engine work done) | T11 |
| 5 | T15, T19 | T18 | T21 and T22 written against the running UI |
| 6 | T21, T22, T23 complete; T24; stop for approval | | |

## 15. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| "Over" rarely shows because TaskJuggler never double-books | The heatmap looks fine while work waits | Held and unmet marks (5.4, ADR-0014); H7 and H8; the fixtures prove red appears |
| Explanations read as promises ("would have started …") | Trust | Causes name only what the schedule shows; "may" for limits; `unknown` stated; ADR-0014 |
| The bridge's scoreboard read is slow on large frames (the `workingTime` precedent: 7 to 14 ms on Fedora) | Slower runs | One combined pass with the booking scan; timings per golden; the 10% target; a raw read justified in the header if needed |
| The native cross-check cannot print capacity | Weaker serializer check | Weekly effort is checked regardless; the gate says what is not |
| Week buckets differ from TaskJuggler's around DST or the week start | Gate mismatch | `weekStartsMonday` from the engine; buckets from `ZoneOffsets`; the DST fixtures; the cross-check in the plan's zone |
| Bundle passes 450 KB (26 KB headroom) | CI fails | Lazy People and insight chunk; no new dependencies; sizes per chunk |
| Phone emulation is paint-bound (T22) | Slow People views on phones | Canvas, small overscan, no layout reads, DOM-node cap enforced, mirror rebuilt after scrolling stops |
| Leave interval forms differ in meaning (end exclusive, `+Nd`) | Wrong days painted | One printed form chosen by the edit API, engine tests on v3 `leaves` (6.5, 18.5) |
| A drop with several tasks in a cell is ambiguous | Wrong task moved | "Move which task?" chooser; menu alternatives in the details |
| Group allocations and alternatives cannot be rewritten safely | Confusing refusals | Specific sentences (`via-group`, alternatives); "Show in text" |
| Long sessions of painting and drags grow the engine's memory | Worker crash past about 1,800 runs | Leak fix sequenced first (11); heap growth recorded at the gate |
| Parallel UI tasks conflict on `App.svelte`, `TabBar`, `strings.ts` | Merge churn | T13 lands the shell first; strings grouped per view; at most two UI tracks |

## 16. Gate acceptance criteria

Copied word for word from the plan:

> Gate: on the Fedora plan, the heatmap's hours per person per week match the engine's load data exactly; every health check has a passing and a failing fixture.

### 16.1 Criterion 1: "on the Fedora plan, the heatmap's hours per person per week match the engine's load data exactly"

`upstream-fedora-20` has no resources (19.1), so the criterion is shown on `fedora-res` (18.1) and also stated for Fedora itself.

- **How it is shown.**
  - `workload-gate.spec.ts` in CI on the gate commit, desktop and Pixel 7:
    1. open `fedora-res`, Workload at week zoom, all groups expanded;
    2. scroll through every person and every week, reading each cell's exact hours from the ARIA mirror;
    3. compare with an oracle written in the test that walks the live result's `bookings` (`run.lastGood`, through the dev hook) slot by slot into local weeks (`weekStartsMonday`, the project zone);
    4. groups are compared with the sums of their members.

    Pass: zero differences in integer minutes, and the live result equals the committed golden (parity).
  - **Engine's load data, checked natively:** the T6 cross-check shows tj3's own weekly resource report agrees with the golden's bookings for `fedora-res` and every golden with resources (5.3).
  - **The Fedora plan itself:** the spec opens `upstream-fedora-20`, and the Workload view shows "No people in this plan yet". Zero cells means zero differences, which the gate file states rather than counts as evidence.
- **Evidence:** CI run link; the cell count compared (people x weeks) and the difference count; the cross-check summary; a phone and a desktop screenshot of the `fedora-res` heatmap; the unit oracle results over all goldens at day, week and month.

### 16.2 Criterion 2: "every health check has a passing and a failing fixture"

- **How it is shown.** `tests/fixtures/health/<check>/{pass,fail}/` for H1 to H9, all in the golden manifest (kind `health`, recorded natively). The unit test runs each check on its pair:
  - the failing fixture yields exactly its expected findings;
  - the passing fixture yields none for that check.

  `health.spec.ts` opens two pairs in the app (H1 and H7) and shows the panel's results match the unit results.
- **Evidence:** a table of check x fixture with the finding counts, the CI link, and screenshots of the health panel on each failing fixture (desktop) and on two of them (phone).

### 16.3 Phase deliverables (plan bullets, for completeness)

| Plan bullet (verbatim) | Demonstration |
| --- | --- |
| "Resources view, workload heatmap with thresholds, drag to rebalance, calendar with leave painting, resource table and groups." | Screenshots of each view and state; `rebalance`, `calendar` and `resources` specs (patch, undo, redo per W row); thresholds in a spec |
| "Plan health panel with the checks from the best-practices section and "why is this here?" explanations." | 16.2; explain unit fixtures; `health.spec.ts`, Why here? screenshots |

The gate also records:
- the authoring track (ADR-0013) with phone screenshots;
- the schema v3 `serializeMs` table;
- derived-work timings (8.3);
- `workload-perf` numbers for desktop and Pixel 7 emulation, with the waiver note (8.5);
- JS sizes;
- the golden state (Ruby 3.3.6 or 3.4);
- edit API timings for the new intents;
- worker heap growth over the gate spec.

## 17. Evidence files

`docs/phases/phase-3-gate.md`; `docs/phases/screenshots/phase-3/*.png`; `test-results/workload-perf.json`, `workload-gate.json`; ADR-0013, ADR-0014.

## 18. Open questions for the user

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| 18.1 | The gate says "the Fedora plan", which has no resources (19.1) | Add the golden `fedora-res`: Fedora 20's files copied unchanged, plus one appended `include "mainspring-load.tji"` in the copy of `f-20.tjp`. That file is generated by a seeded script: about 24 people in 4 groups, one part-timer, one at efficiency 0.8, global holidays and personal leaves of every type, and `supplement task` blocks that allocate people to about 150 leaves. Gate on it, and state the empty Fedora result | T7, gate |
| 18.2 | Hours in a cell: booked time, or effort weighted by efficiency | Booked time (what the person is busy for; available time is not weighted either). Effective effort appears in the cell details | T9 |
| 18.3 | Thresholds and the meaning of red | Two thresholds: spare below 80%, over above 100%, adjustable in the Workload toolbar and stored per plan in the browser. A cell is also over when work is held or unmet for that person in it (5.4) | T9, T14 |
| 18.4 | Bridge schema v3 (6.1) and a re-record of every golden; load stays derived from `bookings` (no per-day load field) | Yes. Provisional on 3.3.6; the user records Ruby 3.4 once after T6 | T6 |
| 18.5 | How leave is written and edited | Person leaves go in the person's declaration body; global holidays go after the project header. The form is `<type> "<name>" <start> - <end>` with the end as the exclusive next day, chosen by the edit API and verified against the engine. Defaults: `annual` for a person, `holiday` for Everyone. `vacation` stays readable and is edited as `holiday`. Shift and macro leaves stay text-only | T8, T12, T16 |
| 18.6 | Leave painting gesture | A Paint bar with Select, Paint and Erase, a type picker, and a scope (Everyone or a person). Desktop drags; touch long-presses, then drags; keyboard selects days, then L or Delete | T16 |
| 18.7 | Resource groups | "Add group" adds a resource; people join it by drag or by the details "Group" select (`moveResource`). Moving into a person who has allocations is refused (`not-a-group`). Rebalancing work booked through a group allocation is refused, with "Change the task's people in its details" | T12, T17 |
| 18.8 | Which health checks ship, and their defaults | H1 to H9 (section 12); long gap 5 working days; long task 20 working days; start and finish milestones exempt from H1 and H2; checks can be turned off per plan | T11 |
| 18.9 | Rebalance drag details | Axis lock (one intent per drop: person or week, not both); a cell with several movable tasks asks "Move which task?"; drops on group rows refused; week moves use the move preference (`start`, `gap`, or `end` for ALAP) | T12, T14 |
| 18.10 | Where the views and Health live | Desktop and tablet view switcher (Gantt, Workload, Resources, Calendar). Phone People tab with Load, Lanes, Calendar and Team. Health in the right panel on desktop, and from the status button on phones | T13, T18 |
| 18.11 | **Authoring on phones** (out of the original scope; ADR-0013, Appendix A). (a) Approve the early track. (b) A new plan is the header only, with `no_tasks` shown as an empty plan (not an error), rather than a starter task. (c) The frame runs `+1y` from the start date, editable later in the project sheet. (d) The time zone defaults to the device's zone. (e) Add then rename is two undo steps | (a) Yes. (b) Header only: the empty state is needed anyway (deleting the last task), the text stays minimal, and the first action is the Add task the track builds. (c) `+1y`: a short frame makes beginners' tasks run past the end. (d) Yes, with "None (UTC)" offered. (e) Two steps, both labelled in History; merging them would need a dispatcher change for little gain | T3, T4, T5 |
| 18.12 | Placeholders, limits as caps, shifts editing, alternatives | Stay in Phase 5 (v1). Views refuse with a sentence and "Show in text" | Scope |
| 18.13 | Explainer scope | Placement (start for ASAP, end for ALAP) plus gaps inside effort bars; limits only as "may hold it" until Phase 5 exposes them | T10 |
| 18.14 | Phase 3 performance criteria without a real device | Desktop frame caps and the Pixel 7 DOM-node cap enforced in CI. Phone frame times recorded (target 90%); the waiver noted. Derived-work targets recorded (8.3) | T22 |

## 19. Conflicts and ambiguities

1. **"On the Fedora plan."** Fedora 20 declares no resources, leaves or allocations, so its heatmap is empty and the criterion would pass with nothing compared. See 18.1.
2. **"Resource load per day"** (Architecture: the bridge grows). The engine already returns exact booking slots, and load is derived from them exactly. The bridge adds availability and leaves instead of a load field (18.4).
3. **Product scope tiers.** "Drag to rebalance" is in Workload's v1 column and "Why is this here?" in Plan health's v1 column, but both are Phase 3 bullets. This spec follows the phase bullets.
4. **Best practices outside this phase.** Placeholders, "limits shown as caps", baselines, the status date and generated commit summaries belong to Phases 4 and 5. Phase 3's health set is section 12.
5. **"Red for over"** (best practices, Views 2 and 3). TaskJuggler never books a person twice, so booked time above 100% only comes from `overtime` bookings. Over also covers held and unmet work (5.4, 18.3).
6. **"The patch updates `allocate` or adds a constraint."** Moving work in time uses R2's move preference, so it can write a gap instead of a constraint, and `end` for ALAP tasks.
7. **"Explainer: blocking dependency, busy resource, leave or limit."** Limits are not engine data until Phase 5, so a limit is reported as "may hold it" (18.13).
8. **Phone gestures are limited to pan, pinch and long-press drag.** Leave painting and rebalancing use long-press then drag, so they fit. Nothing else is added.
9. **The caller lists "allocation alternatives" among the rebalance intents.** The plan places them in Phase 5. No intent is added, and tasks with alternatives are refused with a sentence.
10. **Authoring on phones** is outside the Phase 3 bullets and needs ADR-0013 (18.11).
11. **Phase 2 carry-ins.** Gantt filters (phase-2 18.10) and the rest of the project sheet (phase-2 19.9) are in this phase's scope because Phase 2 deferred them here. Neither is in the Phase 3 bullets.
12. **"Every health check has a passing and a failing fixture."** H3 (hard constraints) is informational. Its passing fixture is a plan with no constraints.
13. **The heatmap's hours versus TaskJuggler's `effort`.** The cell shows booked time; tj3's report is weighted by efficiency. The cross-check compares bookings times efficiency (5.3), and the cell details show both (18.2).
14. **"Calendar: holidays, leaves and milestones by month"** does not say whose leaves. The spec adds a scope picker (Everyone, or one person).
15. **Real-device performance.** The plan's budgets assume a mid-range phone. Phase 3 judges phones under emulation, following the Phase 2 waiver (8.5, 18.14).

## Appendix A: ADR-0013 stub (for T1; `docs-writer` formats)

**ADR-0013: Authoring on phones.** Status: proposed, 2026-11-14; needs the user's approval (out-of-phase scope).

*Context.* The user (2026-11-14): "Right now on mobile it's difficult to actually create a plan and add tasks." Plans open only from samples. Adding a task needs a selected row and the row menu, so an empty plan has no visual way to add its first task.

*Decision.*
1. A + control in the Gantt toolbar on every layout. It adds after the selected task, or at the end of the plan, and offers "Add subtask". It uses `addTask` through the dispatcher, then opens the details with the name focused.
2. "New plan…" in the plan chooser. The form takes a name, a start and an optional zone, and writes a header-only `.tjp` with a one-year frame into a new in-tab workspace. Switching away from an edited one asks first. Saving waits for Phase 4.
3. Empty states on every layout. The engine's `no_tasks` is shown as an empty plan, not an error.

*Consequences.* The track runs early in Phase 3, before the workload work, and is small. No new intent or storage is added. Preferences for new plans share the key `new`. Phase 4 adds saving a new plan to a folder or repository.

## Appendix B: ADR-0014 stub (for T1)

**ADR-0014: Resource data and workload semantics.** Status: proposed, 2026-11-14.

*Context.* The heatmap, lanes, calendar and explainer need each person's availability and leaves, which schema v2 lacks. TaskJuggler levels as it schedules, so "over" cannot mean booked above available.

*Decision.*
1. Bridge schema v3 (phase-3.md 6.1), with goldens re-recorded and a native weekly-load cross-check.
2. Load is derived exactly from `bookings`. Hours are booked time; effective effort is shown in the cell details.
3. Bands use two thresholds (80% and 100% by default, per plan). A cell is also over when work is held or unmet for that person (5.4).
4. The ADR-0007 display-data rule extends to load, demand, causes and health. These are derived, never sent to the engine, and interpretations are labelled.
5. New intents `clearLeave` and `gapToTask`. No intents for alternatives until Phase 5.
6. Phase 3 health set H1 to H9 with the defaults in 18.8.

*Consequences.* There is one schema bump and one re-record (provisional on Ruby 3.3.6). The serializer reads the resource scoreboard after scheduling. Explanations can say "the schedule does not show why".