# UI fixtures

Small plans for the end-to-end specs that test the interface, not the engine's scale (ADR-0016
change 4). Each has 10 to 30 tasks and 3 to 5 people, so a test boots and schedules in a
fraction of the time of `fedora-res` or `gantt-500`. All start on Monday 2026-03-02 (the same
week as `tests/fixtures/gantt/manipulation`, so the e2e rigs' `minute()` helper applies).

| Sample id      | Folder       | For                                                                                                                                        |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ui-basic`     | `basic/`     | Gantt specs: dependency kinds and gaps, a milestone, a critical path with a `now` line, progress, flags, a macro task, included files      |
| `ui-people`    | `people/`    | People specs: one group of five, every leave type, global holiday and vacation, a part-timer, an efficiency 0.8 person, flags, busy people |
| `ui-multifile` | `multifile/` | Includes in sub-folders, a cross-file `depends`, macros, `supplement`, and text-only tasks                                                 |

They are registered as samples in `src/lib/workspace/samples.ts`, so a test opens one with
`?sample=ui-basic`. They have no native goldens (no `tj3` in the test environment, and the
golden corpus is for engine parity). `src/lib/workspace/ui-fixtures.engine.test.ts` schedules each
one in the wasm engine and requires no error and no warning.
