# Phase 3 gate evidence

## Status

Kept at the top of this file by the main session (ADR-0016 section 5). Update it at the end of every
batch, before the push.

| Item                       | Now                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Last green commit on main  | `d4150c6d` (branch run 44237567781, 2026-11-18); its run on `main` failed only on a hung iPhone browser install, fixed in `5d2a7624` |
| Timing trend               | 1. `d4150c6d` (run 44240034126, artifact `timing-232`): job green, no gross regression               |
| iPhone 14 skips left       | 37 spec files at 2026-11-18 (ADR-0016 counted 33 by its own method); target: at most 6 allowlisted    |
| CI wall time               | about 21 min (run 44237567781, 04:28–04:49 UTC); target 12 min (ADR-0016 section 4)                  |

How the iPhone skips are counted, so that the number is repeatable. A spec file counts when it has a
`skip` call and also names the iPhone project or WebKit:

```sh
grep -lE "skip" tests/e2e/*.spec.ts | xargs grep -lE "iphone-14|isIphone|webkit" | wc -l
```

Once `tests/e2e/lib/webkit-allowlist.ts` exists (ADR-0016 section 2), count its entries instead and
keep this grep at zero outside it.

How the CI wall time is read: open the last green run of the `CI` workflow on `main`; the wall time
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
  `playwright test --grep @timing --workers=1 --project=desktop --project=pixel-7`:
  - `gantt-perf.spec.ts` (all of it: the desktop caps, first open, the phone profile and the
    touch-listener comparison; the phone profile runs only with `E2E_PERF=1`, that is nightly),
  - `workload-perf.spec.ts` desktop scroll caps and the Pixel 7 swipe frame times,
  - `gantt-gesture-frames.spec.ts`,
  - the full-speed copies of the sheet shape tests (named `... (full speed)`, Chromium only) and
    "closing while it slides in goes on from where it is".
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

## Done when (ADR-0016): recorded as each item is met

1. Merge tier has no frame-rate or full-speed animation assertion: split done (see above). Five
   reruns of the merge tier on one commit green, and three timing trend entries: not yet.
2. iPhone skips down to the allowlist: not yet.
3. Contract specs for the six primitives: not yet.
4. CI meets the time target: not yet.
5. The status line is at the top of this file: done (this file).
