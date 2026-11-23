# Phase 3: performance and accessibility findings (T22)

Written 2026-11-23 by `perf-a11y-auditor`, revised the same day after review. Specs: phase-3.md 8.1
to 8.5, 10, 13.3, 16.3, 26 (the two tiers). Format as `phase-2-perf-a11y.md`. Every number below is in
a JSON file of `docs/phases/evidence/phase3-t22/` (one file per test and project; each carries its
device, browser, build, CPU throttle and the load average when it started), or is marked "not in
evidence". Summarise the Gantt's with `node scripts/gantt-perf-summary.mjs
docs/phases/evidence/phase3-t22/gantt-perf.json`.

## How the numbers were taken

- **Machine.** The shared 4-vCPU cloud sandbox (Intel Xeon at 2.1 GHz, no GPU, software raster) with
  other agent sessions on it. Its one-minute load average was 15 to 35 for most of the day and fell to
  1 to 4 for about half an hour. **The numbers in the tables are from that quiet half hour unless a
  load is given**; each record in the evidence says its own load. Frame numbers follow the load
  (Phase 2 found the same), so a number taken at another load is labelled. A first, busy pass (load 15
  to 18) is in the history of this file (commit 754ba2ea) and is cited only where it adds something.
  Playwright empties `test-results/` when a run starts, so every run of this audit used
  `--output=<scratch>`.
- **Browser and build.** Chromium 156.0.8078.4 (headless, Playwright 1.64.1) for desktop and Pixel 7;
  WebKit 2370 for the iPhone 14 project. The `build` in a record is `git describe --always --dirty`
  (the audit's commit with its working tree, `754ba2ea-dirty` for these runs).
  `MAINSPRING_DEV_PAGES=1 npx astro build`, preview on its own port, `--trace off`.
- **Devices.** `desktop` is Desktop Chrome 1280 x 720, no throttle. `pixel-7` is **emulation**
  (412 x 915, dpr 2.625, touch), unthrottled and with `Emulation.setCPUThrottlingRate` 4 (CDP). The
  iPhone 14 is WebKit emulation with no throttle and no trace. No real device (T26 waiver of 2026-11-13,
  phase-3.md 8.5). Everything about a phone is about the emulation.
- **Plans.** `fedora-res` (28 rows, 88 weeks, 611 days, 414 tasks, 241 health findings) for the views;
  `scale-1000` (1,000 tasks, pasted into the editor) for the derived work; the small `poc-sample` for the
  Calendar's DOM; `gantt-200` and `gantt-500` for the Phase 2 budgets of BUILD_PLAN.
- **Input and meter.** As Phase 2 (`tests/e2e/lib/perf.ts`): DevTools wheel gesture on a desktop, real
  touch events on a phone; rAF intervals ("on time" is 20 ms or less), Long Animation Frames, the
  compositor's dropped frames from a Chromium trace (during a pinch or a swipe with pauses it counts
  frames that were not needed, so it reads high), script time per frame. Paint stats come from the cells
  painter itself (`HeatPlot`'s recorder, below).
- **Tiers (ADR-0016).** Frame caps and times are `@timing` (never block a merge, judged for a gross
  regression, over twice the budget in every run). Deterministic checks (DOM nodes, fills per frame
  on a phone, the long-task rule) are in the merge tier or the responsiveness job.

## Performance: each measurement against its budget

Budgets: phase-3.md 8.1, 8.3, 8.4, 16.3 and BUILD_PLAN "Performance budgets".

### The workload views (phase-3.md 8.4)

Files: `workload-perf.json` (load 4.3 at the start, falling), `phase3-perf-paint-*`, `phase3-perf-dom-*`.

| # | Measurement | Budget | Desktop | Pixel 7 emulation | Verdict |
| --- | --- | --- | --- | --- | --- |
| W1 | Heatmap: scroll through every row and back (4 laps), `fedora-res`, best of up to three runs | at least 95% on time, at most 5% of compositor frames dropped, none over 50 ms (desktop caps) | week 73 frames, 100% on time, 0% dropped, longest 16.8 ms; day 71 frames, 100%, 0%, 16.8 ms (one run each passed) | n/a | **Met** at load 4. At load 16 to 18 the same spec failed (8 to 10% dropped, 33 to 83 ms), as the Gantt did in Phase 2: the cap is a regression catcher for a quiet runner |
| W2 | Heatmap: pan across the whole frame (88 weeks, 611 days) and back | as W1 | week 160 frames, 100%, 0.5% dropped, 16.8 ms; day 744 frames, 99.9%, 0.2%, 33.3 ms | n/a | **Met** at load 4 |
| W3 | Zoom: Ctrl+wheel from day to month, 60 notches; a pinch week to month, four pinches | recorded | 184 frames, 99.5% on time, longest 33.4 ms, longest task 41.5 ms, compositor dropped 9.3% | 1x: 100% on time, longest 16.8 ms, compositor dropped 33.3%. 4x: 99.6%, longest 33.3 ms, compositor dropped 50% (the pauses between pinches) | Recorded |
| W4 | A 3 s rebalance drag from a cell, script time per frame, p95 (input handlers plus rAF callbacks) | under 8 ms | 0.3 ms (0.2 + 0.1); 376 frames, 100% on time, longest 16.8 ms | not run (a phone drag needs a long-press; the desktop number is the budget) | **Met**. At load 16 to 18 (commit 754ba2ea) the script time still held (0.5 ms) while the frames did not: 468 frames, 87.6% on time, 25 over 50 ms, longest 450 ms, longest animation frame 561 ms |
| W5 | A scroll during which a result arrives (a real move released, the wheel turning until the engine's newer result is in) | recorded | 290 frames, 100% on time, longest task 35 ms | not run | Recorded |
| W6 | Mounted DOM of the Workload view | at most 800 on a Pixel 7 (enforced, `workload-perf.spec.ts`) | 529 (reference, not in evidence) | **333**. iPhone 14: 285 (observed in a run log, not in evidence) | **Met** |
| W7 | Swipe through the heatmap, 12 swipes, frames on time | target 90% at 4x (recorded; a miss is a finding) | n/a | 1x: 100% on time, longest 16.8 ms. **4x: 97.1%**, longest 50 ms, none over | **Met** at load 3. At load 7 to 17 the 4x swipe measured 89.9 to 91.9% (not in evidence), so the target is close |
| W8 | Cells painter, fills per frame, a sweep across the plot | at most 600 (8.1), asserted on a phone | heat: week 407, **day 731 (p95 676)**; lanes: week 146, day 128. **Recorded only** | heat 195 (week), 225 (day); lanes 148 and 129. iPhone 14: heat 149 and 181, lanes 108 and 108 | Phones **met** (asserted). A 1280 px desktop at day zoom is over 600: awaiting the user's decision (P2) |
| W9 | Cells painter, script time per paint, p95 | 4 ms desktop, 8 ms at 4x | heat 2.5 (week), 2.5 (day); lanes 1.4 and 1.2 | 1x: 1.3 to 1.5. **4x: heat 5.7 and 5.2, lanes 4.5 and 4.5** (longest single paint 8.4 ms). iPhone 14 (load 20): 2 to 4 | **Met** |
| W10 | Mounted DOM of the other views | none in the spec; caps of about twice the measure (regression catchers: 500, 300, 1,000) | lanes 170, Calendar 154 (`poc-sample`), table 495; Health panel 982 (below) | lanes 239, Calendar 154, table 495; Health 976. iPhone 14: 186, 154, 495; Health 964 | Recorded, caps enforced |

### Derived work and responsiveness (phase-3.md 8.3)

Files: `phase3-perf-derived-1x.json`, `-4x.json` (load 2), `responsiveness-workload-*.json` (load 3),
`phase3-perf-health-panel-*.json` (load 2 to 4). The 4x column of D1 to D5 and D7 (desktop row) is a
**desktop** browser throttled by 4; the Pixel 7 is named where it is meant.

| # | Measurement | Budget | Desktop, unthrottled | Desktop at 4x CPU | Verdict |
| --- | --- | --- | --- | --- | --- |
| D1 | Gantt analysis | each idle task under 50 ms at 4x | `fedora-res` 5.0 ms; `scale-1000` 8.8 | 26.7; 25.0 | Met |
| D2 | Load model (first, then warm) | at most 15 ms on desktop; under 50 ms at 4x | 7.6 then 0.9 (`scale-1000` up to 14.2) | 27.2 then 4.3 (up to 17.5) | Met |
| D3 | Demand | at most 25 ms; under 50 ms at 4x | 3.2 (`scale-1000` 3.1) | 28.7 (19.3) | Met |
| D4 | Health check, first (cold) call | at most 15 ms; under 50 ms at 4x | **15.9** (`scale-1000` 11.2) | 47.0 (42.4) | **Marginally over** on `fedora-res` (0.9 ms); under 50 ms at 4x, with 3 ms to spare. Recorded, not enforced |
| D5 | One runner task (the idle task that chains steps) | under 50 ms at 4x | 3.9 to 13.8 | 16.2 to 31; **61.1** on `scale-1000` | **Not met** at 4x on `scale-1000` |
| D6 | After the engine is ready, `fedora-res` with the Workload view open: no main-thread task over 50 ms (the responsiveness job, now implemented) | none after ready | **3 of 3 runs: no long task after ready** at load 3. A first, busy run (load 16 to 18) had one task of 53 ms wall and 44 ms of CPU; it passed because the rule is CPU time over 50 ms (a task far longer in wall than in CPU time waited for the machine) | after ready, 5 tasks of 53 to 148 ms wall, 55 to 147 ms of CPU (reported, not asserted) | **Met** at 1x (wall time at load 3; **by CPU time** when busy); **not met at 4x** |
| D7 | Health panel on `fedora-res` (241 findings): the time from the press to the list in the page, its mounted DOM, then a scroll of 200 frames | recorded | open 69 ms; 982 elements; 100% on time, longest 16.8 ms | desktop at 4x: open 197 ms; 64% on time, 2 frames over 50 ms, longest 66.6 ms | Recorded |
| D7b | The same on the phones | recorded | **Pixel 7 1x:** open 122 ms; 976 elements; 100% on time. **Pixel 7 at 4x:** open 273 ms; 47% on time, 1 frame over 50 ms, longest 50.1 ms, compositor dropped 21.6%. **iPhone 14:** open 469 ms; 964 elements; no frame record (WebKit has no trace or throttle) | | Recorded. A Pixel 7 at 4x scrolls the list at 47% on time (P6) |

### Worker memory and JS (16.3, 8.3, 13.3)

| # | Measurement | Budget | Measured | Verdict |
| --- | --- | --- | --- | --- |
| M1 | Worker memory after the first result, `fedora-res` | recorded (16.3) | 112.9 MB (the wasm memory the worker reports, `timings.memoryBytes`) | Recorded |
| M2 | Worker memory growth over 12 reschedules (a character typed into the text each time) | recycle at 1.2 GiB (`client.ts`); the spec asserts at most 10% growth after the first edit, and that the worker reports its memory | 112.9 MB, 120.1 MB after the first edit, flat to the ninth edit, 122.7 MB from the tenth to the twelfth: **2.6 MB (2.2%) after the first edit** | **Met**; no leak. The wasm memory never shrinks, so it is a high-water mark, the right measure of the worker's heap. The page's own JS heap reads a constant 16.1 MB (`performance.memory` is coarse without a flag) |
| J1 | First load, Visual mode (`js-sizes.mjs --serve`) | at most 330,000 bytes gzip | **329,561** | **Met, with 439 bytes of headroom** (finding P4) |
| J2 | First load, Text mode | at most 440,000 | 436,652 | Met (3,348 left) |
| J3 | All of `dist/_astro` | guard 650,000 | 608,147 | Met |
| J4 | People chunks (13.3: reported) | per-chunk caps; 60,000 for "the People chunk" in 8.3, amended by 23.1 | `PeopleView` 3,115; `Workload` 5,764; `WorkloadBar` 6,144; **`WhichTask` 19,196 (the plot, the painters and the details the heatmap and the lanes share; it had no cap)**; `Lanes` 9,818; `Calendar` 12,934; `ResourcesView` 7,333; `ResourcePanel` and its modules 12,769. **All the People views' chunks together: 90,589** | Met per chunk. New: `js-sizes.mjs` reports the sum and guards it at 100,000, and caps the shared chunk at 21,000. A Gantt-first load fetches none of them (`loadsPeopleChunk` false) |

### Phase 2 budgets (BUILD_PLAN), re-measured on this build

`gantt-perf.spec.ts` (`gantt-200` for the first open, `gantt-500` for the rest), at load 1 to 2. A busy
first pass (load 15 to 18, commit 754ba2ea) failed the desktop's frame caps in every run and measured the
engine at 7.9 s: those are load, not code, and are not the figures below.

| # | Measurement | Budget | Desktop | Pixel 7 at 4x | Verdict |
| --- | --- | --- | --- | --- | --- |
| B1 | App shell, first open (first contentful paint) | under 1.5 s | 0.39 s (rows at 0.35 s) | 0.40 s unthrottled (rows at 0.32 s) | **Met** |
| B2 | Engine ready (status "Ready", `gantt-200`) | under 4 s | 3.4 s (started at 1.5 s) | 3.3 s unthrottled (started at 1.4 s) | **Met** at a quiet machine (Phase 2: 6.1 s and 5.5 s at load 3 to 4; the busy pass here: 7.9 s and 6.5 s). Close to the budget |
| B3 | 500-task scroll, 60 fps (95% on time, none over 50 ms), three runs at day and at week zoom | every run passes | **6 of 6 runs pass**: 99.8 to 100% on time, 0.2 to 0.4% dropped, longest 16.8 to 50 ms | **0 of 6**: 61.5 to 62.3% on time, 33 to 37% dropped, 69 to 110 frames over 50 ms a run | Desktop **met**. Phone **not met**, unchanged from Phase 2 (62 to 66%) |
| B4 | Drag feedback: script per frame, p95 (budget 8 ms in 8.4) | 8 ms | 0.6 ms (0.3 + 0.3) | 5.0 ms (1.1 + 3.9) | **Met** |
| B5 | Drag feedback, pointer to the frame that shows it (`InputLatency`) | 16 ms | p50 11.1, p95 17.6 ms | p50 89, p95 132 ms | Desktop p50 is inside the budget; the phone is as in Phase 2: the span runs to presentation on a software raster, and the script cost (B4) is what the code controls |
| B6 | Reschedule after a drop, 500 tasks | 1 s for 200 tasks | 3.2 s | 3.5 s | The budget is for 200 tasks; 500 reported (Phase 2: 4.3 to 5.1 s) |

## Performance: findings and what was done

| # | Finding | Where | State |
| --- | --- | --- | --- |
| P1 | **The 8.3 rule had no check for the Workload view.** 13.3 says the `responsiveness` job extends to `fedora-res` with the Workload view open; only the 1,000-task engine page was covered. | CI | **Fixed**: `tests/e2e/workload-responsiveness.spec.ts`, run by `npm run test:responsiveness` with `engine-responsiveness.spec.ts` (config, `testIgnore`, shard plan and the WebKit-skip exemption updated). A long task after ready counts when its CPU time in a Chromium trace is over 50 ms; every task over 50 ms of the trace is kept in the record and matched by wall time (within 10 ms). Three runs asserted, 4x reported. Its records are `responsiveness-workload-*.json`, which the job's `responsiveness-*` upload takes, on success as well |
| P2 | **Fills per frame: 731 at day zoom on a 1280 px desktop, over the 600 of 8.1.** The window is every row (28, inside the 10 rows of overscan) by about 26 columns; on a phone it is 225. The script time per paint is 2.5 ms p95, inside the 4 ms. A taller or wider desktop screen has more visible cells than 600 whatever the overscan. | `Workload.svelte`, `Lanes.svelte` | **Waiting for the user.** Not changed, and **not asserted on a desktop** (record only); the 600 stays asserted on a phone |
| P3 | **The first paint after the engine is ready is one rAF callback with a 46 ms Layout inside it** (99 ms at 4x), in the chunk named `WhichTask` (the plot's paint). Layout inside a callback means the page is read after being written (fonts and canvas sizing are the likely cause); the trace shows the callback but not the line. Seen in a trace of a busy pass (wall 69 ms, 30 ms of CPU); the quiet runs have no task over 50 ms after ready at 1x. | `HeatPlot.svelte` first paint | **Open**, for `ui-builder`: 8.1 says no layout reads in the paint path. The spec keeps a trace of its first run and its 4x run in `test-results/` (15 MB each; not committed) |
| P4 | **The Visual-first first load has 439 bytes of headroom** (329,561 of 330,000). Any growth of the shared code fails `js-sizes`. | bundle | **Open** (user): either a small cut in the first load or a raise |
| P5 | **At 4x, one runner task is over 50 ms** (61.1 ms on `scale-1000`), and the health check's cold call is at its limit (47 ms at 4x, 15.9 ms against 15 on a desktop). The idle callback runs several steps in one task. | `schedule-runner`, `lib/health` | **Open**, for `engine-specialist` and `grammar-specialist`: chunk the steps against `IdleDeadline.timeRemaining()` |
| P6 | **The Pixel 7's Health list at 4x scrolls at 47% on time** (one frame over 50 ms). The swipe through the heatmap at 4x is at 97% in a quiet pass but was 89.9 to 91.9% at load 7 to 17 (not in evidence). | emulation | Recorded, per 8.4 (a miss is a finding, not a failure). A real-device pass is Phase 6 |
| P7 | The Resources table's windowing (above 100 rows) was "not measured on `scale-1000`" (23). `scale-1000` has 60 resource rows (groups and people), under the threshold, so the table is not windowed there; `fedora-res` mounts 495 elements for its 28 people. | `ResourceTable` | Not reachable with the fixtures; the 100-row case is unit-tested (`rows.test.ts`). A plan with over 100 people would need a new fixture |
| P8 | `js-sizes.mjs` did not report the People views as a group and left the shared chunk (named `WhichTask`) uncapped. | `scripts/js-sizes.mjs` | **Fixed**: `peopleViews` in the JSON and the step summary with a guard of 100,000 (measured 90,589), and the cap of 21,000 for `WhichTask`; unit tests beside them |

Code changes for the numbers: `HeatPlot.svelte` pushes each cells paint (fills, texts, script ms) to
`globalThis.__mainspringPaint` **only when a test put an array there** (an init script); nothing is
kept in production, and the cost is one property read per paint. The harness additions are
`tests/e2e/lib/perf-env.ts` (the environment record, and one file per test), `workload-perf.spec.ts`
(zoom, the 3 s drag, a scroll during a result, the phone's swipes and pinches at 1x and 4x),
`phase3-perf.spec.ts` (merge tier: DOM of the lanes, Calendar and table; paint) and
`phase3-timing.spec.ts` (timing tier: derived work on `fedora-res` and `scale-1000` at 1x and 4x, the
Health panel, worker memory). CI uploads the records: `phase3-perf-*.json` with the timing artifacts, and
`responsiveness-workload-*.json` with the responsiveness report. The new timing tests add about 8
minutes to the timing job (derived work 2 x 0.5, memory 2, Health panel 1 per project, the workload
additions 2). This audit's run of the new and changed timing tests (`workload-perf`, `phase3-timing`) took
4.8 minutes on desktop and Pixel 7 and 22 seconds on the iPhone, with the Gantt's own 8.7 minutes beside
them, on a quiet machine: well inside the timing job's 45 minutes. The merge tier's cost of the new
files is in `tests/e2e/durations.json` (below).

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
| A3 | Heatmap keys: arrows, Home/End, PageUp/PageDown, Enter (details), T; Alt+arrows in the details | `workload.spec` (all but T), `rebalance.spec` (Alt keys). **T was not tested; `phase3-axe` now presses it** in the heatmap and the Calendar with the browser clock fixed (`page.context().clock.setFixedTime`) to Wednesday 13 January 2027, inside `poc-sample` (2026-11-16 for five months): the heatmap's focus goes to the cell named "week of January 11" (the Monday of that date) and the Calendar's day 2027-01-13 gets `aria-current="date"`, so the result does not depend on the date the test runs | Pass (desktop and Pixel 7 run it; a phone has no keyboard, so it skips there) |
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
| A-F1 | **"Move which task?" lost the focus.** It takes the focus into its first button and said in its header that it gave it back, but it did not: a choice, Escape or Cancel removed the focused button and the focus fell to the page's body. A keyboard or switch user lost their place in the grid. | 2.4.3 Focus Order, 2.4.7 | `WhichTask.svelte` remembers what had the focus (after a pointer drag, the view itself) and, on close, returns to it **only if the focus is about to fall** (still on the dialog, or nowhere; something that took it since keeps it), else to the grid's focus cell of its view, with `preventScroll`. Unit test `WhichTask.svelte.test.ts` (5 cases: opens with the focus; returns to what had it; to the grid cell when that is gone or nothing had it; leaves a focus that something else took), and `phase3-axe.spec.ts` (Escape leaves the focus in the view). No visible change, so no screenshot |
| A-F2 | The reduced-motion spec failed under load when the engine was busy (the loader). | 2.3.3 | Not an app bug: the mark pulses by design. The spec skips that one animation, with the reason (`phase3-a11y.spec.ts`, 5 lines) |
| A-F3 | Live regions had no end-to-end test (`health-live`, `cal-live`, `heat-live`, `lanes-live`); the T key had none. | 4.1.3 | Tests added (`phase3-axe.spec.ts`); no app change was needed |

### Not done, and why

- Real screen readers (NVDA, VoiceOver, TalkBack): Phase 6.
- Forced colours and contrast of the canvas pixels in the People views (Phase 2 did them for the Gantt);
  the tokens are tested (`tests/ci/palette.test.ts`) but not the painted heat bands and lane bars.
- The iPhone 14's frame times: WebKit has no trace and no CPU throttle. The timing specs run there and
  record what they can (the Health panel's time to open and its DOM, the cells paint, the DOM of the
  views); the Gantt and Workload frame specs are the allowlisted ones (5 entries of 6).

## Open items for the owners

1. **P2**, design: the 600-fill figure of 8.1 for a desktop. Keep it as a phone figure and take the
   4 ms of script time as the desktop budget, or lower the rows' overscan on a fine pointer.
2. **P3**, `ui-builder`: the 46 ms Layout in the first paint's rAF callback.
3. **P4**, user: 439 bytes of headroom in the Visual-first load.
4. **P5**, `engine-specialist`: chunk the idle steps (a runner task of 61 ms at 4x on `scale-1000`); the cold health check is 15.9 ms against 15, and 47 ms at 4x.
5. P6: the Pixel 7 at 4x (the Health list at 47% on time); real device in Phase 6.
6. The user's decision in the T21 notes about a drop on a group row is being built elsewhere; not touched.

## Run evidence

Builds: `npm run build:engine`, `MAINSPRING_DEV_PAGES=1 npx astro build`; ports 4994 to 4996; `--trace off`.
Test counts are from the final runs of this revision.

| Project | What ran | Result |
| --- | --- | --- |
| desktop and pixel-7 | merge tier of `phase3-axe`, `phase3-perf`, `phase3-a11y` and `workload-perf` (`--grep-invert @timing`) | 36 passed, 6 skipped (keyboard-only on a phone, phone-only on a desktop) |
| desktop and pixel-7 | timing tier: `workload-perf`, `phase3-timing` | 8 passed |
| desktop and pixel-7 | `gantt-perf` (`@timing`) | 4 passed |
| desktop (Chromium) | `workload-responsiveness` through `playwright.responsiveness.config.ts` | 4 passed |
| iphone-14 | the same merge-tier files | 16 passed, 5 skipped (the timing and desktop-only tests) |
| iphone-14 | timing tier: `phase3-timing` (the Health panel's time to open and its DOM; the rest is desktop-only) | 1 passed |
| inventory (earlier in the audit, commit 754ba2ea) | the T21 accessibility specs: `workload-edits`, `lanes`, `calendar`, `resources`, `health`, `why-here`, `people-shell`, `authoring`, `gantt-filter`, `workload` (axe, 44 px, keyboard, reduced motion, focus) | 85 passed, 28 skipped for the other project, 1 failed (the reduced-motion spec on the loader, fixed above, then green) |

Per-file merge-tier durations, seconds of worker time with two workers, as `tests/e2e/durations.json`
keeps them (only new keys were added; the rest of the file is another task's). Measured on this machine at
a load of 18 to 23 for the desktop and the iPhone and 2 to 20 for the Pixel 7, so they are **upper
bounds**; the iPhone's `ciFactor` is 1 (CI seconds), so they are the numbers the shard plan will use.

| File | desktop | pixel-7 | iphone-14 |
| --- | ---: | ---: | ---: |
| `phase3-axe.spec.ts` | 69.4 | 60.3 | 263.7 |
| `phase3-perf.spec.ts` | 25.3 | 33.4 | 183.5 |
| `phase3-a11y.spec.ts` | 14.8 | 3.2 | 16.3 |

The iPhone's 263.7 s for `phase3-axe` is 15 tests that each load a plan (about 45 s each at that
load); `phase3-perf` is four plan loads (the heatmap, the lanes, the Calendar, the table). If a shard's
time matters, the six axe scans are the part to thin (light only on the iPhone).

Checks, all green on the final tree: `npx tsc --noEmit`, `npx svelte-check` (0 errors), prettier,
`vitest run tests/ci tests/scripts src/components/workload` and the touched unit tests,
`node scripts/ci/webkit-skips.mjs` (none outside the allowlist), `node scripts/ci/fixed-waits.mjs`,
`node scripts/ci/no-ruby.mjs`, `node scripts/ci/shard-plan.mjs check`, `node scripts/js-sizes.mjs --serve`.
