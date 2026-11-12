# Phase 2: Gantt and visual editing

Status: approved by the user 2026-11-12, every recommendation in section 18 accepted as written. Phase 2 starts once the Phase 1 gate evidence is recorded (the user approved the Phase 1 gate in advance, conditional on that). Sources: `docs/BUILD_PLAN.md` ("Phase 2", "UX and interaction design" (modes, views, direct manipulation, gesture rules, layouts, design system), "Performance budgets", "Architecture" (engine worker, edit pipeline, state, rendering), "Planning best practices", "Testing and quality", "Risks and mitigations", "Claude Code execution plan"); `docs/phases/phase-0.md` and `phase-0-gate.md`; `docs/phases/phase-1.md` (§6, §7, §8 and §15.1 to §15.25); `docs/phases/phase-1-audit.md`; ADR-0001 to ADR-0006; and the code in `src/lib/tjp/edit/`, `src/lib/workspace/`, `src/engine/protocol.ts`, `src/lib/state/` and `src/components/`. Section 18 lists the open questions, each with a recommended answer. Section 19 lists conflicts with the plan. This spec does not settle them silently.

## 1. Scope

| In scope | From the plan |
| --- | --- |
| Canvas Gantt: outline columns, timeline, zoom from day to quarter, collapse and expand, summary bars, milestones, dependency lines, critical path, float tails, today line and status-date line | Phase 2, bullet 1; Views 1; Product scope, Gantt (MVP) |
| Text, Split and Visual modes, with a top-bar toggle and Cmd/Ctrl+1/2/3; two-way selection sync; "show source" sheet in Visual mode | Phase 2, bullet 2; "Editing modes" |
| Inspector for tasks and links, plus a project settings sheet (see 19.9) | Phase 2, bullet 2; Product scope, Visual editing |
| Every MVP gesture on mouse and touch, with keyboard and inspector equivalents: each row of the direct-manipulation table, plus add and delete task | Phase 2, bullet 2; Direct manipulation; gesture rules |
| Unified undo and redo across text and visual edits; a toast with Undo for every visual edit | Phase 2, bullet 2; Direct manipulation ("shown as a toast with Undo") |
| Engine data the Gantt needs (bridge schema v2) and display data derived from it (section 5) | "Engine worker" (the bridge grows); "Show the driving path" |
| Spike: the parse-skipping fast path, adopted only if equivalence tests pass | Phase 2, bullet 3 |
| Desktop, tablet and phone layouts, light and dark; phone tab bar gains **Gantt** | Layouts; CLAUDE.md "Mobile counts" |
| Performance: 60 fps scroll with 500 tasks, measured in CI under emulation and on a real mid-range Android device; drag feedback under 16 ms; reschedule time recorded | Gate; Performance budgets; Phase 1 audit §4 |
| Accessibility: ARIA treegrid mirror of the Gantt, keyboard model, WCAG 2.2 AA target sizes and non-drag alternatives | Design system (Accessibility) |
| Carry-overs: engine version and timings in `/app` (Phase 0 gate); intents dispatched from views gated on Android's held Enter (audit §5); 44 px coarse-pointer targets (audit §3.3); real-device keystroke measurement (audit §4) | `phase-0-gate.md`, `phase-1-audit.md` |

## 2. Non-goals

- No Resources, Workload or Calendar views, no people lanes, no heatmap and no plan health panel (Phase 3). The view switcher shows Gantt only.
- No scenario switcher, compare overlay or baseline ghost bars (Phase 5). The Gantt draws the first active scenario, the one `finishScenario` picks.
- No filters by person or flag, and no PNG or CSV export (19.10).
- No resource inspector, resource table, leave painting or working-hours editing in views (Phase 3). The edit API already supports them.
- No storage, file save, Dexie cache, service worker or wasm code cache (Phase 4). The only persistence is UI preferences in `localStorage` (18.5). Plan text is never stored.
- No v1 gestures: `onstart`/`onend` link types, allocation alternatives, limits, bulk edit across a selection.
- No renaming of ids. Rename edits the name string only, as in Phase 1.
- No real-time animation of successors while dragging. The preview moves only the dragged item (7.3).
- No change to `engine/tj/`. Everything new in the engine is bridge code.
- No new runtime dependency: no Gantt, canvas or gesture library (Tech stack: "Pointer Events; no gesture library").
- The fast path is a spike. If it fails its equivalence tests, the app keeps full reparses and nothing else in this spec changes.

## 3. Starting point

- **Engine.** `ScheduleResult` v1 (`src/engine/protocol.ts`) gives, per task and per active scenario: `scheduled`, `start`, `end` (integer minutes since `project.start`), `allocated`, and TaskJuggler's `criticalness` and `pathCriticalness`. Per-task scenario dates are already there. Missing: resolved dependencies, `complete`, scheduling direction, the project's working time and `dailyworkinghours`. TaskJuggler's `criticalness` values are resource-contention scores that it uses to order scheduling. They are not a CPM critical path and give no float (19.6). Fedora takes 3.7 to 4.6 s in the worker on CI hardware, Tutorial 0.87 s and poc-sample 0.54 s (phase-0 gate).
- **Edit API.** `applyIntent(ws, index, intent, opts)` is pure and returns a `TjpEdit` with per-file `changes`, `inverse`, `base` versions, `targets` and `select`, or a refusal or no-op. `applyEdit` applies an edit and records the versions it produced. `undoEdit(applied, now)` builds the inverse only while those versions are current. Every intent type in phase-1 §7.1 is implemented and passes the fidelity suite. Timings: the caller reports that intents now take 15 to 35 ms on Fedora. The audit table (§2.1) still shows 150 to 270 ms for the structural intents and 2 to 3 ms for `setAttr` and `renameTask`. T6 measures again (19.19).
- **Workspace.** It holds one `EditorState` per file, each with its own CodeMirror `history()`. `Workspace.apply` dispatches one transaction per file, annotated with `tjpEditId` and `isolateHistory('full')`, with origin `'intent'` or `'format'`. Subscribers get `ChangeInfo.transactions`.
- **Runner.** Origin `'typing'` waits 300 ms of quiet. `'intent'` and `'format'` run at once, and they first derive the full view (index rebuild) synchronously. The index catches up with typing after a 150 ms pause, or at most 1 s into a burst, so `indexVersion` can lag `version`. `latest` and `lastGood` are kept, and `outdated` dims the last good result. Handling a result is one task of 50 to 170 ms on `scale-1000` (audit §4).
- **UI.** Text mode only: `App.svelte`, `EditorPanel`, `OutlinePanel`/`OutlineTree` (ARIA tree), `StatusStrip`, `TabBar` (Plan and Text), and breakpoints at 600 and 1024 (`layout.svelte.ts`). `EditorController` keeps the one `EditorView` in step with the workspace by calling `setState` in a microtask after outside edits. `androidKeyPending(view)` exists in `src/lib/tjp/cm/lint.ts`. `strings.ts` already holds one sentence per `RefusalReason`.
- **Sizes.** `/app` JS is 280 KB gzip. CI enforces under 450,000 bytes gzip (audit §2.5).
- **Goldens.** Still provisional (Ruby 3.3.6) unless the Phase 1 gate closes the Ruby 3.4 re-record (ADR-0003 #5, amended).

## 4. Module layout

```text
engine/bridge/serialize.rb          # schema v2 fields (6.1)
engine/bridge/fast_path.rb          # spike only (section 12); not loaded unless adopted
src/engine/protocol.ts              # v2 types; FastPatch (only if the spike is adopted)
src/lib/schedule/
  working-time.ts                   # project working time: snapping, working spans (6.2)
  date-text.ts                      # minutes -> TaskJuggler date and duration text (6.2)
  critical.ts, float.ts             # driving links, critical path, total float (6.2)
src/lib/gantt/
  model.ts                          # rows from the index joined with engine dates (6.3)
  scale.ts, ticks.ts                # time scale, zoom levels, header ticks (Intl)
  layout.ts, hit.ts                 # geometry shared by painting and hit testing (6.4)
  paint/grid.ts, paint/bars.ts, paint/links.ts, paint/overlay.ts
  intents.ts                        # GanttAction -> EditIntent (6.6)
  prefs.ts                          # move preference, zoom, collapse (localStorage)
src/lib/gesture/
  machine.ts, long-press.ts, pinch.ts, snap.ts   # pointer state machine (6.5)
src/lib/workspace/history.ts        # unified undo and redo (6.7)
src/lib/state/
  edits.svelte.ts                   # edit dispatcher, pending edits, toasts (6.8)
  selection.svelte.ts               # selection and two-way sync (6.10)
  mode.svelte.ts                    # Text / Split / Visual, per workspace
src/components/gantt/
  Gantt.svelte, Timeline.svelte (canvas layers), OutlineGrid.svelte (treegrid),
  TimeHeader.svelte, LinkMode.svelte, PeoplePalette.svelte, RowDragIndicator.svelte
src/components/inspector/
  Inspector.svelte, TaskFields.svelte, LinkFields.svelte, ProjectSheet.svelte,
  Stepper.svelte, SourceSheet.svelte
src/components/app/
  ModeToggle.svelte, SplitDivider.svelte, Toasts.svelte (TopBar, TabBar extended)
src/pages/dev/_gantt-perf.astro     # perf harness page, dev pages only
scripts/perf-android.mjs            # real-device runner (Playwright, experimental Android support)
tests/e2e/gantt-*.spec.ts, tests/fixtures/gantt/**
```

Every `src/lib` module has a `*.test.ts` beside it. `strings.ts` will pass 400 lines. It stays one file (CLAUDE.md "one strings file") and says why in its header.

## 5. Engine data for the Gantt

### 5.1 Where each item comes from

| Gantt needs | Source | Why |
| --- | --- | --- |
| Task tree, names, ids, text-only state | Symbol index (`run.index`, with engine hints) | The text is the source of truth. A rename, add, delete or move shows at once, before the reschedule |
| Start and end per scenario, scheduled flag, allocated people | Engine result (v1, already present) | Schedule |
| Resolved dependencies per task and scenario (after inheritance, `precedes` included, gaps, `onstart`/`onend`) | **Bridge v2** | TaskJuggler resolves inheritance at creation, scenarios and macro-built dependencies (phase-1 §15.19 and §15.20). Doing that again on the main thread would mean reimplementing parser semantics |
| Scheduling direction (asap/alap) | **Bridge v2** | Positional and inherited (§15.20). The engine knows the answer |
| `complete` | **Bridge v2** | Needed for the progress handle (row "Mark progress") |
| Project working time (global working hours minus global leaves), `dailyworkinghours` | **Bridge v2** | Snapping to working days, effort units and float in working days. This is TaskJuggler's own project scoreboard (`Project#isWorkingTime`), so time zones and DST come out right |
| Dependency lines to draw and remove | Index `DependencySite`s, with engine dependencies as a read-only fallback | Lines that can be removed must map to text. Dependencies only the engine knows are drawn dashed and cannot be removed |
| Critical path, driving links, total float | **Derived on the main thread** (6.2) from the result | The plan says "computed in the app from the scheduled dates and dependencies" |
| Today line | `Date.now()` | Display |
| Status-date line | `project.now` from the result | TaskJuggler's `now`. The runner never sends `options.now`, so a plan without `now` gets the clock, aligned to the hour (19.17) |

### 5.2 The rule for derived data (ADR-0007)

CLAUDE.md says no schedule is ever computed outside the engine. Phase 2 computes **display data only**. That means pure functions of a `ScheduleResult` (and the index, for mapping to text) whose output:

- is never sent to the engine;
- never becomes a task's start or end;
- is never shown as a date the engine produced.

In particular:

- Float and the critical path are estimates. They ignore resource limits and leveling, and the inspector labels them that way.
- The drag preview moves only the dragged item.
- Snapped dates in a drag label are targets ("start Mon 9 Mar"), not results.

ADR-0007 records this line and the bridge v2 decision (18.1, 18.2).

### 5.3 Golden impact

Bridge v2 changes the serializer that both sides share, so:

- `GoldenFile.schemaVersion` becomes 2;
- every golden is re-recorded by `npm run golden:record`;
- golden parity must stay green.

Under ADR-0003 #5 (amended) the change may merge with goldens re-recorded on Ruby 3.3.6, which stay provisional. If the Ruby 3.4 re-record is still open when T2 merges, the user records once, after T2, so that one 3.4 recording covers schema v2. The cross-check (`cross-check.tji`) gains a dependency column if TaskJuggler's CSV report can print one. If it cannot, the gate says so.

## 6. Interfaces

All times are integer `Minutes` since `ProjectInfo.start` (ADR-0002 #4). Views use `Intl` only to display them.

### 6.1 Protocol, schema v2 (`src/engine/protocol.ts`)

```ts
export interface ProjectInfo {
  // ... v1 fields unchanged
  /** Hours in a working day (`dailyworkinghours`); converts 'd', 'w', 'm', 'y' effort units. */
  dailyWorkingHours: number;
  /** Global working time over the frame: [start, end) pairs, ascending, merged.
   *  From the project scoreboard (global working hours minus global leaves). */
  workingTime: Array<[start: Minutes, end: Minutes]>;
}
export interface TaskScenarioResult {
  // ... v1 fields unchanged
  direction: 'asap' | 'alap';
  /** `complete` in percent as TaskJuggler holds it for this scenario; null when unset. */
  complete: number | null;
  /** This task's own start waits on these (TaskJuggler `depends`, after inheritance). */
  depends: DependencyResult[];
  /** This task's own end must precede these (TaskJuggler `precedes`, after inheritance). */
  precedes: DependencyResult[];
}
export interface DependencyResult {
  task: string;              // the other task's full id
  onEnd: boolean;            // TaskDependency#onEnd: the other task's end (true) or start
  gapDurationMin: number;    // calendar minutes (TaskDependency#gapDuration / 60)
  gapLengthMin: number;      // working minutes (gapLength slots x timingResolutionMin)
}
```

Lists are in TaskJuggler's order. A dependency that names a missing task is left out; TaskJuggler reports those as messages. The worker protocol messages are unchanged.

### 6.2 Derived display data (`src/lib/schedule/`)

```ts
// working-time.ts
export interface WorkingTime {
  /** Start of the working day containing or after m (first working slot of that day). */
  dayStart(m: Minutes): Minutes;
  /** End of the working day containing or before m. */
  dayEnd(m: Minutes): Minutes;
  /** Working minutes in [a, b). */
  workingBetween(a: Minutes, b: Minutes): number;
  /** The instant `work` working minutes after a. */
  addWorking(a: Minutes, work: number): Minutes;
  /** Shift by whole working days (negative allowed), keeping the time-of-day role (start or end). */
  shiftDays(m: Minutes, days: number, role: 'start' | 'end'): Minutes;
}
export function workingTimeOf(p: ProjectInfo): WorkingTime;

// date-text.ts (Phase 1 §6.5: "Converting Minutes to date text is Phase 2's job")
/** TaskJuggler date text in the project's zone: '2026-03-09', or '2026-03-09-13:00' when not at
 *  midnight. Parses back to the same instant with values/date.ts (property-tested, DST included). */
export function dateText(m: Minutes, project: ProjectInfo, zones: ZoneOffsets): string;
/** Duration text in a given unit, rounded to whole units, at least 1: ('d', 2880 working min) -> '6d'. */
export function durationText(workMin: number, unit: DurationUnit, project: ProjectInfo): string;

// critical.ts, float.ts
export type Driver =
  | { kind: 'dependency'; pred: string; via: 'depends' | 'precedes' }
  | { kind: 'frame' }          // starts at the project start or ends at the project end
  | { kind: 'unexplained' };   // resource, leave, limit or constraint: Phase 3 explains
export interface DrivingAnalysis {
  readonly scenario: string;
  readonly finish: Minutes | null;                  // finishMinutes()
  readonly critical: ReadonlySet<string>;           // task ids on a driving path to the finish
  readonly criticalLinks: ReadonlySet<string>;      // `${pred}>${succ}`
  readonly driver: ReadonlyMap<string, Driver>;
  readonly floatMin: ReadonlyMap<string, number>;   // total float, working minutes, >= 0
  readonly lateEnd: ReadonlyMap<string, Minutes>;   // where the float tail ends
}
export function analyse(r: ScheduleResult, scenario: string, wt: WorkingTime): DrivingAnalysis;
```

Rules:

- **Driving link.** An edge p to s (s `depends` on p's end, gap g) drives when s.start equals the earliest start the edge allows, within one timing-resolution slot. The earliest start is `addWorking(p.end, gapLength)`, or `p.end + gapDuration`, whichever is later, moved to the next working slot. `onStart` edges and `precedes` edges (which drive ALAP ends) use the same rule on the other side.
- **Critical path.** Start from the tasks whose end equals the scenario finish and follow driving edges backwards. Tasks that end before the status date are drawn but not highlighted ("from status date to the end", best practices).
- **Total float.** A backward pass over the resolved lists. A task's late end is the minimum of the finish and, over its outgoing edges, the successor's late start minus the gap. A successor's late start is its late end minus its scheduled working span. A container's late end bounds its descendants. Hard constraints and resources are ignored, so float is an upper bound. The UI says "about" and the treegrid column says "float (estimate)".
- **Cost.** Runs once per result, in an idle task: at most 10 ms for 500 tasks on desktop, recorded at 4x throttle.

### 6.3 Gantt model (`src/lib/gantt/model.ts`)

```ts
export interface GanttRow {
  readonly id: TaskId; readonly depth: number; readonly name: string;
  readonly kind: 'task' | 'container' | 'milestone';
  readonly expanded: boolean | null;              // null for leaves
  readonly start: Minutes | null; readonly end: Minutes | null;  // engine; null until scheduled
  readonly scheduled: boolean;
  readonly direction: 'asap' | 'alap' | null;
  readonly sizing: { attr: 'effort' | 'length' | 'duration'; text: string; unit: DurationUnit } | null;
  readonly openEnded: boolean;                    // allocated leaf with no size or end (11.1)
  readonly allocated: readonly string[];
  readonly complete: number | null;
  readonly critical: boolean; readonly floatMin: number | null; readonly lateEnd: Minutes | null;
  readonly textOnly: TextOnlyReason | null;       // gestures and fields off, badge shown
  readonly pending: PendingMark | null;           // preview geometry until the result arrives
}
export interface GanttLink {
  readonly pred: TaskId; readonly succ: TaskId;
  readonly site: DependencySite | null;           // null: engine-only, dashed, not removable
  readonly critical: boolean;
}
export interface GanttModel {
  readonly rows: readonly GanttRow[];             // visible rows, pre-order, collapse applied
  readonly rowOf: ReadonlyMap<TaskId, number>;
  readonly links: readonly GanttLink[];
  readonly frameEnd: Minutes; readonly now: Minutes; readonly today: Minutes | null;
  readonly scenario: string | null;
  readonly dimmed: boolean;                       // RunnerState.outdated
  readonly revision: Revision | null;
}
export function buildGanttModel(i: {
  index: SymbolIndex; run: RunnerState; collapsed: ReadonlySet<TaskId>;
  analysis: DrivingAnalysis | null; pending: PendingEdits; today: Minutes | null;
}): GanttModel;
```

- The rows' structure comes from the index. Dates come from `run.lastGood`, joined by task id.
- While an edit is pending, `PendingEdits.renames` maps old ids to new ones (from `moveTask`), so a moved task keeps its old bar until the result arrives.
- A new task gets a row with no bar ("not scheduled yet"). A deleted task's row goes at once.
- The model is rebuilt when the index or the result changes, never per frame. The per-frame inputs are only scroll offset, scale and the drag overlay.
- Layout data sits in typed arrays (row tops, start and end in minutes), so painting a frame allocates nothing.

### 6.4 Layout, painting and hit testing (`src/lib/gantt/layout.ts`, `hit.ts`)

```ts
export interface TimeScale { readonly pxPerMin: number; readonly originMin: Minutes;
  x(m: Minutes): number; m(x: number): Minutes }
export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';   // plus continuous zoom between
export interface GanttLayout {
  readonly rowHeight: number;                 // 28 px fine pointer, 40 px coarse
  readonly scale: TimeScale;
  readonly viewport: { top: number; left: number; width: number; height: number };
  barRect(row: number): Rect | null;
  handleRects(row: number, pointer: PointerKind): HandleRects;   // hit areas, not drawn sizes
  linkPath(link: number): readonly Point[];
}
export type Hit =
  | { kind: 'bar'; row: number; part: 'body' | 'end-handle' | 'link-dot' | 'progress' }
  | { kind: 'link'; link: number }
  | { kind: 'row-handle'; row: number }
  | { kind: 'empty'; row: number | null; at: Minutes };
export function hitTest(layout: GanttLayout, model: GanttModel, x: number, y: number,
  pointer: PointerKind, selected: TaskId | null): Hit;
```

Painting and hit testing use the same `layout` functions, so what a pointer hits is what was drawn. Hit areas are at least 24 x 24 CSS px for a fine pointer and 44 x 44 for a coarse one, whatever the drawn size (10.3). A link is hit within 12 px of its path.

### 6.5 Gesture state machine (`src/lib/gesture/machine.ts`)

```ts
export type PointerKind = 'mouse' | 'pen' | 'touch';
export interface GestureConfig { longPressMs: 350; slop: { mouse: 3; pen: 4; touch: 8 }; doubleTapMs: 300 }
export type GestureInput =
  | { type: 'down' | 'move' | 'up' | 'cancel'; id: number; kind: PointerKind; x: number; y: number;
      t: number; target: Hit; buttons: number; modifiers: Modifiers }
  | { type: 'timer'; t: number } | { type: 'escape' };
export type GestureOutput =
  | { type: 'tap'; hit: Hit; count: 1 | 2 } | { type: 'long-press'; hit: Hit }
  | { type: 'drag-start'; hit: Hit; x: number; y: number }
  | { type: 'drag-move'; x: number; y: number } | { type: 'drag-end'; x: number; y: number }
  | { type: 'drag-cancel' } | { type: 'pan-native' }
  | { type: 'pinch'; scale: number; cx: number } | { type: 'pan2'; dx: number; dy: number };
export interface GestureMachine { send(e: GestureInput): readonly GestureOutput[];
  readonly state: 'idle' | 'pressed' | 'armed' | 'dragging' | 'native' | 'pinching' }
export function createGestureMachine(cfg?: Partial<GestureConfig>): GestureMachine;
```

The machine is pure: time comes in through events, so tests run on fake timers. Its rules are in 7.2.

### 6.6 Gantt actions to edit intents (`src/lib/gantt/intents.ts`)

```ts
export type GanttAction =
  | { type: 'resize'; task: TaskId; end: Minutes }                 // snapped
  | { type: 'move'; task: TaskId; days: number }                   // whole working days, +/-
  | { type: 'link'; pred: TaskId; succ: TaskId }
  | { type: 'unlink'; link: GanttLink }
  | { type: 'reorder'; task: TaskId; parent: TaskId | null; index: number }
  | { type: 'assign' | 'unassign'; task: TaskId; resource: ResourceId }
  | { type: 'replace-person'; task: TaskId; from: ResourceId; to: ResourceId }
  | { type: 'rename'; task: TaskId; name: string }
  | { type: 'progress'; task: TaskId; percent: number }
  | { type: 'add'; parent: TaskId | null; index: number; name: string }
  | { type: 'delete'; task: TaskId };
export interface MovePreference { kind: 'start' | 'gap' }           // asked once (18.4)
export interface ActionContext { index: SymbolIndex; model: GanttModel; analysis: DrivingAnalysis;
  wt: WorkingTime; project: ProjectInfo; zones: ZoneOffsets; move: MovePreference | null }
export type Planned =
  | { status: 'intent'; intent: EditIntent; label: ToastLabel }
  | { status: 'ask-move-preference' }
  | { status: 'not-possible'; reason: 'milestone' | 'container' | 'text-only' | 'no-driver' };
export function planAction(a: GanttAction, ctx: ActionContext): Planned;
```

`planAction` builds the intent only. The edit API still decides refusals. Section 7 has the mapping for each row.

### 6.7 Unified undo (`src/lib/workspace/history.ts`; ADR-0008)

```ts
export type HistoryKind = 'typing' | 'intent' | 'format';
export interface HistoryEntry {
  readonly id: string;                     // the TjpEdit id, or a fresh id for a typing group
  readonly kind: HistoryKind;
  readonly label: string;                  // for toasts and announcements ("Effort of Code: 5d to 7d")
  readonly applied: AppliedEdit;           // changes, inverse, base and resulting versions
  readonly selectionBefore: Readonly<Record<WorkspacePath, EditorSelection>>;
  readonly selectionAfter: Readonly<Record<WorkspacePath, EditorSelection>>;
}
export type HistoryOutcome =
  | { status: 'done'; entry: HistoryEntry; direction: 'undo' | 'redo' }
  | { status: 'empty' }
  | { status: 'diverged'; entry: HistoryEntry };   // a file changed outside history: stacks cleared
export interface WorkspaceHistory {
  readonly canUndo: boolean; readonly canRedo: boolean;
  top(): HistoryEntry | null;
  undo(): HistoryOutcome; redo(): HistoryOutcome;
  subscribe(l: (h: WorkspaceHistory) => void): () => void;
  dispose(): void;
}
export function createHistory(ws: Workspace, opts?: { groupMs?: number /* 500 */; limit?: number /* 500 */ }): WorkspaceHistory;
export const tjpHistory: AnnotationType<'undo' | 'redo'>;
```

Design, built on the existing `inverse` and version checks, as phase-1 §6.5 planned:

- **One stack for the workspace.** CodeMirror's per-file `history()` is removed from the file states. `historyKeymap` is replaced by app commands (Mod-Z, Mod-Shift-Z, Mod-Y) that call `WorkspaceHistory`, in the editor and everywhere else. Undo is global. In Text mode, Mod-Z after a visual edit in another file undoes that edit, and says which one (19.8).
- **Entries.** The history subscribes to the workspace:
  - every `'intent'` or `'format'` apply becomes one entry, with its `TjpEdit` and the versions `applyEdit` records;
  - typing transactions join the current typing entry while all of these hold: same file, same user-event family (input or delete), less than `groupMs` since the last, and no other entry between;
  - otherwise a typing transaction starts a new entry;
  - a typing entry's changes are composed, and its inverse is inverted against the text before the group.
- **Undo** builds `undoEdit(entry.applied, snapshot)` and applies it through `Workspace.apply` with `tjpHistory.of('undo')` (not recorded as a new entry), origin `'history'`, and `selectionBefore` for the files it touches. **Redo** applies `changes` again.
- **Version re-stamping.** An undo or redo bumps file versions. The entry it uncovers is re-stamped: for each file it shares with the undone entry, its expected version becomes the new version. The text there is exactly what it was right after that entry; tests assert this with `Text.eq`. So `undoEdit`'s version check still catches any change that bypassed the history, and that case clears both stacks with `diverged`, never applying a wrong inverse.
- **Toast Undo** is enabled only while the toast's entry is `top()`. It then does exactly what Mod-Z does.

### 6.8 Edit dispatcher, pending edits and toasts (`src/lib/state/edits.svelte.ts`)

```ts
export type DispatchOutcome =
  | { status: 'applied'; edit: TjpEdit; entry: string }
  | { status: 'refused'; reason: RefusalReason; at: readonly SourceRange[]; message: string }
  | { status: 'noop'; reason: NoopReason }
  | { status: 'confirm-shared'; affects: readonly string[] }      // asks, then retries with confirmShared
  | { status: 'cancelled' };
export interface DispatchOptions { label: ToastLabel; coalesceKey?: string; confirmShared?: boolean }
export interface PendingEdits {
  readonly byTask: ReadonlyMap<TaskId, PendingMark>;   // preview geometry, from the gesture
  readonly renames: ReadonlyMap<TaskId, TaskId>;
}
export class EditDispatcher {
  dispatch(intent: EditIntent, o: DispatchOptions, preview?: PendingMark): Promise<DispatchOutcome>;
  readonly pending: PendingEdits;
  readonly toasts: readonly Toast[];
}
```

Order of work for one intent:

1. **Android gate.** The intent is planned first. If any file it changes is the one shown in a live editor view and `androidKeyPending(view)` is true, the dispatcher waits and retries every 16 ms. After about 500 ms it goes ahead anyway, the same cap as the lint push (audit §5).
2. **Fresh index.** `runner.ensureIndex()` (6.9) so that the plan uses an index of the current snapshot.
3. **Plan.** `applyIntent`. `stale` or `needs-schedule` re-plans once against the newest snapshot and index. A second refusal becomes a toast with `refusalStrings[reason]` and a "Show in text" action (`at[0]`). `shared-declaration` asks for confirmation, listing `affects`.
4. **Apply.** `applyEdit`, then a history entry, a toast and a pending mark keyed by the workspace version the edit produced.
5. **Settle.** The first runner state whose `latest.workspaceVersion` is at least that version settles the toast:
   - `ok` with no new error ids: the pending mark is dropped and bars animate to the engine's dates;
   - otherwise the toast reads "Changed. The plan no longer schedules: *first error*" with Undo and Show (11.2).
6. **Coalescing.** Intents with the same `coalesceKey` within 300 ms (keyboard nudges, stepper presses) update the preview only. One intent is dispatched after 300 ms of quiet, on blur or on Enter, and makes one undo step.

The editor follows workspace edits without `setState`. `EditorController` takes the `ChangeInfo.transactions` for the shown file that start from `view.state` and calls `view.update(transactions)`, so the view keeps its DOM, scroll and focus. It falls back to `setState` only when they do not chain (a reconfiguration). Reveals and the source-block highlight in Split mode wait on `androidKeyPending` the same way.

### 6.9 Runner changes (`src/lib/workspace/schedule-runner.ts`)

```ts
export interface ScheduleRunner {
  // ... Phase 1 members
  /** The index of the current snapshot, derived now if `indexVersion` lags. */
  ensureIndex(): SymbolIndex;
}
export type ChangeOrigin = 'typing' | 'format' | 'intent' | 'history';
```

- `'history'` behaves like `'intent'`.
- For `'intent'`, `'format'` and `'history'` the runner posts the schedule request first and derives the full view in the next task. The request needs only text, so the drop's main-thread work is split.
- Result handling is split so that no task exceeds 50 ms on `scale-1000` at 4x throttle: the index, the diagnostics and the Gantt model run in idle chunks. This addresses audit §4 and protects scrolling when a result lands mid-scroll.

### 6.10 Selection and two-way sync (`src/lib/state/selection.svelte.ts`)

```ts
export type Selection =
  | { kind: 'task'; id: TaskId; origin: 'text' | 'visual' }
  | { kind: 'link'; pred: TaskId; succ: TaskId; origin: 'visual' }
  | null;
/** The task whose declaration (or supplement) holds pos, using an index that may lag the text. */
export function taskAtCursor(run: RunnerState, ws: Workspace, file: WorkspacePath, pos: number): TaskId | null;
/** The task's declaration block in current coordinates, or its engine source line when the
 *  index cannot name it (expanded-only). */
export function sourceOf(run: RunnerState, ws: Workspace, id: TaskId): SourceRange | null;
```

- **Text to visual.** The cursor position is mapped back to `indexVersion` through `changesSince(indexVersion).invertedDesc`, then looked up with `index.symbolAt`. The bar is selected and scrolled into view without taking focus.
- **Visual to text.** The declaration range is mapped forward through `changesSince(indexVersion)`. In Split mode the editor scrolls to it and decorates the block (a "selected source" line background). The editor cursor moves only when the editor does not have focus.
- `origin` stops feedback loops.
- After `moveTask`, the selection follows the new id (`PendingEdits.renames`).

### 6.11 Workspace changes (`src/lib/workspace/workspace.ts`)

- `newState` no longer adds `history()` (6.7).
- `apply(edit, opts?: { origin?: ChangeOrigin; selection?: Readonly<Record<WorkspacePath, EditorSelection>>; annotations?: readonly Annotation<unknown>[] })`. The defaults are as today.
- `isolateHistory` is no longer needed and is dropped.

### 6.12 Fast-path protocol (only if the spike is adopted; section 12)

```ts
export interface ScheduleRequest { /* v1 fields */ fast?: FastPatch }
export interface FastPatch {
  base: Revision;                    // the full run whose parsed project the worker kept
  edits: Array<{ task: string; attribute: FastAttr; scenario: string | null; value: string }>;
}
export type FastAttr = 'effort' | 'length' | 'duration' | 'start' | 'end' | 'priority' | 'complete';
export interface Timings { /* v1 fields */ path?: 'full' | 'fast' }
```

`files` still carries the full text. The worker falls back to a full run whenever it does not hold `base` or any eligibility check fails.

## 7. Gestures

### 7.1 Gesture-to-intent mapping

The fixture is `tests/fixtures/gantt/manipulation/` (T3): a plan with siblings, containers, a chain, two files with an include, resources, an ALAP task, an open-ended allocated leaf and a macro-built task. The expected patches are hand-written from the plan's "Text change" column (T21), not produced by the edit API.

| # | Plan row | Desktop | Touch | Keyboard / inspector (WCAG 2.5.7 alternative) | Intent | Expected patch (fixture example) | Notes and refusals shown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Change effort or length | Drag a bar's right edge | Long-press bar, drag the end handle (on a selected bar the handle drags at once, 19.4) | Shift+Alt+Right/Left: plus or minus one unit; inspector stepper | `setAttr` with the task's own sizing attr. With none and no `end`: `effort` if allocated, else `length` (18.13). A start-and-end task: `setAttr end` | `effort 5d` becomes `effort 7d` (value token only) | `length` = working days between start and the snapped end; `duration` = calendar days; `effort` = old x new span / old span, rounded to whole written units, label marked "about". Milestones and containers: no handle. `conflicting-attribute` and `macro-in-body` come from the edit API |
| R2 | Move a task later | Drag the bar body | Long-press, then drag | Alt+Right/Left: one working day; inspector start field or stepper | Preference `start` (default for tasks without a driving predecessor): `setAttr start` for ASAP, `setAttr end` for ALAP (19.2). Preference `gap`: `setDependsGap(task, driver, { kind: 'gaplength', value })`, gap = old + days; 0 or less gives `gap: null` | `start 2026-03-09` inserted at its rank in the 7.2 order (after `responsible`, before `effort`), or the existing value rewritten; or `depends !spec` becomes `depends !spec { gaplength 2d }` | The first move asks once and remembers (18.4). The `start` option warns once that this creates a constraint. The preview clamps at the driving predecessor's earliest start, so it cannot drop earlier than its dependencies allow. `task_pred_before` and similar are schedule-dependent (11.2) |
| R3 | Link tasks | Drag from a bar's end dot onto another bar | Tap the link handle, then tap the target (link-mode banner with Cancel) | L, then arrows and Enter to pick the successor; inspector "Add dependency" picker | `addDepends(task = target, target = source)` | `depends !design` inserted in the successor, or `, !design` appended to its last own `depends`; an absolute id for non-siblings | Hovering a target dry-runs `applyIntent` once per target change (in an idle task) and shows allowed or not allowed (`cycle`, `already-linked`, `conflicting-attribute`). A drop on itself or an ancestor shows `cycle` |
| R4 | Remove a link | Select the line, then Delete | Tap the line, then tap Remove | Inspector dependency list, Remove button | `removeDepends(succ, pred)` | The `!design` item and one adjacent comma removed, or the whole `depends` line | Engine-only (dashed) lines cannot be selected for removal; their tooltip and sheet say "written in a macro; edit as text" |
| R5 | Reorder or reparent | Drag a row in the outline grid; horizontal offset sets the depth (one indent step = 16 px) | Long-press the row handle, drag; drop indented to nest | Alt+Shift+Up/Down (reorder), Alt+Shift+Right/Left (indent or outdent); row menu buttons | `moveTask(task, parent, index)` | The block cut and inserted, re-indented, references fixed across files (`depends app.b` becomes `depends core.b`) | Drop indicator shows the depth. Collapsed rows auto-expand after 600 ms of hover. `cycle`, `id-collision`, `unfixable-reference`, `shared-declaration` |
| R6 | Assign a person | Drag a chip from the people palette onto a bar | Tap the bar, then tap the people chips in the inspector sheet | Inspector chips (Space toggles) | `addAllocation` / `removeAllocation` | `allocate dev1` becomes `allocate dev1, dev2`, or `allocate dev2` inserted | Removing the last allocation of an effort leaf: `conflicting-attribute`. Inherited: `inherited` |
| R7 | Rebalance load | (heatmap: Phase 3) | (heatmap: Phase 3) | Inspector: a chip's "Replace with..." menu | `replaceAllocation(task, from, to)` | `allocate dev1` becomes `allocate dev2` (one id token) | The row's gesture needs the Phase 3 heatmap (19.1, 18.3) |
| R8 | Rename | Double-click the name cell | Tap the name in the inspector | F2 on the row; inspector name field | `renameTask` | `task code "Write code"` becomes `task code "Implement"` | `unsafe-text` for `${`, `$(` or a newline |
| R9 | Mark progress | Drag the progress handle inside a bar | Drag the handle (selected bar) | Inspector stepper (5% steps), P then arrows | `setAttr complete` | `complete 40` inserted or rewritten | Snaps to 5%. Leaves only. A thin progress fill is drawn so the handle has a position (19.3) |
| R10 | Navigate | Scroll; Shift+scroll pans time; Ctrl+scroll zooms | One-finger pan (native), pinch zooms time, two-finger pan | Arrow keys move rows, PageUp/PageDown, Ctrl/Cmd+= and Ctrl/Cmd+- zoom, T jumps to today | none | The text is unchanged (asserted) | Undo does not apply (19.13) |
| extra | Add, delete | Toolbar and row menu; Delete key | Inspector sheet buttons | Insert / Mod+Enter (add after), Delete | `addTask` / `deleteTask` | As phase-1 §7.1 | Product scope, Visual editing (MVP) |

Every row's intent goes through the dispatcher (6.8), so each one is one undo step, has a toast with Undo, and its refusals use the strings already in `strings.ts`.

### 7.2 Gesture rules

- **Mouse and pen.** A press on a draggable part becomes a drag after 3 px (pen 4 px), with pointer capture. A press with no movement is a tap (select). Two taps within 300 ms on the name cell start a rename.
- **Touch.**
  - A press starts a 350 ms long-press timer.
  - Moving more than 8 px before it fires hands the gesture to native scrolling (`pan-native`), and the following `pointercancel` is ignored.
  - When the timer fires the item lifts (visual lift, `navigator.vibrate(10)` where available) and the next move starts the drag.
  - On a bar that is already selected, its visible handles (end, link, progress) drag at once after the 8 px slop (19.4).
- **Two pointers.** Pinch scales time around the centroid. Two-finger movement pans time. Both cancel any single-pointer press.
- **Cancel.** Escape, `pointercancel` during a drag, or a drop within the slop of the origin cancels with no intent.
- **Edge auto-scroll** during a drag, up to 600 px/s.
- **Snapping.** Dates snap to working days (`WorkingTime.dayStart` and `dayEnd`), because the coarsest-to-finest zoom range is day to quarter. The live label shows the resulting value and the target date ("effort 7d, ends about Wed 11 Mar").
- **Text-only tasks** show no handles and a not-allowed cursor. A long-press on one opens the source sheet.

### 7.3 Latency budget and what runs when

| Stage | Budget | What runs |
| --- | --- | --- |
| Pointer move to preview painted | Under 16 ms per frame. Script at most 4 ms desktop, 8 ms at 4x throttle | Gesture machine, snapping, overlay canvas redraw in rAF. **No edit API, no engine** |
| Drag start (bar, handle) | One idle task | A dry run of the likely intent (for example `setAttr effort` with the current value plus one) to hide handles that would be refused (`text-only`, `macro-in-body`, `inherited`) |
| Link target change | One idle task per target | Dry run of `addDepends` |
| Drop to pending bar painted | Next frame | Preview kept, styled pending (hatched outline). The intent is dispatched in a task after that paint |
| Drop to intent applied | At most 50 ms on Fedora (desktop), split into tasks of at most 50 ms at 4x throttle | `planAction`, `applyIntent` (2 to 35 ms on Fedora), `applyEdit`, history, toast; the runner posts the schedule request, then derives in the next task (6.9) |
| Drop to rescheduled result painted | Under 1 s for plans up to 200 tasks (plan budget; recorded, enforced in Phase 6) | Engine run, result handling in idle chunks, 150 to 200 ms bar animation (none with reduced motion) |

**Does live drag feedback use the edit API?** No. At 15 to 35 ms an intent is one to two frames, so running one per pointer move would drop frames on a phone. The preview stays visual-only until the drop, and only dry runs at drag start and target change touch the edit API.

**The 300 ms debounce.** It applies to typing only. A drag produces exactly one intent, at the drop, and that runs at once, as the runner already does for `'intent'`. Repeated keyboard nudges and stepper presses are coalesced for 300 ms in the dispatcher (6.8, 19.7), so they do not start one engine run and one index rebuild per key. Typing in Split mode and dragging cannot overlap, because focus is in one place.

**Where the fast path fits.** Only at the drop, and only for in-place value rewrites (R1 rewrite, R2 `start` rewrite, R9 rewrite, and undo or redo of those). It cuts engine time by up to about the 45% the plan attributes to parsing, and does not change the preview.

## 8. Rendering and performance

### 8.1 Structure

- **Scroll container.** One native scroll container holds a spacer sized to rows x row height by frame width.
  - Native scrolling gives momentum, scrollbars, keyboard scrolling and accessibility for free.
  - The outline grid (DOM) and the timeline share its vertical scroll.
  - The outline columns are frozen with `position: sticky`.
- **Canvas layers inside it,** each `position: sticky` and the size of the viewport plus overscan:
  1. grid (non-working-day shading, today and status-date lines, header ticks);
  2. bars and dependency lines;
  3. overlay (selection, focus ring for keyboard users, drag ghost, link rubber band, drop indicator).
  - The grid and bars layers redraw only on scroll past the overscan, on zoom, or on a model change. The overlay redraws during gestures.
- **Virtualisation.**
  - Rows: only visible rows plus 10 rows of overscan are painted or mounted (DOM grid rows are recycled).
  - Time: only bars and ticks that intersect the visible minute range.
  - Links: every link is checked against the viewport with a bounding test (about 600 links for 500 tasks, well under 0.1 ms).
- **devicePixelRatio.** Backing size = CSS size x min(dpr, 2). On a 2.625-dpr Pixel 7 this saves about 40% of fill against full dpr. `setTransform(dpr)`, lines snapped to device pixels, and a `matchMedia('(resolution: …)')` listener redraws on a dpr change. Text width is measured once per font and cached; drawing waits for `document.fonts.ready`.
- **No OffscreenCanvas worker.** The main-thread work per frame is small: about 20 to 40 rows, tens of links, and the overlay. A worker would add a postMessage hop between pointer input and paint, which works against the 16 ms drag-feedback budget. It would be reconsidered through an ADR only if T22 shows paint as the bottleneck.
- **Animation after a reschedule.** Visible bars tween from old to new geometry in 150 to 200 ms. `prefers-reduced-motion` turns it off.

### 8.2 Touch and scrolling

- The timeline uses `touch-action: pan-x pan-y`. One-finger pan stays native; pinch is ours.
- A long-press drag must stop native scrolling. A non-passive `touchmove` listener calls `preventDefault` only while the machine is `armed` or `dragging`. During the long press the finger has not moved, so the first `touchmove` after it can be cancelled before scrolling starts.
- **Risk.** A non-passive touch listener makes Chrome wait for the main thread on each `touchmove`. The listener returns at once when idle, and result handling is chunked (6.9). T22 measures scroll with and without the listener. If the main-thread dependency costs frames on the device, the fallback is `touch-action: none` on the selected bar's handle elements only (DOM overlay), with long-press on unselected bars dropped in favour of tap-to-select, then drag the handles. That would need an ADR (19.4).
- Ctrl+wheel (and trackpad pinch) zoom needs a non-passive `wheel` listener, with the same caution.

### 8.3 Main-thread work outside frames

- Gantt model and analysis: rebuilt once per index or result change, in an idle task. At most 10 ms each for 500 tasks on desktop.
- Result handling: chunked so that no task exceeds 50 ms (6.9).
- Before the first schedule, rows come from the index and bars show a "Scheduling..." placeholder. There is no cached schedule until Phase 4.

### 8.4 Measuring 60 fps in CI (emulation)

`tests/e2e/gantt-perf.spec.ts`, Chromium:

- **Profiles.** Pixel 7 emulation with 4x CPU throttling (`Emulation.setCPUThrottlingRate`), and desktop without throttling.
- **Plan.** The `gantt-500` fixture (T3): 500 tasks, all expanded, at day zoom and week zoom, after the engine is ready. Engine boot is excluded, because its stall is the known Phase 0 deviation and the wasm code cache comes in Phase 4.
- **Scenarios:**
  - a scripted vertical scroll through all rows and back with `Input.synthesizeScrollGesture` (a real compositor scroll);
  - a horizontal pan across the frame;
  - a pinch from day to quarter with `Input.synthesizePinchGesture`;
  - a 3 s bar drag;
  - a scroll during which a result arrives (the runner is triggered by an edit at the start of the scroll).
- **Metrics:**
  - frame intervals from rAF;
  - Long Animation Frames entries;
  - dropped frames from a Chromium trace (frame presentation events);
  - script time per frame;
  - drop-to-paint and drop-to-reschedule;
  - written to `test-results/gantt-perf.json`.
- **Enforced in CI** as regression catchers only, because headless runners have no GPU and share CPUs:
  - desktop: at most 5% dropped frames and no frame over 50 ms during scroll;
  - drag script time p95 under 8 ms;
  - the throttled profile is recorded, not failed.
- **Nightly:** the same, with history kept so regressions show.

### 8.5 Measuring on a real device (gate)

- **Device.** The user provides a mid-range Android phone with Chrome stable (proposal in 18.7: a 2022 to 2024 device in the Pixel 6a/7a or Galaxy A54 class). Battery over 50%, no power saving, refresh rate recorded. On a 90 or 120 Hz screen the target is still 16.7 ms per frame.
- **Build.** `npm run build` with dev pages, served locally and forwarded with `adb reverse`.
- **Automated run.** `scripts/perf-android.mjs` (T22) drives Chrome on the device through Playwright's experimental Android support (`_android`). If that fails, it uses CDP over `chrome://inspect`. It runs the 8.4 scenarios with the same trace collection and writes `test-results/gantt-perf-android.json`.
- **Manual pass.** A fling session with the in-page frame meter on `/dev/gantt-perf` is a second check. A screen recording is optional.
- **The same run** also records keystroke latency in Text mode on Fedora, which audit §4 deferred to this gate.

## 9. UI and layouts

### 9.1 Modes

- A segmented control in the top bar (Text, Split, Visual) and Cmd/Ctrl+1/2/3. The choice persists per workspace (sample id) in `localStorage` (18.5).
- Defaults: Split on desktop, Visual on tablet, the Gantt tab on phone (18.5).
- **Text** is Phase 1's mode unchanged, except for unified undo.
- **Split** puts the editor and the Gantt side by side, with selection sync (6.10).
- **Visual** shows the Gantt and inspector. A **Show source** button opens the selected task's block in a read-only sheet, highlighted with `@lezer/highlight` (no CodeMirror view, so phones need not load it), with "Open in Text".

### 9.2 Layout per breakpoint

| Width | Text | Split | Visual |
| --- | --- | --- | --- |
| Desktop, 1024 px and up | As Phase 1: outline, editor, status strip | Editor left, divider (drag, or arrow keys on a `role="separator"` with `aria-valuenow`), Gantt centre, inspector right (320 px, collapsible). The Phase 1 outline becomes a toggled drawer (the Gantt grid is the task outline) | Gantt and inspector; people palette as a collapsible panel above the inspector; outline drawer toggle |
| Tablet, 600 to 1023 px | As Phase 1 (outline drawer) | Stacked: Gantt above, editor below, swipeable divider with a 44 px handle and keyboard support | Gantt full width; inspector as a bottom sheet; people chips in the sheet |
| Phone, under 600 px | Tab bar **Plan / Gantt / Text** (People arrives in Phase 3). No Split. Gantt tab: compact toolbar (zoom out, zoom in, Today), a frozen narrow name column (112 px, indent and chevron), timeline; tapping a bar or name opens the bottom-sheet inspector at half height (drag to full) with large steppers (44 px or more). The selected row scrolls above the sheet (WCAG 2.4.11). Link-mode banner and toasts sit above the tab bar. Gestures are pan, pinch, long-press drag and the tap-tap link | | |

Light and dark use the existing tokens. New semantic tokens, separate from the accent: `--critical`, `--float`, `--pending`, `--status-date`, `--today`, `--text-only`, `--done`.

### 9.3 Inspector

- **Task.**
  - Name (`renameTask`) and id (read-only, monospace).
  - Sizing: a type select (effort, length, duration) and a value stepper. Changing the type rewrites keyword and value together (phase-1 §15.20).
  - `start`, `end`, `minstart`, `maxend` as date fields in the project's zone, with a constraint warning.
  - `scheduling` and `milestone` (with the open-ended warning in 11.1), `priority` (stepper), `note` (multi-line, committed on blur), `flags` (chips from declared flags; "declare" offers `declareFlag`), `responsible`, `complete`.
  - Dependencies, each with Remove and a gap field (`setDependsGap`).
  - People chips.
  - Read-only: the engine's start, end, float (estimate), the driver ("Waits for *Design*", "Starts with the project", or "Held by resources or calendars", which Phase 3 explains) and whether the task is critical.
- **Field rules.**
  - Each field shows "inherited from *parent*" where the index says so.
  - A text-only field is disabled with its reason and "Show source".
  - Edits commit on Enter or blur. Steppers coalesce (6.8).
- **Link.** Predecessor, successor, gap and Remove. Type (`onstart`/`onend`) is read-only (v1).
- **Project sheet.** Name, frame start and end (`setProjectHeader`), status date (`setProjectAttr now`), time zone. This is the minimum the status-date line needs; the rest of the project frame is Phase 3 (19.9).

### 9.4 Toasts and status

- Toasts live in a polite live region: one per edit, 6 s, with Undo (enabled while the entry is on top). Refusals and "no longer schedules" toasts stay until dismissed.
- The status strip shows the engine version and the last run's timings, which closes the Phase 0 carry-over.

## 10. Accessibility

### 10.1 Screen-reader model

- The Gantt's outline columns are a DOM `role="treegrid"` (the plan's "ARIA grid", with hierarchy). That treegrid is the accessible mirror of the timeline.
  - Rows carry `aria-level`, `aria-expanded`, `aria-setsize` and `aria-posinset`. `aria-rowcount` is the full count while rows are virtualised.
  - Cells: name, start, end, effort or length, people, float (estimate), critical (yes or no), status (scheduled, pending, text-only).
- The canvases are `aria-hidden`.
- Announcements (polite): edit toasts, and after a reschedule "Rescheduled. Finish Tue 3 Mar, 2 days later. 4 tasks moved." Link mode announces its prompt.
- Critical tasks are never shown by colour alone (WCAG 1.4.1): a thicker outline, and the treegrid column.

### 10.2 Keyboard model

- Focus enters the treegrid on one row (roving tabindex).
- Up and Down move between rows; Left and Right collapse, expand or move between cells; Home and End.
- Enter opens the inspector and moves focus into it; Escape returns.
- F2 renames. The 7.1 shortcuts work when focus is in the Gantt only, never in the editor. They avoid common screen-reader keys; single-letter keys (L, P, T) work only in the treegrid and can be turned off in a later shortcuts sheet (v1).
- The canvas draws a focus ring around the focused row's bar that matches the DOM focus ring (3 px, at least 3:1).
- Tab order: top bar, mode toggle, (editor), Gantt toolbar, treegrid, inspector, toasts.
- There is no keyboard trap. The editor keeps Tab unbound.

### 10.3 Target sizes and contrast

- Every pointer target has a hit area of at least 24 x 24 CSS px (WCAG 2.5.8 AA): fine-pointer rows 28 px high, handles 24 px hit areas, milestones 24 px.
- On a coarse pointer: 40 px rows and 44 x 44 handles. This also covers the Format and Docs buttons left at 32 px by audit §3.3.
- WCAG 2.5.7 (Dragging Movements, AA): every drag has the single-pointer, non-drag alternative listed in 7.1.
- Bars, links, the critical colour, the status-date and today lines: at least 3:1 against the background (1.4.11). The float tail is "faint" but still 3:1, because float also appears in text.
- Bottom sheets never cover the focused row (2.4.11).

### 10.4 Testing

- axe on every Gantt state, light and dark, desktop, tablet and Pixel 7: inspector open, link mode, toast, sheet, Split.
- A test asserts that the treegrid's row and cell texts equal the model.
- A keyboard-only walkthrough of every 7.1 row.
- Real screen-reader runs stay a Phase 6 item.

## 11. Phase 1 gaps that touch Phase 2

### 11.1 Open-ended allocated leaves (phase-1 §15.24, §15.25)

A leaf with a start, an allocation and no size or end runs to the project end and books its resource. Others may then not fit (`sched_runaway`).

- The model flags these rows `openEnded` and draws them to the frame end with an open-end marker.
- Turning `milestone` off for a leaf with an allocation and no sizing asks first: "This task will have no size, so TaskJuggler books *dev1* until the project end. Add an effort?" The choices are "Set effort" (focuses the field) and "Change anyway".
- R1 on such a bar inserts `effort` (7.1).

### 11.2 Edits that apply but no longer schedule (phase-1 §15.19, §15.22)

The edit API does not refuse schedule-dependent errors. The dispatcher settles each edit against the first result that includes it (6.8 step 5).

- If that result is `ok: false`, or has error ids the previous good run did not have, the toast says "Changed. The plan no longer schedules: *message*", with Undo and Show. Show reveals the diagnostic in Text or Split, or opens the source sheet.
- The Gantt shows `lastGood` dimmed (the existing `outdated` rule). The pending bar returns to its last good place, marked "not scheduled".
- The status strip already says "Not scheduled: fix the errors".

### 11.3 Other gaps

- **JS budget.** CI keeps the 450,000-byte gzip cap on all `/app` JS. Phase 2 code-splits the CodeMirror view, language, autocomplete, lint and search packages into a chunk loaded when an editor first mounts. `@codemirror/state`, Lezer and the edit API stay in the main chunk, because Visual mode needs them. A new recorded metric, "initial JS with Visual mode or the Gantt tab", targets 300 KB gzip or less (18.11).
- **Wasm code cache (Phase 4).** First visits still stall frames during engine boot (Phase 0 deviation). Perf measurements start after `ready`, and the gate evidence says so.
- **Provisional goldens.** Schema v2 needs a re-record anyway (5.3). The gate states whether the goldens are 3.3.6 or 3.4.
- **Structural intents over 50 ms (audit §2.1).** T6 measures again and fixes anything over 50 ms p90 on Fedora, because the drop path depends on it.

## 12. Fast-path spike (`engine-specialist`, T19)

**Question.** Can the worker keep a parsed, unscheduled TaskJuggler project from a full run, apply an attribute rewrite to it, and schedule it, with results identical to a full reparse and clearly faster?

**Steps:**

1. **Retention.** Find out whether a `Project` can be scheduled twice, or cloned cheaply before scheduling (for example `Marshal` round trip, or a bridge-level copy of scenario data). Measure clone cost against parse cost on Fedora, `gantt-200` and Tutorial. If a clone costs about as much as a parse, stop: the spike fails.
2. **Eligible edits.** In-place value rewrites only: the statement exists, its line count does not change, and no other text changes. If lines shifted, the retained project's `sourceFileInfo` lines and message lines would be wrong. Attributes: `effort`, `length` and `duration` (the same keyword), `start`, `end`, `priority`, `complete`, top scenario only. Excluded:
   - tasks whose attribute is inherited by children;
   - tasks with another scenario's site of the same attribute (phase-1 §15.20 copy-over rules);
   - criterion keyword changes;
   - anything with macros in the task's bodies.
   The main thread decides eligibility from the intent and the index. The worker checks that it holds `base`.
3. **Apply.** Use TaskJuggler's own attribute setters, so the parse-time side effects run (for example `setDurationAttribute` resetting the other criteria).
4. **Equivalence tests** (`tests/engine/fast-path.equivalence.test.ts`, fidelity job, `bootNodeEngine`). For every golden plan and 500 generated plans (the fidelity generator), and every eligible intent the families draw, the fast result equals the full result as canonical JSON, excluding `revision` and `timings`: tasks, bookings, messages with lines. A shuffled sequence of fast and full runs through one worker checks for state leakage. Nightly: 5,000 cases.
5. **Adoption criteria.** All of:
   - zero differences;
   - median engine time saved of at least 30% on Fedora and `gantt-200`;
   - no golden parity change (golden runs never use the fast path);
   - the bundle size growth recorded.
   The outcome goes in ADR-0010 either way. If adopted, the runner sends `fast` (6.12) for eligible single intents and undo or redo of them. Typing never uses it.

## 13. Tests and CI

### 13.1 Unit and property (`test:unit`)

| Module | Tests |
| --- | --- |
| `schedule/working-time`, `date-text` | Snapping and spans on syn-09 (Berlin DST), syn-10 (Kathmandu), syn-11 (Sydney), syn-14 (working hours); property: `dateText` parses back to the same instant with `values/date.ts` |
| `schedule/critical`, `float` | Hand-computed fixtures (chain, fan-in, gaps, ALAP, containers, a resource-driven start); properties on generated plans without resources: critical tasks have float 0, the path is connected and ends at the finish, float is at least 0 |
| `gantt/model` | Join of index and result, collapse, renames while pending, new and deleted tasks, text-only rows, open-ended rows, dimmed state |
| `gantt/layout`, `hit` | Property: for random models and viewports, the hit at a bar's painted pixel is that bar; hit areas meet 24 px and 44 px |
| `gesture/machine` | Fake time: long-press at 350 ms, slop to native pan, `pointercancel`, Escape, drag back to cancel, pinch, double tap, handle drag on a selected bar |
| `gantt/intents` | One test per 7.1 row: action to intent, move preference, ALAP, no-driver, unsized resize, effort rounding |
| `workspace/history` | Property: random sequences of typing, intents and format across 1 to 3 files, with undo and redo, keep the text equal to a model; undo all gives the seed byte for byte; redo all gives the final text; re-stamped versions keep `undoEdit` valid; a bypassing change gives `diverged` |
| `state/edits` | Android gate (fake `androidKeyPending`), stale re-plan, `shared-declaration` confirm, coalescing, settle with ok and not-ok results |
| `state/selection` | Cursor to task with a lagging index, task to range forward-mapped, expanded-only tasks through engine lines |
| Runner | `ensureIndex`, post before derive, chunked handling (no task over 50 ms in a fake-timer budget test) |

### 13.2 End-to-end (`test:e2e`; desktop Chrome, Pixel 7, iPhone 14)

- **`gantt-manipulation.spec.ts`.** One test per row R1 to R10, plus add and delete, on each device project. Each:
  1. performs the gesture with real input: mouse on desktop; CDP touch events on Pixel 7; on WebKit (iPhone 14), dispatched pointer and touch events, because Playwright cannot drive a touch drag there (18.14);
  2. asserts the full text of every changed file equals the hand-written expected file;
  3. asserts the toast;
  4. presses Undo and asserts the original bytes;
  5. presses Redo and asserts the expected bytes;
  6. waits for the result and asserts that the bar matches the engine's dates;
  7. takes a screenshot.
- The same file runs each row's keyboard or inspector alternative on desktop and Pixel 7.
- **`gantt-sync.spec.ts`.** Split-mode selection sync both ways, across files; Visual "show source"; mode persistence; Cmd/Ctrl+1/2/3.
- **`gantt-android-enter.spec.ts`.** Galaxy Tab S4 emulation, so Split is stacked. Enter is held in the editor (clock paused, as in audit §5), and an intent is dispatched in the same frame through a dev-only hook. Both the newline and the intent must land. The test must fail with the gate stubbed out.
- **`gantt-schedule-fail.spec.ts`.** An edit that applies but breaks scheduling (from the §15.19 list) shows the "no longer schedules" toast, the dimmed last good schedule and a working Undo.
- **`gantt-a11y.spec.ts`.** axe in every 10.4 state; treegrid against model; target-size probes; reduced motion.
- **Screenshots.** Gantt in every mode, light and dark, desktop, tablet and phone, saved to `docs/phases/screenshots/phase-2/`.

### 13.3 Golden, fidelity, performance

- **Golden parity.** Schema v2 on every push, as today.
- **Fidelity job.** Adds the fast-path equivalence suite while T19 runs, and keeps it if adopted.
- **`gantt-perf.spec.ts`.** In the `e2e` job, with the 8.4 regression caps. The nightly job records both profiles.

### 13.4 CI changes

| Job | Change |
| --- | --- |
| `check` | New unit tests; JS size check reports total and Visual-first initial JS (cap 450,000 bytes total, unchanged) |
| `e2e` | New Gantt specs on three devices plus the tablet profile for Split; uploads `gantt-perf.json` and traces |
| `golden` | Schema v2 |
| `fidelity` | Fast-path equivalence (spike, then permanent if adopted) |
| `nightly.yml` | `gantt-perf` throttled and desktop with history; fast-path 5,000 cases |

## 14. Tasks

Each task runs in its own worktree and goes through `reviewer` before merge. UI tasks ship desktop and phone-emulation screenshots (CLAUDE.md).

| # | Task | Owner | Files | Depends on |
| --- | --- | --- | --- | --- |
| T1 | ADR-0007 (engine data and derived display data) and ADR-0008 (unified undo, move preference, UI preferences, touch handle rule) from the user's answers to section 18 | **User** decides; `docs-writer` formats | `docs/decisions/0007-*.md`, `0008-*.md` | user answers; before T2, T7, T12 merge |
| T2 | Bridge schema v2 (6.1): serializer fields, protocol types, `GoldenFile.schemaVersion` 2, canonical and compare updates, cross-check column if possible; re-record (provisional) | `engine-specialist`; `fixture-maker` runs `golden:record`; **user** re-records on Ruby 3.4 | `engine/bridge/serialize.rb`, `src/engine/protocol.ts`, `engine/golden/**`, `tests/golden/**` | T1 |
| T3 | Fixtures: `gantt-manipulation` workspace; seeded generators `gantt-200` and `gantt-500` with committed output; added to the golden manifest and as lazy samples | `fixture-maker` | `tests/fixtures/gantt/**`, `engine/golden/generators/`, `engine/golden/plans/`, `src/lib/workspace/samples.ts` | none (goldens after T2) |
| T4 | Working time, date text, duration text (6.2) | `grammar-specialist` | `src/lib/schedule/working-time.ts`, `date-text.ts` | T2 types |
| T5 | Driving links, critical path, float (6.2) | `engine-specialist` | `src/lib/schedule/critical.ts`, `float.ts` | T2, T4 |
| T6 | Edit API speed: re-measure every intent on Fedora; fix any over 50 ms p90 (audit §2.1); record the table | `grammar-specialist` | `src/lib/tjp/edit/**`, `tests/perf/text-mode-timings.test.ts` | none |
| T7 | Unified undo (6.7), workspace changes (6.11), editor key bindings | `grammar-specialist` | `src/lib/workspace/history.ts`, `workspace.ts`, `src/lib/state/editor-setup.ts` | T1 |
| T8 | Runner changes (6.9): `ensureIndex`, `'history'` origin, post before derive, chunked result handling | `engine-specialist` | `src/lib/workspace/schedule-runner.ts`, `run-view.ts`, `run-types.ts` | none |
| T9 | Gesture state machine, long-press, pinch, snapping glue (6.5, 7.2) | `ui-builder` | `src/lib/gesture/**` | none |
| T10 | Gantt model, time scale, zoom, ticks (6.3, 6.4) | `ui-builder` | `src/lib/gantt/model.ts`, `scale.ts`, `ticks.ts` | T2 types, T4 |
| T11 | Canvas renderer, virtualisation, dpr, overlay, hit testing, reschedule animation (section 8) | `ui-builder` | `src/lib/gantt/layout.ts`, `hit.ts`, `paint/**`, `src/components/gantt/Timeline.svelte`, `TimeHeader.svelte` | T10 |
| T12 | Gantt actions to intents (6.6, 7.1), move preference | `grammar-specialist` | `src/lib/gantt/intents.ts`, `prefs.ts` | T1, T4, T5 |
| T13 | Edit dispatcher, pending edits, toasts, Android gate, `EditorController` `view.update` sync (6.8) | `grammar-specialist` (logic); `ui-builder` (`Toasts.svelte`) | `src/lib/state/edits.svelte.ts`, `editor-controller.ts`, `src/components/app/Toasts.svelte` | T7, T8 |
| T14 | Modes and layouts (section 9.1, 9.2): toggle, shortcuts, persistence, dividers, phone Gantt tab, tablet stacked Split; code-split CodeMirror (11.3) | `ui-builder` | `src/lib/state/mode.svelte.ts`, `layout.svelte.ts`, `src/components/app/**`, `App.svelte` | none |
| T15 | Selection and two-way sync (6.10), source-block highlight | `ui-builder`; `grammar-specialist` reviews the mapping | `src/lib/state/selection.svelte.ts`, `src/lib/tjp/cm/` (highlight extension) | T10, T13 |
| T16 | Gantt interactions: gestures wired to hits, previews, link mode, people palette, row drag with indent, keyboard model (7.1, 7.2, 10.2) | `ui-builder` | `src/components/gantt/**` | T9, T11, T12, T13 |
| T17 | Inspector, link inspector, project sheet, show-source sheet (9.3, 9.1), open-ended warning (11.1) | `ui-builder` | `src/components/inspector/**`, `src/lib/strings.ts` | T12, T13 |
| T18 | Treegrid outline columns and announcements (10.1) | `ui-builder` | `src/components/gantt/OutlineGrid.svelte` | T10 |
| T19 | Fast-path spike (section 12); ADR-0010 with the outcome | `engine-specialist`; `test-writer` (equivalence tests); `docs-writer` formats the ADR | `engine/bridge/fast_path.rb`, `src/engine/**`, `tests/engine/fast-path.*` | T2 |
| T20 | Unit and property tests (13.1), written alongside each owner's task | `test-writer` | beside each module | per module |
| T21 | E2E specs (13.2), hand-written expected patches, screenshots | `test-writer` | `tests/e2e/gantt-*.spec.ts`, `tests/fixtures/gantt/expected/**` | T3; complete after T16, T17 |
| T22 | Perf harness: `gantt-perf.spec.ts`, `/dev/gantt-perf`, frame meter, `perf-android.mjs`, touch-listener comparison (8.2) | `perf-a11y-auditor` | `tests/e2e/gantt-perf.spec.ts`, `src/pages/dev/_gantt-perf.astro`, `scripts/perf-android.mjs` | T11, T16 |
| T23 | Accessibility audit (section 10), 44 px carry-over | `perf-a11y-auditor` | `tests/e2e/gantt-a11y.spec.ts`, fixes in components | T16, T17, T18 |
| T24 | Engine version and timings in the status strip (Phase 0 carry-over) | `ui-builder` | `src/components/StatusStrip.svelte`, `src/lib/state/status.ts` | none |
| T25 | CI changes (13.4) | `test-writer`; `engine-specialist` reviews golden and fidelity | `.github/workflows/*.yml`, size script | as suites land |
| T26 | Real-device run (8.5) and Text-mode keystroke latency on the device | **User** provides the device; `perf-a11y-auditor` prepares the procedure; main session runs it with the user | `test-results/gantt-perf-android.json`, gate file | T22 |
| T27 | Gate evidence | main session; `test-runner` runs suites | `docs/phases/phase-2-gate.md` | all |

### 14.1 Parallel waves

| Wave | Tasks |
| --- | --- |
| 0 | User answers section 18; T1; T3 starts |
| 1 | T2, T6, T8, T9, T14, T24; T3 continues; T20 drafts against the 6.x types |
| 2 | T4, T7, T10, T18; T19 starts once T2 has merged |
| 3 | T5, T11, T13 |
| 4 | T12, T15, T17 |
| 5 | T16; T21 and T22 written against the running UI |
| 6 | T21, T22, T23, T25 complete; T19 decision (ADR-0010) |
| 7 | T26 with the user's device; T27; stop for approval |

## 15. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 60 fps fails on the device because of main-thread work during scroll (non-passive touch listener, result handling) | Gate fails | Chunked result handling (6.9); idle model builds; listener measured with and without (T22); fallback design in 8.2 behind an ADR |
| Canvas fill cost on high-dpr phones | Dropped frames | dpr capped at 2; layered canvases, only the overlay redraws during gestures; overscan |
| Long-press drag fights native scrolling on iOS or Android | Accidental scrolls or edits | 350 ms rule, 8 px slop to native pan, `preventDefault` only when armed; e2e on Pixel 7; real-device pass |
| Derived critical path or float disagrees with users' expectations under leveling | Trust | Labelled as estimates; `unexplained` drivers named; fixtures with known answers; Phase 3 explainer |
| Bridge v2 changes golden output | Parity churn | One schema bump; re-record by script; the user records Ruby 3.4 once after T2 |
| Unified undo diverges from the text | Data loss | Inverse plus version checks with re-stamping; `diverged` clears stacks rather than applying; property tests over mixed sequences |
| Removing CodeMirror's per-file history changes Text-mode habits | Surprise | Global undo announced with a label; Text-mode e2e updated; 19.8 |
| Android drops a held Enter when a visual edit lands in Split | Lost keystrokes | Dispatcher gate and `view.update` instead of `setState` (6.8); e2e that fails without the gate. CodeMirror's own dispatches stay uncovered (audit §5) |
| Structural intents over 50 ms on Fedora | Janky drops | T6; the drop path split into tasks (7.3) |
| Reschedule takes over 1 s for 200 tasks | Feels slow | Pending styling, optimistic preview; fast-path spike; recorded budget, enforced in Phase 6 |
| Fast path gives subtly different results | Wrong schedules | Narrow eligibility; full-result equivalence on the corpus and 5,000 nightly cases; adopt only with zero differences |
| WebKit touch drags cannot be driven by Playwright | Weaker iPhone evidence | Dispatched pointer events on iPhone 14; Pixel 7 uses real CDP touch; real iOS in Phase 6 |
| Bundle grows past 450 KB gzip | CI fails | Code-split CodeMirror; no new runtime dependencies; size reported per chunk |
| Parallel UI tasks conflict on `App.svelte`, `strings.ts` | Merge churn | T14 lands the shell first; strings grouped by component |

## 16. Gate acceptance criteria

Copied word for word from the plan:

> Gate: each row of the direct-manipulation table works on desktop and in phone emulation, produces the documented patch, and is undoable; 500-task scroll at 60 fps on a mid-range Android device.

### Criterion 1: "each row of the direct-manipulation table works on desktop and in phone emulation, produces the documented patch, and is undoable"

- **How it is shown.** `gantt-manipulation.spec.ts` (13.2) passes in CI on the gate commit for desktop Chrome and Pixel 7. iPhone 14 runs too and is reported. For each row R1 to R10:
  - **works:** the gesture completes with real input and the bar matches the engine result;
  - **documented patch:** the changed files equal the hand-written expected text, which follows the plan's "Text change" column;
  - **undoable:** Undo restores the original bytes and Redo restores the patch.
  - R10 asserts navigation and no text change; undo does not apply (19.13).
  - R7 is shown through the inspector unless the user decides otherwise (18.3).
- **Evidence in `phase-2-gate.md`:**
  - CI run link;
  - a table of row x device: gesture, patch match, undo, redo, screenshot link;
  - the expected and actual diff for each row;
  - the keyboard and inspector alternative per row;
  - the Android Enter spec result (fails with the gate stubbed out, passes with it);
  - the "no longer schedules" spec;
  - the axe report;
  - screenshots in light and dark, desktop and phone, in every mode.

### Criterion 2: "500-task scroll at 60 fps on a mid-range Android device"

- **How it is shown.**
  - `scripts/perf-android.mjs` on the user's device (8.5), `gantt-500`, all rows expanded, three runs.
  - Pass (recommended definition, 18.7): in every run, at least 95% of frames presented within 16.7 ms, and no frame over 50 ms, during the scripted vertical scroll through all 500 rows and back. The horizontal pan and pinch are reported.
  - The CI emulation numbers (8.4) are supporting evidence, not the criterion.
- **Evidence:**
  - device model, Android and Chrome versions, refresh rate;
  - per-run frame statistics (median interval, p95, dropped %, longest frame, LoAF count);
  - the trace files as artifacts;
  - the CI emulated numbers beside them;
  - the touch-listener comparison;
  - the Text-mode keystroke latency on the device (audit §4).

### Phase deliverables

These are phase bullets, not gate criteria; they are listed for completeness.

| Plan bullet (verbatim) | Demonstration |
| --- | --- |
| "Canvas Gantt with outline, zoom, collapse, dependency lines, critical path, float tails, today and status-date lines." | Screenshots of each feature; unit results for model, ticks and analysis; the treegrid test; critical and float fixtures |
| "Split, Text and Visual modes with two-way selection sync; inspector; all MVP gestures on mouse and touch; unified undo across text and visual edits." | `gantt-sync.spec.ts`; criterion 1 table; history property-test output (cases, seeds) |
| "Spike: the parse-skipping fast path; adopt only if equivalence tests pass." | ADR-0010 with the equivalence counts, differences (must be 0 to adopt) and timings before and after on Fedora and `gantt-200` |

The gate also records the reschedule time for plans up to 200 tasks, drag feedback times, JS sizes, the golden state (Ruby 3.3.6 or 3.4) and the edit API timing table (T6).

## 17. Evidence files

`docs/phases/phase-2-gate.md`; `docs/phases/screenshots/phase-2/*.png`; `test-results/gantt-perf.json`, `gantt-perf-android.json`, `text-mode-node-timings.json`; ADR-0007, ADR-0008, ADR-0010.

## 18. Open questions for the user

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| 18.1 | Extend the bridge (schema v2: resolved dependencies, `complete`, direction, project working time, `dailyworkinghours`) and re-record all goldens | Yes. Re-record provisionally on 3.3.6; the user records Ruby 3.4 once, after T2 | T2 |
| 18.2 | The derived-data rule (5.2): critical path, float and snapping computed on the main thread from the result, labelled as estimates, never fed back | Approve as ADR-0007 | T5, T12 |
| 18.3 | "Rebalance load" needs the Phase 3 heatmap | Phase 2 shows its patch (`replaceAllocation`) and undo through the inspector's "Replace with..." chip; the heatmap gesture is checked at the Phase 3 gate | T21, gate |
| 18.4 | Move preference: asked once; default offer `start` (a constraint) or `gap` (`gaplength` on the driving dependency); ALAP tasks write `end` | Ask once, pre-select `gap` when a driving dependency exists, else `start`; `gaplength`; `end` for ALAP | T12 |
| 18.5 | Persist UI preferences (mode, zoom, collapse, divider, move preference) in `localStorage` per sample; defaults Split (desktop), Visual (tablet), Gantt tab (phone) | Yes; no plan text is stored | T14 |
| 18.6 | Unified undo replaces CodeMirror's per-file history; Mod-Z in the editor undoes the last action anywhere | Yes (ADR-0008) | T7 |
| 18.7 | Real device and pass definition for "60 fps" | The user provides a 2022 to 2024 mid-range Android (Pixel 6a/7a or Galaxy A54 class), Chrome stable; pass = at least 95% of frames on time and none over 50 ms during the scripted 500-row scroll, three runs | T22, T26 |
| 18.8 | On touch, a selected bar's handles drag without a long-press | Yes; everything else needs the 350 ms long-press | T9, T16 |
| 18.9 | Inspector scope in Phase 2: tasks, links and a project sheet; resources and calendars with Phase 3 views | Yes | T17 |
| 18.10 | Filters (MVP Gantt) and PNG/CSV export (MVP Export) are in no phase bullet | Filters in Phase 3 with people; export in Phase 4 before the MVP release | none |
| 18.11 | JS budget | Keep the 450,000-byte gzip cap; code-split CodeMirror; record Visual-first initial JS with a 300 KB target | T14 |
| 18.12 | Fast-path eligibility and adoption bar (section 12) | In-place value rewrites only; zero differences and at least 30% faster | T19 |
| 18.13 | Resize semantics: `effort` scaled and rounded to whole written units; start-and-end tasks rewrite `end`; unsized tasks get `effort` (allocated) or `length` | Approve as written | T12 |
| 18.14 | iPhone 14 emulation uses dispatched touch events for drags | Accept; Pixel 7 with CDP touch is the gate's phone emulation, real iOS in Phase 6 | T21 |

## 19. Conflicts and ambiguities

1. **Rebalance load (R7)** is a direct-manipulation row, and the gate says "each row", but its gesture starts on a heatmap cell, which is Phase 3. See 18.3.
2. **"Move a task later … adds or edits `start`."**
   - For an ALAP task, TaskJuggler's anchor is the end, and a `start` would overspecify it (`conflicting-attribute`). This spec writes `end` for ALAP tasks.
   - The row says "later" only. The spec allows earlier moves down to the driving constraint.
   - The gap kind is unspecified. The spec uses `gaplength`, to match working-day snapping (18.4).
3. **Mark progress** edits `complete`, which is v1 tracking (already in the edit API, ADR-0003 #4), and "progress fill" is a v1 Gantt item. A handle needs a position, so a thin fill ships in Phase 2.
4. **Touch "Drag the handle"** (Mark progress) and the rule "long-press (350 ms) before dragging on touch". Resolved by 18.8: handles on a selected bar drag at once.
5. **Phone "gestures limited to pan, pinch and long-press drag"** while the gate needs every row in phone emulation. Tap-tap linking and tap-in-inspector are taps, not drags, so they fit. Nothing beyond those three gestures is added.
6. **"Critical-path highlight, computed in the app"** and CLAUDE.md's "No schedule is ever computed outside the browser engine". Resolved by the display-data rule (5.2, 18.2).
   - TaskJuggler's `criticalness` and `pathCriticalness` are not a CPM critical path, so they are not used for the highlight.
   - With leveling, the "critical path" is a driving path, and float is an estimate.
7. **"Debounced 300 ms for typing, immediate for gestures"** (Edit pipeline step 4). Keyboard nudges and stepper presses are coalesced for 300 ms in the dispatcher (a small deviation). Drags stay immediate at the drop.
8. **Unified undo.** Phase 1 §6.5 planned "a workspace-level undo keyed by `tjpEditId` and built on `inverse`". This spec does that, and also removes CodeMirror's per-file history, so Text mode's undo becomes global (18.6).
9. **"Inspector for every MVP keyword"** (Product scope) against Phase 2's "inspector". Resource, leave and working-hours keywords go with their Phase 3 views (18.9).
10. **MVP items in no phase bullet:** Gantt filters and export to PNG and CSV (18.10).
11. **"Bars animate to new positions after a reschedule"** is in the design system. It is included here; it is not in the Phase 2 bullets.
12. **"Gantt rows exposed as an ARIA grid."** This spec uses `treegrid`, the grid role with hierarchy.
13. **Navigate row (R10).** "Produces the documented patch" means no text change, and "is undoable" does not apply to navigation.
14. **"60 fps … with 500 tasks visible"** (budget) and "500-task scroll" (gate). A phone shows about 15 to 20 rows at once. This spec reads both as 500 tasks loaded and expanded, scrolled through.
15. **"A mid-range Android device"** is not defined, and the build environment has none. The user provides it (18.7, T26). The Phase 1 audit deferred real-device testing to this gate.
16. **Edit pipeline step 2** ("the view shows the result optimistically"). The preview shows only the dragged item's geometry; successors move when the engine answers (5.2).
17. **Status date without `now`.** The runner never sends `options.now`, so TaskJuggler uses the clock aligned to the hour, and the status-date line and the today line nearly coincide. They are then drawn as one, labelled "Today (status date)".
18. **The plan's tab bar** (Plan, Gantt, People, Text). People arrives in Phase 3.
19. **Edit API timings.** The caller reports 15 to 35 ms per intent on Fedora. `phase-1-audit.md` §2.1, the latest record in the repository, shows 150 to 270 ms for the structural intents. This spec plans against the caller's figure; T6 measures again and records the numbers in the gate.
20. **"Posts the changed files"** (Edit pipeline step 4). Requests still carry the full workspace text (Phase 1 §14.6). The fast path adds a patch beside the full text, but does not replace it.
