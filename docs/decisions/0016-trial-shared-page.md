# ADR-0016 change 4, trial: one booted page per worker for read-only specs

Result: **dropped.** It saved 41% to 54%, but state leaked between tests, which the trial's own
isolation assertion caught. Recorded 2026-11-18; the trial code was removed from the tree (it is in
the history of branch `claude/new-session-6tly46` only as far as the commit that deleted it).

## What was tried

A worker-scoped fixture booted the app once. Each test then loaded its plan through the app's own
sample chooser (`Sample plan`), which keeps the engine worker, instead of `page.goto`. Before each
test: Escape, viewport and colour scheme back to the project's, `localStorage` and `sessionStorage`
emptied, and a switch away and back when the same plan was asked for again. Opening the plan then
asserted that the text equals the sample's file and that no preference or toast was left.

Three read-only specs were copied test by test, with the same bodies and assertions (so the A/B
differs only in how the plan is opened): five tests of `gantt-read-only` (tutorial), three of
`gantt-treegrid` (tutorial) and two of `gantt-critical` (tutorial, `ui-multifile`), plus a pair that
proves isolation: one test changes the zoom, the selection and a collapsed row, the next one must
start from the sample.

## Result (local, two workers, Chromium, 12 tests per run)

| Project | One page per test | Shared page | Saved |
| --- | --- | --- | --- |
| desktop | 123 s of worker time (wall 169 s) | 73 s (wall 89 s) | 41% (wall 47%) |
| pixel-7 | 106 s (wall 139 s) | 49 s (wall 70 s) | 54% (wall 50%) |

The saving is real: it is the ruby.wasm start-up (about 5 to 8 s a test) that is not paid again.

## Why it is not adopted

The isolation test failed on both projects: `starts clean after it` found the Gantt at `quarter`
zoom after the previous test set it. The zoom, and with it other view state held in memory by the
Svelte components (focus, scroll, expanded rows), survives a plan switch. Clearing `localStorage`
does not reach it. The only reliable reset is a reload, which pays the boot again. Making the app
reset every view's state on a plan switch would be a change in `src/components`, outside this task,
and a bug-for-bug risk for every spec that would share a page.

A shared page also makes a failing test hard to reproduce alone, and a retry (CI retries once)
would run on a page the failure may have damaged.

## If it is tried again

Do it after the app resets all view state on a plan switch (a contract test beside the shell), keep
the isolation pair as a permanent spec, and share a page only inside one spec file.
