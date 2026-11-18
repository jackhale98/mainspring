# ADR-0016: UI hardening pass at the end of Phase 3

Status: proposed, 2026-11-18. Needs the user's approval: this is work outside the Phase 3 task list.
Source: CI history and the user's iPhone reports of 2026-11-17 and 2026-11-18; `docs/phases/phase-3.md`
8.4, 13 and 14 (T21 to T23) and 22.y; `docs/phases/phase-2-polish.md` rows 18 and 19; ADR-0009 #7.
(Number 0015 is held for the schedule-result caching proposal, still open.)

## Context

The engine and text layer are stable. Golden parity, the engine build tests, patch fidelity and
the edit API reviews (each with an engine reproduction) all found the backend correct. One check
of the engine's memory failed once (28 MB growth against 20 MB slack) and passed on reruns.

Nearly every red CI run and every late bug came from the UI or its tests:

1. **Timing checks fail on noise.** The frame-rate gates (`gantt-perf`, `workload-perf`) failed on
   shared runners until they got a job of their own. The sheet slide recordings (200 ms) fail on
   headless WebKit in CI. It paints the first frame 200 to 300 ms late, mostly because of the
   panel shadow. The same commit passed and then failed.
2. **iPhone bugs were found on the user's phone, not in CI.** 33 of the 70 spec files skip
   `iphone-14` by name, most of them for the whole file. `sheet-states` also skips WebKit for one
   test. About 500 of about 620 tests never run on WebKit. These bugs got through:
   - the docs sheet opened above the screen (the modal dialog's built-in `overflow: auto` scrolled
     to the focused field during the slide);
   - the calendar's day panel was cramped and jumped (22.y);
   - selects were styled wrongly;
   - fields zoomed the page (polish 18).
3. **One break in a shared hand-built part reached many features.**
   - A global select rule lost to Svelte's class specificity and took the arrow off 7 selects.
   - The Gantt toolbar's one-row layout needed new tweaks each time a control was added (24.10).
   - Rebuilding the heatmap's ARIA mirror lost the keyboard focus.
   - The Sheet's motion, focus and close logic needed two review rounds.
4. **End-to-end runs are slow and sensitive to load.** Each test boots ruby.wasm and schedules a
   real plan. Often that is `fedora-res` (about 400 tasks), which 23 spec files use. A run takes 13
   to 38 minutes, the shards are uneven, and a new push cancels the run in progress.

## Decision

A hardening pass of at most two weeks, in Phase 3's last wave (14.1, wave 6), before the gate.
It has five changes and runs on at most two tracks at once:

| # | Change | Effort | Order |
| --- | --- | --- | --- |
| 1 | Two-tier test gate | 1 day | First |
| 5 | Push habits and a CI status line | Half a day | With 1 |
| 4 | Cheaper end-to-end tests | 2 to 3 days | Second (track A: `test-writer`, `fixture-maker`) |
| 3 | Shared UI primitives with contract tests | 3 to 4 days | Second (track B: `ui-builder`) |
| 2 | WebKit as a first-class target | 4 to 5 days | Third, in four batches |

Change 3 comes before change 2. That way, the iPhone bugs that change 2 finds are fixed in parts
that already have tests.

### 1. Two-tier test gate

- **The merge tier blocks a merge.** It checks behaviour and correctness, as now, minus the checks
  listed under the timing tier.
- **The timing tier does not block a merge.** Its tests are tagged `@timing`. The merge run uses
  `--grep-invert @timing`. The timing job runs one worker, on every push to `main` and nightly. It
  adds each result to a trend (an artifact and the step summary). These checks move to it:
  - the frame-rate assertions of `gantt-perf.spec.ts` and `workload-perf.spec.ts` (today the
    `gates` job's "Frame-rate gates" step);
  - `gantt-gesture-frames.spec.ts`, which already only records;
  - the sheet recordings at full speed (200 and 180 ms) on Chromium in `sheet-states.spec.ts` and
    `phone-bugfixes.spec.ts`, including "closing while it slides in".
- **These stay in the merge tier** because they do not depend on timing:
  - JS sizes, the Pixel 7 DOM-node cap, golden parity, and the responsiveness job (the Phase 0
    gate criterion);
  - the shape of sheet motion. Every sheet test uses `slowSheets` (2 s slides) on every browser,
    not only WebKit. It checks four things: only `transform` moves, the edge moves in many steps,
    it moves the right way, and no gap opens. A slide that jumps or never animates still fails.
- **A gross regression still turns the timing run red.** That means a measure more than twice its
  budget in all three runs. The main session treats a red timing run as a bug before the next
  batch. No budget number changes.

### 2. WebKit as a first-class target

- **Local setup becomes a documented script.** `npm run setup:webkit` (`scripts/setup-webkit.mjs`)
  installs Playwright's WebKit into a local `PLAYWRIGHT_BROWSERS_PATH` and checks its system
  libraries. `npm run test:e2e:iphone -- <spec>` runs specs on WebKit. Both are in the README's
  developer section.
- **The skips come off in four batches.** Each batch is done on a branch and merged on its own,
  with the most-used flows first:
  - B1: shell, Gantt core (add task, undo, structure, sync, name and id, failed schedule), the
    inspector and its dependency picker, edit dispatch, selection sync;
  - B2: new plan, the Gantt filter, the edge cases of gestures, `gantt-a11y`;
  - B3: People (shell, workload, lanes, calendar, resources, `workload-gate`);
  - B4: health, health fixes, why-here, and the screenshot specs.
- **Each failure is triaged.** If the app is wrong, `ui-builder` fixes it, or the main session does
  if the fix is a few lines. If the test is wrong, the test is fixed: a fixed wait becomes a wait
  on state.
- **The allowlist stays short.** `tests/e2e/lib/webkit-allowlist.ts` has one line per skipped test,
  with its reason. It holds only what WebKit cannot do: touch through CDP, Chromium-only
  performance APIs, Android EditContext. The target is at most 6 entries. A grep in the `check` job
  fails on any `iphone-14` or `webkit` skip outside the allowlist.
- **The user tries each batch on the phone.** Each batch ends with the Pages preview link for the
  user's iPhone. Emulation is not Safari.

### 3. Shared UI primitives with owners and contract tests

| Primitive | Today | What its contract test checks |
| --- | --- | --- |
| Sheet | `Sheet.svelte` | Half and full heights; motion shape; every way to close (button, Escape, backdrop, drag down, the `open` prop); focus returns; no scroll on open (the docs sheet bug); no gap above the tab bar |
| Menu | `RowMenu`, `AddTaskMenu`, `ActionMenu` | One `Menu`: arrows, Home and End, Escape returns focus, a tap outside closes it, stays on screen at 360 px, 44 px items on a finger |
| Select | A global rule in `Base.astro`, `Select.svelte` and its copy `ResourceSelect.svelte` | One component that draws its own arrow, 16 px text on a finger; the global rule is removed |
| Toolbar | `GanttToolbar` tiers | The tier rules in one module; a one-row check from 360 to 1600 px for each toolbar; a new control must declare its narrow form |
| Grid focus | `HeatGrid`, `OutlineGrid`, Calendar, Lanes | `lib/ui/roving-grid.ts`: a roving tab stop keyed by cell, and focus kept across a rebuild |
| Popover | `DetailsPopover`, `ThresholdsPopover` | Stays inside the viewport, Escape closes it, focus returns |

- **A test page without the engine.** A dev page, `src/pages/dev/_primitives.astro`, is built only
  with dev pages, like `_gantt-perf`. It mounts each primitive and never boots the engine. The
  contract specs (`tests/e2e/primitives/*.spec.ts`) run on desktop, Pixel 7 and iPhone 14, and take
  seconds each.
- **Each primitive has an owner and a review rule.** Its header names the owner (`ui-builder`) and
  the specs that use it. A change to a primitive runs its contract spec and all those specs, and
  gets one review that covers every feature using it.
- **No behaviour changes except fixes, and no JS cap is raised.** The first-load headroom today is
  5.3 KB (Visual-first) and 3.9 KB (Text-first). The Select goes in the `shared-ui` group, so lazy
  chunks do not each carry a copy (23.2).

### 4. Cheaper end-to-end tests

- **UI-only specs get small plans.** `fixture-maker` builds them in `tests/fixtures/ui/` from a
  recipe: 10 to 30 tasks, 3 to 5 people, one group, and every leave type.
- **The big plans stay only where size matters.** `fedora-res` and the scale plans are kept for
  `workload-gate`, the perf specs, the health pairs (16.2), windowing, and other tests named for
  scale. Every other spec moves to a small plan.
- **Sharing a booted page is tried, not assumed.** For read-only specs, each worker would keep one
  booted page and load the next plan through the dev hook instead of booting again. This is
  adopted only if three trial specs save 30% with no state leaking between tests.
- **The time target.** Shards are rebalanced by measured time. Every required job finishes within
  12 minutes of a push (median of 5 runs), and no shard takes over 8 minutes.

### 5. Process

- **Batch pushes.** One push per batch goes to the integration branch. No push goes out while a run
  is within about 5 minutes of finishing.
- **Runs on `main` are never cancelled.** `cancel-in-progress` is set only for branches that are
  not `main`.
- **Flaky tests are named.** Retries stay at 1. A test that passed only on its retry is listed in
  the run summary. If that happens twice in a week, it is fixed or moved to the timing tier.
- **The gate file opens with a status line.** `phase-3-gate.md` starts with: the last green commit,
  the timing trend, the iPhone skips still left, and the CI wall time.

## What this does not change

- The text-first architecture.
- The engine, `engine/bridge/` and `engine/tj/`.
- The edit API and the golden corpus.
- The budget numbers (only where the frame-rate budgets are checked moves).
- The Phase 3 gate criteria.
- The real-device pass, which stays in Phase 6.
- The memory check that failed once stays as it is. It is an engine item for
  `engine-specialist`, not part of this pass.

## Done when (recorded in phase-3-gate.md)

1. The merge tier has no frame-rate or full-speed animation assertion. Five reruns of the merge
   tier on one commit are all green. The timing trend has at least three entries.
2. The `iphone-14` skips are down from 33 files to the allowlist (at most 6 entries, each with a
   reason). The setup script is documented. Each bug found is fixed, or listed with its severity.
3. Each of the six primitives has a contract spec that passes on all three devices. The global
   select rule is gone, and `select-arrows.spec.ts` passes on all three devices.
4. CI meets the time target in item 4 above.
5. The status line is at the top of the gate file.

## Fit with the plan

- **T21** (`test-writer`) takes changes 2 and 4 and writes the contract specs.
- **T22** (`perf-a11y-auditor`) takes the timing tier and its tolerances.
- **T23** takes the workflow changes and the setup script.
- **T25** is a new task for the primitives work (owner `ui-builder`, depends on change 1). No
  existing task covers it.
- `reviewer` does one pass per primitive, covering every feature that uses it. The CI changes do
  not touch the golden or fidelity jobs.
- T24 (gate evidence) follows, then the stop for approval.

## Conflicts with the plan, for the user to confirm

1. **Phase 3, 8.4 and 13.3, say the desktop frame caps are "enforced" in CI.** This ADR makes them
   a non-blocking timing tier. The build plan's testing table already says "Performance … Nightly".
2. **Phase 3, 13.2, limits iPhone 14 to "the drag rows with dispatched events".** The build plan
   runs every end-to-end row on iPhone 14 emulation. This ADR follows the build plan.
3. **The user's priority of 2026-11-16 says workload work first and polish waits unless it is a
   bug.** This pass runs inside T21 to T23, after T14 to T19. Most of what it fixes is bugs. Please
   confirm that it may run before any workload items still open.
4. **T25 is a new task** and needs approval (CLAUDE.md, "Before any work").

## Alternatives considered

- **Status quo.** Keeps the red runs that come from noise. iPhone bugs would keep reaching the user
  first, and each fix to a shared part would keep breaking other features.
- **Drop WebKit from CI.** Cheaper, but iPhone is a main target and these bugs were all
  WebKit-only. Phase 6's device pass would find them too late.
- **A UI component library.** Most headless Svelte libraries are MIT-licensed, which is GPL-2.0
  compatible. Apache-2.0-only or GPL v3 code is not allowed in the bundle (CLAUDE.md;
  `scripts/ci/licenses.mjs`). Rejected for other reasons:
  - it would use the little first-load headroom left;
  - it would need restyling to ADR-0009;
  - iOS problems with the native `<dialog>` would still be ours to fix;
  - moving to it this late in the phase costs more than these fixes.

## Consequences and risks

- **CI goes red for a while as the iPhone skips come off.** Each batch is done on a branch and
  merges only when green, so `main` stays green.
- **CI time goes up before it comes down.** About 400 more WebKit tests run. Change 4 lands before
  change 2 to pay for them, and the iPhone shards are resized after each batch.
- **Slowed motion tests the shape of a slide, not its speed.** The full-speed sampling on Chromium
  in the timing tier covers speed.
- **Moving the primitives touches many components.** The moves are mechanical commits with no
  behaviour change, made before any fix. Each consumer's specs run on every primitive change.
- **More process.** A small amount: a header on each primitive and a line in the gate file.
