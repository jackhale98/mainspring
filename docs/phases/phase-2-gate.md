# Phase 2 gate: Gantt and visual editing

Status: **evidence recorded, 2026-11-14 (T27).** The user approved moving into Phase 3 as soon as
Phase 2 is done (2026-11-13), so Phase 3 starts without waiting; the verdict below still awaits
the user's review.

Gate commit: `bdc9af8e` (the T22/T23 merge) on `claude/new-session-6tly46`, fast-forwarded to
`main` with the docs commit `c29a0e0c`. CI run:
<https://github.com/jackhale98/mainspring/actions/runs/43609169886> (run 162, success: check,
golden, fidelity with the fast-path equivalence step, responsiveness, e2e on desktop, Pixel 7 and
both iPhone 14 shards, JS size).

## Verdict

| Criterion (phase-2.md 16) | Verdict |
| --- | --- |
| 1. Each row of the direct-manipulation table works on desktop and in phone emulation, produces the documented patch, and is undoable | **Pass** |
| 2. 500-task scroll at 60 fps on a mid-range Android device | **Not met under emulation; device run waived.** Desktop passes. The user decided on 2026-11-14 to record the result and move on, with a real-device check in Phase 6 |

## Criterion 1

Evidence: `docs/phases/phase-2-test-audit.md` (maps every 13.2 item and every criterion to its
spec) and the CI run above, where all of these pass.

| Row | Gesture (desktop / phone) | Patch asserted | Undo and Redo | Keyboard or inspector alternative | Devices in CI |
| --- | --- | --- | --- | --- | --- |
| R1 change effort or length | drag the bar's end | `effort 3d` becomes `effort 5d`, bar matches the engine (`barOnEngine`) | yes | Ctrl+Alt+arrow; inspector stepper | desktop, Pixel 7, iPhone 14 |
| R2 move (`start` and `gap` kinds) | drag the bar | `start` rewritten, or the dependency's `gapduration` | yes | Alt+arrow | desktop, Pixel 7, iPhone 14 |
| R3 link | drag from the link handle, or tap then tap | `depends` added; a refused target says why | yes | link mode by key | desktop, Pixel 7, iPhone 14 |
| R4 remove a link | select the line, Remove | `depends` entry removed | yes | inspector Remove | desktop, Pixel 7 |
| R5 reorder or re-parent | row drag (long press on a phone) | block moved, references follow, across files too | yes | Alt+Shift+arrows; row menu | desktop, Pixel 7, iPhone 14 |
| R6 assign a person | drop a person chip | `allocate` added; a container refuses with a message | yes | inspector people field | desktop, Pixel 7 |
| R7 replace a person | inspector chip menu (18.3; the heatmap gesture is a Phase 3 gate item) | one id token rewritten (`dev1` to `dev3`) | yes | the same menu | desktop, Pixel 7 |
| R8 rename | double-click the name (desktop) or the sheet field | the task's name string | yes | F2; the details field | desktop, Pixel 7 |
| R9 mark progress | drag the progress handle | `complete` set | yes | key | desktop, Pixel 7, iPhone 14 |
| R10 navigate | scroll, pan, pinch | text unchanged (asserted); undo does not apply | n/a | arrows, PageUp/PageDown, T, zoom keys | desktop, Pixel 7 |
| Add and delete a task | toolbar and row menu | exact text of `plan.tjp` and `lib/build.tji` | yes | keys | desktop, Pixel 7 |

Each row's expected text is written inline as an exact replacement of the original lines, next to
the gesture (audit, "Decisions"). Also passing:

- **Android Enter** (`text-mode-android-enter.spec.ts`, Pixel 7): passes with the dispatcher gate,
  and fails with the gate stubbed out (verified by mutation in the audit).
- **"No longer schedules"** (`gantt-schedule-fail.spec.ts`): the last good schedule stays, dimmed,
  and Undo and Redo go through it.
- **Two-way selection sync** (`selection-sync.spec.ts`, `gantt-sync.spec.ts`, across files) and
  **unified undo** across typing and chart edits (`gantt-undo.spec.ts`, the history property tests).
- **Accessibility** (`gantt-a11y.spec.ts`, `phase-2-perf-a11y.md` A1 to A13): axe finds no
  violations in any state, light and dark, desktop and Pixel 7; 44 px targets on a coarse pointer
  (rows are 40 px by design, 10.3). Open by design: A11, the row menu acts on the selected row,
  not the focused one.
- **Screenshots**: `docs/phases/screenshots/phase-2/` (336 files: every mode, light and dark,
  desktop, tablet and phone, plus the gesture pictures).

## Criterion 2

The real-device run (8.5, T26) was dropped by the user on 2026-11-13. Under emulation
(`phase-2-perf-a11y.md` P4, `tests/e2e/gantt-perf.spec.ts`, `scripts/perf-android.mjs`):

- **Desktop, unthrottled: met.** 6 of 6 runs at least 95% on time (95.3 to 99.8%), no interval
  over 50 ms.
- **Pixel 7 emulation at 4x CPU: not met.** 0 of 6 runs: 62.5 to 66% on time, 32 to 39% of
  compositor frames dropped, 69 to 150 frames over 50 ms per run, longest 117 to 317 ms.
- **Cause:** style, layout and paint while treegrid rows mount during the scroll, plus canvas
  redraws; not input handling (0.5 ms per frame) and not the touch listener (P12 shows no
  difference). Software raster in emulation may overstate it.
- **Decision (user, 2026-11-14): record and move on.** The fixes are polish item 12
  (`getClientRects` forced layout in `Timeline.svelte` and `TimeHeader.svelte`, fewer rows mounted
  on a coarse pointer, `contain: strict`), and a real-device check is in Phase 6.

## Deliverables

- **Canvas Gantt** with outline, zoom, collapse, dependency lines (rerouted like MS Project and
  OmniPlan), critical path, float tails, today and status-date lines: screenshots above;
  `gantt-critical`, treegrid and analysis tests.
- **Split, Text and Visual modes** with selection sync, the inspector (bottom sheet on phones,
  tap to select and tap again for details), every MVP gesture on mouse and touch, unified undo
  (phone Undo and Redo in the top bar, with a long-press History rewind).
- **Fast path spike (T19, ADR-0010): accepted with a condition, merged but switched off.**
  Equivalence over three review rounds: 0 differences (round 3: 2,578 and 2,544 cases at two
  seeds, plus 194 shuffled fast runs). Median engine time saving 37 to 51% on Fedora 20 and 34 to
  44% on `gantt-200`. It is switched on only after a third independent adversarial review finds no
  wrong-result case; that review is paused for machine capacity and resumes next.
- **Other items the gate records:**
  - reschedule time up to 200 tasks: the first schedule of `gantt-200` lands at 5.1 s on desktop
    (Ready 6.1 s) against the 4 s budget; boot alone is 2.4 s (P2, P3; a known Phase 0 deviation,
    wasm code cache is Phase 4);
  - drag script time per frame 1.0 ms desktop and 4.2 ms at 4x (P7, budget 8 ms);
  - JS size 424,010 bytes gzip against the 450,000 byte cap (CI `js-sizes.json`);
  - goldens: still **provisional, Ruby 3.3.6** (ADR-0003 #5, amended), schema v2;
  - edit API timings: the T6 table below; every Fedora intent and drop path is under 50 ms p90.

## Open items carried forward

| Item | Where |
| --- | --- |
| Engine memory: about 1.1 MB kept per full run; ruby.wasm fails past 2 GiB, after about 1,800 runs | `engine-specialist` investigating; fix before Phase 3 work in `src/engine/client.ts` |
| `gantt-500` analysis cold 13 to 26 ms against 10 ms (warm meets it) | P13; open |
| First 200-task schedule over 4 s | P3; Phase 4 code cache |
| Phone scroll cost under emulation | polish 12; Phase 6 device check |
| Remaining phone layout; add-dependency picker in the details | polish 8, 11 |
| Fast path switched off | ADR-0010 final review |
| Project intents on the 1,000-task plan at 44 to 51 ms p90 cold | T6 "Open" below |
| Ruby 3.4 golden re-record | the user (ADR-0003 #5) |

## Edit API timings (T6)

Spec: phase-2.md T6 and 11.3 ("T6 measures again and fixes anything over 50 ms p90 on Fedora,
because the drop path depends on it"), 19.19, and phase-1-audit.md §2.1.

**Method** (`tests/perf/text-mode-timings.test.ts`, cases in `tests/perf/edit-intent-cases.ts`):

- Every `EditIntent` type, plus the Gantt drop path (`checkAction` in `src/lib/gantt/intents.ts`:
  `planAction`, then the `applyIntent` dry run) for the 7.1 rows.
- **Cold runs.** Each run gets a fresh workspace and a fresh index (built outside the timing), so
  no cache from an earlier run helps; in the app every edit starts from a new snapshot. The
  audit's runs repeated one intent on one snapshot, 8 times.
- 30 timed runs per case after 3 warm-ups; p50, p90 and max of wall time.
- Plans: Fedora 20 with the engine's hints, as the app indexes it. Fedora declares no resources,
  leaves or allocations, so those intents run on **Fedora+res** (Fedora plus a global leave, a
  group of two resources, one with a leave, and `allocate dev` in one leaf). Fedora's project
  header is built by macros, so its project intents are refused at once (`text-only`); they run
  on **scale-1000** (5,628 lines, 2.3 times Fedora) instead.
- Machine: the shared 4-vCPU cloud sandbox of the audit, Node 22.23.4, other agent sessions on
  the same machine. The table is one run at load average 2.5 to 3. Absolute values are upper
  bounds for a dedicated desktop.

**Changes** (commits 52fe6804 and 145e84dd):

- The dependency loop check (`edit/dep-loops.ts`) walks integer indices and typed arrays instead
  of string keys. A property test checks it against the string-keyed walks it replaced
  (`dep-loops-testing.ts`, 20,000 random graphs).
- `edit/dep-graph.ts` checks scenarios that read every statement alike only once (Fedora's two
  scenarios have no prefixed statements), and `newLoop` reuses the cached loops of the edit's
  own index for the before side.
- `updateFile` keeps its last result per file, so `buildEdit` reuses the tree that the edit's
  checks already reparsed instead of parsing the edited file a second time.
- `valueDiagnostics` is cached per index (the runner and the project re-check ask for the same
  one).

**Before and after, structural intents** (cold harness, wall ms, run back to back at load average
10 to 13; before = the lib code at d7bb151f):

| Intent | Before p50 | Before p90 | After p50 | After p90 |
| --- | --- | --- | --- | --- |
| `addTask` | 38.7 | 51.2 | 33.4 | 44.0 |
| `deleteTask` | 43.0 | 48.3 | 28.8 | 36.4 |
| `moveTask` | 50.0 | 73.6 | 30.5 | 38.0 |
| `addDepends` | 31.9 | 50.5 | 21.5 | 33.2 |
| `removeDepends` | 14.4 | 20.5 | 13.1 | 19.5 |
| Gantt link (R3) | 33.1 | 50.2 | 21.9 | 32.4 |
| Gantt reorder (R5) | 41.9 | 54.5 | 38.2 | 45.1 |

**After: every intent** (wall ms; target 50 ms p90; status is what the intent returned):

| Intent | Plan | Status | p50 | p90 | max |
| --- | --- | --- | --- | --- | --- |
| `setAttr priority` | Fedora | edit | 4.33 | 6.94 | 22.74 |
| `setAttr length` | Fedora | edit | 3.98 | 6.55 | 24.67 |
| `setAttr start` | Fedora | edit | 4.04 | 6.18 | 8.59 |
| `setAttr complete` | Fedora | edit | 3.99 | 5.72 | 6.19 |
| `removeAttr flags` | Fedora | edit | 3.13 | 6.42 | 8.59 |
| `renameTask` | Fedora | edit | 3.00 | 4.57 | 5.60 |
| `addTask` | Fedora | edit | 22.79 | 26.03 | 36.70 |
| `deleteTask` | Fedora | edit | 20.31 | 25.96 | 40.91 |
| `moveTask` | Fedora | edit | 25.47 | 36.52 | 63.30 |
| `addDepends` | Fedora | edit | 20.68 | 26.02 | 34.61 |
| `removeDepends` | Fedora | edit | 12.72 | 16.17 | 20.73 |
| `setDependsGap` | Fedora | edit | 3.07 | 3.57 | 5.04 |
| `declareFlag` | Fedora | edit | 2.90 | 4.51 | 5.78 |
| `format` | Fedora | noop (already formatted) | 6.08 | 9.64 | 10.22 |
| `setProjectHeader` | scale-1000 | edit | 5.28 | 8.94 | 15.30 |
| `setProjectAttr` | scale-1000 | edit | 34.55 | 43.70 | 52.77 |
| `removeProjectAttr` | scale-1000 | edit | 33.51 | 49.80 | 55.72 |
| `setWorkingHours` | scale-1000 | edit | 35.60 | 50.76 | 72.10 |
| `allocate` | Fedora+res | edit | 4.97 | 8.14 | 9.09 |
| `addAllocation` | Fedora+res | edit | 3.70 | 6.54 | 9.54 |
| `removeAllocation` | Fedora+res | edit | 3.40 | 5.86 | 6.26 |
| `replaceAllocation` | Fedora+res | edit | 3.43 | 5.61 | 6.67 |
| `addResource` | Fedora+res | edit | 4.52 | 6.35 | 7.96 |
| `deleteResource` | Fedora+res | edit | 4.10 | 5.52 | 6.35 |
| `moveResource` | Fedora+res | edit | 4.17 | 6.82 | 9.81 |
| `renameResource` | Fedora+res | edit | 2.78 | 4.02 | 5.79 |
| `setResourceAttr` | Fedora+res | edit | 2.80 | 5.14 | 10.79 |
| `removeResourceAttr` | Fedora+res | edit | 2.94 | 6.10 | 8.66 |
| `addLeave` | Fedora+res | edit | 3.67 | 4.86 | 8.42 |
| `updateLeave` | Fedora+res | edit | 2.70 | 3.98 | 4.86 |
| `removeLeave` | Fedora+res | edit | 2.83 | 5.01 | 5.37 |
| Gantt resize (R1) | Fedora | edit | 3.65 | 5.18 | 7.26 |
| Gantt move, `start` (R2) | Fedora | edit | 4.41 | 6.87 | 7.51 |
| Gantt move, `gap` (R2) | Fedora | edit | 3.22 | 6.13 | 12.60 |
| Gantt link (R3) | Fedora | edit | 22.46 | 29.58 | 35.40 |
| Gantt unlink (R4) | Fedora | edit | 13.60 | 19.20 | 41.75 |
| Gantt reorder (R5) | Fedora | edit | 27.42 | 39.77 | 41.07 |
| Gantt progress (R9) | Fedora | edit | 4.09 | 6.37 | 7.43 |

**Result.** On Fedora every intent and every Gantt drop path is under 50 ms at p90 with cold
caches. The structural ones (add, delete, move, link) are 20 to 27 ms at p50; what is left is
mostly the re-index of the edited file that the task-tree and anchor checks need (about half)
and the loop check of the edit's own index on first use.

**Open.** The project intents, measured on the 1,000-task plan, are at 44 to 51 ms p90 cold. They
re-index the whole edited file and compare its value diagnostics (`edit/revalidate.ts`). In the
app the runner has usually computed the "before" diagnostics for the same index already, which
saves about 6 ms. They come from the project sheet, not from a drag, so they are not on the 7.3
drop path. Making the re-check incremental (only the statements after the changed setting) is
the next step if the gate wants them under 50 ms on that plan too.
