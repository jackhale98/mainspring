# Phase 3: performance and accessibility findings (T22)

Written 2026-11-23 by `perf-a11y-auditor`. Specs: phase-3.md 8.1 to 8.5, 10, 13.3, 16.3, 26 (the two
tiers). Format as `phase-2-perf-a11y.md`. Raw numbers are in `docs/phases/evidence/phase3-*-t22.json`
(each record carries its device, browser, build, CPU throttle and load average). Summarise the Gantt's
with `node scripts/gantt-perf-summary.mjs docs/phases/evidence/phase3-gantt-perf-t22.json`.

## How the numbers were taken

- **Machine.** The shared 4-vCPU cloud sandbox (Intel Xeon at 2.1 GHz, no GPU, software raster) with
  other agent sessions running on it. **The load average was 7 to 8 at best and 15 to 35 for most of
  the day**, and frame numbers follow it (Phase 2 found the same). Two passes of the Workload
  frame specs are therefore given where they differ: a *quiet* pass (load 7 to 8) and a *busy* pass
  (load 15 to 18). Script times (drag, paint, derived work) are far less sensitive than frame counts.
  The JSON files in `evidence/` are the busy pass: Playwright empties `test-results/` when a run
  starts, and the quiet pass's `workload-perf.json` was gone before it could be copied (the numbers
  of it below were read from it before that). Every later run used `--output=<scratch>`.
- **Browser and build.** Chromium 156.0.8078.4 (headless, Playwright 1.64.1) for desktop and Pixel 7;
  WebKit 2370 for the iPhone 14 project. Build: `727f7270` plus the T22 changes (this commit).
  `MAINSPRING_DEV_PAGES=1 npx astro build`, preview on its own port, `--trace off`.
- **Devices.** `desktop` is Desktop Chrome 1280 x 720, no throttle. `pixel-7` is **emulation**
  (412 x 915, dpr 2.625, touch), unthrottled and with `Emulation.setCPUThrottlingRate` 4 (CDP). No
  real device (T26 waiver of 2026-11-13, phase-3.md 8.5). Everything about the phone is about the
  emulation.
- **Plans.** `fedora-res` (28 rows, 88 weeks, 611 days, 414 tasks, 241 health findings) for every view;
  `scale-1000` (1,000 tasks, pasted into the editor) for the derived work; `gantt-200` and `gantt-500`
  for the Phase 2 budgets of BUILD_PLAN.
- **Input and meter.** As Phase 2 (`tests/e2e/lib/perf.ts`): DevTools wheel gesture on a desktop,
  real touch events on a phone; rAF intervals ("on time" is 20 ms or less), Long Animation Frames,
  the compositor's dropped frames from a Chromium trace, script time per frame. Paint stats come from
  the cells painter itself (`HeatPlot`'s recorder, below).
- **Tiers (ADR-0016).** Frame caps and times are `@timing` (never block a merge, judged for a gross
  regression, over twice the budget in every run). Deterministic checks (DOM nodes, fills per frame,
  the long-task rule) are in the merge tier or the responsiveness job.

## Performance: each measurement against its budget

Budgets: phase-3.md 8.1, 8.3, 8.4, 16.3 and BUILD_PLAN "Performance budgets".

### The workload views (phase-3.md 8.4)

| # | Measurement | Budget | Desktop | Pixel 7 emulation | Verdict |
| --- | --- | --- | --- | --- | --- |
| W1 | Heatmap: scroll through every row and back (4 laps), `fedora-res`, best of up to three runs | at least 95% on time, at most 5% of compositor frames dropped, none over 50 ms (desktop caps) | quiet: week 100% on time, 1.5% dropped, longest 16.8 ms; day 100%, 0%, 16.8 ms (one run each). busy: three runs of 8.2, 7.9 and 9.8% dropped, 33 to 83 ms | n/a | **Met** when the machine is quiet; fails in the busy pass (load 17), as the Gantt did in Phase 2 |
| W2 | Heatmap: pan across the whole frame (88 weeks, 611 days) and back | as W1 | quiet: week 100% on time, 0.7% dropped, 16.8 ms; day 99.5%, 0.5%, 33.4 ms (the first run had a 116.7 ms frame, the second passed). busy: not run to a pass | n/a | **Met** (quiet) |
| W3 | Zoom: Ctrl+wheel from day to month, 60 notches | recorded | quiet: 190 frames, 98.9% on time, one frame of 66.6 ms, longest task 71 ms; busy: 96.5%, 66.7 ms | pinch week to month, 4 pinches: quiet 1x 100%, 4x 99.7% (one frame 66.7 ms); busy 4x 94.7%, 83.4 ms | Recorded. The 71 ms task is the model rebuild at the new bucket |
| W4 | A 3 s rebalance drag from a cell, script time per frame, p95 (input handlers plus rAF callbacks) | under 8 ms | quiet 1.6 ms (0.3 + 1.3), 378 frames all on time; busy 0.5 ms | not run (the phone drag needs a long-press; the desktop number is the budget) | **Met** |
| W5 | A scroll during which a result arrives (a real move released, the wheel turning until the engine's newer result is in) | recorded | quiet: 482 frames, 98.1% on time, one frame of 66.7 ms; busy: 333 frames, 90.7%, 16 frames over 50 ms, longest task 247 ms | not run | Recorded |
| W6 | Mounted DOM of the Workload view | at most 800 on a Pixel 7 (enforced) | 529 (reference) | **333** (iPhone 14, WebKit: 285) | **Met** |
| W7 | Swipe through the heatmap, 12 swipes, frames on time | target 90% at 4x (recorded, a miss is a finding) | n/a | 1x: 99.4 to 100% on time, longest 16.8 to 33.3 ms. **4x: 89.9% (quiet), 91.9% (busy)**, 1 to 2 frames over 50 ms, longest 66.8 ms | Recorded. **At the target, 0.1 point under in the quiet pass** |
| W8 | Cells painter, fills per frame, a sweep across the plot | at most 600 (8.1) | heat: week 407, **day 731 (p95 676)**; lanes: week 146, day 128 | heat 195 (week), 225 (day); lanes 148 and 129 | Pixel 7 **met**. **A 1280 px desktop at day zoom is over 600** (see finding P2) |
| W9 | Cells painter, script time per paint, p95 | 4 ms desktop, 8 ms at 4x | heat week 2.5, day 3.9 (max 5.4); lanes 2.2 and 2.2 | 1x: 1.4 to 2.9; **4x: heat 6.4 (week) and 7.0 (day), lanes 6.9 and 5.7** (max 11.2, one cold paint) | **Met** (p95); close at 4x |
| W10 | Mounted DOM of the other views | none in the spec; capped at about twice the measure (regression catcher) | lanes 170, calendar 112, team table 495, Health panel 982 (list windowed) | lanes 239, calendar 120, team 495, Health 976 | Recorded, caps 500, 300, 1,000 and 2,000 enforced (`phase3-perf.spec.ts`) |

### Derived work and responsiveness (phase-3.md 8.3)

| # | Measurement | Budget | Desktop, unthrottled (load 8) | At 4x CPU (load 7) | Verdict |
| --- | --- | --- | --- | --- | --- |
| D1 | Gantt analysis | each idle task under 50 ms at 4x | `fedora-res` 4.6 ms; `scale-1000` 7.1 | 37 ms; 25.8 | Met |
| D2 | Load model (first, then warm) | at most 15 ms on desktop; under 50 ms at 4x | 8.0 then 1.0 (`scale-1000`: 5.1) | 33.5 then 4.3 (22) | Met |
| D3 | Demand | at most 25 ms; under 50 ms at 4x | 2.0 (`scale-1000`: 3.3) | 34.9 (7.8) | Met |
| D4 | Health check | **at most 15 ms**; under 50 ms at 4x | **23.5** (`scale-1000`: 24.4) | **62.2** (39.7) | **Not met** on desktop (recorded, not enforced); over 50 ms at 4x on `fedora-res` |
| D5 | One runner task (the idle task that chains steps) | under 50 ms at 4x | 7.4 to 26.8 | 33 to **78.7** (`scale-1000`) | **Not met** at 4x on `scale-1000` |
| D6 | After the engine is ready, `fedora-res` with the Workload view open: no main-thread task over 50 ms (the responsiveness job, now implemented) | none after ready | 3 of 3 runs pass (load 16 to 18). Tasks over 50 ms wall after ready: 53 to 76 ms, of 22 to 44 ms of CPU: waiting, not busy | Reported: tasks of 74 to 164 ms wall (up to 158 ms of CPU) after ready | **Met** (by CPU time, see the spec header); **not met at 4x** (reported) |
| D7 | Health panel: open (press to the list), then a scroll through 241 findings | recorded | open 64 ms (quiet) to 191 ms (busy); scroll 96.5% on time, longest 49.9 ms (quiet); busy 95%, 66.6 ms | open 188 to 190 ms; scroll 100% on time (quiet), 94.8% (busy). **4x (busy): open 380 ms, scroll 47% on time, 19 frames over 50 ms, longest 200 ms** | Recorded. The phone at 4x is poor in the busy pass |

### Worker memory and JS (16.3, 8.3, 13.3)

| # | Measurement | Budget | Measured | Verdict |
| --- | --- | --- | --- | --- |
| M1 | Worker memory after the first result, `fedora-res` | recorded (16.3) | 112.9 to 113.4 MB (the wasm memory the worker reports, `timings.memoryBytes`) | Recorded |
| M2 | Worker memory growth over 12 reschedules (a character typed into the text each time) | recycle at 1.2 GiB (`client.ts`); the spec asserts at most 10% growth | 112.9 to 120.1 MB after the first edit, then **flat** over the other 11 edits (second run: 113.4 to 117.1 MB, flat from the third); growth after the first edit 0 to 3.7 MB | **Met**; no leak. The wasm memory never shrinks, so it is a high-water mark, the right measure of the worker's heap. The page's own JS heap reads a constant 16.1 MB (`performance.memory` is coarse without a flag) |
| J1 | First load, Visual mode (`js-sizes.mjs --serve`) | at most 330,000 bytes gzip | **329,561** | **Met, with 439 bytes of headroom** (finding P4) |
| J2 | First load, Text mode | at most 440,000 | 436,652 | Met (3,348 left) |
| J3 | All of `dist/_astro` | guard 650,000 | 608,147 | Met |
| J4 | People chunks (13.3: reported) | per-chunk caps; 60,000 for "the People chunk" in 8.3, amended by 23.1 | `PeopleView` 3,115; `Workload` 5,764; `WorkloadBar` 6,144; **`WhichTask` 19,196 (the plot, the painters and the details the heatmap and the lanes share; it had no cap)**; `Lanes` 9,818; `Calendar` 12,934; `ResourcesView` 7,333; `ResourcePanel` and its modules 12,769. **All the People views' chunks together: 90,589** | Met per chunk. New: `js-sizes.mjs` reports the sum and guards it at 100,000, and caps the shared chunk at 21,000. A Gantt-first load fetches none of them (`loadsPeopleChunk` false) |

### Phase 2 budgets (BUILD_PLAN), re-measured on this build

`gantt-perf.spec.ts`, `gantt-200` for the first open and `gantt-500` for the rest, **at load 15 to 18**,
so frame numbers are not comparable with Phase 2's (taken at load 3 to 4) and are given as they are.

| # | Measurement | Budget | Desktop | Pixel 7 at 4x | Verdict |
| --- | --- | --- | --- | --- | --- |
| B1 | App shell, first open (first contentful paint) | under 1.5 s | 0.84 s (rows at 0.76 s) | 0.26 s unthrottled | **Met** |
| B2 | Engine ready (status "Ready", `gantt-200`) | under 4 s | 7.9 s (started at 4.1 s) | 6.5 s unthrottled (started at 3.1 s) | **Not met**, as in Phase 2 (6.1 s and 5.5 s at load 3 to 4): the known Phase 0 deviation (wasm code cache is Phase 4) |
| B3 | 500-task scroll, 60 fps | 95% on time, none over 50 ms | 0 of 6 runs (best 90.3% on time, 6.5 to 16% dropped, 100 to 300 ms): **not a verdict**, the machine was at load 17 and Phase 2 passed 6 of 6 at load 3 to 4 | 0 of 6 (58 to 61% on time, 45 to 49% dropped), as Phase 2 (62 to 66%) | Desktop: not judged (load). Phone: **not met**, as Phase 2, unchanged |
| B4 | Drag feedback: script per frame, p95 (budget 8 ms in 8.4; the 16 ms of BUILD_PLAN) | 8 ms | 1.1 ms (0.3 + 0.8) | 5.6 ms (1.2 + 4.4) | **Met** |
| B5 | Drag feedback, pointer to the frame that shows it (`InputLatency`) | 16 ms | p50 11.8, p95 33.8 ms | p50 92, p95 198 ms | As Phase 2: the span runs to presentation on a software raster; the script cost (B4) is what the code controls |
| B6 | Reschedule after a drop, 500 tasks | 1 s for 200 tasks | 6.1 s | 4.6 s | The budget is for 200 tasks; 500 reported (Phase 2: 4.3 to 5.1 s at lower load) |

## Performance: findings and what was done

| # | Finding | Where | State |
| --- | --- | --- | --- |
| P1 | **The 8.3 rule had no check for the Workload view.** 13.3 says the `responsiveness` job extends to `fedora-res` with the Workload view open; only the 1,000-task engine page was covered. | CI | **Fixed**: `tests/e2e/workload-responsiveness.spec.ts`, run by `npm run test:responsiveness` with `engine-responsiveness.spec.ts` (config, `testIgnore`, shard plan and the WebKit-skip exemption updated). A long task after ready counts when its CPU time in a Chromium trace is over 50 ms: a task far longer in wall time than in CPU time waited for the machine or for V8's compile job (the same reading as the engine spec). Three runs asserted, 4x reported |
| P2 | **Fills per frame: 731 at day zoom on a 1280 px desktop, over the 600 of 8.1.** The window is every row (28, inside the 10 rows of overscan) by about 26 columns. On a phone it is 225. The script time per paint is 3.9 ms p95, inside the 4 ms. A taller or wider desktop screen has more visible cells than 600 whatever the overscan. | `Workload.svelte`, `Lanes.svelte` | **Design question.** Not changed. The spec test caps a desktop at 800 and a phone at 600; the budget that matters, script time, holds |
| P3 | **The first paint after the engine is ready is one rAF callback with a 46 ms Layout inside it** (99 ms at 4x), in the chunk named `WhichTask` (the plot's paint). It is the longest task after ready (D6). Layout inside a callback means the page is read after being written (fonts and canvas sizing are the likely cause); a trace on this machine shows the callback but not the line. | `HeatPlot.svelte` first paint | **Open**, for `ui-builder`: 8.1 says no layout reads in the paint path. Trace: `workload-responsiveness-trace-run-1.json` and `-4x.json` (kept by the spec, 15 MB each) |
| P4 | **The Visual-first first load has 439 bytes of headroom** (329,561 of 330,000). Any growth of the shared code fails `js-sizes`. | bundle | **Open** (user): either a small cut in the first load or a raise |
| P5 | **At 4x, derived tasks and the health check are over 50 ms** (D4, D5), and the health check is 23 ms against 15 on a desktop (recorded targets, 8.3). The idle callback runs several steps in one task (one FireIdleCallback of 129 ms wall, 118 ms CPU at 4x: two functions in `shared-ui` and the runner's idle timeout). | `schedule-runner`, `lib/health` | **Open**, for `engine-specialist` and `grammar-specialist`: chunk the steps against `IdleDeadline.timeRemaining()`; the health check's cold first call is most of it (warm calls are 5 to 10 ms, `health.perf.test.ts`) |
| P6 | **A Pixel 7 at 4x is at the target, not above it:** 89.9% of frames on time for the swipe (quiet pass), 91.9% (busy). The Health panel list at 4x scrolls at 47% on time in the busy pass. | emulation | Recorded, per 8.4 (a miss is a finding, not a failure). A real-device pass is Phase 6 |
| P7 | The Resources table's windowing (above 100 rows) was "not measured on `scale-1000`" (23). `scale-1000` has 60 resource rows (groups and people), under the threshold, so the table is not windowed there; `fedora-res` mounts 495 elements for its 28 people. | `ResourceTable` | Not reachable with the fixtures; the 100-row case is unit-tested (`rows.test.ts`). A plan with over 100 people would need a new fixture |
| P8 | `js-sizes.mjs` did not report the People views as a group and left the shared chunk (named `WhichTask`) uncapped. | `scripts/js-sizes.mjs` | **Fixed**: `peopleViews` in the JSON and the step summary with a guard of 100,000 (measured 90,589), and the cap of 21,000 for `WhichTask`; unit tests beside them |

Code changes for the numbers: `HeatPlot.svelte` pushes each cells paint (fills, texts, script ms) to
`globalThis.__mainspringPaint` **only when a test put an array there** (an init script); nothing is
kept in production, and the cost is one property read per paint. The harness additions are
`tests/e2e/lib/perf-env.ts` (the environment record), `workload-perf.spec.ts` (zoom, the 3 s drag, a
scroll during a result, the phone's swipes and pinches at 1x and 4x, with the load and build in every
record) and `phase3-perf.spec.ts` (DOM of every view, paint, derived work on `fedora-res` and
`scale-1000` at 1x and 4x, the Health panel, worker memory).

## Accessibility: findings

Spec: phase-3.md 10. Specs: the T21 inventory in `phase-3-gate.md` plus `phase3-axe.spec.ts` (new). All
on desktop and Pixel 7; the iPhone 14 where stated. Axe is `@axe-core/playwright` with wcag2a, wcag2aa,
wcag21a, wcag21aa and wcag22aa, light and dark. Screen readers were not run (Phase 6); names were read from
the accessibility tree (`ariaSnapshot`), written by the spec to `test-results/phase3-a11y-tree-*.txt`.

### Items

| # | Item (phase-3.md 10) | Evidence | Result |
| --- | --- | --- | --- |
| A1 | axe in every new Phase 3 state, both schemes | heatmap, thresholds, details (`workload-edits`); lanes and period details (`lanes`); Calendar, details (`calendar`); table, a person's details (`resources`); Health list, settings (`health`); Why here? (`why-here`); switcher, loading, failed, "No people", phone People tab (`people-shell`); New plan sheet, empty state, details with the name focused, + menu (`authoring`); Gantt filter, five states (`gantt-filter`). **Added:** the heatmap's "Move which task?" chooser, the Calendar in paint and erase mode with the scope and type menus, Resources with the Add person form open (`phase3-axe`) | **No violations** in any state, light or dark, desktop and Pixel 7 (iPhone: below) |
| A2 | Heatmap ARIA grid: `aria-rowcount`/`aria-colcount`, row headers, column headers, a cell named by person, period and hours | tree dump below; `workload.spec` | Pass |
| A3 | Heatmap keys: arrows, Home/End, PageUp/PageDown, Enter (details), T; Alt+arrows in the details | `workload.spec` (all but T), `rebalance.spec` (Alt keys). **T was not tested; `phase3-axe` now presses it** in the heatmap and the Calendar (the fixture `poc-sample` is dated around today) | Pass |
| A4 | Lanes: canvas hidden, a mirror whose cells name the assignments of the period | tree dump below; `lanes.spec`; `phase3-axe` asserts no unhidden canvas | Pass |
| A5 | Calendar: gridcells, `aria-selected`, Shift+arrows, L, Delete; paint mode and type announced | `calendar.spec`; **announcement added in `phase3-axe`** (`cal-live` says the mode, then the erase mode; polite status) | Pass |
| A6 | Health: list grouped by check with headings; the count in the button's name; "N new problems" announced politely, once per result | `health.spec`, `health-fixtures`; **the announcement had only a unit test; `phase3-axe` now brings a finding back with Undo and reads the live region** (said once, a repeat differs by an invisible character so a reader says it again) | Pass |
| A7 | Zoom of the heatmap and the lanes announced | **`phase3-axe`**: `heat-live` and `lanes-live` are polite status regions and say the zoom | Pass |
| A8 | Targets 44 x 44 on a coarse pointer (cells, days, chips, buttons); lane rows 40 px (Phase 2 exemption) | 44 px probes in `workload-edits`, `lanes`, `calendar`, `resources`, `health`, `people-shell`, `authoring`, re-run on the Pixel 7 in this audit | Pass |
| A9 | No drag without an alternative (2.5.7) | `rebalance`, `lanes`, `calendar`, `resources` (the menus and keys of W1 to W8) | Pass |
| A10 | Reduced motion | `phase3-a11y`: nothing in the heatmap, details, lanes, calendar or table animates or transitions. **One allowed animation: the brand mark's loader** pulses its opacity (ADR-0009) and held the test up when the engine was still busy under load; the test now skips that one animation (an opacity change is no movement) | Pass |
| A11 | Focus order and return | Calendar, Resources, Health, Why here?, People shell, authoring (many `toBeFocused`). **Gap found and fixed: "Move which task?" left the focus on the page when it closed** (A-F1). **Added:** Escape on the chooser, the Thresholds popover onto its chip, Enter on a lane period and Escape back to that period | Pass after the fix |
| A12 | Keyboard walkthrough W1 to W12 | W1 and W2 `rebalance`, `lanes`, `workload-edits`; W3 to W5 `calendar`; W6 to W8 `resources`; W9 `gantt-add-task`; W10 `phase3-a11y`; W11 `authoring`; W12 arrows `workload`, `calendar`, `lanes`, **T `phase3-axe`** | Pass |
| A13 | Screen-reader names of the mirrors | See the dump: the heatmap's cell is "Team, week of March 2: 72 of 180 hours, spare" (leave and over appended: "..., 16 hours of leave"); a lane cell "Dev 2, week of March 23: 17 of 40 hours, spare, works on Write docs 9 h, Write code 8 h"; a table row "Jack, in Developers, 184 h booked" with its level; the table is a `treegrid` named "People", the heatmap a `grid` named "Workload by person and period", the lanes "Resource lanes by person and period" | Pass |

Names, from `ariaSnapshot` (the heatmap, abridged):

```
- grid "Workload by person and period":
  - row "People week of March 2 week of March 9 ...":
    - columnheader "People"
    - columnheader "week of March 2"
  - row:
    - rowheader "Team, group, expanded"
    - gridcell "Team, week of March 2: 72 of 180 hours, spare"
    - gridcell "Team, week of March 9: 56 of 164 hours, spare, 16 hours of leave"
```

### Fixes

| # | Finding | WCAG | Fix |
| --- | --- | --- | --- |
| A-F1 | **"Move which task?" lost the focus.** It takes the focus into its first button and said in its header that it gave it back, but it did not: a choice, Escape or Cancel removed the focused button and the focus fell to the page's body. A keyboard or switch user lost their place in the grid. | 2.4.3 Focus Order, 2.4.7 | `WhichTask.svelte` remembers what had the focus (after a pointer drag, the view itself) and returns to it on close, else to the grid's focus cell of its view. Unit test `WhichTask.svelte.test.ts` (3 cases), and `phase3-axe.spec.ts` (Escape leaves the focus in the view). No visible change, so no screenshot |
| A-F2 | The reduced-motion spec failed under load when the engine was busy (the loader). | 2.3.3 | Not an app bug: the mark pulses by design. The spec skips that one animation, with the reason (`phase3-a11y.spec.ts`, 5 lines) |
| A-F3 | Live regions had no end-to-end test (`health-live`, `cal-live`, `heat-live`, `lanes-live`); the T key had none. | 4.1.3 | Tests added (`phase3-axe.spec.ts`); no app change was needed |

### Not done, and why

- Real screen readers (NVDA, VoiceOver, TalkBack): Phase 6.
- Forced colours and contrast of the canvas pixels in the People views (Phase 2 did them for the Gantt);
  the tokens are tested (`tests/ci/palette.test.ts`) but not the painted heat bands and lane bars.
- The iPhone 14 runs of the timing specs: they need Chromium's trace and throttle (allowlist, six
  entries of six, one added: the Health panel's frame times).

## Open items for the owners

1. **P2**, design: the 600-fill figure of 8.1 for a desktop. Keep it as a phone figure and take the
   4 ms of script time as the desktop budget, or lower the rows' overscan on a fine pointer.
2. **P3**, `ui-builder`: the 46 ms Layout in the first paint's rAF callback.
3. **P4**, user: 439 bytes of headroom in the Visual-first load.
4. **P5**, `engine-specialist`: chunk the idle steps; the cold health check (23 ms) against its 15 ms.
5. P6: the phone at 4x sits on the 90% target; real device in Phase 6.
6. The user's decision in the T21 notes about a drop on a group row is being built elsewhere; not touched.

## Run evidence

Builds: `npm run build:engine`, `MAINSPRING_DEV_PAGES=1 npx astro build`; ports 4994 to 4996; `--trace off`.

| Project | What ran | Result |
| --- | --- | --- |
| desktop | `phase3-axe` (24 tests across both projects with Pixel 7, 4 skipped as phone-only or desktop-only); `phase3-a11y`; the T21 accessibility inventory (axe, 44 px, keyboard, reduced motion, focus: `workload-edits`, `lanes`, `calendar`, `resources`, `health`, `why-here`, `people-shell`, `authoring`, `gantt-filter`, `workload`): 85 passed, 28 skipped for the other project, 1 failed (the reduced-motion spec on the loader, fixed above, then green) | pass |
| desktop | `workload-perf` and `phase3-perf` (`@timing` and merge tier): the frame caps pass in the quiet pass and fail in the busy pass (W1, W2); DOM, paint, derived work, memory and the Health panel record and pass; the drag script time asserts under 8 ms and passes | pass (quiet), see above |
| desktop (Chromium) | `workload-responsiveness` through `playwright.responsiveness.config.ts`: 3 runs asserted, 1 at 4x reported | 4 passed |
| pixel-7 | `phase3-axe`, `phase3-a11y`, the inventory above (the 44 px probes), `workload-perf` (DOM cap 333, swipes and pinches at 1x and 4x), `phase3-perf` (DOM, paint at 1x and 4x, derived work skipped as desktop-only, the Health panel) | pass |
| iphone-14 | `phase3-axe` (all states: axe in both schemes, live regions, names, T key), `phase3-a11y` (reduced motion), `phase3-perf` (DOM of each view, paint of the heatmap and the lanes at both zooms), `workload-perf` (285 nodes, cap 800): 8 passed on the re-run; the first run had six timeouts waiting for "Engine: Ready" at a load of 30 to 37 | pass |
| checks | `npx tsc --noEmit`, `npx svelte-check` (0 errors), prettier, `vitest run tests/ci tests/scripts src/components/workload src/components/resources src/lib/workload` (670 tests), `node scripts/ci/webkit-skips.mjs` (none outside the allowlist), `node scripts/ci/fixed-waits.mjs` (30 in 15 files, down from 32 because two waits of the swipe and pinch loops were replaced by frame counts), `node scripts/ci/no-ruby.mjs`, `node scripts/ci/shard-plan.mjs check`, `node scripts/js-sizes.mjs --serve` (exit 0) | pass |

