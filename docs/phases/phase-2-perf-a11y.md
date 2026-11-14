# Phase 2: performance and accessibility findings (T22, T23)

Written 2026-11-14 by `perf-a11y-auditor`. Specs: phase-2.md 8.2, 8.4, 10, 16 (criterion 2), 18.7.
Raw numbers: `docs/phases/evidence/gantt-perf-t22.json` (summarise with
`node scripts/gantt-perf-summary.mjs docs/phases/evidence/gantt-perf-t22.json`) and
`docs/phases/evidence/gantt-analysis-browser-t22.json`.

## How the numbers were taken

- **Machine.** The shared 4-vCPU cloud sandbox (Intel Xeon at 2.1 GHz, no GPU, software raster),
  other agent sessions running on it. Load average (one-minute) is given with every measurement;
  the final runs below were made at 2.6 to 4.1. Earlier runs at load 10 to 55 were discarded
  because dropped frames followed the load (the same code showed 40 to 55% dropped at load 20 and
  1 to 2% at load 3). `PERF_MAX_LOAD=<n>` makes the spec wait up to two minutes for a quieter
  machine before each scroll run; it was not enough on this machine, so quiet periods were used.
- **Browser and build.** Google Chrome 153.0.8010.12, headless, Playwright 1.64; Playwright's
  device descriptors set the user agent. Build: the worktree at commit 5a652477 plus the T22 and
  T23 edits (the JSON files say `build`). Preview server on its own port.
- **Devices.** `desktop` is Desktop Chrome (1280 x 720, no throttle). `pixel-7` is **emulation**
  (412 x 915, dpr 2.625, touch) with `Emulation.setCPUThrottlingRate` 4. No real device was used
  (T26 was dropped on 2026-11-13). Everything said below about the phone is about the emulation.
- **Plan.** `gantt-500`: 500 tasks, all expanded, 501 treegrid rows, scroll height 20,076 px,
  width 36,089 px. After the engine is ready and the first paint has settled (engine boot is
  excluded, as phase-2.md 8.4 says).
- **Input.** Desktop: the DevTools wheel gesture (`Input.synthesizeScrollGesture`, mouse), which is
  the browser's own scroller. Phone: **real touch events** (`Input.dispatchTouchEvent`, paced
  swipes of about 4,500 px/s, each lift flinging as Chrome does). The DevTools *touch* scroll
  gesture does not scroll the chart in headless Chrome (checked: 0 px at every speed), so the
  earlier T16 scroll numbers for the phone were taken with a wheel and did not exercise
  `touch-action` or the `touchmove` listener; these do.
- **Frame metrics.** rAF intervals; "on time" is an interval up to 20 ms (16.7 ms plus 3.3 ms of
  timestamp jitter); Long Animation Frames; the compositor's presented and dropped frames from a
  Chromium trace; script time per frame; input latency spans from the trace. Headless Chrome
  has no GPU, so rasterisation is software and the figures are an upper bound on a phone's.

## Performance: each measurement against its budget

Budgets are from BUILD_PLAN "Performance budgets" and phase-2.md 8.4 and 18.7.

| # | Measurement | Budget | Desktop (load 3.8 to 2.7) | Pixel 7 emulation, 4x CPU (load 2.8 to 3.6) | Verdict |
| --- | --- | --- | --- | --- | --- |
| P1 | App shell, first open (first contentful paint; rows visible), `gantt-200`, cold, local server | under 1.5 s | 0.58 s (rows at 0.49 s) | 0.57 s (rows at 0.47 s); not throttled, load 4.1 | **Met** |
| P2 | Engine booted (status leaves "Starting the scheduler") | under 4 s | 2.4 s | 2.1 s | **Met** |
| P3 | Engine "Ready" (boot, first schedule of 200 tasks, status settled) | under 4 s | first schedule at 5.1 s, Ready at 6.1 s | first schedule 4.6 s, Ready 5.5 s | **Not met** for a 200-task plan; boot alone is met. Known Phase 0 deviation (wasm code cache is Phase 4) |
| P4 | 500-task vertical scroll through all rows and back: at least 95% of frames on time, none over 50 ms, three runs per zoom (18.7) | pass in every run | **6 of 6 runs pass** (day 95.3 to 98.3% on time, week 97.8 to 99.8%; longest interval 50 ms; compositor dropped 0.3 to 2.5%) | **0 of 6 runs pass**: 62.5 to 66% on time, 31.7 to 38.9% compositor frames dropped, 69 to 150 frames over 50 ms per run, longest frame 117 to 317 ms | Desktop **met**; the emulated phone **not met** |
| P5 | Horizontal pan across the frame (reported) | n/a | 100% on time, longest 16.8 ms | 76.7% on time, 22% dropped, longest 83 ms | Reported |
| P6 | Pinch (phone) or Ctrl+wheel (desktop), day towards quarter (reported) | n/a | 99.6% on time, longest 33 ms; zoom reached quarter | 79.7% on time, 57% dropped, longest 133 ms; zoom reached quarter | Reported |
| P7 | 3 s bar drag, script time per frame, p95 (8.4: under 8 ms) | under 8 ms | input handlers 0.3 ms plus rAF 0.7 ms = 1.0 ms | 0.5 plus 3.7 = 4.2 ms (at 4x) | **Met** on both |
| P8 | Drag feedback: pointer move to the frame that shows it (Chromium `InputLatency` spans) | under 16 ms (BUILD_PLAN) | p50 24 ms, p95 38 ms | p50 69 ms, p95 156 ms | Not comparable with the budget: the span runs to presentation on a software-rastered, vsync-locked pipeline (about two frames at rest). The script cost (P7, 1 to 4 ms) is what the code controls. Recorded |
| P9 | Drop to paint: pointer up to the second frame after it | n/a | 38 to 70 ms | 43 to 78 ms | Reported |
| P10 | Drop to reschedule: pointer up to the engine's newer revision, `gantt-500` | under 1 s for plans up to 200 tasks | 4.3 to 5.1 s for 500 tasks (4.5 s while scrolling) | 4.7 to 7.4 s | The budget is for 200 tasks; 500 is reported. The 200-task case is the engine-responsiveness and edit specs' |
| P11 | Scroll while a result arrives (the drag's drop starts the runner, the scroll begins at once) | n/a (reported) | 98.7% on time, longest 33 ms, no long task over 41 ms | 65.8% on time, longest 333 ms | Reported; the desktop shows the chunked result handling (6.9) working |
| P12 | Touch-listener comparison (8.2): the same phone scroll, three runs each, with and without the Gantt's non-passive `touchmove` listener | the listener must not cost frames | with: 59.2, 60.1, 60.5% on time; 43.5, 44.5, 44.6% dropped | without: 60.8, 61.6, 64.0% on time; 45.1, 41.3, 36.6% dropped | **No difference** beyond the run-to-run spread (about 4 points). Taken at load 5 to 9, so not as clean as P4. The listener is not what costs the phone its frames; the fallback of 8.2 (and its ADR) is **not** needed |
| P13 | `gantt-500` analysis, cold (first result after load), desktop, three runs | 10 ms | 26.3, 13.1, 26.5 ms (load 3.5 to 5.3) | n/a | **Not met** (open item, as known: 12 to 18 ms before, up to 26 ms on a loaded machine) |
| P14 | `gantt-500` analysis, warm | 10 ms | 7.5, 6.7, 10.6 ms | 4x: 21.9, 29.8, 21.4 ms | Met on desktop; the 4x figure is reported (10 ms is a desktop target) |
| P15 | `syn-20-scale-1000` while scheduling (`npm run test:responsiveness`) | no task over 50 ms after the engine is ready | 3 of 3 runs pass; no task after ready; boot tasks 172, 64 ms (capped at 250) | throttled 4x: 0 long tasks after ready; one boot task 166 ms; key events 48 ms | **Met**. The "two steps near 50 ms" at 4x did not reproduce as long tasks; the slowest Event Timing entry is 48 to 64 ms (8 ms granularity). The resumable index link proposal stands as a proposal (below) |
| P16 | Touch drop at 4x on the small plan (`gantt-gesture-frames`, 3 runs) | none over 50 ms | n/a | max frame 83.4, 33.4, 49.9 ms (138, 138, 135 frames) | **Intermittent**: one run in three has a frame over 50 ms (the known open item). On `gantt-500` at 4x the 3 s drag has 109 frames over 50 ms (the drag row of the P4 run), so it is worse there |
| P17 | JS size | 450,000 bytes gzip for `/app` | see `scripts/js-sizes.mjs` (run by CI on desktop) | | See the gate file |

### Criterion 2 ("500-task scroll at 60 fps"), as judged under emulation

- **Desktop, unthrottled: met.** Six runs (three at day zoom, three at week zoom), every one at
  least 95% on time with no interval over 50 ms.
- **Pixel 7 emulation at 4x CPU: not met.** About 64% of frames on time and about 35% of the
  compositor's frames dropped in every one of six runs, with 69 to 150 frames over 50 ms in each.
  This is emulation: a throttled main thread, software raster and no GPU, so a real phone may be
  better or worse. It does not show that a real device passes. The result is **recorded as it is**;
  the gate file must say that the emulated phone fails 18.7 and that the user waived the device run.
- **Where the time goes** (phone, 4x, touch scroll; Long Animation Frames summed over a run, 30 to
  75 long frames): script 450 to 2,200 ms, render (style, layout, paint, before the compositor)
  590 to 2,800 ms, of which style and layout 110 to 540 ms. A sampled CPU profile of a touch scroll
  at 4x shows 55% of the main thread in "(program)" (Chromium's own style, layout and paint work),
  13% in script (Svelte row templates cloning, the Gantt's scroll handling) and 20% idle, with
  `getClientRects` the largest single script item (208 ms of 7.5 s sampled). The cost is the
  DOM treegrid rows being mounted and laid out during a scroll plus the canvas redraws, not input
  handling (the input handlers take 0.5 ms per frame) and not the touch listener (P12).
- **Not fixed here.** The fix is in `Timeline.svelte`, `OutlineGrid.svelte` and the painters
  (`ui-builder`), not a small change. Proposals, in the order of expected gain: (1) in
  `Timeline.svelte:126` and `TimeHeader.svelte:48` the `getClientRects().length === 0` visibility
  test forces layout on each paint; read it from a cached `ResizeObserver` result; (2) mount fewer
  treegrid rows on a coarse pointer (the 10-row overscan is 10 rows of 40 px) and use
  `contain: strict` on the rows' container so a row change does not lay out the table; (3) check
  whether the canvases redraw on every scroll event or only past the overscan (8.1); (4) measure again
  on a real device before changing anything else, because a software-raster emulation can
  overstate raster cost. If the real device also fails, phase-2.md 8.1 names the next step
  (an ADR for an OffscreenCanvas worker "only if T22 shows paint as the bottleneck": the profile
  above says paint and layout, so this is the measurement that would trigger it).

### Open items from the brief

| Item | Measured now | State |
| --- | --- | --- |
| `gantt-500` analysis cold start 12 to 18 ms against 10 ms | 26.3, 13.1, 26.5 ms at load 3.5 to 5.3 (P13); warm 6.7 to 10.6 ms | **Open**, not fixed (engine/analysis internals) |
| `scale-1000` at 4x, two steps near 50 ms; needs a resumable index link in `src/lib/tjp/index` | no task over 50 ms after ready in four runs including 4x (P15); Event Timing 48 to 64 ms | **Not reproduced as a long task.** **Proposal (not done): a separate task** for a resumable index link in `src/lib/tjp/index`, to be taken only if the step reappears in a trace; the trace files of this run are `test-results/responsiveness-trace-*.json` |
| One 50 ms max frame on a touch drop at 4x | one run in three on the small plan (83.4, 33.4, 49.9 ms); 109 frames over 50 ms on `gantt-500` | **Open**; same cause as P4 on the phone (render cost per frame), not a separate bug |

## Accessibility: findings

Spec: `tests/e2e/gantt-a11y.spec.ts`, desktop and Pixel 7 (iPhone 14 skipped: Chromium audit).

### Method and coverage

- **axe** (`@axe-core/playwright`, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa), light and
  dark, soft assertions so one run reports every state. States: Text, Split (desktop) and Visual;
  the treegrid with no selection and with a row focused; the details panel (desktop), bottom sheet
  (phone and tablet width) and drawer (desktop Split at 1280 px, from the rail); the source sheet;
  the project sheet; the phone's status popover (the engine popover on desktop); the row menu; the
  shortcuts dialog; link mode; the people palette (desktop; a finger books people in the sheet);
  the move question; a toast.
- **Hand checks as specs:** the keyboard walkthrough (10.2), focus ring at every stop, no trap, Enter
  into the details and Escape back, the row menu, the shortcuts dialog and link mode by keyboard;
  44 px targets on a coarse pointer, probed in 12 states; reduced motion; forced colours; names
  from the accessibility tree.
- **Screen readers:** not run (Phase 6, as 10.4 says). Names were checked from the a11y tree
  (`locator.ariaSnapshot()`); the tree of each run is written to `test-results/gantt-a11y-tree-*.txt`.

### Findings table

| # | Finding | WCAG | State | Reason or evidence |
| --- | --- | --- | --- | --- |
| A1 | axe: **no violations** in any state above, light or dark, on both devices | 2.2 AA | Pass | 18 axe states of the first run passed, and the rest after fixing the test, not the app (below) |
| A2 | The phone header's **Project settings** button was 35.8 x 44 px and the **theme** button 35.3 x 44 px: a flex item shrank below the control size when the plan's name took the room | 2.5.8 (24 px: met), project rule 44 px | **Fixed** | `flex: none` on `.project-button` and `.icon-button` (`TopBar.svelte`, `ThemeToggle.svelte`, 4 lines); the target-size spec probes 12 states and passes. Screenshots `docs/phases/screenshots/phase-2/a11y-header-*.png` |
| A3 | The row (treegrid row) is 40 px high on a coarse pointer, not 44 | 2.5.8 | **Exempt** | phase-2.md 10.3 sets 40 px rows (44 px for handles, buttons, fields); 40 px clears the 24 px of 2.5.8. The probe lists it with this reason (`EXEMPT`) |
| A4 | Every other interactive element (buttons, selects, steppers, chips, menu items, dialog buttons, the toast's Undo, the link banner's Cancel, the move question) is at least 44 x 44 on a coarse pointer | project rule | Pass | probe in 12 states, two samples a moment apart so a layout still settling is not a finding. A `<select>` is measured by the label that wraps it |
| A5 | Focus order: header, mode switch, the Gantt's controls, the treegrid (one tab stop, roving), then the details | 2.4.3 | Pass | walkthrough spec |
| A6 | Focus visible at every stop (a 3 px outline, or a ring on the select's chip), and in forced colours the treegrid row keeps its outline | 2.4.7, 2.4.13 | Pass | spec |
| A7 | No keyboard trap: Tab leaves the treegrid; Enter on a row opens the details and focuses the first field, Escape returns to the row; Escape closes the row menu (focus returns to its button), the shortcuts dialog (to the row menu) and link mode (to the row) | 2.1.2 | Pass | spec |
| A8 | Reduced motion: no animation or transition longer than 50 ms on any element in the selected, row-menu and project-sheet states; the Today scroll is not smooth | 2.3.3 | Pass | spec reads computed styles. The reschedule tween and the logo animation are off through `--motion-*` and the matchMedia checks (not observed frame by frame) |
| A9 | Forced colours: pressed and unpressed chips and the mode switch differ in more than a background; the focus ring stays | 1.4.11 | Pass | spec compares border, outline, decoration, weight and `::after`; screenshot `test-results/gantt-forced-colors.png` per run. The canvases keep their own pixels (they do not adapt), which is expected and legible on their own background |
| A10 | Names from the a11y tree: the treegrid is "Tasks", the toolbar group "Gantt controls", the zoom control "Zoom", a row's name is the task, its dates, people and float, every canvas is hidden, and the toast is in a polite live region | 4.1.2, 1.3.1 | Pass | spec |
| A11 | The row menu's button is disabled until a row is selected, and moving the focus never selects; a keyboard user who arrows to a row must press Enter (which also opens the details) before the menu works | 2.1.1 | **Open, by design** | Documented in phase-2.md 10.2 ("moving focus never selects"). Every command has its key on the focused row, so nothing is unreachable. Raise at the gate if the user wants the menu to act on the focused row |
| A12 | Dragging alternatives (2.5.7): every drag row of 7.1 has the key or menu alternative | 2.5.7 | Pass | covered by `gantt-manipulation.spec.ts` (keyboard and menu variants), not repeated |
| A13 | Contrast (1.4.3, 1.4.11) of the Gantt's bars and lines | 1.4.3, 1.4.11 | Pass for DOM (axe, both schemes) and for the tokens | axe does not read canvas; `tests/ci/palette.test.ts` checks every token pair of both themes (4.5:1 for text, 3:1 for graphics, colour-vision simulation). Not measured: the canvas pixels as painted (anti-aliased edges, the float tail's faint fill) |

### Not done, and why

- Real screen readers (NVDA, VoiceOver, TalkBack): Phase 6.
- Contrast of the canvas pixels as painted, per scheme (A13); the tokens are tested.
- iPhone 14 (WebKit) accessibility runs: the audit is Chromium on desktop and Pixel 7.

## Files

- `tests/e2e/gantt-perf.spec.ts`, `tests/e2e/lib/perf.ts` (+ `perf.test.ts`), `src/lib/perf/frame-meter.ts` (+ test),
  `src/pages/dev/_gantt-perf.astro` (route `/dev/gantt-perf`, `MAINSPRING_DEV_PAGES=1`),
  `scripts/perf-android.mjs` (not run: no device), `scripts/gantt-perf-summary.mjs`,
  `.github/workflows/nightly.yml` (job `gantt-perf`).
- `tests/e2e/gantt-a11y.spec.ts`, `tests/e2e/lib/targets.ts`.
- `tests/e2e/gantt-gesture-frames.spec.ts` keeps the small-plan drag; its listener comparison moved to `gantt-perf.spec.ts` (gantt-500, real touch events).
- CI: the desktop job runs `gantt-perf.spec.ts` on every push (caps: at least one of up to six scroll runs per zoom within 5% dropped compositor frames and 50 ms; drag script time p95 under 8 ms). The phone profile and the listener comparison run nightly (`E2E_PERF=1`) or locally.
