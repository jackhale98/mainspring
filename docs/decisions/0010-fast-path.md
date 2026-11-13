# ADR-0010: Parse-skipping fast path (draft)

Status: draft by `engine-specialist` (T19), for the main session to format and put to the user.
Source: `docs/phases/phase-2.md` section 12, 18.12 and 6.12. Code on branch `t19-fast-path`:
`engine/bridge/fast_path.rb`, the `retain` and `fast` request fields in `src/engine/protocol.ts`,
and the tests `tests/engine/fast-path.*`.

## Context

A full run parses the workspace and then schedules it. In the browser engine the parse is a large
part of a run: on gantt-200, 800 to 1,050 ms of a 1.7 to 2.2 s run, and on Tutorial, 550 to
800 ms of 650 to 950 ms. Most Gantt drops change one value in place: R1 rewrites an `effort` or
`length`, R2 a `start`, R9 a `complete`. Section 12 asks whether the worker can keep a run's
parsed, unscheduled project, apply such a rewrite to it and schedule it, with results identical
to a full reparse and clearly faster.

Adoption criteria (18.12), all required:

- zero differences;
- a median engine time saving of at least 30% on Fedora 20 and gantt-200;
- no change to golden parity;
- the bundle size growth recorded.

## What the spike built

1. **Keeping a parse.** TaskJuggler cannot schedule a `Project` twice: `Project#schedule` writes
   computed values into the same attributes (`AttributeBase` mode 2). So the worker keeps a copy.
   - A full run sent with `retain: true` takes a `Marshal` dump of its project right after the
     parse, before scheduling.
   - Marshal handles the whole graph except the default procs of `PropertyTreeNode`'s attribute
     hashes. The bridge takes those procs off for the dump. After each load it installs them
     again, bound to the copy (the same code as `PropertyTreeNode.rb:58-85`).
   - The base run's parse messages, the version and timezone captures, and TjTime's zone after
     the parse are kept with the dump.
   - Projects with shift assignments cannot be copied: `ShiftAssignments` is a `Monitor`, which
     Marshal cannot dump, and it shares scoreboards through a class-level cache. Such a run is not
     kept (`retainError`), and later fast requests run in full.
2. **Applying a rewrite.** For each edit, the bridge marks the attributes that the keyword's
   pattern sets as not provided. Then it parses `supplement task <id> { <keyword> <value> }` into
   the copy with TaskJuggler's own parser.
   - This runs the keyword's grammar action with its parse-time side effects. Examples:
     `setDurationAttribute` resetting the other criteria, `start` and `end` setting the direction,
     and the range checks.
   - Marking the attributes not provided first is what avoids the `attr_overwrite` warning and
     the `multiple_durations` error.
   - Any message during the apply makes the request run in full. An example is `complete 150`,
     which gives `task_complete`.
3. **Scheduling the copy.** The bridge restores TjTime's zone (`TaskJuggler.new` resets it to
   UTC), schedules and serializes. The messages are the base parse's plus the schedule's.
4. **Falling back.** Anything the bridge cannot vouch for runs in full, with the same result, and
   `Timings.fastFallback` says why. The bridge checks:
   - it holds the base, and the entry, the file set and `options.now` are unchanged;
   - when the plan took `now` from the clock, the clock's hour is unchanged;
   - every file has the same line count, and only the named lines differ, each an in-place
     `<keyword> <value>` statement before and after;
   - the keyword is `effort`, `length`, `duration`, `start`, `end`, `priority` or `complete`,
     for the top scenario only;
   - the task exists;
   - no attribute the pattern sets is inherited by children while the task has any (of these,
     only `priority`; `start` and `end` are not copied to children);
   - no other scenario provides the attribute;
   - for `start` and `end`, the task's direction is already the one the pattern sets;
   - the base parse gave no message on an edited line.

   The main thread adds the checks only the index can make: the statement is the task's own,
   alone on its line, with no macro in the line or the task body, and the task is not text-only
   or macro-built. The test helper `eligibleSites` in `tests/engine/fast-path-cases.ts` is that
   check.

Protocol, refining 6.12:

- `ScheduleRequest.retain?: boolean` asks the worker to keep the run's parse. The worker keeps
  one base; only the next run with `retain` replaces it.
- `ScheduleRequest.fast?: { base, edits }`. Each edit is `{ task, attribute, scenario: null,
  value, file, line }`. The spec had no `file` and `line`; the bridge needs them to check the
  text diff itself.
- New `Timings` fields: `path`, `retainMs`, `retainBytes`, `retainError`, `cloneMs`, `applyMs`
  and `fastFallback`. `files` always carries the full text.

## Equivalence (tests/engine/fast-path.equivalence.test.ts)

Run with `FAST_PATH=1 FAST_PATH_RUNS=500` (seed 20261113): 40 golden plans and 500 generated
plans. 14 of these plans have no eligible statement (macro-built or text-only tasks, no
value statements).

| | Cases | Fast | Ran in full | Differences |
| --- | ---: | ---: | ---: | ---: |
| Golden and generated plans, one rewrite per patch and multi-rewrite patches | 1,136 | 1,118 | 18 | **0** |
| Shuffled replay through one engine, with unrelated runs and bases between (2 fast runs per case) | 97 | 194 | 0 | **0** |

Why the 18 ran in full:

| Reason | Count |
| --- | ---: |
| The project has shift assignments, which cannot be copied | 10 |
| The base parse had errors, so nothing was kept | 4 |
| The new date is outside the project (`date_in_range`, from the keyword's own rule) | 2 |
| `start` or `end` would change the task's direction | 2 |

Each result is compared as canonical JSON, `revision` and `timings` aside: tasks, resources,
bookings, the project header and the messages with their lines. The suite took 998 s on this
machine (`test-results/fast-path-equivalence.json`).

Bugs the suite found and the spike fixed:

- **Time zones.** The copy was scheduled in UTC: `TaskJuggler.new` resets TjTime's zone, and the
  zone is global state that only the parse sets. This gave differences on `syn-09-tz-dst-berlin`
  and `syn-21-tz-dst-edges-newyork`, and none after the fix.
- **Shifts.** `ShiftAssignments` cannot be copied; such plans now run in full.

`tests/engine/fast-path.guards.test.ts` checks each fallback reason on small plans, 18 cases.
Each takes the expected path, names the expected reason and gives the full run's result.

## Timings (tests/engine/fast-path.timings.test.ts)

In the real engine (the built wasm bundle booted in Node, `bootNodeEngine`). Each figure is the
median of 5 rounds after one warm-up round, and every fast run equalled the full run of the same
text. The rewrite is the plan's first `effort` or `length`, rewritten to `3d`. Two complete runs
on a machine with load 1.4 to 2.

| Plan | Full run (ms) | of which parse | Fast run (ms) | of which copy (clone) | Saved | Keeping the parse: extra time on a full run | Copy size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fedora 20 (414 tasks) | 3,429 / 3,037 | 1,651 / 1,548 | 1,907 / 1,711 | 208 / 180 | **44.4% / 43.7%** | 244 / 189 | 1,389 KB |
| gantt-200 | 2,010 / 1,770 | 852 / 795 | 1,265 / 1,032 | 51 / 44 | **37.1% / 41.7%** | 43 / 45 | 358 KB |
| gantt-500 | 4,249 / 3,949 | 1,657 / 1,715 | 2,370 / 2,302 | 96 / 95 | 44.2% / 41.7% | 138 / 193 | 821 KB |
| scale-1000 (1,225 tasks) | 8,093 / 9,164 | 3,566 / 4,105 | 5,596 / 6,208 | 277 / 279 | 30.9% / 32.3% | 294 / 409 | 2,031 KB |
| Tutorial | 676 (alone) | 504 | 144 | 20 | 78.7% (89% in the full runs) | 29 | 158 KB |

- **Applying the rewrite** costs 1 to 2.4 ms.
- **Scheduling** is the same work on both paths: the fast run saves the parse, minus the copy.
- **Tutorial's** full-run parse measured 1.6 to 2.0 s in the complete runs, where it ran last,
  and about 0.5 s when timed alone. I checked whether kept copies slow later parses: after eight
  scale-1000 runs, Tutorial parses in 0.53 to 0.67 s with or without them. The row uses the run
  timed alone.
- **The bar** (at least 30% on Fedora 20 and gantt-200) is met on both runs. scale-1000, which
  is not part of the bar, also clears 30%.

## Decision

**Adopt the fast path, subject to the user's decision.** Every criterion of 18.12 holds:

1. Zero differences in 1,136 cases and 194 shuffled fast runs.
2. A median saving of 43.7% to 44.4% on Fedora 20 and 37.1% to 41.7% on gantt-200, against a bar
   of 30%.
3. Golden parity is unchanged: golden runs never send `retain` or `fast`, and `npm run
   test:golden` passes on this branch (4 of 4, every golden plan in one long-lived worker, shuffled).
4. Bundle growth: +5,126 bytes gzip (406,125 against 400,999), +17,795 bytes raw.

Scope of adoption:

- **Rewrites:** in-place rewrites of `effort`, `length`, `duration`, `start`, `end`, `priority`
  and `complete` in the top scenario.
- **When it runs:** for single intents and their undo or redo, as section 12 says. Typing never
  uses it.
- **When it runs in full:** whenever the bridge cannot vouch for the patch.
- **Integration:** wiring it into the runner comes after T8 (merged), as described below, with
  its own review.

## Consequences and the runner integration (not wired in this spike; T8 is now merged)

- **When the runner keeps a parse.** It sends `retain: true` on runs whose origin is 'intent' or
  'history': visual editing, where the next change is likely another value rewrite. Typing never
  retains and never sends `fast` (6.12, section 12 step 5).
- **When it sends `fast`.** For an intent whose text differs from the kept base's text only by
  eligible rewrites. The dispatcher (T13) knows the intent and the edit API's change; the main
  thread checks it with the index, as `eligibleSites` does; and the runner tracks the base's
  revision and workspace version.
  - The edits are cumulative relative to the base: every eligible rewrite since the base run,
    one per line, the latest value of each.
  - The undo or redo of such an edit qualifies the same way.
  - The request still carries the full text and also sets `retain: true`, so a fallback re-bases.
- **Results.** A fast result is an ordinary `ScheduleResult`. The runner shows it like any other.
  `latest.workspaceVersion` settles the edit as before.
- **Costs.**
  - A retaining full run pays `retainMs` (see Timings).
  - The worker holds one copy (`retainBytes`: about 1.4 MB for Fedora).
  - The bundle grows by 5,126 bytes gzip (406,125 against 400,999; 17,795 bytes raw).
- **Coupling to TaskJuggler internals.** The bridge relies on:
  - the attribute-hash default procs, whose code it copies;
  - the `@provided` flag;
  - the parser's `@project`;
  - TjTime's class-level zone.

  All are pinned at commit `3b36c79`. Any TaskJuggler update must rerun the equivalence suite.
  The Marshal blob never leaves the worker's VM.
- **CI.**
  - The equivalence suite and the guards run in the fidelity job with `FAST_PATH=1`: 500
    generated plans per push, 5,000 nightly (`FAST_PATH_RUNS`).
  - Golden runs never send `retain` or `fast`, so golden parity covers only the unchanged full
    path.
- **Not covered.** Rewrites in other scenarios, criterion changes (`effort` to `length`), plans
  with shifts, and statements on shared or macro lines all run in full.
