# ADR-0010: Parse-skipping fast path (draft)

Status: draft by `engine-specialist` (T19), revised after the T19 review ("adopt after fixes",
2026-11-13), for the main session to format and put to the user.
Source: `docs/phases/phase-2.md` section 12, 18.12 and 6.12. Code on branch `t19-fast-path`:
`engine/bridge/fast_path.rb`, `fast_path_sites.rb` and `fast_path_procs.rb`, the `retain` and
`fast` request fields in `src/engine/protocol.ts`, the main thread's half in
`src/lib/workspace/fast-patch.ts`, and the tests `tests/engine/fast-path.*`.

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
     again, bound to the copy (`fast_path_procs.rb`, a near-copy of `PropertyTreeNode.rb:58-85`).
   - The base run's parse messages are kept as plain data (type, id, text, file and line,
     scenario id), not as TaskJuggler `Message` objects, which hold the run's live project. The
     version and timezone captures and TjTime's zone after the parse are kept with the dump.
   - Projects with shift assignments cannot be copied: `ShiftAssignments` is a `Monitor`, which
     Marshal cannot dump, and it shares scoreboards through a class-level cache. Such a run is not
     kept (`retainError`), and later fast requests run in full.
2. **Noting where each statement ran.** While a retaining run parses, the bridge records, for
   every action of a keyword the fast path rewrites (and `milestone`, which shares the duration
   family), the file and line of its keyword token, the task it ran on, the keyword, the
   scenario and its place in parse order (`fast_path_sites.rb`). It does this by wrapping the
   patterns of TaskJuggler's `:taskScenarioAttributes` rule on each `ProjectFileParser` it opens,
   from the bridge (a prepended `open`). `engine/tj` is unchanged, and runs without `retain` note
   nothing. This is how the bridge knows, from its own parse, which task and keyword a line
   belongs to, instead of taking the main thread's word for it.
3. **Applying a rewrite.** For each edit, the bridge marks the attributes that the keyword's
   pattern sets as not provided. Then it parses `supplement task <id> { <keyword> <value> }` into
   the copy with TaskJuggler's own parser.
   - This runs the keyword's grammar action with its parse-time side effects. Examples:
     `setDurationAttribute` resetting the other criteria, `start` and `end` setting the direction,
     and the range checks.
   - Marking the attributes not provided first is what avoids the `attr_overwrite` warning and
     the `multiple_durations` error.
   - Any message during the apply makes the request run in full. An example is `complete 150`,
     which gives `task_complete`.
4. **Scheduling the copy.** The bridge restores TjTime's zone (`TaskJuggler.new` resets it to
   UTC), schedules and serializes. The messages are the base parse's plus the schedule's.
5. **Falling back.** Anything the bridge cannot vouch for runs in full, with the same result, and
   `Timings.fastFallback` says why.

### What the bridge checks, whatever the main thread sent

The edits are what a wrong or hostile main thread could send, so the bridge alone must catch a
bad one. In order:

- it holds the base, and the entry, the file set and `options.now` are unchanged; when the plan
  took `now` from the clock, the clock's hour is unchanged;
- each edit is well formed: the keyword is `effort`, `length`, `duration`, `start`, `end`,
  `priority` or `complete`, for the top scenario only, and the value is strictly a value of that
  keyword (one token: a duration, a date with optional time and zone, an integer priority, a
  number for completion; no space, brace, `#`, `$` or quote can get in);
- every file has the same line count, and only the named lines differ, each a lone
  `<keyword> <value>` statement before and after, with an optional comment;
- the edited line ran exactly one noted action in the kept parse: of that keyword, on that task,
  in the top scenario (so not a line in a comment, a report, a macro body used twice, a file
  included twice, or another task's line);
- no later action of the same family ran on that task (a later `start`, or a `length` after the
  `effort`, would win in a full run);
- the base parse gave no message on an edited line;
- the task exists; no attribute the pattern sets is inherited by children while the task has any
  (of these, only `priority`; `start` and `end` are not copied to children);
- no other scenario provides the attribute;
- for `start` and `end`: the direction (`forward`) is already the one the pattern sets, **in
  every scenario**. The pattern sets it in the top scenario and copies it to the derived ones,
  so a `late:end`, `late:scheduling alap` or `late:depends` read after the statement would be
  undone otherwise. Direction is positional (the statement read last wins), so a rewrite that
  would change it in any scenario runs in full.

### The main thread's half (`src/lib/workspace/fast-patch.ts`)

`fastSites` lists the statements a fast patch may rewrite, and `fastEditsOf` turns a change (an
intent's edit, or its undo or redo) into `FastEdit`s, or null. A site is a task's own `effort`,
`length`, `duration`, `start`, `end`, `priority` or `complete` statement for the top scenario,
alone on its line, with a strict value, when the task is not text-only or macro-built, has no
statement-level macro call in its bodies, its declaration gives no other task in another include
visit, the file is not included twice, it is the task's only statement of that family in any
scenario, and, for `priority`, the task is a leaf. This is the cheap first filter; the bridge's
checks above are the safety net. Unit tests in `fast-patch.test.ts`.

### Protocol, refining 6.12

- `ScheduleRequest.retain?: boolean` asks the worker to keep the run's parse. The worker keeps
  one base; only the next run with `retain` replaces it.
- `ScheduleRequest.fast?: { base, edits }`. Each edit is `{ task, attribute, scenario: null,
  value, file, line }`. The spec had no `file` and `line`; the bridge needs them to check the
  text diff and its own parse.
- New `Timings` fields: `path`, `retainMs`, `retainBytes`, `retainError`, `cloneMs`, `applyMs`
  and `fastFallback`. `files` always carries the full text.

## The review and what changed

| Finding | Fix | Test |
| --- | --- | --- |
| H1: a `start` or `end` rewrite reset the direction in derived scenarios (`test:end`, `late:depends`, `late:scheduling` read later) and ran fast with a different result | The direction check covers every scenario | 4 review repros; 4 guards; the direction family in the equivalence suite (below) |
| M1: the bridge took the main thread's word for which task and keyword a line belongs to (wrong task id, block comment, macro body used by two tasks, report `start`, file included twice, a value carrying more statements) | Sites noted during the retaining parse; one action per line, that task and keyword, top scenario, no later one of the family; strict values | 7 review repros, guards |
| M2: the eligibility rule lived in a test helper | `src/lib/workspace/fast-patch.ts`, which the suites now use; lines that give more than one task are excluded | `fast-patch.test.ts` |
| M3: CI ran too much per push and did not say exactly what | See CI below | |
| L1: the default-proc near-copy was in a GPL-2.0-or-later file | `fast_path_procs.rb`, GPL-2.0-only with a header naming the source (ADR-0001 addendum), listed as such in the bundle notice | |
| L2: timings from one machine only | The review's figures beside mine, below | |
| L3: kept `Message` objects held the base run's live project | Kept as plain data | guards, equivalence |
| L4: after a `retainError` the runner would keep asking | Integration plan below | |
| L5: no unit tests for the runtime's request and timings | `bridgeRequest` and `fastTimings` in `runtime.ts`, tested in `runtime.test.ts` | |

The review's repros are `tests/engine/fast-path.adversarial.test.ts` (15 cases: 11 that must run
in full for the named reason, 4 that must still run fast; all equal a full run). With the old
direction check (top scenario only) put back for a test, 4 of them fail and the direction family
finds 32 differences in 40 plans; with the fix, none.

## Equivalence (tests/engine/fast-path.equivalence.test.ts)

Run after the review fixes with `FAST_PATH=1 FAST_PATH_RUNS=500 FAST_PATH_DIRECTION_RUNS=100`,
at the old seed and a new one: 40 golden plans (6 rewrites each plus a patch of three), 500
generated plans and 100 direction plans, then the shuffled replay.

| Seed | Cases | Fast | Ran in full | Differences | Shuffled replay (2 fast runs per case) | Wall time |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| 20261113 | 1,887 | 1,695 | 192 | **0** | 97 cases, 194 fast runs, **0** differences | 1,895 s |
| 20261114 (new) | 1,942 | 1,754 | 188 | **0** | 97 cases, 194 fast runs, **0** differences | 1,837 s |

Why they ran in full (20261113 / 20261114):

| Reason | Count |
| --- | ---: |
| `start` or `end` would change the direction in some scenario (at seed 20261113, 115 of the 117 come from the direction family) | 117 / 125 |
| A later statement of the same family on that task (a second `start`, a `late:start` after the `start`, and the like) | 29 / 23 |
| The base parse gave a message on the edited line (for example `task_overspecified` warnings) | 23 / 18 |
| The project has shift assignments, which cannot be copied | 10 / 10 |
| The new date is outside the project (`date_in_range`, from the keyword's own rule) | 9 / 8 |
| The base parse had errors, so nothing was kept | 4 / 4 |

Plans with no rewritable statement: 14 / 8 (macro-built or text-only tasks, no value
statements). The wall times are on a 4-core machine shared with other work (load 6 to 22).

Each result is compared as canonical JSON, `revision` and `timings` aside: tasks, resources,
bookings, the project header and the messages with their lines.

The direction family (`directionPlan` in `tests/engine/fast-path-cases.ts`) is plans with
scenarios `plan` and `late`, whose tasks combine `start` or `end` with `late:depends`,
`late:scheduling alap` or `asap`, `late:end`, `late:start`, `late:precedes`, `depends`,
`precedes` or `scheduling`, before or after it. Every top-scenario `start` and `end` line is
rewritten whether or not `fast-patch.ts` would offer it, so the bridge's checks alone decide, and
the sites the main thread offers are rewritten too.

Bugs the suite found and the spike fixed earlier: TjTime's zone (`TaskJuggler.new` resets it;
differences on the DST plans before the fix) and shift assignments (cannot be copied; now run in
full).

`tests/engine/fast-path.guards.test.ts` checks each fallback reason on small plans, 22 cases,
four of them `start` and `end` against a derived scenario's direction (two must run in full, two
must stay fast). Each takes the expected path, names the expected reason and gives the full
run's result.

## Timings (tests/engine/fast-path.timings.test.ts)

In the real engine (the built wasm bundle booted in Node, `bootNodeEngine`). Each figure is the
median of 5 rounds after one warm-up round; every fast run took the fast path and equalled the
full run of the same text. The rewrite is the plan's first `effort` or `length` site, given a new
value. Each round runs, interleaved, the full run of the rewritten text, the retaining run of the
text before it, and the fast run.

The engine time saved by the fast run, from every run so far (4-core machines; the load is the
1-minute load average during the run):

| Plan | Draft (my machine, load 1.4 to 2, two runs) | Review (load about 3) | After the fixes (my machine, load 6 to 11) | Range |
| --- | ---: | ---: | ---: | ---: |
| Fedora 20 (414 tasks) | 44.4% / 43.7% | 37.3% | 39.4% | **37 to 44%** |
| gantt-200 | 37.1% / 41.7% | 34.6% | 41.6% | **35 to 42%** |
| gantt-500 | 44.2% / 41.7% | 34.8% | 38.3% | 35 to 44% |
| scale-1000 (1,225 tasks) | 30.9% / 32.3% | not run | 27.1% | 27 to 32% |
| Tutorial | 78.7% (timed alone) | not run | 91.4% (see below) | |

The run after the fixes, in detail (ms):

| Plan | Full run | of which parse | of which schedule | Fast run | of which copy | of which schedule | Retaining full run | of which `retainMs` | Copy size |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fedora 20 | 3,003 | 1,428 | 1,503 | 1,820 | 166 | 1,552 | 3,290 | 214 | 1,389 KB |
| gantt-200 | 1,962 | 847 | 1,014 | 1,145 | 49 | 933 | 2,048 | 57 | 358 KB |
| gantt-500 | 4,381 | 1,553 | 2,608 | 2,705 | 108 | 2,340 | 4,416 | 143 | 821 KB |
| scale-1000 | 9,677 | 3,285 | 5,845 | 7,056 | 398 | 5,972 | 8,950 | 405 | 2,031 KB |
| Tutorial | 3,207 | 3,098 | 98 | 274 | 22 | 206 | 2,546 | 76 | 158 KB |

- **Fedora, before and after:** a full run takes 3,003 ms of engine time and the fast run of the
  same rewrite 1,820 ms (39.4% saved); in the draft, 3,429 / 3,037 ms against 1,907 / 1,711 ms.
- **The spread is load.** A second run after the fixes, at load 10 to 26 (median 18) on the
  same 4 cores, gave Fedora 10.5 s full against 4.8 s fast and gantt-200 4.9 s against 4.1 s,
  with schedule steps varying by up to half between paths: too noisy to use, and left out of
  the tables. The bar should be read against the lowest figures, the review's.
- **The schedule step of a fast run may be a few percent slower.** The review measured it 4.5 to 7%
  slower than the full run's at load about 3. In the run above it was within noise (-10% to +3%
  on the four large plans). The cause is not established; the copy's objects are laid out in
  load order and the worker's heap also holds the kept dump. The savings above are net of it.
- **Applying the rewrite** costs 1.4 to 1.7 ms.
- **Keeping the parse** costs `retainMs` on a retaining full run (57 to 405 ms, 214 ms on
  Fedora). Noting the sites while it parses (new after the review) is below what these runs can
  resolve: the retaining run minus the full run minus `retainMs` is +73 ms on Fedora and
  negative on the others.
- **Tutorial's** full-run parse measures 1.6 to 3.1 s in the complete runs, where it runs last,
  and about 0.5 s when timed alone (draft); kept copies do not slow later parses (checked in the
  draft after eight scale-1000 runs). Its percentage is not meaningful; it is not part of the bar.
- **scale-1000**, not part of the bar, falls just under 30% in the run after the fixes.

## Decision

**Adopt the fast path, subject to the user's decision.** Every criterion of 18.12 holds:

1. Zero differences: 3,829 cases at two seeds (1,887 and 1,942; at seed 20261113, 1,136 on
   golden and generated plans, as in the draft, and 751 on the direction family) and 388
   shuffled fast runs, plus the 15 review repros and 22 guards.
2. A median saving of 37 to 44% on Fedora 20 and 35 to 42% on gantt-200 over every run so far,
   against a bar of 30%. The lowest figures are the review's (37.3% and 34.6%).
3. Golden parity is unchanged: golden runs never send `retain` or `fast`. On the branch after the
   fixes, `npm run test:golden` passes (4 of 4, every golden plan in one long-lived worker,
   shuffled), `npm run golden:wasm` matches 40 of 40 plans and 71 of 71 time-zone edge cases, and
   native `tj3` reproduces all 40 committed goldens (`record-native.mjs --verify --allow-ruby`,
   Ruby 3.3.6: the goldens are provisional, ADR-0003).
4. Bundle growth: +7,507 bytes gzip (408,506 against 400,999), +26,106 bytes raw.

Scope of adoption:

- **Rewrites:** in-place rewrites of `effort`, `length`, `duration`, `start`, `end`, `priority`
  and `complete` in the top scenario.
- **When it runs:** for single intents and their undo or redo, as section 12 says. Typing never
  uses it.
- **When it runs in full:** whenever the bridge cannot vouch for the patch.
- **Never stale.** A fast result is the full run's result by construction (the checks above,
  and the suites that hold the two equal), so the app never presents it as provisional or
  stale, and never reschedules in full behind it to confirm it.
- **Integration:** wiring it into the runner is a separate task with its own review, as
  described below.

## Engine info: which path a run took (user decision, 2026-11-13)

- The T24 engine popover shows whether the last run took the fast or the full path, and, for a
  fast request that ran in full, the reason (`Timings.fastFallback`, for example "the direction
  would change"). A run that asked to keep its parse and could not shows `retainError` the same
  way.
- A **Run full schedule** button forces a full run: the runner sends the current text with no
  `fast` and no `retain`, forgets its base (so later intents re-base with `retain` first), and
  the popover shows that run's result and timings like any other.

## Runner integration plan (not wired; T8 is merged)

- **When the runner keeps a parse.** It sends `retain: true` on runs whose origin is 'intent' or
  'history': visual editing, where the next change is likely another value rewrite. Typing never
  retains and never sends `fast` (6.12, section 12 step 5).
- **The edit sites, from the dispatcher (T13).** The dispatcher knows the intent and the edit
  API's change; the runner knows the base. The channel between them, to be added with the
  wiring:
  - With each intent, undo or redo it hands to the workspace, the dispatcher passes the runner
    `{ workspaceVersion, edits: FastEdit[] | null }`: the result of `fastEditsOf(before, index,
    changes)`, computed on the snapshot and index the intent was applied to. `null` means "not
    a fast change" (any change it cannot express as in-place site rewrites).
  - Typing, file operations and anything else that changes the text without that call carry no
    edits, which the runner treats as `null`.
  - The runner never computes sites itself and never reads the edit API's internals.
- **When it sends `fast`.** When every change since the base run carried edits: the request
  carries the base's revision and the edits accumulated since the base, one per file and line,
  the latest value of each. A single `null` change ends the accumulation until the next base.
  The request still carries the full text and `retain: true`, so a fallback re-bases.
- **Keeping its base current.** From each result's timings: a run that asked to retain and has
  `retainMs` (and no `retainError`) is the new base, at its revision and workspace version, with
  no edits accumulated; `path: 'fast'` leaves the base as it was (the kept parse is not changed
  by a fast run), with the edits still accumulated relative to it; `path: 'full'` from a fast
  request re-based only if its `retainMs` says so.
- **After a `retainError`.** The plan cannot be kept (shift assignments today). The runner
  stops sending `retain` and `fast` until the plan changes in a way that could remove the cause:
  any change that carried `null` edits (typing, a structural intent, a file operation). In-place
  value rewrites cannot add or remove shifts, so they do not re-arm it.
- **R1 on an ALAP task with both `start` and `end`.** R1 rewrites `start` there (phase-2.md 9,
  R1). The `start` pattern makes a task ASAP, so the bridge's direction check always sends this
  case to a full run ("the direction would change"). This is by design: TaskJuggler's direction
  is positional, and a supplement statement is read last. R2 on such a task rewrites `end`,
  which keeps the direction and can run fast.
- **Results.** A fast result is an ordinary `ScheduleResult`. The runner shows it like any other.
  `latest.workspaceVersion` settles the edit as before.

## Costs

- **A retaining full run** pays `retainMs` for the copy, plus noting the sites while it parses
  (see Timings).
- **Memory.** The worker holds one copy (`retainBytes`: about 1.4 MB for Fedora, 2 MB for
  scale-1000).
- **Bundle.** +7,507 bytes gzip (408,506 against 400,999 for the base branch's bundle, built the
  same way), +26,106 bytes raw; the draft added 5,126 bytes gzip, and the site recorder and the
  stricter checks are the difference.
- **The schedule step of a fast run may be a few percent slower** than a full run's (see
  Timings); the saving is net of it.
- **Coupling to TaskJuggler internals.** The bridge relies on:
  - the attribute-hash default procs, whose code it copies;
  - the `@provided` flag;
  - the parser's `@project`, `@property`, `@scenarioIdx`, `@sourceFileInfo` and `@rules`, and
    the `:taskScenarioAttributes` rule's pattern objects;
  - TjTime's class-level zone.

  All are pinned at commit `3b36c79`. Any TaskJuggler update must rerun the equivalence suite.
  The Marshal blob never leaves the worker's VM.
- **Licensing.** `engine/bridge/fast_path_procs.rb` is a near-copy of TaskJuggler code and is
  GPL-2.0-only, with a header naming `PropertyTreeNode.rb:58-85` (ADR-0001 addendum), like
  `tj_wasm_time.rb`; the bundle's notice lists both. The other new files are GPL-2.0-or-later.

## CI

`npm run test:fast-path` runs three files with `FAST_PATH=1`: the review repros
(`fast-path.adversarial.test.ts`, 15 cases), the guards (`fast-path.guards.test.ts`, 22 cases)
and the equivalence suite (`fast-path.equivalence.test.ts`). The sizes are environment
variables of the equivalence suite.

| | Per push (`ci.yml`, job Patch fidelity, step Fast path equivalence; blocking) | Nightly (`nightly.yml`, job fast-path-nightly; reporting, like the other nightly jobs) |
| --- | --- | --- |
| Repros and guards | all 37 cases | all 37 cases |
| Golden plans (`FAST_PATH_CORPUS_EDITS`) | all 40, 2 rewrites each plus a patch of both | all 40, 6 rewrites each plus a patch of three |
| Generated plans (`FAST_PATH_RUNS`) | 50 | 500 |
| Direction family (`FAST_PATH_DIRECTION_RUNS`) | 20 | 200 |
| Shuffled replay (`FAST_PATH_SHUFFLED`) | 25 plans | all (the golden plans with sites and 60 generated) |
| Seed (`FAST_PATH_SEED`) | 20261113, fixed | the run number, new every night |
| Report | `test-results/fast-path-equivalence.json`, uploaded with the fidelity report | the same, in the step summary and as an artifact |

Per-push duration, measured on a 4-core machine shared with other sessions (a CI runner runs
nothing else, so it should be quicker):

- 481 s at load 11 to 16 with these settings: golden plans 309 s, generated plans 51 s,
  direction family 66 s, shuffled replay 47 s; the repros and the guards run in parallel with
  them and finish in the first two minutes;
- 395 s at load 5 to 17 with the whole shuffled replay (85 plans, 176 s alone), whose golden plans
  took 149 s.

From these, about 4 to 5 minutes on an unshared runner, on top of the job's 2 minutes. The
first CI run gives the real figure; `FAST_PATH_CORPUS_EDITS` and `FAST_PATH_SHUFFLED` are the
knobs if it runs long. The golden plans dominate: each runs seven times (a retaining run, then
three patches, fast and in full), more when the replay samples it.

The timings suite (`fast-path.timings.test.ts`) does not run in CI: it is run by hand, on a
quiet machine, when the bridge or the engine changes.

Golden runs never send `retain` or `fast`, so golden parity covers only the unchanged full path;
the suites above cover the fast path.

## Not covered

Rewrites in other scenarios, criterion changes (`effort` to `length`), plans with shifts,
statements on shared or macro lines, and statements that a later statement of the same family
overrides all run in full.
