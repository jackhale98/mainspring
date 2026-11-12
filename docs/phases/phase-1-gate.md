# Phase 1 gate: Document layer and text mode

Status: **approved by the user on 2026-11-12, in advance, on condition that the evidence below was
recorded.** The user then asked to start Phase 2 (spec approved the same day, every recommendation
accepted). Evidence recorded on branch `claude/new-session-6tly46` at `1d75f7bc` (also `main`).

## Verdict

Both gate criteria pass.

| Gate criterion (verbatim) | Result |
| --- | --- |
| "parsing then printing every golden file reproduces it byte for byte" | **Pass.** 43 of 43 golden files are byte-exact (36 plans), and 85 of 85 files in TaskJuggler's `Syntax/Correct` suite |
| "property tests show each edit changes only its target range and the result still schedules" | **Pass.** 200 generated plus 50 corpus cases on every push, and a 5,000-case 4-shard nightly run. All 28 intents are covered, and the oracle is independent of the edit code. 0 new engine errors |

CI on the gate commit, all jobs green (format, typecheck, unit, round trip, licenses, engine build
and engine edit tests, golden parity, fidelity, Pages base path, end-to-end on desktop, Pixel 7 and
iPhone 14 with axe, responsiveness, no-Ruby):
https://github.com/jackhale98/mainspring/actions/runs/43325516302

## Criterion 1: byte-exact round trip

`npm run test:roundtrip` (report: `evidence/phase-1/roundtrip.md`):

| Corpus | Plans | Files | Bytes | Passed | Files with error nodes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Golden (asserted count) | 36 | 43 | 288,365 | 43 | 2 (expected) |
| Fixtures (T16 edge cases) | 25 | 37 | 12,388 | 37 | 2 (negative fixtures) |
| TaskJuggler `Syntax/Correct` | 85 | 85 | 69,984 | 85 | 0 |

- Each file is decoded as the app decodes it, parsed, printed and re-encoded. The result is compared
  byte for byte. The test also asserts no non-whitespace gaps and that every typed value parses.
- Parse-error fixtures: `syn-19-errors-parse` `lib/broken.tji` has its first error node on line 6,
  and `bridge-parse-failure` on line 14. Both match their golden message lines
  (`tests/roundtrip/roundtrip.test.ts:108`).
- Invalid UTF-8 (`bridge-bom-invalid-utf8`): the text matches exactly after decoding, under the
  rule chosen in ADR-0003 #1. The test also asserts that strict decoding fails.
- Mutation check (spec 9.1): `tests/roundtrip/print-mutation.test.ts`. Removing one token from the
  Tutorial tree makes `printTree` throw and `checkFile` report the gap. The test covers the first
  and last tokens, a keyword inside a nested block, a string, a comment and a token mid-file.
- T19 scanner differential: `scripts/dev/scanner-diff.dev.ts` (developer script with native Ruby)
  passes. The wasm token-oracle smoke test runs in CI and passes 19 of 19.
- Index cross-check (spec 9.2, `tests/index/golden-index.test.ts`): ids, parents, order, file and
  line match the goldens for every compared plan.

## Criterion 2: patch fidelity

**Every push** (`npm run test:fidelity`, the `fidelity` CI job; report:
`evidence/phase-1/fidelity-default.md`):

- Seed 20261112: 200 generated and 50 corpus cases, plus cases aimed at text-only elements.
- P1 to P6 all hold. P1 checks each edit against an oracle region written from spec 7.1, which
  does not import the edit code. It also checks against the edit's own declared targets.
- P4 (still schedules, run in the engine through `bootNodeEngine`): 423 engine runs over 220 edited
  cases. `ok` held in 216 of 216 cases that scheduled before. New error or fatal ids: 0.
- Time:
  - text-only properties: 2.9 s, p95 14 ms per case;
  - P4: 58 s, p95 401 ms per case. This is over the 300 ms target in 9.3 because each case runs the
    engine twice. Recorded as a deviation in phase-1.md §15.25.
- Every one of the 28 intents had at least 5 edits; the per-intent table is in the report.

**Nightly, 5,000 cases** (4 shards with the nightly settings, seed 20261112, run locally on the gate
commit; merged report: `evidence/phase-1/fidelity-nightly-5000.md`):

- All 4 shards pass. The merge step checks that every shard reported, that each intent has at least
  5 edits across shards, and that P4 ran in every shard.
- P4: 9,993 engine runs over 5,121 edited cases. `ok` held in 5,081 of 5,084 cases.
  - The 3 exceptions are ids that depend on the computed schedule, which §15.19 and §15.22 leave
    unrefused: `sched_runaway` 2, `impossible_start_dep` 1.
  - Also tolerated, with `ok` unchanged: `task_end_in_parent` 1, `booking_no_duty` 1.
  - New error or fatal ids: 0.
- At least 161 edits per intent (renameTask is the lowest).
- Deliberate text-only targets were all refused: `text-only` 367, `macro-in-body` 221,
  `unsafe-text` 75.
- Tutorial and Fedora had 20 corpus cases each, with Fedora indexed through its engine hints.
- 7 pinned regressions replay in every shard.
- The scheduled CI nightly (`nightly.yml`, 03:17 UTC) runs the same jobs on `main`. Its first run
  after the gate is the CI record of this result. Dispatching it by hand is not permitted from
  this session.

**Mutation meta-test** (`tests/fidelity/mutation.test.ts`): every faulty wrapper is caught well
within 200 cases.

| Faulty wrapper | Caught by | Cases to catch |
| --- | --- | ---: |
| Touches one byte outside the target | P1, oracle region | 1 |
| Skips one required change | P3 | 14 |
| Writes an inserted statement at the wrong place | P1, oracle region | 1 |
| Skips one reference fix of a deleteTask or moveTask | P3 | 2 |
| Drops one change of the inverse | P6 | 1 |

**Bugs the suite found in the edit API**, all fixed before the gate:
- `setAttr milestone=false` left a task underspecified;
- removing a `start` that a `precedes` relies on deadlocked the engine.

The fixes are a precise `task_underspecified` rule and a dependency-anchor rule, both checked
against native tj3 (§15.24). The reviewers found more before merge: manager loops that crash the
engine, supplement and booking order, container attributes, and others (§15.19 to §15.24).

## Phase deliverables

| Plan bullet | Evidence |
| --- | --- |
| Lezer TJP grammar with lossless round trip; symbol index across included files; diagnostics pinned to file, line and column | Criterion 1; the index cross-check against all goldens; engine diagnostics land on the golden lines, with token precision where available |
| Completion and hover docs generated from TaskJuggler's own syntax rules | `gen:keywords --check` passes (254 keywords). `tests/e2e/text-mode.spec.ts` asserts that the completion detail, completion info, hover and Docs sheet equal the engine's `syntax()` output |
| Edit API with every MVP intent, each with unit tests | 28 intents in `src/lib/tjp/edit/`, each with unit tests beside it, plus engine tests in CI. Fidelity coverage above |
| Text mode | End-to-end tests on desktop, Pixel 7 and iPhone 14 with axe in light and dark. Screenshots in `screenshots/phase-1/` |

## Tests on the gate commit

| Suite | Result |
| --- | --- |
| `npm run typecheck`, `format:check`, `licenses`, `no-ruby`, `build:grammar --check`, `gen:keywords --check` | Pass (licenses: only the known OpenSSL exception, ADR-0001) |
| `npm run test:unit` | 211 files, 3,509 tests pass |
| `npm run test:golden` | 36 of 36 plans match (`evidence/phase-1/golden.md`) |
| End-to-end (Chromium desktop and Pixel 7 locally; iPhone 14 in CI) | 65 passed locally (33 skips are project-specific by design); CI green on all three |
| `npx vitest run tests/perf` | Pass |

## Performance and accessibility (T21; full report `phase-1-audit.md`)

| Measure | Budget | Result |
| --- | --- | --- |
| App shell first paint | under 1.5 s | about 0.2 s |
| Engine ready | under 4 s | about 1.4 s |
| Keystroke to paint, Fedora (p90) | 50 ms | 32 ms |
| Keystroke to paint, 1,000-task plan (p90) | 50 ms | 40 ms (32 ms with a key every 200 ms) |
| Incremental reparse (p90, Node) | 5 ms | 3.4 ms Fedora, 3.8 ms scale-1000 |
| Index rebuild after one edit (p90) | 30 ms | 8.3 ms |
| Any intent on Fedora (p90) | 50 ms | 3 to 31 ms (addTask is the highest) |
| `/app` JS, gzip | 450 KB cap | about 280 KB |

Accessibility:
- axe (WCAG 2.2 AA) is clean in every state tested, on desktop, Pixel 7 and iPhone 14.
- The audit fixed tooltip contrast, the diagnostics panel's tokens and target sizes, and screen
  reader announcements for problems.
- An iPhone-only finding at the gate was also fixed: the Docs sheet's scrolling text is now a
  focusable region.
- An Android Chrome bug, where Enter was dropped when a lint update landed in the same frame, is
  guarded and has a test that fails without the guard. A residual risk inside CodeMirror is
  documented.

## Decisions made during Phase 1

- ADR-0003: document layer answers.
- ADR-0004: id completion and hover.
- ADR-0005: OFL fonts allowed, for fonts only.
- ADR-0006: GitHub Pages preview (out of phase, approved).
- §15 items 1 to 25 record the settled details. Main ones:
  - the precise refusal rules checked against native tj3;
  - the typing pause;
  - the fidelity suite's design;
  - open-ended allocated work is intended behaviour, and the resulting resource contention is
    schedule-dependent.

## Open items carried forward

| Item | When |
| --- | --- |
| Re-record goldens on Ruby 3.4 (all goldens are provisional on 3.3.6) | The user, on Debian or Ubuntu with Ruby 3.4 |
| ruby.wasm without OpenSSL, or an ADR accepting it (the Pages preview ships it, ADR-0006) | Before any real release |
| Dexie is Apache-2.0 | Before Phase 4 ships it |
| Real-device keystroke latency and screen reader runs | Phase 2 gate (device from the user) |
| CodeMirror upstream report for the held Android Enter | Optional; the wording is in the audit §5 |
| Fidelity P4 p95 above 300 ms | Accepted deviation (§15.25); revisit if CI time grows |
| Make `golden`, `e2e` and `fidelity` required checks | GitHub branch protection, the user's setting |
