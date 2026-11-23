# Phase 3 gate evidence

## Status

Kept at the top of this file by the main session (ADR-0016 section 5). Update it at the end of every
batch, before the push.

| Item                       | Now                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Last green commit on main | `55695168` (branch run 45237757981, 2026-11-23, 19 min 20 s; main fast-forwarded): T22's audit, T23's CI changes and the paint property fix, on top of the small plans |
| Gate | **Approved by the user, 2026-11-23.** Evidence: section "Gate evidence" below (T24). Decisions at the gate: the 600 fills-per-frame budget is enforced on phones only (desktop recorded); the Visual-first first-load cap is raised to 340,000 bytes gzip; the CI time target is waived; polish item 22 (status bar "No problems" beside Health findings) added |
| Timing trend | 1. `d4150c6d` (run 44240034126, artifact `timing-232`): job green, no gross regression. 2. `6d43799c` (nightly 44728784645, `timing-nightly-9`): 14 passed, judge step green. 3. `1b3c00d7` (nightly 44896823472, `timing-nightly-10`): 14 passed, judge step green. 4. `1b3c00d7` (nightly 45016747623, `timing-nightly-11`): 14 passed, judge step green |
| iPhone 14 skips left | None outside the allowlist (2026-11-19): B4 is done (health, health fixes, why-here and the health screenshots run on the iPhone 14 once the windowed Health list held still on WebKit, `anchor.ts`), so `PENDING_BATCHES` in `scripts/ci/webkit-skips.mjs` is empty and the scan fails on any iPhone skip outside the allowlist in every spec. Allowlist: 5 entries of at most 6 (1 `cdp-touch`, 4 `chromium-performance-api`; T22's Health panel test runs on the iPhone and records only the time to open there, so it took no entry) |
| CI wall time | 14.3 to 19.0 min over the five manual runs on `1b3c00d7` (16.3, 16.3, 14.3, 17.2, 19.0; runs 44807594259, 44828061086, 44983027206, 45043700692, 45054048787). About 215 job-minutes over 38 jobs against at most 20 concurrent runners; the iPhone project is about 120 of them, so the 12 min target (ADR-0016 section 4) needs fewer iPhone worker-minutes, not more shards. Durations re-measured 2026-11-19 (longest planned shard about 7 min). The e2e shards run in `mcr.microsoft.com/playwright:v1.64.1-noble`. After the small plans: 16 min 19 s on `10a7a6d1` (run 45229658035, 208 job-minutes). The 12 min target is waived by the user (2026-11-23; done-when item 4) |

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

## Gate evidence (T24, 2026-11-23)

The gate commit is `55695168`. Gate run: [CI run 45237757981](https://github.com/jackhale98/mainspring/actions/runs/45237757981),
green, 18:22:52 to 18:42:12 UTC (19 min 20 s), every job passed. "Gate run" below means this run.
Sections lower in this file hold the detail: [T21](#t21-end-to-end-specs-the-gate-spec-and-pictures-2026-11-19)
(specs and pictures), [T22](#t22-performance-and-accessibility-audit-2026-11-23) (perf and a11y),
[T23](#t23-ci-changes-133) (CI), [CI time](#ci-time-small-plans-adr-0016-change-4-small-plans-first-user-2026-11-23)
and [Done when](#done-when-adr-0016-recorded-as-each-item-is-met).

### Criterion 1 (16.1): the heatmap's hours per person per week match the engine's load data

| Evidence | Result | Source |
| --- | --- | --- |
| `workload-gate.spec.ts`, `fedora-res`, week zoom, every group expanded, desktop | 28 rows x 88 weeks = **2464 cells compared, 0 differences** | gate run, job "End-to-end and accessibility (desktop 3/5)", log line `workload gate (desktop)` |
| The same on Pixel 7 | 2464 cells, **0 differences** | gate run, job "pixel-7 6/6" |
| The same on iPhone 14 (not required by 16.1) | 2464 cells, 0 differences | gate run, job "iphone-14 1/18" |
| Live result equals the committed golden (parity), ignoring only the wall clock `/project/now` (user decision, T21) | 0 differences on desktop and Pixel 7 | the spec asserts it in CI; the counts are in `docs/phases/evidence/phase3-t24/workload-gate.json` (local run of the spec on `55695168`, desktop and Pixel 7, load 1 to 2, 4 of 4 passed). The gate run did not upload `workload-gate.json`; later runs do (artifact `workload-gate-<project>-<shard>`) |
| Golden parity job | 72 of 72 plans match their goldens (`fedora-res` included, fresh and shuffled) | gate run, artifact `golden-report` |
| Engine's load data checked natively (T6 cross-check, 5.3) | tj3's own weekly resource report agrees with the golden's bookings, working time and leaves for every golden with resources. `golden:record` stops on any disagreement (`engine/golden/record-native.mjs`, `crossCheck` throws), and all 72 goldens were recorded through it. Last counts written down: 31 goldens with resources, 268 resource rows, 174,340 values (commit `399ab463`). The 31 goldens added in `bee485d9` (`fedora-res`, the workload and health fixtures) passed the same check when recorded, but that commit gives no counts | commits `dd8ff7b1`, `043fe035`, `399ab463`, `bee485d9` |
| The Fedora plan itself (`upstream-fedora-20`) | It declares no resources; the Workload view says "No people in this plan yet". Zero cells, zero differences: stated, not counted as evidence | `workload-gate.spec.ts` test "upstream-fedora-20: no resources", passed in the gate run and locally; picture `t13-no-people-*` |
| Unit oracle over all goldens at day, week and month (`src/lib/workload/load.golden.test.ts`) | 62 goldens with resources, 290 people, 21 groups; 1394 weeks, 9561 days, 344 months; 172,558 cells per series; all 63 tests pass. `fedora-res`: 24 people + 4 groups x 88 weeks = 2464 week cells | gate run, job "Format, typecheck and unit tests", stdout of `load.golden.test.ts` |

Pictures of the `fedora-res` heatmap (all exist): desktop `t14-heatmap-week-desktop-light.png`,
`t14-heatmap-week-desktop-dark.png`; phone `t14-heatmap-week-pixel-7-light.png`,
`t14-heatmap-week-pixel-7-dark.png`, `t14-heatmap-week-iphone-14-light.png`,
`t14-heatmap-week-iphone-14-dark.png`, `t14-heatmap-week-360-light.png`; tablet
`t21-heatmap-tablet-820-light.png`, `t21-heatmap-tablet-820-dark.png` (all in
`docs/phases/screenshots/phase-3/`).

### Criterion 2 (16.2): every health check has a passing and a failing fixture

Fixtures: `tests/fixtures/health/<check>/{pass,fail}/`, all 18 in the golden manifest (kind `health`,
recorded natively). Counts are the findings of `checkPlan` over each committed golden with every check
on (local run of `src/lib/health/health.golden.test.ts` and a count of `goldenReport` on `55695168`;
the same test passed in the gate run's unit job).

| Check | Fail fixture: findings | Pass fixture: findings |
| --- | --- | --- |
| H1 no-predecessor | 1 (`no-predecessor`, task `build`) | 0 |
| H2 no-successor | 1 (`no-successor`, `test`) | 0 |
| H3 hard-constraint | 1 (`hard-constraint`, `build`) | 0 |
| H4 constraint-warning | 1 (`constraint-warning`, message 0) | 0 |
| H5 long-gap | 1 (`long-gap`, link `build` to `test`) | 0 |
| H6 long-task | 1 (`long-task`, `build`) | 0 |
| H7 held-by-people | 1 (`held-by-people`, `side`) | 0 |
| H8 work-without-people | 1 (`work-without-people`, `side`) | 0 |
| H9 resource-warning | 1 (`resource-warning`, message 0) | 0 |

Each fail fixture has exactly its own finding, with the facts its header names; each pass fixture has
none at all. `health-fixtures.spec.ts` opens the H1 and H7 pairs in the app and the panel lists exactly
the unit oracle's findings, on desktop, Pixel 7 and iPhone 14 (gate run). On `fedora-res` the panel holds
241 findings: no-predecessor 26, no-successor 61, hard-constraint 7, long-gap 39, long-task 10,
work-without-people 77, resource-warning 21.

Pictures of the panel on each failing fixture, written by `health-fixture-screenshots.spec.ts`
(SCREENSHOTS=1; it runs in the nightly `gated` job). Before each picture the spec asserts that the panel
lists exactly one finding, of the fixture's own check, and says "1 problem". Desktop, all nine:
`t24-health-h1-no-predecessor-fail-desktop-light.png`, `t24-health-h2-no-successor-fail-desktop-light.png`,
`t24-health-h3-hard-constraint-fail-desktop-light.png`,
`t24-health-h4-constraint-warning-fail-desktop-light.png`, `t24-health-h5-long-gap-fail-desktop-light.png`,
`t24-health-h6-long-task-fail-desktop-light.png`, `t24-health-h7-held-by-people-fail-desktop-light.png`,
`t24-health-h8-work-without-people-fail-desktop-light.png`,
`t24-health-h9-resource-warnings-fail-desktop-light.png`. Phones, H1 and H7:
`t24-health-h1-no-predecessor-fail-pixel-7-light.png`, `t24-health-h1-no-predecessor-fail-iphone-14-light.png`,
`t24-health-h7-held-by-people-fail-pixel-7-light.png`, `t24-health-h7-held-by-people-fail-iphone-14-light.png`
(all in `docs/phases/screenshots/phase-3/`). The fixture text is typed into the small `ui-people` plan, so
the plan chip reads "Small plan: five people". The panel on `fedora-res` is `t18-health-panel-*`.

### Phase deliverables (16.3)

| Plan bullet | Demonstration |
| --- | --- |
| "Resources view, workload heatmap with thresholds, drag to rebalance, calendar with leave painting, resource table and groups." | Specs: `workload.spec.ts`, `workload-edits.spec.ts` (thresholds), `rebalance.spec.ts` and `lanes.spec.ts` (exact patch, Undo bytes, Redo per W row), `calendar.spec.ts`, `resources.spec.ts`, all green in the gate run. Pictures: `t14-thresholds-desktop-*`, `t15-lanes-fedora-res-*`, `t21-rebalance-moved-*`, `t21-rebalance-question-*`, `t21-rebalance-refused-*`, `t16-month-everyone-*`, `t16-paint-drag-*`, `t17-table-*`, `t17-add-person-*` (desktop, Pixel 7, iPhone 14, light and dark where named) |
| "Plan health panel with the checks from the best-practices section and "why is this here?" explanations." | Criterion 2 above; explain unit fixtures (`src/lib/schedule/explain.golden.test.ts`, `explain.test.ts`, `explain.engine.test.ts`); `health.spec.ts`, `health-fixes.spec.ts`, `why-here.spec.ts`. Pictures: `t18-health-panel-*`, `t18-why-here-*`, `t18-why-here-unsure-*`, `t18-cell-why-*`, `t18-show-in-gantt-*` |

### What the gate also records

**Authoring track (ADR-0013), phone pictures** (Pixel 7, light and dark): `add-task-toolbar-idle-*`,
`add-task-toolbar-menu-*`, `add-task-plan-tab-idle-*`, `add-task-plan-tab-menu-*`,
`add-task-details-*`, `add-task-toolbar-phone-360-light.png`; New plan on Pixel 7 and iPhone 14:
`new-plan-chooser-*`, `new-plan-sheet-*`, `new-plan-empty-state-*`, `new-plan-empty-plan-tab-*`,
`new-plan-sheet-phone-360-light.png`. Specs: `gantt-add-task.spec.ts`, `new-plan.spec.ts`,
`authoring.spec.ts`.

**Schema v3 `serializeMs`** (native `golden:record`, in Ruby, minimum of two runs;
`engine/golden/native-timings.json` before schema v3, at `1cc5cd0b^`, and now). One recording each, on
a shared machine on different days, so totals move with machine noise; the serializer's own share is
the comparable figure.

| Golden | Tasks | serializeMs v2 | serializeMs v3 | total ms v2 | total ms v3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `syn-20-scale-1000` | 1225 | 153.3 | 155.6 | 1682.3 | 1980.4 |
| `gantt-500` | 500 | 76.2 | 70.8 | 788.4 | 963.4 |
| `gantt-200` | 200 | 41.8 | 35.3 | 452.4 | 549.0 |
| `upstream-fedora-20` | 414 | 13.2 | 32.5 | 545.3 | 686.2 |
| `fedora-res` (new) | 414 | | 89.6 | | 1666.7 |
| `syn-23-unused-resources` (new) | 3 | | 45.3 | | 296.8 |
| `upstream-tutorial` | 15 | 3.9 | 4.4 | 154.0 | 175.3 |

Against 5.3's targets: the serializer adds 1.5% on `scale-1000` and is 7% faster on `gantt-500`, so its
share of the total stays well under 10%. On Fedora it adds 19.3 ms, about 3.5% of the total: "about
none" is not quite met. The T6 review's unused-resource case went from 3,814 to 38 ms of serializeMs in
the browser engine (commit `0f281f93`). Browser-engine serializeMs per golden at the gate commit was not
recorded.

**Derived-work timings (8.3)**: T22's table D1 to D7 ([T22](#t22-performance-and-accessibility-audit-2026-11-23);
`docs/phases/phase-3-perf-a11y.md`). In short, unthrottled desktop Chromium at load 3 to 4: load model
7.6 ms cold, 0.9 warm; demand 3.2; health check 15.9 cold against 15 (marginal); Gantt analysis 5.0.
At 4x CPU every derived task is under 50 ms except one runner task of 61.1 ms on `scale-1000`.

**`workload-perf`, desktop and Pixel 7 emulation, with the waiver (8.5)**: T22's W1 to W10. Desktop
heatmap scroll and pan 100% on time, at most 0.5% dropped (load 4; they fail at load 15 to 35); drag
script p95 0.3 ms; Pixel 7 DOM 333 nodes (cap 800, enforced); Pixel 7 swipe at 4x 97.1% on time
(target 90%). These are emulation on a shared sandbox: no real device was measured, under the T26
waiver of 2026-11-13 (real devices in Phase 6). In CI the desktop caps run in the timing tier, which is
not blocking (ADR-0016).

**JS sizes** (gate run, artifact `js-sizes`, gzip bytes):

| Measure | Size | Cap |
| --- | ---: | ---: |
| Visual-first first load | 329,562 | 330,000 (438 left) |
| Text-first first load | 436,653 | 440,000 |
| Whole `dist` | 608,183 | 650,000 |
| People views, all lazy chunks together | 90,624 | 100,000 |
| `heat-shared` (the heatmap and lanes' shared chunk) | 19,234 | 21,000 |
| Editor chunk | 103,330 | 118,000 |

Every other chunk cap passes too (`people`, `workload`, `heat`, `lanes`, `calendar`, `resources`,
`person`, `health`, `health-checks`). The first load of either kind loads no People chunk.

**Golden state**: provisional. All 72 goldens are schema v3, recorded natively on Ruby 3.3.6 (`native.ruby`
in each file of `engine/golden/expected`; `native-timings.json`), until the user records once on Ruby
3.4 (ADR-0003 #5, amended).

**Edit API timings for the new intents** (gate run, unit job, `tests/perf/text-mode-timings.test.ts`,
CI runner; target 50 ms):

| Intent | Plan | p50 | p90 | max |
| --- | --- | ---: | ---: | ---: |
| `clearLeave` | Fedora + resources | 2.12 | 2.45 | 3.70 |
| `gapToTask` | Fedora | 18.57 | 24.23 | 25.89 |
| Rebalance reassign (W1) | `fedora-res` | 1.53 | 2.03 | 2.43 |
| Leave paint (W3) | `fedora-res` | 1.76 | 3.21 | 3.26 |

All under 50 ms. In the same log one older intent's p90 is over 50 ms: `setWorkingHours` on
`scale-1000` (p50 38.3, p90 50.5, max 70.3), on a shared CI runner.

**Worker heap growth**: the gate spec reads the worker's memory once, after its result: 112.9 MB on
desktop and 108.2 MB on Pixel 7 (`docs/phases/evidence/phase3-t24/workload-gate.json`, local run).
Growth over a session is T22's M2: 12 reschedules of `fedora-res` grow the wasm memory by 2.6 MB
(2.2%) after the first edit, then stay flat. No leak.

### Open for the user at the gate

1. **Desktop fills (T22 P2).** At day zoom on a 1280 px desktop the heatmap draws 731 cells per frame
   against the 600 of 8.1, while its paint stays inside 4 ms. It is recorded, not enforced. Should 600
   apply to phones only?
2. **Visual-first first load.** It is 438 bytes under its 330,000 cap (gate run). Should something be
   cut, or the cap raised?
3. **CI time (done-when item 4).** Waived by the user on 2026-11-23. The gate run took 19 min 20 s.
4. **Goldens provisional** on Ruby 3.3.6 until the user re-records them on Ruby 3.4.
5. **Real devices** are waived to Phase 6, including the iPhone fling check of the Health list.
6. **Polish items 20 and 21** are open (`docs/phases/phase-2-polish.md`).

**Gaps in this evidence**, stated plainly:
- The gate run did not upload `workload-gate.json`. The committed copy comes from a local run of the gate
  spec on the gate commit; in the gate run the counts are in the job logs. Later runs upload it
  (`ci.yml`, artifact `workload-gate-<project>-<shard>`, 30 days).
- The native cross-check counts for the 31 goldens added in `bee485d9` were not written down. They
  passed, because recording stops on a disagreement.
- Fedora's serializeMs grew by about 3.5% of total engine time (native), against "about none".
- Browser-engine serializeMs per golden is not recorded at the gate commit; only native figures are.

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
  only `AxisScroll` and `heldVelocity` call it. A press nearer its edge than 12 px arms when the
  pointer reaches the edge (review, 2026-11-19), so a drag can still reach what is beyond it. The
  callers (row drag, workload and calendar each with a unit test beside it that fails with the hold
  taken out, jsdom and fake frames via `lib/gesture/dom-testing.ts`; the Gantt chart's wiring is
  covered by the e2e specs below):
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
- **Left open (review nits).** The press point is the last DOM-primary down, not looked up by the
  dragging pointer's id: after a cancelled touch drag with a finger still down, or a mouse press
  between a touch press and its long-press, the hold can use the wrong press (rare). On desktop with
  the details drawer open, a drag past the chart's visible box to the window edge does not scroll
  (the same before this change).

## Done when (ADR-0016): recorded as each item is met

1. Merge tier has no frame-rate or full-speed animation assertion: split done (see above). Five
   reruns of the merge tier on one commit green, and three timing trend entries: done (2026-11-22).
   Five manual runs (`workflow_dispatch`, user) on `1b3c00d7`, all green: 44807594259,
   44828061086, 44983027206, 45043700692, 45054048787, plus its push run 44760368049. One test
   passed only on retry, in the fifth: the iPhone calendar axe scan caught the view switcher's
   segment colour still easing (color-contrast on "Load"); the scan now waits for animations to end.
   An earlier attempt on `6d43799c` failed in its second run (a rebalance read of the result from
   before Redo), which led to the sweep of such waits. Timing trend entries 2 to 4 above.
2. iPhone skips down to the allowlist: done (B1 to B5 done; `PENDING_BATCHES` is empty; 5 allowlist entries of at most 6).
3. Contract specs for the six primitives: done (T25 above): pass on desktop, Pixel 7 and iPhone 14;
   `select-arrows.spec.ts` passes on all three and the global select rule is gone.
4. CI meets the time target: waived by the user (2026-11-23), kept as is. After the small-plans
   work the branch run 45229658035 on `10a7a6d1` took 16 min 19 s against the 12 min target: 38
   jobs and 208 job-minutes on about 20 runners, so a third of the jobs queued 5 to 7 minutes; the
   last iPhone shard to start (11/18) ran 10 minutes, and the engine build job alone takes 11. The
   levers left are even shard packing, fewer iPhone shards and a shorter engine build job.
5. The status line is at the top of this file: done (this file).

## T21: end-to-end specs, the gate spec and pictures (2026-11-19)

Inventory of phase-3.md 13.2 against the specs (13.2 names `authoring`, `rebalance`, `health` and
`a11y` files that were never written under those names; the behaviours were covered under others).
"Added" is what T21 wrote.

| 13.2 bullet and behaviour | Covered by | State |
| --- | --- | --- |
| authoring: + on an empty new plan; + after selected; Add subtask; name focused | `gantt-add-task.spec.ts` (Add task (+), on the Plan tab), `new-plan.spec.ts` (empty plan) | covered |
| authoring: undo of each | `gantt-add-task.spec.ts` (name and add are two undo steps; Undo on each path) | covered |
| authoring: redo of each | `authoring.spec.ts` (three tests: Undo bytes, Redo same text) | added |
| authoring: New plan form; switching away from an edited plan asks | `new-plan.spec.ts` | covered |
| authoring: New plan by keyboard; axe of the sheet and empty state; 44 px | `authoring.spec.ts` | added |
| authoring: empty states on each layout | `new-plan.spec.ts` (desktop Split and Visual, phone Plan tab); tablet width in `authoring.spec.ts` | tablet added |
| authoring: axe of the details with the name focused and of the + menu | `authoring.spec.ts` has the place for them | BLOCKED by app bug 1 below |
| rebalance W1/W2 from a lane bar, refusal `inherited`, text-only | `lanes.spec.ts` (exact patch, Undo bytes, Redo, lanes follow the engine) | covered |
| rebalance W1/W2 from a heatmap cell | `workload-edits.spec.ts` was loose (any of applied/refused, no exact text, no Redo, no engine check, chooser optional) | PARTIAL, now `rebalance.spec.ts`: details menus, keys (cumulative, one undo step), drags with mouse and finger, exact text, Undo, Redo, mirror cell equals the oracle after each |
| rebalance: "Move which task?" chooser | `rebalance.spec.ts` (two options asserted, choice is one patch) | added |
| rebalance refusals `via-group`, `unsupported-form` (alternatives) | `rebalance.spec.ts` (alternatives written in Text first) | added |
| rebalance refusal `not-a-person` | unit only; the details menu lists people only and a drop on a group row is refused by the ghost, with no toast (observation 2) | `rebalance.spec.ts` asserts the drop changes nothing |
| calendar W3 to W5, global and per person, merge, erase, split, type change, text-only leave | `calendar.spec.ts` (Undo bytes, Redo), `calendar-sheet.spec.ts`, `calendar-narrow.spec.ts` | covered |
| resources W6 to W8, working-hours editor, project sheet | `resources.spec.ts` (`undoRedo` on each step), `stale-index.spec.ts` | covered |
| health: each fix button, patch, undoable | `health-fixes.spec.ts` (H1, H3, H5 x2, H8; Undo bytes) | covered |
| health: Why here? causes, badge count, phone status path | `why-here.spec.ts`, `health.spec.ts` | covered |
| health: H1 and H7 pass/fail pairs in the app match the unit results (16.2) | none | added: `health-fixtures.spec.ts` |
| workload-gate (16.1) | `workload-gate.spec.ts` existed; parity with the golden was left to the golden job | PARTIAL, now compares the live result with `engine/golden/expected/fedora-res.json` too, writes `test-results/workload-gate.json` |
| gantt-filter: person, flag, both, nothing, cleared state | `gantt-filter.spec.ts` | covered |
| a11y: axe in every new state, both schemes | workload-edits, lanes, calendar, resources, health, why-here, gantt-filter, people-shell, authoring | covered except the blocked states |
| a11y: 44 px probes | the same specs, on a finger | covered |
| a11y: reduced motion | Gantt and sheets only | PARTIAL, now `phase3-a11y.spec.ts` (heatmap, details, lanes, calendar, team) |
| a11y: keyboard walkthrough W1 to W12 | W1/W2 `rebalance` and `lanes`; W3/W4 `calendar`; W5 `calendar`; W6/W7/W8 `resources`; W9 `gantt-add-task`; W11 `authoring`; W12 `workload`, `calendar`, `lanes` | W10 (a fix by Enter) was MISSING, added to `phase3-a11y.spec.ts` (desktop only) |
| screenshots | see the matrix below | desktop and phone covered; tablet missing, added |

Screenshots. There is no tablet project in `playwright.config.ts` (desktop, pixel-7, iphone-14). The
existing tablet pictures use the desktop project at 820 x 1180, so T21 does the same
(`phase3-screenshots.spec.ts`, `SCREENSHOTS=1`, files `t21-*`). Before T21, light and dark at desktop
and phone existed for every view and state except: tablet (only the Gantt switcher, Add task split
and the Health sheet in light); phone dark for `t13-people-tab-calendar`, the Health finding shots and
`t25-app-health-pill`, `t25-app-heat-move-pills`; phone for `t16-paint-drag`, `t16-type-picker`,
`t17-drag-row`, `t14-over/percent/thresholds`, `t19-empty/flag/panel-*`; heatmap rebalance states.
T21 added 40 pictures: tablet 820 (heatmap, heatmap details, Resources view, person details,
calendar, day details, Health sheet, Gantt filter, New plan sheet, empty state, No people; light and
dark) and the heatmap rebalance question, result and refusal on desktop, Pixel 7 and iPhone 14 (light
and dark). The phone gaps listed above remain and are not added: those states are desktop-only
controls or one-shot light shots already.

Gate spec result (`workload-gate.spec.ts`, all three projects): 28 rows x 88 weeks = 2464 cells
compared with the oracle, 0 differences; the live result equals the golden with one field set aside,
`/project/now`: the app schedules as of the wall clock, which the worker reads and a page cannot pin,
and the golden was recorded as of 2013-09-02. Nothing else differs. Worker memory of the result is
recorded (112.9 MB); worker heap growth over the spec is not measured (one result only). The spec text
says the Fedora view shows "No people in this plan yet"; the view's title is "No people yet" and the
test checks that.

App bugs and observations (no app code changed):
1. `HealthButton` at count 0 shows "0" with the name "Plan health: no problems": axe reports
   `label-content-name-mismatch` (WCAG 2.5.3) on `.health-button`. Reproduction: open `?sample=poc-sample`,
   New plan, Create, press Add task, then run axe on the page. Blocks the axe scans of the details with
   the name focused and of the + menu in `authoring.spec.ts`.
2. A drop of a heatmap cell on a group row does nothing and says nothing after the drop (the ghost
   label says "Drop on a person, not a group" during the drag). 7.1 lists `not-a-person` as a W1
   refusal; the planner has it, no UI path reaches it.

Runs: desktop, pixel-7 and iphone-14 (`--repeat-each=2` on iPhone) for `authoring`, `rebalance`,
`health-fixtures`, `phase3-a11y`, `workload-gate`: all pass (the tablet test and keyboard tests skip on
phones). `tsc`, prettier, `vitest run tests/ci`, `webkit-skips`, `fixed-waits` (32 in 15 files,
unchanged) and `shard-plan check` pass. New spec files have no entry in `durations.json`: the
estimate stands.

**Decisions (user, 2026-11-19).** "Tablet" in 13.2's screenshot rule is the desktop project at
820 x 1180; no tablet project is added. The gate spec's comparison with the committed golden sets
only `/project/now` aside (the app schedules as of the wall clock). The Health button's zero name is
fixed (`Plan health: 0 problems`, WCAG 2.5.3), so the authoring axe test scans the details with the
name focused and the + menu too. A drop on a group row in the heatmap is being given the planner's
`not-a-person` refusal toast. The five merge-tier reruns of done-when item 1 use the new manual
start of `ci.yml` (`workflow_dispatch`).

## CI time: small plans (ADR-0016 change 4, "Small plans first", user 2026-11-23)

Goal: cut e2e worker time, the iPhone first, without testing less. Measured before touching
anything: every test pays a floor of about 12 to 15 s on the iPhone for the page and the engine
(WebKit compiles the 30 MB wasm in each fresh context), and a test that opens `fedora-res` pays
about 45 to 65 s on top of that for its 414 tasks. So only a test that opens a big plan can be
made cheaper by a smaller one; a file that is already on a small plan is at its floor (below).

**What moved.** Seven spec files opened `fedora-res` for tests whose subject is not the size of the
plan. Each of those now runs on a small plan, with the same assertions adapted to the small plan's
ids:

| File | What drove its time | Moved | Stays on `fedora-res` (scale is the point) |
| --- | --- | --- | --- |
| `health.spec.ts` | all 8 iPhone tests opened `fedora-res` | severity filter, milestone setting, thresholds, 44 px targets, axe light and dark, keyboard path, tablet sheet, focus: `ui-basic` (9 findings in 4 checks) | the 241-finding golden counts and windowing, the two scroll-holds-still tests, the Tab walk through a windowed list |
| `why-here.spec.ts` | 11 of 11 tests on `fedora-res` | gap and written date, "cannot tell", the link to a task, finding to details, axe: `ui-basic` / `ui-people`; the three "finding about a person" tests: health fixture H8 typed into `ui-basic`; the heatmap's cell details: `ui-people` | the explainer's sentences against the native golden (gap, written date) |
| `workload-edits.spec.ts` | 7 of 7 on `fedora-res` | all: `ui-people` | none (the gate and `workload.spec.ts` keep the scale) |
| `workload.spec.ts` | 5 of 8 on the iPhone on `fedora-res` | buildLoad equals the cells, zoom, unit, group toggle, keyboard: `ui-people` | 28 rows with groups, held and unmet work (T10); `workload-gate.spec.ts` untouched |
| `health-fixes.spec.ts` | 6 of 6 on `fedora-res` | H3 remove start, H5 convert gap, H5 edit gap, H8 replace person: the health fixtures typed into `ui-basic`; the macro refusal: a plan of its own | H1 "Add predecessor" (the picker over 414 tasks, then the whole report back) |
| `health-screenshots.spec.ts` | 8 of 8 on `fedora-res` | "Why here?", cell details and Show in Gantt, finding about a person | the panel with its 241 findings, the list held mid-scroll, the tablet sheet |
| `health-fixtures.spec.ts` | not heavy | only its `setPlan` helper moved to `lib/health-rig.ts` (shared) | |

How a small plan's expectations are known (they have no native golden): `tests/e2e/lib/small-plan.ts`
schedules the plan in the spec's own Node process with the same engine build (once per worker) and
runs the unit oracles of `src/lib` (`checkPlan`, `explainTask`) over the result; the health
fixtures (H1 to H9) keep their native goldens. `tests/e2e/lib/small-plan.test.ts` pins the numbers the
specs rely on (nine findings, the milestone rule, the explainer's sentences). The screenshots of the
moved tests (`t18-why-here*`, `t18-cell-why*`, `t18-show-in-gantt*`, `t18-finding-*`) were
regenerated on the small plans, for the three devices; the ones that show the 241-finding list are
unchanged.

**Seconds of worker time per file** (sum of tests over 2 workers, as in `durations.json`). iPhone:
before and after run back to back per file on one machine (shared with other jobs, load 15 to 35), so
both saw the same load; desktop and pixel-7: separate runs, less load-sensitive.

| File | iPhone before | iPhone after | desktop before | desktop after | pixel-7 before | pixel-7 after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| health | 409 | 243 | 87 | 97 | 83 | 51 |
| why-here | 353 | 171 | 77 | 55 | 70 | 42 |
| workload-edits | 268 | 92 | 47 | 25 | 44 | 21 |
| health-screenshots | 295 | 253 | 47 | 29 | 54 | 45 |
| workload | 213 | 98 | 40 | 33 | 23 | 17 |
| health-fixes | 278 | 80 | 66 | 39 | 53 | 27 |
| health-fixtures | 24 | 25 | 8 | 10 | 7 | 7 |
| **total** | **1840** | **962** | **372** | **288** | **334** | **210** |

The iPhone opens of `fedora-res` fell from about 43 to 9. On the desktop `health` did not get
faster: its remaining tests are the long fedora ones, and each worker now also boots the Node engine
once (about 5 s) for the small plans' expectations.

`durations.json` has the new times of these files for the three projects (iPhone from the "after"
runs above, which a loaded machine makes about 1.3 times the CI figures, so the shard plan is
slightly pessimistic for them; `health-fixtures` had no entry and now has one). Note for whoever
re-measures: `shard-plan.mjs measure` replaces the whole project's map with the files of the reports
it is given, so for a few files merge the result instead of running it on them alone.

**Estimated CI saving.** By `durations.json` (times by `ciFactor`): iPhone 589 s, pixel-7 227 s,
desktop 115 s, about **15.5 job-minutes of the ~215**; the back-to-back iPhone runs give 878 s of
worker time, so 16 to 20 job-minutes is a fair range. This is not the whole of the 12-minute target:
it takes the fedora opens out of three of the heaviest iPhone shards.

**Left alone, and why.** The other heavy files are on small plans already (`gantt-manipulation`,
`upstream-tutorial`, `poc-sample`, `ui-people`) and sit at the floor: `gantt-a11y` (11 tests, 18 to
50 s), `phone-bugfixes` (15 to 33 s), `resources` (20 to 36 s), `phone-status` (22 to 31 s),
`gantt-add-task` (14 to 22 s), `gantt-manipulation` (about 20 s), `select-arrows` (20 to 35 s),
`people-shell` (a reload test is two boots, 62 s), `gantt-treegrid` (25 to 40 s, axe scans). Their time
is the number of tests times the engine boot, so only merging tests or a faster boot would cut it, and
merging would break the independence of the tests. `workload-gate`, the perf specs and the golden
parity are untouched.

## T22: performance and accessibility audit (2026-11-23)

The full audit is `docs/phases/phase-3-perf-a11y.md` (budget, measured, method and verdict for every
Phase 3 budget; the accessibility items with their evidence and fixes). Raw records, one file per test
and project, each with its device, browser, build and load: `docs/phases/evidence/phase3-t22/`. In short,
at the quiet half hour of a shared machine (load 1 to 4; at load 15 to 35 the frame caps fail):

- **Met:** the Workload scroll and pan caps, the 3 s drag script time (0.3 ms of 8), the Pixel 7's
  800-node cap (333), fills per frame on a phone (225 of 600), paint script time (2.5 ms desktop, 5.7 ms
  at 4x), no long task after ready with the Workload view open (new check), worker memory (flat after the
  first edit, 2.6 MB over 12), every first-load and chunk cap of `js-sizes`, and the Phase 2 desktop
  budgets (app shell 0.39 s, engine ready 3.4 s, the 500-task scroll 6 of 6 runs).
- **Not met, recorded:** one runner task of 61 ms at 4x on `scale-1000` (50 ms per task, 8.3) and the
  health check's cold call at 15.9 ms against 15 (47 ms at 4x); 731 fills at day zoom on a 1280 px
  desktop (the 600 of 8.1); the 500-task phone scroll at 61 to 62% on time, as in Phase 2.
- **Fixed:** the "Move which task?" chooser dropped the focus on close (WCAG 2.4.3); `js-sizes` now
  reports the People views together (90,589 of a 100,000 guard) and caps the shared heatmap chunk; the
  responsiveness job covers `fedora-res` with the Workload view open; the live regions and the T key have
  end-to-end tests.
- **Waiting for the user (P2):** the desktop's fills per frame is recorded only, with no assertion, until
  the user decides what a desktop's budget is. The 600 stays asserted for a phone.
- **Open (user or owner):** the Visual-first first load has 439 bytes under its cap; a Layout inside the
  first Workload paint's rAF callback (46 ms in a busy trace); the idle work at 4x. See the audit's
  "Open items".

## T23: CI changes (13.3)

Each row of phase-3.md 13.3 against `ci.yml` and `nightly.yml` at `d83dfcfa`. Two gaps were closed (marked
"added"); the rest was already in place as the suites landed.

| Row of 13.3 | Job and workflow lines | State | Evidence |
| --- | --- | --- | --- |
| `check`: new Phase 3 unit tests | `check`, `npm run test:unit` | was there | `vitest.config.ts` includes `src/**/*.test.ts` and `tests/**/*.test.ts`, so every Phase 3 unit test (workload, health, explain, calendar, `tests/golden`) runs; only the two engine-booting fidelity files are excluded, and `fidelity` runs them |
| `check`: fedora-res generator `--check` | `check`, the step after `scale-1000.mjs --check` | added | `node engine/golden/generators/fedora-res.mjs --check` prints `fedora-res: 4 files match the generator`, exit 0 |
| `golden`: schema v3, new goldens | `golden`, `npm run test:golden` (`tests/golden/parity.spec.ts`) | was there | `GOLDEN_SCHEMA_VERSION = 3` (`engine/golden/lib.mjs`); every file in `engine/golden/expected` has `schemaVersion` 3; the manifest holds `fedora-res`, 13 `workload` and 18 `health` plans and `loadCorpus()` reads the whole manifest; `tests/golden/corpus.test.ts` fails on a golden of another schema |
| `fidelity`: `clearLeave` and `gapToTask` families | `fidelity`, `npm run test:fidelity`; nightly `fidelity-nightly` and `fidelity-merge` | was there | `leaveClearFamily` and `gapTaskFamily` are in `FAMILIES` (`tests/fidelity/families/index.ts`), so both are enforced and `PENDING` is empty; `harness.test.ts` fails if an intent type has no family; `fidelity-merge.mjs` fails a nightly with fewer than 5 edits of an enforced type. The `engine` job also runs `leave-gap.engine.test.ts` |
| `fidelity`: fast-path suite on v3 | `fidelity`, step "Fast path equivalence" | was there | `fast-path.equivalence.test.ts` runs "every golden plan" from `loadCorpus()` (all v3), each fast result equal to a full run of the same text |
| `e2e`: new specs on the matrix | `e2e` (desktop 5, pixel-7 6, iphone-14 18 shards) via `scripts/ci/shard-plan.mjs` | was there | `shard-plan.mjs files <project> <shard>` over all shards of each of the three projects lists `workload`, `workload-edits`, `workload-gate`, `workload-perf`, `workload-screenshots`, `health`, `health-fixes`, `health-fixtures`, `health-screenshots`, `people-shell`, `people-shell-screenshots`, `gantt-people-picker`, `people-picker-screenshots`; `shard-plan.mjs check` passes |
| `e2e`: `workload-perf` desktop caps | `timing` (ci.yml, main only) and nightly `timing`, `--grep @timing` | was there | the desktop tests carry `{ tag: '@timing' }` (ADR-0016); `scripts/ci/timing-check.mjs` reads `workload-perf.json` |
| `e2e`: Pixel 7 DOM-node cap | `e2e` merge tier (`--grep-invert @timing`) | was there | "the mounted Workload view stays under 800 DOM nodes on a phone" in `workload-perf.spec.ts` has no `@timing` tag, so it runs in the shards |
| `e2e`: `js-sizes` reports the People chunk | `gates`, step "JS sizes" and the `js-sizes` artifact | was there | `CHUNK_CAPS` has the `people` chunk (`view: true`); `peopleViewsSize` totals the People view chunks; `loadsPeopleChunk` is checked per load |
| `responsiveness`: `fedora-res` with the Workload view open | `responsiveness`, `npm run test:responsiveness` | was there | `playwright.responsiveness.config.ts` `testMatch` lists `workload-responsiveness.spec.ts`, which opens `/app?sample=fedora-res&mode=visual&view=workload`; the `responsiveness-*` artifact glob picks up its report |
| `nightly.yml`: `workload-perf` throttled, with history | nightly `timing`: `--grep @timing` on desktop and pixel-7; artifact `timing-nightly-<run_number>` with `workload-perf.json`, 90 days | was there (history); summary added | The Pixel 7 test measures swipes and pinches at 1x and 4x CPU on every run. History is the Gantt's: one artifact per night, kept 90 days, no new store. Added: step "Summarise the Workload phone measures" (`scripts/workload-perf-summary.mjs`) prints the 1x and 4x rows into the step summary, as `gantt-perf-summary.mjs` does for the Gantt |

Checks run locally: the generator `--check` (match); `scripts/workload-perf-summary.mjs` on a sample JSON
(table printed); a YAML parse of the three workflows (`actionlint` is not installed); `tsc --noEmit`;
`prettier --check`; `vitest run tests/ci` (296 passed); `shard-plan.mjs check`; `webkit-skips.mjs`;
`fixed-waits.mjs` (30 in 15 files); `licenses.mjs`; `no-ruby.mjs`. No golden or fidelity job was changed;
those rows were verified by reading, and by the nightly on `1b3c00d7` (run 45175320477, job "Patch fidelity
(all shards)"): `clearLeave` 169 edits of 180 cases and `gapToTask` 170 (at least 5 required), P4 with no
new error or fatal ids, "All rules hold".
