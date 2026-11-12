# Phase 1 audit: performance and accessibility of Text mode (T21)

Scope: phase-1.md 8.4 (timings), BUILD_PLAN.md "Performance budgets", WCAG 2.2 AA. Build: base
`4b37ad72` plus the T21 changes in this branch. Date: 2026-11-12.

## 1. Method and machine

- **Machine.** Shared cloud sandbox, 4 vCPU Intel Xeon 2.10 GHz, 16 GiB, Linux 6.18, Node 22,
  Chromium 1248 (Playwright 1.64.1, headless, Desktop Chrome profile 1280x720, no GPU).
  **Other agent sessions ran on the same machine**; load average was 3.5 to 25 during the work. The
  numbers below are from the quietest runs, and every before/after pair was interleaved on the same
  machine. Treat absolute values as upper bounds for a dedicated desktop; they are not a phone.
- **Node timings** (`tests/perf/text-mode-timings.test.ts`, `npm run test:unit`): 20 warm runs after
  3 warm-ups, p50/p90/max, written to `test-results/text-mode-node-timings.json`.
- **Browser timings** (`tests/e2e/text-mode-perf.spec.ts`, desktop project only): keystroke latency is
  the Event Timing interaction latency per key (longest of keydown, keypress, beforeinput, input,
  keyup, from the event timestamp to the next paint; 8 ms resolution; unreported keys, under 16 ms,
  count as 16). 3 rounds of 60 keys, 90 ms apart, each on a fresh page. Cold load: 5 fresh contexts.
  JS size: every `.js` response of `/app`, raw and gzip level 9. Output goes to
  `test-results/text-mode-perf.json` with browser, machine and load average.
- **Accessibility**: `@axe-core/playwright` with tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa
  (`tests/e2e/text-mode-a11y.spec.ts`), light and dark, plus a keyboard-only walkthrough by script
  and by hand-written probes (tab order, focus ring, target sizes, live regions).

## 2. Performance results

### 2.1 Node (spec 8.4), p50 / p90 / max in ms

| Measure                                        | Target | p50   | p90   | max   |
| ---------------------------------------------- | ------ | ----- | ----- | ----- |
| Cold parse, Fedora `f-20.tjp` (2,442 lines)    | 150    | 11.4  | 14.8  | 15.5  |
| Cold parse, `scale-1000` (5,628 lines)         | 300    | 31.8  | 47.0  | 57.8  |
| Incremental reparse, Fedora                    | 5      | 2.7   | 3.4   | 4.2   |
| Incremental reparse, `scale-1000`              | 5      | 2.7   | 3.3   | 3.9   |
| Index rebuild for one changed file, Fedora     | 30     | 5.6   | 7.9   | 10.0  |
| Intent `setAttr` on Fedora                     | 50     | 2.1   | 4.1   | 4.2   |
| Intent `renameTask`                            | 50     | 1.8   | 1.9   | 2.7   |
| Intent `addDepends` (includes the cycle check) | 50     | 12.8  | 14.6  | 16.5  |
| Intent `removeDepends`                         | 50     | 2.1   | 3.1   | 3.3   |
| `format` (Fedora is already formatted: no-op)  | 50     | 3.9   | 5.5   | 5.9   |

All within target. On a loaded run, the Fedora incremental reparse p90 reached 9.7 ms and the index
rebuild max 78 ms: noise, but it shows the 5 ms target is not safe to enforce. `addTask`,
`deleteTask` and `moveTask` have no handler on this base, so they are not measured (re-run when T11b
lands; the test needs one more entry each).

### 2.2 Browser: keystroke to paint (Event Timing), ms

| Case (3 x 60 keys)                           | p50 | p90 | max | Long tasks (over 50 ms) | Target |
| -------------------------------------------- | --- | --- | --- | ----------------------- | ------ |
| Fedora 20 open (414 tasks)                   | 24  | 32  | 56  | 0                       | 50     |
| `scale-1000` pasted in (1,000 tasks)         | 24  | 32  | 48  | 2                       | 50     |
| Fedora 20, CPU throttled 4x (phone stand-in) | 48  | 104 | 168 | 60                      | 50     |

The Fedora target (50 ms or less) is met at p90 on desktop. A p50 of 24 is mostly the headless
paint cadence (frames are 16.7 ms and durations come in steps of 8). A plain small plan gives the
same p50, so it is not Fedora-dependent. At 4x CPU slowdown p50 is just under the target but p90 is
about 2x over; see section 4.

### 2.3 The syn-20 p90 of 56 ms (T15)

Cause, found with a CPU profile and Event Timing split into input delay, processing and
presentation: handlers cost under 1 ms; the slow keys were presentation delay of 40 to 55 ms, with
long tasks of 50 to 140 ms between keys. The long tasks were `fullView` in the runner's idle task:
after every keystroke the runner rebuilt the index and re-ran the value and attribute checks
(15 to 40 ms on the 1,000-task plan), so one frequently landed between two keystrokes of a burst.

Fix (`src/lib/workspace/schedule-runner.ts`, `run-types.ts`): the idle derive now waits for a
150 ms pause in typing (`TYPING_PAUSE_MS`), then runs once in an idle task. Syntax diagnostics still
update on every keystroke (`quickView`), and engine results still derive everything. Tests updated.

Before and after, `scale-1000` pasted in, 100 keys per run, five runs each, interleaved, same machine
(Event Timing interaction latency, ms):

| Build  | p90 per run        | max per run           | Long tasks per run |
| ------ | ------------------ | --------------------- | ------------------ |
| Before | 24, 32, 48, 56, 32 | 24, 56, 160, 176, 72  | 0, 5, 17, 17, 9    |
| After  | 24, 32, 24, 32, 24 | 88, 64, 40, 56, 72 | 1, 1, 0, 1, 2 |

p50 went from 24 to 16 in the interleaved runs, the median p90 from 32 to 24 and the number of long tasks fell by about
90%. Fedora did not change (24 / 24 / 24, both builds), as expected: its refresh is cheap. A second
interleaved before/after on the full spec was cut short by other sessions loading the machine to a
load average of 25; the table above is the clean one.

### 2.4 Cold load and size (desktop Chrome, localhost, no throttling), 5 cold runs

| Measure                              | Budget | p50    | p90    | max    |
| ------------------------------------ | ------ | ------ | ------ | ------ |
| First contentful paint (app shell)   | 1,500  | 252    | 268    | 268    |
| DOMContentLoaded                     |        | 56     | 73     | 73     |
| Engine leaves `booting` (engine ready) | 4,000 | 2,186  | 2,268  | 2,268  |
| First schedule shown                 |        | 3,255  | 3,355  | 3,355  |

Within budget on localhost with a warm disk cache. This is not a "fast connection" measurement: the
9 MB gzipped Ruby runtime has to download first, so the 4 s budget needs a real network run in the
Phase 4 offline work (the service worker is not in yet).

**`/app` JavaScript** (5 files, 3 of them lazy samples, plus the worker): raw 857,222 bytes, gzip
272,252 bytes (App 756 KB raw, worker 57 KB, client 42 KB, f-20 sample 77 KB). Engine assets are not
JS: `ruby.*.wasm.gz` 9,058,728 bytes, `tj-bundle.*.json.gz` 398,514 bytes. Fonts add about 90 KB.
BUILD_PLAN has no JS size budget; Vite warns about the single 756 KB chunk (CodeMirror and the
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
   leaves. It is not `aria-atomic`, so it does not collide with the status strip's own region.
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
  the then-current state, and dropped if the view is gone. The stale-redraw timer does the same.
- Unit tests: `src/lib/tjp/cm/lint-push.test.ts`.
- E2E: `tests/e2e/text-mode-android-enter.spec.ts` (Pixel 7). Deterministic: `page.clock` is paused,
  Enter is pressed (the held key is asserted), the engine result arrives from the worker while the
  frame is pending, then the clock runs. It **fails on the base build (line count unchanged) and
  passes with the fix**.

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
