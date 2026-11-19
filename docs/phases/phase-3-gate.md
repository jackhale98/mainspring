# Phase 3 gate evidence

## Status

Kept at the top of this file by the main session (ADR-0016 section 5). Update it at the end of every
batch, before the push.

| Item                       | Now                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Last green commit on main | `60680f74` (branch run 44360731949, 2026-11-18; main fast-forwarded): B2 (the Gantt edge specs on the iPhone) and its review fixes, on top of the iPhone CI times (`93c9b361`, run 44346394164, 14 min) |
| Timing trend               | 1. `d4150c6d` (run 44240034126, artifact `timing-232`): job green, no gross regression               |
| iPhone 14 skips left | None outside the allowlist (2026-11-19): B4 is done (health, health fixes, why-here and the health screenshots run on the iPhone 14 once the windowed Health list held still on WebKit, `anchor.ts`), so `PENDING_BATCHES` in `scripts/ci/webkit-skips.mjs` is empty and the scan fails on any iPhone skip outside the allowlist in every spec. Allowlist: 5 entries of at most 6 (1 `cdp-touch`, 4 `chromium-performance-api`) |
| CI wall time | 14.7 min (run 44371927138, B2 with 9 iPhone shards). B3's specs made the iPhone project about 103 worker-minutes (run 44382320872, whose shard 1/9 ran 49 min because they were estimated at zero), so it has 15 shards at 8 min or less by the plan, and `workload.spec.ts` is split in two (one file ran 9 min on the iPhone). The iPhone times are re-measured from the CI reports of each batch's first run (`shard-plan.mjs measure`); a push to `main` runs only the timing tier, and an e2e shard stops at 35 min. Target 12 min (ADR-0016 section 4); with 35 jobs against about 20 concurrent runners the wall time is expected above it, to be measured. The e2e shards run in `mcr.microsoft.com/playwright:v1.64.1-noble` |

How the iPhone skips are counted, so that the number is repeatable. A spec file counts when it has a
`skip` call and also names the iPhone project or WebKit:

```sh
grep -lE "skip" tests/e2e/*.spec.ts | xargs grep -lE "iphone-14|isIphone|webkit" | wc -l
```

`tests/e2e/lib/webkit-allowlist.ts` now exists (ADR-0016 section 2): count its entries as well, and the
`check` job's `node scripts/ci/webkit-skips.mjs` fails on a skip naming the iPhone or WebKit outside it,
for every spec (its `PENDING_BATCHES` list is empty since B4). Run the iPhone specs with `npm run setup:webkit` once, then
`npm run test:e2e:iphone -- <spec>`.

How the CI wall time is read: open the run of the `CI` workflow on the branch commit that `main` was
fast-forwarded to (a push to `main` runs only the timing tier, ADR-0016 section 5); the wall time
is the time from start to the end of the slowest job (the run's "Total duration"). The timing job is
`continue-on-error` and is not part of the merge wall time.

## The two tiers (ADR-0016 section 1)

- **Merge tier** (blocks a merge): everything except `@timing`. The e2e matrix runs
  `playwright test --grep-invert @timing`. The `gates` job is now JS sizes only. The Pixel 7 DOM-node
  cap (`workload-perf.spec.ts`), golden parity and the responsiveness job are unchanged. Sheet
  motion is checked for its shape (only `transform` moves, many steps, the right way, no gap) with
  `slowSheets` (2 s slides) on every browser; the 200 and 180 ms motion tokens are still checked
  at full speed, since that is not timing-sensitive.
- **Timing tier** (never blocks): tests tagged `@timing`, run with
  `playwright test --grep @timing --workers=1 --project=desktop --project=pixel-7` (the `timing` job of `ci.yml` adds `--project=iphone-14`, in the same Playwright container as the e2e shards; only its first-open and gesture-frame runs exist there, the rest is allowlisted):
  - `gantt-perf.spec.ts` (all of it: the desktop caps, first open, the phone profile and the
    touch-listener comparison; the phone profile runs only with `E2E_PERF=1`, that is nightly),
  - `workload-perf.spec.ts` desktop scroll caps and the Pixel 7 swipe frame times,
  - `gantt-gesture-frames.spec.ts`,
  - the full-speed copies of the sheet shape tests (named `... (full speed)`, Chromium only), including
    "closing while it slides in goes on from where it is". Its shape copy (merge tier, every browser,
    iPhone 14 included) slows the sheets to 6 s and closes 250 ms in; the full-speed copy closes 70 ms
    into the 200 ms slide.
- Where it runs: the `timing` job of `ci.yml` on every push to `main` (`if: github.ref ==
'refs/heads/main'`), and the `timing` job of `nightly.yml` (with `E2E_PERF=1`).
  Both are `continue-on-error`: the workflow stays green whatever they do.

## Reading the timing trend

Each timing run leaves three things:

1. **The step summary** of the run: a table from `scripts/ci/timing-check.mjs` with one row per
   measure (the Gantt's scroll at day and week zoom, its drag script time, the Workload heatmap's
   scrolls): the budget, the "gross" line (twice the budget), the number of runs, the best and the
   worst run, and a verdict.
2. **The artifact** `timing-<run number>` (nightly: `timing-nightly-<run number>`), kept 90 days:
   `gantt-perf.json`, `gantt-gesture-frames.json`, `workload-perf.json`, `timing-summary.md` and
   `e2e-results.json`. The trend is the "Best" column of `timing-summary.md` across artifacts; to
   plot it, download several and read that column, or run
   `node scripts/gantt-perf-summary.mjs <gantt-perf.json>` on each for the full per-frame numbers.
3. **The job's colour.** Green job: no gross regression. A red job on a green workflow:

**What a red timing run looks like.** The job `Timing tier` shows a red cross, the step `Judge the
timing run` has failed, and its last line is

```
Gross regression (over 2x budget in all runs): gantt scroll day: dropped frames %
```

The summary table shows `GROSS REGRESSION` on that row. It means the measure was more than twice its
budget (dropped frames over 10 %, a frame over 100 ms, drag script p95 over 16 ms) in every run the
spec made (three, plus the extra runs the Gantt makes when none is within the budget). The workflow
itself stays green, so a merge is not blocked, but the main session treats it as a bug before the
next batch (ADR-0016): find the commit from the run's SHA, reproduce with
`npx playwright test --grep @timing --workers=1 --project=desktop`, fix it. Budgets do not change.

Everything between the budget and twice the budget shows as `over budget (noise?)` and does not turn
the job red: a shared runner drops frames in bursts of minutes whatever the code does. Look at the
trend (several runs in a row over budget), not at a single run. A failing assertion in the
`Timing tests` step (for example the 5 % cap) is reported on the summary line "Timing tests step:
failure"; it is a signal, not a gate.

To judge a local run: `node scripts/ci/timing-check.mjs` reads `test-results/` and exits 1 on a gross
regression. Its rules are unit tested in `tests/scripts/timing-check.test.ts`.

## Flaky tests (ADR-0016 section 5)

Retries stay at 1. Every e2e shard and the timing job end with a step that lists the tests that
passed only on their retry (`scripts/ci/flaky-summary.mjs`, from the JSON reporter's
`test-results/e2e-results.json`) in the run summary. A test that appears twice in a week is fixed or
moved to the timing tier.

## Concurrency

`cancel-in-progress` is on for every ref except `main`: a push to `main` never cancels the run of the
commit before it. Batch pushes; do not push within about 5 minutes of a run finishing.

## T25: shared UI primitives (ADR-0016 change 3)

Six primitives with an owner (`ui-builder`) and a contract spec each, all in the header of the
component. The specs run on `/dev/primitives` (built only with the dev pages, no engine) on desktop,
Pixel 7 and iPhone 14, and are in the CI shards (`scripts/ci/shard-plan.mjs` walks
`tests/e2e/primitives/`; its unit test checks every spec lands in exactly one shard).

| Primitive  | Code                                                                | Contract spec                          |
| ---------- | ------------------------------------------------------------------- | -------------------------------------- |
| Sheet      | `src/components/Sheet.svelte`                                       | `tests/e2e/primitives/sheet.spec.ts`   |
| Menu       | `src/components/ui/Menu.svelte`, `src/lib/ui/place.ts`              | `tests/e2e/primitives/menu.spec.ts`    |
| Select     | `src/components/ui/Select.svelte` (the global select rule is gone)  | `tests/e2e/primitives/select.spec.ts`  |
| Toolbar    | `src/lib/ui/toolbar-tiers.ts`, `src/styles/toolbar.css`             | `tests/e2e/primitives/toolbar.spec.ts` |
| Grid focus | `src/lib/ui/roving-grid.ts`                                         | `tests/e2e/primitives/grid-focus.spec.ts` |
| Popover    | `src/components/ui/Popover.svelte`                                  | `tests/e2e/primitives/popover.spec.ts` |

**Exception: the Calendar bar wraps, in two rows on a phone.** The one-row check from 360 to 1600 px
holds for the Gantt's chips and for the Workload and Lanes bar. The Calendar's bar has five groups
(months, Today, person, mode, type) that cannot share 360 px. After the compact pass (user,
2026-11-18, "Make the controls more compact") it is two rows on a phone (up to 599 px; it was three),
two rows from about 615 to 1000 px, and one row from 1024 px. Row one is the months (previous, "Nov
2026", next) and the mode as three icons (Select, Paint, Erase); row two is Today as an icon, the
person and the leave type. They use the toolbar's narrow forms (`icon-phone`, plus the `.ico-stand`
and `.lbl-short` hooks added to `toolbar.css`). Measured at 107 px high (it was 175): the month shows
five full weeks at 390x664 (iPhone 14; four before) and at 360x640 (three before).
`toolbar.spec.ts` allows exactly that (`calendarRows`) and still fails on any clipped control.

**Three rows still happen** where the Calendar's own width is under 600 px but the viewport is not a
phone: at every viewport from 600 to about 615 px (in Visual mode at 600 px the Calendar is 584 px
wide and its bar is 133 px high), and in a Split pane dragged under 600 px. That is the bar from
before the compact pass, left as it was (the compact form is keyed to the viewport, `icon-phone`;
tablet and desktop layouts were to stay as they are). The spec allows three rows only at its 600 px
step. **Follow-up for the user:** a compact Calendar bar in a narrow container, and on 600 dp
tablets (a container-keyed `icon` form for the mode switch and Today, so that the two-row bar also
serves 600 to 615 px and a narrow Split pane).

**First-load JS (gzip, `js-sizes.mjs --serve`), before and after the compact Calendar bar.** The three
mode icons live in the lazy `src/lib/icons-calendar.ts` (passed to `Icon` as `paths`), so the first
load does not carry them. Measured on the merged tree, with and without the change:

| First load   | Before  | After   | Delta | Cap     | Headroom |
| ------------ | ------- | ------- | ----- | ------- | -------- |
| Visual-first | 327,837 | 327,865 | +28   | 330,000 | 2.1 KB   |
| Text-first   | 439,192 | 439,222 | +30   | 440,000 | 0.8 KB   |

The `calendar` chunk is 13,069 before and 13,089 after (cap 16,400). With the icons in `icons.ts` the
delta had been +239 and +246 bytes.

**First-load JS (gzip, `js-sizes.mjs --serve`), before and after T25.** Both stay under their caps.

| First load   | Before  | After   | Delta  | Cap     | Headroom |
| ------------ | ------- | ------- | ------ | ------- | -------- |
| Visual-first | 324,406 | 327,560 | +3,154 | 330,000 | 2.4 KB   |
| Text-first   | 435,830 | 438,913 | +3,083 | 440,000 | 1.1 KB   |

By chunk (first load): `shared-ui` 38,369 to 44,689 (+6,320: Select, Menu, Popover, `place`,
`roving-grid` and what they import; the group keeps lazy views from carrying a copy each). The
bundler re-cut the rest: `App` 91,432 to 84,204 (-7,228), and the small `SegmentTabs` (10,636),
`Sheet` (2,807), `preload-helper` (852) and `avatar` (115) chunks went into the new `ViewSwitcher`
(9,010) and `gantt-env.svelte` (9,504) chunks. Every named lazy-chunk cap in `js-sizes.mjs` holds.
Text-first headroom is thin: the next UI change has to pay for itself.

**Behaviour changes, disclosed.** The three menus now share one placement (fixed, inside the viewport,
flipped above when short) and hide key hints without a fine pointer; the Workload bar's Today loses its
label at 899 px, not 859; `OutlineGrid` and the Calendar gain the kept-focus rule. The Gantt toolbar's
Today and zoom select change only on a phone, as before the move.

Pictures: `docs/phases/screenshots/phase-3/t25-<primitive>-<desktop|pixel-7>-<light|dark>.png` (the dev
page) and `t25-app-<what>-<pixel-7|iphone-14>-<light|dark>.png` (the real app).

## Test infrastructure reset (user, 2026-11-18)

After B3 the user paused the skip batches: a day of iPhone fixes had still left CI red. Most red runs
were fixed waits that CI's WebKit (a median 3x the Pixel 7's time) outran, the shard planner put
every newly turned-on spec at 0, and every test boots the engine and schedules its plan from scratch
(about 313 page opens; 55 to 100 s per test on `fedora-res` on CI WebKit). In order:

1. Tooling: the planner estimates a newly turned-on spec from the other phone (`shard-plan.mjs`,
   `alike`); fixed waits may only go down (`scripts/ci/fixed-waits.mjs`, 339 in 73 files at the
   start). Done 2026-11-18.
2. Replace the fixed waits with waits for state, starting with the rigs and the files with the most.
   Slice 3 (2026-11-19): 139 in 33 files down to 32 in 15 files. What is left is input the page
   measures on its own clock (a long-press, a wheel's stillness, a finger's pace) and the pauses
   that are part of a perf measurement; each has a comment saying so.
3. Measure where an iPhone test's time goes (boot, first schedule, the test's own steps) and time
   the `fedora-res` schedule on a real iPhone.
4. Stop every test paying the engine start-up (a booted page per worker, smaller plans where the
   schedule is not under test, or the schedule cache of ADR-0015): an ADR for the user first.
5. Then B4 (Health) and B5 (Text mode): both done (2026-11-19).

T27 (ADR-0018) so far, recorded for the user:
- **First-load bytes over the ADR's target.** T27a and T27b add about 1,360 bytes gzip to each
  first load (Visual-first 328,668 of 330,000, Text-first 435,202 of 440,000, measured the CI way),
  against the ADR's target of 700 for all of T27. The caps hold and no cap changed; the two reviews
  found nothing that can go without losing a check. Accepted by the user, 2026-11-19 ("the budget
  increase is fine"); the caps are unchanged.
- **Deviations from the ADR, by the implementation and its review:** no call through
  `dispatchPlan`, and no `updateLeave` or `removeLeave`, is ever coalesced (a planner's range maps
  to the text now, not to a gesture's base); siblings and macro-declared or shared declarations
  also fail the id check once ids may have moved (cases the review reproduced), so an inspector edit
  of a shared declaration right after typing is refused until the index catches up.

- **T27e, the reproduction (2026-11-19).** `tests/e2e/stale-index.spec.ts` on desktop Chromium, on
  b9b30348 (the hold hook and the spec, without T27b or T27d; run unmarked with
  `STALE_INDEX_REPRO=1`) and on T27d:

  | Case | Before | After |
  | --- | --- | --- |
  | Alt+Shift+Up right after Redo (Gantt) | fails: wrong order | passes |
  | Three quick presses | fails: `gate` misplaced | passes |
  | A drop after an Undo that reordered its parent is refused | fails: the drop applied | passes |
  | A drop after an Undo elsewhere lands in the shown slot (control) | passes | passes |
  | Resource table Alt+Shift+Up right after Undo | fails: `rev` went into the group | passes |
  | A leave edit after a rename, index held | fails: the edit never written | passes |
  | Two quick changes to one leave both land | fails: the second lost | passes |
  | Remove while the index lags | fails: Remove disabled | passes |

  After: 8 of 8 on desktop and Pixel 7; iPhone 14 by the author's run and CI. The property test
  (`edits-rebase.property.test.ts`) passed at `REBASE_RUNS=2000` twice; fidelity 33 of 33.
- **T27d's deviations:** field errors are checked in the leave card before it dispatches (they stay
  inline, no refusal toast); a commit equal to what the card last sent or read is not sent; the
  resource table's step announcement is read from the applied toast; DayDetails still keys cards by
  `file:from` (a remount while the index lags means the next commit is refused, never misdirected:
  keying by item identity would remount every card on every publish); `App.svelte` imports
  `gantt/rows-plan.ts`, so one planner factory is on the first load (+361 bytes Visual-first, within
  the accepted budget), where the ADR placed the factories in lazy chunks.

App bugs found on the way, open:
- **The windowed Health list jumped on WebKit** (B4, 2026-11-18; fixed 2026-11-19, `FindingGroup.svelte`,
  `lib/health/anchor.ts`). WebKit has no scroll anchoring: as rows mounted, the groups above the
  viewport were measured and re-windowed, and the content moved by thousands of px (a group at 395 px
  went to -4550 in two frames; `scrollHeight` 44k to 19k), so a tapped row was unmounted; at the end
  of the panel the layout kept cycling every 100 ms. Cause: an unmeasured row was estimated at the
  average of the measured ones, so each row measured moved every unmeasured row above the viewport,
  and a row mounted and unmounted between ResizeObserver deliveries was never measured, so a group
  alternated between two heights. Fix: rows are measured synchronously when they mount and kept by
  key, the estimate stops following the average after 8 rows, and the list scrolls by the change
  above the first row in view itself (Chromium's anchoring is off for the panel). Before and after
  numbers: "Health list on WebKit" below.
- **Edits planned on a stale index** (audit, 2026-11-19; ADR-0018 in progress, user's direction: fix
  it in the edit layer). The index lags the text (up to about 4 s on a slow WebKit runner), and views
  read targets from it: the Gantt's Alt+Shift moves and row menu (`interactions.svelte.ts` reorder)
  and its row drop (`moveTo`) can apply a wrong edit right after Undo, Redo or typing; adding a task
  or a person can land in the wrong place; leave edits and removes are refused when the wait runs
  out. Fixed per component so far: the resource table's step (105eb230) and the leave card (1a914cc5,
  dc4cbf85).
- **Find and replace offline on first use** (first-load savings review, 2026-11-19): the search
  package loads on the first Ctrl/Cmd press; offline before it was ever cached, the shortcut opens
  nothing and says nothing (the next press retries). It needs a short status, and the chunk belongs
  in the service worker's precache list when that lands.
- **On Safari the first "Try again" after a failed chunk cannot succeed**: WebKit remembers the
  failed import, so the slot's Reload step is always needed there (B3 review).
- **Gated specs rotted unseen** (2026-11-19): with SCREENSHOTS=1, 12 tests had broken over three
  days (Gantt row lookups by any text after the Predecessors/Successors columns, 83174a48; the
  Workload view's heatmap after T14, a83987e7); fixed in cb2b993b. A nightly job now runs every
  SCREENSHOTS-gated spec on desktop and Pixel 7 in two shards (`nightly.yml` `gated`, user
  2026-11-19), and the main session reads the nightly result daily (every nightly job is
  continue-on-error, which hid three nights of patch-fidelity failures).
- **A short Gantt handle drag sometimes makes no edit** (gantt-perf repair, 2026-11-19): -48 px (3
  days at week zoom) writes nothing on some tries, desktop and Pixel 7, also on 4f39836e; -72 px
  and more always edit. gantt-perf drags 120 px meanwhile. Being root-caused.
- **The Gantt toolbar clips its last items at 1440 px wide** (an "F" chip and "Status da…" in
  `inspector-desktop-light.png`): polish list.

## Health list on WebKit (B4, 2026-11-19)

Probe: `fedora-res`, the Health sheet on the iPhone 14 emulation (WebKit), the list scrolled by a
script 100 px a frame to its end, then 90 idle frames. Per frame it reads every row's top, the
scroller's `scrollHeight` and `scrollTop`; a jump is a row the finger sees that moved by more than 2 px
beyond the scroll made. Before (`db0bded8`) and after, the same machine and plan:

| | Before | After |
| --- | --- | --- |
| Frames with a visible jump | 69 of 174 | 0 of 444 |
| Largest jump of a row in view | 984 px (always a multiple of 164 px, one row) | 0 px |
| `scrollHeight` while scrolling | 9,246 to 44,562 | 44,558 to 44,715 (rows below the view going from estimate to measured) |
| Idle at the end: distinct `scrollHeight` in 90 frames | 10 (settles to 10,571, a collapsed list) | 1 (44,715) |

Frame cost, Pixel 7 emulation at 4x CPU throttle (CDP), the same scroll with no per-frame probing,
two runs each (the figures of the two runs agree within 5%): before, the list never settles even on
Chromium (900 frames without reaching the end, `scrollHeight` alternating 10,063 and 9,281), frame
interval median 53 ms, p95 92, max 213, 497 of 900 frames over 50 ms; page scripting 10.1 s, layout
5.6 s, style recalculation 3.0 s (11 ms, 6 ms and 3 ms a frame). After: the end in 440 frames, median
35 ms, p95 50 to 52, max 68 to 74, 21 to 35 of 440 over 50 ms; scripting 2.0 s, layout 0.78 s, style
0.33 s (4.6, 1.8 and 0.8 ms a frame).

The cause is in the list's own bookkeeping (`FindingGroup.svelte`): an unmeasured row was estimated at
the average of the measured ones, so every row measured moved every unmeasured row above the view, and
a row mounted and unmounted between two ResizeObserver deliveries was never measured, so a group
swung between heights a row apart. Chromium hid the first with scroll anchoring. The fix:
- rows are measured synchronously as they mount, with their fractional height (13 px text at a 1.5 line
  height is 19.5 px a line; `offsetHeight` rounds, and the rounding error moved the first row in view
  by 0.5 to 1 px on an ordinary scroll down), and kept by key; the estimate stops following the average
  after 8 rows (`estimateOf`), and is dropped with the measurements when the list's width changes;
- before the window changes the list notes the rows that reach the view and after it holds the first
  of them that is still mounted where it was (`pickAnchor`, `anchorShift`); a row above the view that
  changes height does the same (`resizeShift`, from the tops before the change);
- while a finger or a fling scrolls (a touch is down, or a scroll event in the last 150 ms) it does not
  write `scrollTop`, which stops a fling on iOS: it holds the row with a bias in the before-spacer
  (`nextBias`), and when the scrolling stops the bias goes in one render that is held by scrolling;
- Chromium's own anchoring is off for the panel (`overflow-anchor: none`), so the two do not add up;
  the panel scrolls itself by what the "findings are from the last good schedule" note adds or takes
  above the view; the window is the same object while nothing in it changed, so a scroll inside it
  runs none of this.

Pure parts are tested in `src/lib/health/anchor.test.ts` (a loop of window, measure and anchor on a
list of fractional heights: no shift on a scroll down, held by scrolling or by the bias on a scroll up
into rows never seen, the bias given back without a move, rounding heights makes shifts) and
`window.test.ts`. End to end, `driveList` in `tests/e2e/lib/health-rig.ts` checks every frame that a row
in view moved only by the scroll made, that the first row and `scrollHeight` hold, and counts the
app's `scrollTop` writes; `health.spec.ts` ("the list holds still while it is scrolled", all three
projects) and the screenshot test use it. On `db0bded8`'s app they fail on the iPhone 14 (a row moved
164 px, then 3,979 px); on this branch they pass.
Screenshots: `docs/phases/screenshots/phase-3/t18-health-list-mid-scroll-*` and
`t18-health-list-finding-tapped-*` (Pixel 7 and iPhone 14), and the existing t18 screenshots on the
iPhone 14 (`t18-*-iphone-14-*`; no Pixel 7 or desktop file is touched).

B4 on the iPhone 14 (WebKit, one run on a loaded 4-core machine): see the run evidence of the commit;
`ci.yml` has 18 iPhone shards instead of 16: the four files were 0 s on the iPhone in the plan, and
about 4 worker minutes of specs more run there now, until the next `shard-plan.mjs measure` from a CI run.

## T26 part 2: hover, completion and the Docs sheet wait for the docs asset (ADR-0017, 2026-11-19)

What changed (part 1 moved the docs to the engine build's `tj-docs.*` asset; this is "Before the docs
arrive"):

- `src/lib/tjp/cm/docs-wait.ts`: `docsWithin` waits at most `DOCS_WAIT_MS` (300 ms) for the docs
  loader, and not at all once the docs are in. The editor env has a `loadDocs` option
  (`env.ts`); the editor bundle passes the loader's `load()`, so the CM layer reaches the loader
  through the env, not a global.
- Hover is an async `hoverTooltip` source for a keyword while the docs are not in (an id, or a
  keyword once they are, is answered at once). Completion `info` is a function that returns a
  promise until the docs are in. The keyboard docs command and `AppState.openDocs` (the Docs sheet)
  wait the same way. Past the bound: the table's syntax line and summary, with "Loading the full
  documentation…" only while the load runs; unavailable: the summary, no note, and the next look
  starts a new load.
- Unit tests (fake timers): `hover.test.ts`, `complete.test.ts`, `docs-tooltip.test.ts`,
  `docs-wait.test.ts`, `editor-bundle.test.ts` (the env carries the loader's `load`).
- e2e: `engine-docs-fallback.spec.ts` (new, all three projects): with the asset aborted by
  `page.route`, hover (desktop) or the Docs sheet (phones) shows the summary with no note and an
  edit still schedules; with the asset held back, the first look shows the summary and the loading
  note, and once it is let through the next look shows the full doc. `text-mode.spec.ts`: the
  re-hover `toPass` loop and the Docs sheet's re-open loop are gone; the first hover, the first
  completion info and the first Docs sheet must show the full doc (the sheet test runs on iPhone 14).
  No new fixed waits (139 in 33 files, unchanged).
- `summaries.generated.ts` was already lazy: in the built app its text is only in the editor chunk
  (`editor-controller.*.js`), so making it lazy gains nothing for the Visual-first load.

First-load JS, gzip (`node scripts/js-sizes.mjs --serve`, `MAINSPRING_DEV_PAGES=1`), before and after:
Visual-first 329,095 and 329,115 (cap 330,000; no `tj-docs` request); Text-first 435,625 and
435,994 (cap 440,000); total 606,744 and 607,117; editor chunk 102,950 and 103,279 (cap 118,000).

Review round (same day), on top of 222bf7d0:

- The loader rests after a failed load (`retryAfterMs`, 5 s, `src/engine/docs-asset.ts`;
  `unavailable` carries `retryAt`). Within the rest `load()` gives null at once with no fetch, the
  docs source says `coolingDown`, and hover, completion info and the docs command neither load nor
  wait: completion info is a plain string again, so CodeMirror sets `aria-describedby`. A look after
  the rest tries again. One load is ended after `timeoutMs` (20 s: its fetches aborted, and it ends
  even if a step ignores the signal) as `unavailable`, so a stalled fetch no longer keeps the note
  and the 300 ms wait for the whole session.
- `openDocs` also drops its result when the editor went away during the wait (Visual mode, another
  plan). Unit tests in `app-docs.svelte.test.ts`: the docs within the bound give the full doc, past
  it the summary and the note, of two quick calls only the later shows, and no sheet once the editor
  is gone. Each fails when its guard (the ticket, the editor check, the wait) is taken out
  (checked).
- Escape within the keyboard command's wait drops the pending tooltip (`hideDocsCommand` bumps a
  per-view counter). Unit-tested.
- The loading note is last in hover, completion info and now the Docs sheet (the sheet shows the
  notes after the body, in the hover's order). Screenshots retaken.
- e2e: the held-back test opens the plan in Visual first, then Text, so the load (and its 20 s
  timeout) starts when the editor mounts; after the asset is let through it waits for its
  `requestfinished` and then looks again with `toPass` until the full doc shows (the body is read,
  gunzipped and parsed after the request ends).

First-load JS, gzip (`node scripts/js-sizes.mjs --serve`, `MAINSPRING_DEV_PAGES=1`): Visual-first
329,115 (no `tj-docs` request), Text-first 436,198, total 607,321, editor chunk 103,329.

e2e (`text-mode`, `engine-docs`, `engine-docs-fallback`, local, after `build:engine` and the dev-pages
build): desktop and Pixel 7, 23 passed and 1 skipped (the hover test on touch, by design); iPhone 14,
10 passed, 1 skipped (the same) and 1 failed: `text-mode.spec.ts` "changing an effort updates the
finish date", which this task does not touch and which shows no docs. Its trace ends with the line
reading `effort 2` and a lint error: under load the two Backspaces and the insert landed in more
than one undo group, so one undo left an error and the strip kept the last good finish. It failed
the same way in one earlier iPhone run of the first round, and passed alone (three times in all).
A pre-existing, load-dependent flake for whoever owns the undo specs.

Unit: `npx vitest run`, 502 of 503 files passed (7,292 tests); the one failure was
`edits-rebase.property.test.ts` (ADR-0018, not touched here), which passed when run alone. `tsc`, `svelte-check` (0 errors) and prettier are clean;
`fixed-waits.mjs` (139 in 33 files, unchanged) and `webkit-skips.mjs` pass.

Screenshots (`SCREENSHOTS=1`, the held-back test): `docs/phases/screenshots/phase-3/t26-loading-note-*`
and `t26-full-doc-*` for desktop (hover popup), Pixel 7 and iPhone 14 (Docs sheet; hover is off on
touch), light.

## Open bugs: patch fidelity nightly, P4 (2026-11-19)

The nightly `Patch fidelity` shards (`continue-on-error`) failed P4 on three nights. Each case was
replayed with its `FIDELITY_CASE` (fails before the fix, passes after) and is now in
`tests/fidelity/regressions.json`, so it replays on every CI run. None was an edit-API bug.

| Case | Class | Cause and fix |
| --- | --- | --- |
| `generated:1414162176:renameTask:@0`, renameTask `plan` to id `x` (2026-11-18) | Oracle bug in the suite | The engine results of the old and the new plan are equal apart from the id (TaskJuggler orders work by priority, path criticalness and declaration order, `Project.rb:1185-1187`, never by id). P4 read the old result under the new id by replacing `"plan"` in the JSON text, which also renamed the default scenario `plan`. The id is now applied field by field (`tests/fidelity/p4-compare.ts`, with unit tests). |
| `generated:527909175:setAttr:@0` (2026-11-18) | Generator bug in the suite | The base plan did not schedule (`sched_runaway`): an ALAP effort task with `precedes` and priority 89 found its only resource booked up to its end by ASAP work of higher priority (TaskJuggler schedules ready tasks whole, highest priority first, `Project.rb:1185-1220`). Effort leaves with a hard end (`precedes`, or a fixed `end`) now get priority 1000 in every site and need a full-time resource (`gen/model-attrs.ts` `firstOfAll`, `gen/model.test.ts`); the same plan with priority 1000 schedules cleanly. Regression seed 379 drew another intent after this, so it was re-recorded as 385@6, which fails P4 (`not_scheduled`) with the anchor check taken out. |
| `corpus:1583755989:setProjectAttr:syn-22-tz-kathmandu-resolution`, `now 2026-02-19-09:00` (2026-11-16) | Harness bug in the suite | The suite built its indexes without the time-zone data the app gives the index (`run-types.ts` `zones`), so the zone checks were skipped as uncheckable. In +05:45 that `now` is 03:15Z, off the 60 min resolution (`misaligned_date`). With the zone data (`harness.ts` `INDEX_OPTIONS`), the edit API refuses it `invalid-value`, as it does in the app, where the Project sheet's `now` field is free text. |

Checks: `npm run test:fidelity` at merge-CI size, 37 of 37 passed. P4 at nightly size, shard 0/4, passed
with each of the fresh seeds 4242, 777001 and 31337 (about 1,280 edited cases each, no new error ids,
about 30 min each). Before the fix, 15,000 generated base plans (attempt 0) scheduled cleanly, so the
generator bug shows up in fewer than 1 plan in 15,000. `tsc`, prettier and `tests/ci` are clean.
Nothing in `src/` or `engine/` changed, so golden parity was not rerun.

## Open bugs: a short drag of a size handle near the chart edge made no edit (2026-11-19, fixed)

Found while repairing `gantt-perf.spec.ts`, which then dragged 120 px to hide it. A 48 px drag of a
bar's size handle (three days at week zoom) made an edit only now and then, on the Pixel 7 and on
desktop.

- **Cause.** Edge auto-scroll (`gestures.svelte.ts` `#pump`, `lib/gesture/autoscroll.ts`) scrolled
  toward an edge whenever the pointer was in its 48 px band, even for a drag that began in the band
  and moved away from the edge. The chart ran under the pointer toward the edge, the content x of the
  pointer (`clientX` plus the scroll) barely changed, and the drop ended on the day it began on:
  `controller.ts` ended the drag with `cancel: no-change`, with no edit and no toast. The edit
  planner was not involved: every drop that reached `dispatchAction` was applied. Logged on the
  failing tries: 14 to 15 autoscroll frames, then `cancel no-change`; on the passing ones a `resize`
  drop at 16860 minutes, applied as `effort 63h`. How far the chart ran depends on the frame
  timing, so the result is intermittent. On the Pixel 7 the end handle of the gantt-500 bar is at
  x 379.7 in a chart whose right edge is 402, 22 px inside the band, so every try was swallowed
  (0 of 12). On desktop the handle is 125 px from the edge and was never affected (24 of 24); with
  a 1030 px wide window it is 24 px inside the band and 4 of 6 tries edited.
- **Fix.** A drag that begins inside a band holds that band: no scroll toward the edge until the
  pointer goes 12 px toward it; leaving the band ends the hold (`lib/gesture/autoscroll.ts`:
  `holdAt`, `heldVelocity`, `AUTOSCROLL_ARM_PX`). Every caller goes through `AxisScroll` (`begin`
  with the press point, then `velocity` each frame); the unheld function is now `bandVelocity` and
  only `AxisScroll` and `heldVelocity` call it. The callers, each with a unit test beside it that
  fails with the hold taken out (jsdom, fake frames: `lib/gesture/dom-testing.ts`):
  the Gantt chart (`gestures.svelte.ts`, both axes; the vertical axis only for a row or link drag),
  the task list's row drag (`row-drag.svelte.ts`, also the People table's), the workload plot
  (`heat-gestures.svelte.ts`, each axis held alone) and the Calendar month
  (`calendar-gestures.svelte.ts`). `edgeVelocity` in `lib/gantt/viewport.ts` was removed.
- **E2E for the other callers** (`tests/e2e/edge-scroll-drags.spec.ts`): the pointer presses 20 px
  inside the edge band, moves 8 to 14 px away from it (still inside the band), is held for 30
  frames, and the scroll position must not have changed; the drop is where the pointer began, so
  the row, the cell or the day is dropped in place and nothing is edited (row drag and workload
  cell). Rows: gantt-500, bottom band. Workload: fedora-res, left band beside the names column.
  Calendar: a short view (a month that fits has nothing to scroll), top band. Each fails with the
  caller's hold taken out, on desktop and on the Pixel 7 (scroll position 811 to 952, 736 to 595 and
  221 to 148 on desktop; 704 to 875, 574 to 413 and 165 to 0 on the Pixel 7), and passes with it on
  desktop, Pixel 7 and iPhone 14.
- **Checks.** After the fix: 12 of 12 on the Pixel 7 and 12 of 12 on the narrow desktop window.
  `tests/e2e/gantt-resize-near-edge.spec.ts` (8 drags of -48 px from 24 px inside the edge, each must
  write what the same drag writes in the middle of the chart; and a drag toward the edge still
  scrolls) failed on try 1 on desktop and Pixel 7 before the fix, and passes on desktop (3 runs),
  Pixel 7 (3 runs) and iPhone 14. `gantt-perf.spec.ts` drags 48 px again and passed on the Pixel 7
  profile. Screenshots: `docs/phases/screenshots/phase-3/gantt-resize-near-edge-*`.

## Done when (ADR-0016): recorded as each item is met

1. Merge tier has no frame-rate or full-speed animation assertion: split done (see above). Five
   reruns of the merge tier on one commit green, and three timing trend entries: not yet.
2. iPhone skips down to the allowlist: done (B1 to B5 done; `PENDING_BATCHES` is empty; 5 allowlist entries of at most 6).
3. Contract specs for the six primitives: done (T25 above): pass on desktop, Pixel 7 and iPhone 14;
   `select-arrows.spec.ts` passes on all three and the global select rule is gone.
4. CI meets the time target: not yet.
5. The status line is at the top of this file: done (this file).
