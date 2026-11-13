# Phase 1 audit: performance and accessibility of Text mode (T21)

Scope: phase-1.md 8.4 (timings), BUILD_PLAN.md "Performance budgets", WCAG 2.2 AA. Build: base
`4b37ad72` plus the T21 changes in this branch. Date: 2026-11-12.

## 1. Method and machine

- **Machine.** Shared cloud sandbox, 4 vCPU Intel Xeon 2.10 GHz, 16 GiB, Linux 6.18, Node 22,
  Chromium 1248 (Playwright 1.64.1, headless, Desktop Chrome profile 1280x720, no GPU).
  **Other agent sessions ran on the same machine**; load average was 3.5 to 25 during the work. The
  numbers below are from the quietest runs, and every before/after pair was interleaved on the same
  machine. Treat absolute values as upper bounds for a dedicated desktop; they are not a phone.
- **Node timings** (`tests/perf/text-mode-timings.test.ts`, `npm run test:unit`): after 3 warm-ups,
  20 runs for cold parse, 40 for incremental reparse, 25 for the index rebuild and 8 for each intent;
  p50/p90/max, written to `test-results/text-mode-node-timings.json`. With so few runs the p90 and max
  of the intents are close to the largest samples.
- **Browser timings** (`tests/e2e/text-mode-perf.spec.ts`, desktop project only): keystroke latency is
  the Event Timing interaction latency per key (longest of keydown, keypress, beforeinput, input,
  keyup, from the event timestamp to the next paint; 8 ms resolution; unreported keys, under 16 ms,
  count as 16). 3 rounds of 60 keys (180 keys per case), 90 ms apart, each on a fresh page; one case
  repeats with 200 ms gaps. Cold load: 5 fresh contexts (5 runs; p90 and max are the same sample).
  The 90 ms gap is below the runner's 150 ms typing pause, so the index refresh does not run between
  these keys; the 200 ms case is the slow typist where it does.
  JS size: every `.js` response of `/app`, raw and gzip level 9. Output goes to
  `test-results/text-mode-perf.json` with browser, machine and load average.
  Since 2026-11-13 these run nightly (`nightly.yml`, `npm run test:e2e:perf`), not on every push.
- **Accessibility**: `@axe-core/playwright` with tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa
  (`tests/e2e/text-mode-a11y.spec.ts`), light and dark, plus a keyboard-only walkthrough by script
  and by hand-written probes (tab order, focus ring, target sizes, live regions).

## 2. Performance results

### 2.1 Node (spec 8.4), p50 / p90 / max in ms

| Measure                                        | Target | p50   | p90   | max   |
| ---------------------------------------------- | ------ | ----- | ----- | ----- |
| Cold parse, Fedora `f-20.tjp` (2,442 lines)    | 150    | 11.1  | 14.1  | 14.6  |
| Cold parse, `scale-1000` (5,628 lines)         | 300    | 27.9  | 41.5  | 67.3  |
| Incremental reparse, Fedora                    | 5      | 2.7   | 3.6   | 4.1   |
| Incremental reparse, `scale-1000`              | 5      | 2.7   | 3.2   | 3.9   |
| Index rebuild for one changed file, Fedora     | 30     | 5.2   | 11.9  | 14.4  |
| Intent `setAttr` on Fedora                     | 50     | 2.5   | 3.2   | 3.2   |
| Intent `renameTask`                            | 50     | 2.2   | 4.5   | 4.5   |
| Intent `addDepends`                            | 50     | 161   | 267   | 267   |
| Intent `removeDepends`                         | 50     | 152   | 160   | 160   |
| Intent `addTask`                               | 50     | 166   | 228   | 228   |
| Intent `deleteTask`                            | 50     | 169   | 227   | 227   |
| Intent `moveTask`                              | 50     | 159   | 166   | 166   |
| `format` (Fedora is already formatted: no-op)  | 50     | 4.3   | 8.1   | 8.1   |

**Finding: the structural intents are over target since the merge of feea27ed.** `addDepends`,
`removeDepends`, `addTask`, `deleteTask` and `moveTask` take 150 to 270 ms on Fedora, three to five
times the 50 ms target. Before that merge `removeDepends` took 2 ms and `addDepends` 13 ms (first
version of this audit, same test), so the slowdown comes with the T11b task verification
(`edit/task-verify.ts`, a full `buildIndex` after the edit) and the dependency anchor check
(`edit/dep-anchors.ts`, `edit/revalidate.ts`, which also builds an index with no cache). A full Fedora
index build is about 21 ms with hints and 11 ms without, so these intents spend several index builds'
worth of time. This is the grammar-specialist's area: reuse the edit's own index and the facts cache in
the verify and revalidate steps. Not fixed here. The Node test caps at ten times the target, so it
still passes. `setAttr` and `renameTask` are unaffected.

The parse, reparse, index and the first two intents are within target. On a loaded run, the Fedora incremental reparse p90 reached 9.7 ms and the index
rebuild max 78 ms: noise, but it shows the 5 ms target is not safe to enforce.

### 2.2 Browser: keystroke to paint (Event Timing), ms

| Case (3 x 60 keys)                           | p50 | p90 | max | Long tasks (over 50 ms) | Target |
| -------------------------------------------- | --- | --- | --- | ----------------------- | ------ |
| Fedora 20 open (414 tasks)                   | 24  | 32  | 32  | 0                       | 50     |
| `scale-1000` pasted in (1,000 tasks)         | 24  | 40  | 64  | 5                       | 50     |
| `scale-1000`, a key every 200 ms             | 24  | 32  | 48  | 3                       | 50     |
| Fedora 20, CPU throttled 4x (phone stand-in) | 48  | 72  | 120 | 34                      | 50     |

These are from a run after the final code, on a machine at load average 3 to 5; earlier runs of
the same specs gave p90 32 to 48 for these cases. The Fedora target (50 ms or less) is met at p90 on
desktop; the 1,000-task plan is at 40 and rides close to it. A p50 of 24 is mostly the headless
paint cadence (frames are 16.7 ms and durations come in steps of 8). A plain small plan gives the
same p50, so it is not Fedora-dependent. At 4x CPU slowdown p50 is just under the target and p90 is
about 1.5x over; see section 4.

### 2.3 The syn-20 p90 of 56 ms (T15)

Cause, found with a CPU profile and Event Timing split into input delay, processing and
presentation: handlers cost under 1 ms; the slow keys were presentation delay of 40 to 55 ms, with
long tasks of 50 to 140 ms between keys. The long tasks were `fullView` in the runner's idle task:
after every keystroke the runner rebuilt the index and re-ran the value and attribute checks
(15 to 40 ms on the 1,000-task plan), so one frequently landed between two keystrokes of a burst.

Fix (`src/lib/workspace/schedule-runner.ts`, `run-types.ts`): the idle derive now waits for a
150 ms pause in typing (`TYPING_PAUSE_MS`), then runs once in an idle task, and at the latest 1 s
after the first keystroke of a burst that never pauses (`MAX_TYPING_WAIT_MS`; the first version had
no upper bound, which the review caught). Syntax diagnostics still update on every keystroke
(`quickView`), and engine results still derive everything. Tests updated, including a burst that
never pauses.

Before and after, `scale-1000` pasted in, 100 keys per run, five runs each, interleaved, same machine
(Event Timing interaction latency, ms):

| Build  | p50 per run        | p90 per run        | max per run          | Long tasks per run |
| ------ | ------------------ | ------------------ | -------------------- | ------------------ |
| Before | 16, 24, 24, 24, 24 | 24, 32, 48, 56, 32 | 24, 56, 160, 176, 72 | 0, 5, 17, 12+, 9   |
| After  | 16, 16, 16, 16, 16 | 24, 32, 24, 32, 24 | 88, 64, 40, 56, 72   | 1, 1, 0, 1, 2      |

These runs used a scratch script (100 keys, 90 ms gaps, one run per page) before the 1 s cap existed;
the cap changes only bursts longer than a second. In them 90 ms gaps never let the 150 ms pause pass,
so the capped version refreshes once a second during such a burst.

The p50 moved from 24 to 16 in that script, but the later spec runs of the final code show 24
again, so a p50 gain is **not established**; the p90 and long-task reductions are (median p90 32 to
24, long tasks down by about 90%, and 5 or fewer in the final spec runs). Fedora did not change (24 / 24 / 24, both builds), as expected: its refresh is cheap. A second
interleaved before/after on the full spec was cut short by other sessions loading the machine to a
load average of 25; the table above is the clean one.

### 2.4 Cold load and size (desktop Chrome, localhost, no throttling), 5 cold runs

| Measure                              | Budget | p50    | p90    | max    |
| ------------------------------------ | ------ | ------ | ------ | ------ |
| First contentful paint (app shell)   | 1,500  | 180    | 212    | 212    |
| DOMContentLoaded                     |        | 29     | 73     | 73     |
| Engine leaves `booting` (engine ready) | 4,000 | 1,406  | 1,624  | 1,624  |
| First schedule shown                 |        | 2,091  | 2,687  | 2,687  |

Within budget on localhost with a warm disk cache. This is not a "fast connection" measurement: the
9 MB gzipped Ruby runtime has to download first, so the 4 s budget needs a real network run in the
Phase 4 offline work (the service worker is not in yet).

**`/app` JavaScript** (5 files, 3 of them lazy samples, plus the worker): raw 882,868 bytes, gzip
280,252 bytes (App about 781 KB raw, worker 57 KB, client 42 KB, f-20 sample 77 KB). Engine assets are not
JS: `ruby.*.wasm.gz` 9,058,728 bytes, `tj-bundle.*.json.gz` 398,514 bytes. Fonts add about 90 KB.
BUILD_PLAN has no JS size budget; Vite warns about the single 780 KB chunk (CodeMirror and the
grammar), which is a code-splitting candidate for Phase 2 or 5.

Drag feedback (16 ms), reschedule time (1 s for 200 tasks) and 60 fps with 500 tasks belong to the
Visual views (Phase 2 and later) and cannot be measured in Text mode.

### 2.5 What CI enforces

Recorded only, never failed on a budget: keystroke latency (except a cap of p50 under 100 ms, a
regression catcher), FCP (cap 15 s), engine ready (cap 60 s), all Node timings (cap: 10 times the
target at p50). Enforced exactly because it does not depend on the machine: `/app` JS gzip under
450,000 bytes (about 65% headroom over today). The Node timings run in the normal unit job
(about 3 s).

## 3. Accessibility results

Axe (wcag2a, wcag2aa, wcag21a/aa, wcag22aa) in light and dark in each state:

| State                                        | Project   | Result                     |
| -------------------------------------------- | --------- | -------------------------- |
| Desktop: text and outline                    | desktop   | clean                      |
| Desktop: a marked problem                    | desktop   | clean                      |
| Lint tooltip open                            | desktop   | violation, fixed (3.1)     |
| Completion popup open                        | desktop   | clean                      |
| Diagnostics panel open                       | desktop   | violation, fixed (3.1)     |
| Diagnostics popover (messages without a place) | desktop | clean                      |
| Tablet, drawer closed and open               | desktop 820 wide | clean               |
| Phone: Text tab, Plan tab, Docs sheet        | pixel-7   | clean                      |

### 3.1 Findings and fixes

1. **Contrast of the diagnostic source label** (WCAG 1.4.3, `color-contrast: .cm-diagnosticSource`,
   both schemes). `@codemirror/lint` draws it at 70% opacity and 70% size. Fixed in
   `src/lib/tjp/cm/theme.ts` (full strength, 85% size).
2. **The diagnostics panel ignored the app's colours.** CodeMirror's fixed greys, and for the focused
   row the system `Highlight`/`HighlightText` colours with our muted label on top (failed contrast).
   The panel now uses the tokens; its close button is at least 28 px (WCAG 2.5.8, it was text-sized).
3. **Problems were silent for screen reader users.** F8, the status strip's "next problem" button and
   arrow keys moved the cursor onto a problem, but the message existed only in the hover tooltip. A
   polite live region inside the editor (`announceProblem` in `lint.ts`, copy in `strings.ts`) now says
   "Error: This } has no matching {." once when the cursor enters a marked problem, and clears when it
   leaves. The region is keyed on the problems at the cursor (ranges and messages), joins all of them,
   and is cleared then set 30 ms later, so F8 between two problems with the same words speaks again.
   `role="status"` implies `aria-atomic`; the `aria-atomic="true"` attribute is left off only so that
   the smoke test's selector for the status strip's region still matches one element.
4. **Android Enter dropped by app dispatches** (from the T20 review; section 5).

### 3.2 Keyboard-only walkthrough, no change needed

- Tab order: skip link, sample picker, outline, file tabs, Format, Docs, editor, status strip. Tab
  leaves the editor (no trap) and Shift+Tab returns.
- Focus ring: 3 px solid outline on buttons, tabs, tree items and links; the editor shows a 2 px ring on
  `.cm-editor`. Contrast of the ring `#0b5cad` / `#6cb2f2` is above 3:1 on both surfaces.
- Outline: ARIA tree, arrow keys, Enter reveals the declaration (T15 smoke covers it).
- Diagnostics: F8 next, Mod-Shift-m panel (a labelled `listbox` "Diagnostics" with
  `aria-activedescendant`), strip button, unlocated-messages popover (Escape closes it).
- Format and Docs by keyboard; the Docs dialog moves focus to Close and returns it to the Docs button
  on Escape; the Format result is spoken through the toolbar's `role="status"`.
- Live region: the strip's hidden polite region speaks once per settled run, as T15 tested.
- Target sizes (WCAG 2.5.8, 24 px): no interactive element under 24 px on desktop or Pixel 7
  (smallest: Format 71x32, strip button 59x31).
- Reduced motion and contrast tokens were already covered by T15 and not re-measured.

### 3.3 Deferred, with reasons

- Real screen reader runs (NVDA, VoiceOver, TalkBack) were not possible here. The live-region
  behaviour is asserted in the DOM only. Needed before the Phase 6 audit.
- Lighthouse accessibility and PWA scores: Lighthouse is not installed; Phase 6 has the 95 gate.
- CodeMirror's content is a single `textbox` role; its line-level semantics for screen readers are
  CodeMirror's own and not changed.
- A coarse-pointer target size of 44 px (a best practice, not an AA criterion) is met for tabs (40 px)
  but not for Format and Docs (32 px). Left for the Phase 2 touch pass.

## 4. Residual performance risk

- At 4x CPU throttle the keystroke p90 is 104 ms on Fedora with 60 long tasks per 180 keys. The
  remaining cost is CodeMirror's own update and layout plus the workspace commit (about 12 ms in Node
  per key, 3x that on a throttled CPU). A real mid-range phone has not been measured; do it at the
  Phase 2 gate on a device.
- The engine result handler (`#handle`: index rebuild, diagnostic mapping) runs in one task of 50 to
  170 ms on `scale-1000` when typing stops; it is not between keystrokes, but a key pressed during it
  waits. It could be split or moved to idle. Not done: outside the 8.4 targets.

## 5. Android Enter dropped by dispatches (coordinator request)

CodeMirror 6.43.15 on Android Chrome (EditContext) holds Enter until the next animation frame
(`delayAndroidKey`), and a transaction dispatched before that frame drops the held key.

Changes (`src/lib/tjp/cm/lint.ts`):

- `setEngineDiagnostics` / `setLocalDiagnostics` skip a push that would draw exactly what the channel
  draws (messages, ranges and stale flag compared; the run revision ignored). A result with unchanged
  diagnostics no longer dispatches at all.
- `androidKeyPending(view)` reads `view.observer.delayedAndroidKey` (not public API; false if absent).
  While it is set, pushes are queued (newest list per channel) and retried every 16 ms, built against
  the then-current state, and dropped if the view is gone. After 30 retries (about 500 ms) the push
  goes in anyway, so a key stuck as pending cannot freeze the marks. The caller's `before` (the
  controller's `sync`) runs before a queued push. The stale-redraw timer waits the same way, with
  the same cap.
- A push is compared against the field as mapped through edits: if an edit deleted the marked text,
  the old entry is a point range, and a fresh result at that point is the same drawing (skipped);
  a stale old entry always differs from a fresh one. Covered by a unit test.
- Unit tests: `src/lib/tjp/cm/lint-push.test.ts`.
- E2E: `tests/e2e/text-mode-android-enter.spec.ts` (Pixel 7). Deterministic: `page.clock` is paused,
  Enter is pressed (the held key is asserted), the engine result arrives from the worker while the
  frame is pending, then the clock runs. The plan has engine errors, so the result turns the stale marks
  current: a real change, not a skipped empty push (the first version used a plan with no messages,
  so the guard was never exercised; the review found it passed with the guard stubbed out). Engine
  requests are held back and released by the test so that the result follows Enter however fast the
  engine is. It **fails on the base build and fails 3 of 3 with `androidKeyPending` stubbed to false,
  and passes 3 of 3 (and 4 of 4) with it**.

Residual risk:

- CodeMirror's own dispatches in that frame are not covered. In testing, `@codemirror/autocomplete`'s
  `accept` timer dispatched in the held window and dropped Enter too (reproduced with the app's push
  disabled). In real use the window is one frame (about 16 ms), against the completion's 100 ms
  typing delay, so a hit needs Enter within a frame of that timer. The hover tooltip's `activateHover`
  dispatch is the same kind (mouse only).
- The guard relies on a private field; a CodeMirror update could rename it (the e2e test would then
  fail, because it asserts the field).
- Other app dispatches: `EditorController.sync` uses `setState` and runs from workspace subscriber
  microtasks after edits made without the view (format, intents). These do not happen while the
  user is pressing Enter in text mode, but Phase 2 intents from a Visual view could. Gate them on
  `androidKeyPending` then.
- **Upstream report.** Suggest filing with CodeMirror (discuss.codemirror.net or codemirror/dev): "On
  Android Chrome with EditContext, any transaction (including one with no changes) dispatched between
  a held Enter and the next animation frame discards the Enter." In `EditorView.update`, the pending
  key is cleared and the DOM change is applied only when `doc` and `selection` are unchanged, but the
  key is lost even then in 6.43.15 (reproduction: Enter, then `view.dispatch({})` in the same frame,
  10 of 10 lost). A fix is to keep the pending key when a transaction changes neither doc nor
  selection.

## 6. Files

- Performance: `tests/e2e/text-mode-perf.spec.ts`, `tests/perf/text-mode-timings.test.ts`,
  `src/lib/workspace/schedule-runner.ts` (+ tests), `src/lib/workspace/run-types.ts`.
- Accessibility: `tests/e2e/text-mode-a11y.spec.ts`, `src/lib/tjp/cm/lint.ts`, `theme.ts`,
  `src/lib/strings.ts`, `src/lib/tjp/cm/lint-push.test.ts`, `tests/e2e/text-mode-android-enter.spec.ts`.
- Screenshots (phone emulation, Pixel 7): `docs/phases/screenshots/phase-1/a11y-phone-diagnostics-panel-light.png`
  and `-dark.png`.
