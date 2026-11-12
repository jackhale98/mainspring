# Patch fidelity report

Seed 20261112 (FIDELITY_SEED), 200 generated and 50 corpus cases, shard 0/1. Replay one case with FIDELITY_CASE=generated:<seed>:<type>[:text-only][:@<attempt>] or FIDELITY_CASE=corpus:<seed>:<type>:<plan> (the failure message prints the exact line).

Wall time 2.9 s for the text-only properties (P1, P2, P3, P5, P6); per case p50 4.3 ms, p95 14.2 ms, max 31.0 ms.

| Intent | Cases | Edits | No-ops | Refusals | Refusal reasons |
| --- | ---: | ---: | ---: | ---: | --- |
| setAttr | 17 | 10 | 0 | 7 | text-only 4, macro-in-body 3 |
| removeAttr | 17 | 6 | 0 | 11 | text-only 10, macro-in-body 1 |
| renameTask | 17 | 9 | 0 | 8 | unsafe-text 1, text-only 7 |
| declareFlag | 10 | 10 | 0 | 0 |  |
| addDepends | 16 | 5 | 1 | 10 | already-linked 1, text-only 10 |
| removeDepends | 9 | 9 | 0 | 0 |  |
| setDependsGap | 9 | 8 | 1 | 0 | not-present 1 |
| allocate | 15 | 8 | 0 | 7 | macro-in-body 7 |
| addAllocation | 15 | 9 | 0 | 6 | macro-in-body 6 |
| removeAllocation | 9 | 6 | 0 | 3 | conflicting-attribute 3 |
| replaceAllocation | 9 | 9 | 0 | 0 |  |
| format | 9 | 7 | 1 | 1 | already-set 1, syntax-error 1 |
| addResource | 9 | 9 | 0 | 0 |  |
| deleteResource | 9 | 8 | 0 | 1 | unfixable-reference 1 |
| moveResource | 9 | 7 | 2 | 0 | already-set 2 |
| renameResource | 9 | 5 | 0 | 4 | unsafe-text 4 |
| setResourceAttr | 9 | 9 | 0 | 0 |  |
| removeResourceAttr | 9 | 7 | 2 | 0 | not-present 2 |
| setProjectHeader | 9 | 7 | 0 | 2 | unsafe-text 2 |
| setProjectAttr | 9 | 9 | 0 | 0 |  |
| removeProjectAttr | 9 | 9 | 0 | 0 |  |
| setWorkingHours | 9 | 9 | 0 | 0 |  |
| addLeave | 8 | 8 | 0 | 0 |  |
| updateLeave | 8 | 8 | 0 | 0 |  |
| removeLeave | 8 | 8 | 0 | 0 |  |
| addTask | 8 | 8 | 0 | 0 |  |
| deleteTask | 8 | 7 | 0 | 1 | conflicting-attribute 1 |
| moveTask | 8 | 5 | 1 | 2 | conflicting-attribute 2, already-set 1 |

Six in seven ordinary generated cases are drawn again until the edit API makes an edit, so the edit counts are not natural rates, and the no-op and refusal counts come from the remaining one in seven, the corpus cases and the cases aimed at text-only text.

Corpus cases per plan: syn-17-priority-efficiency 3, syn-18-structure-include-macro 4, syn-16-constraints-violations 1, syn-01-shifts-resource 2, syn-02-shifts-allocation-task 1, bridge-schedule-error 2, upstream-scrum 5, syn-13-calendars-leaves 4, syn-09-tz-dst-berlin 2, bridge-include-subfolder 4, syn-19-errors-parse 2, upstream-template 1, syn-04-limits-task-min-per-resource 4, syn-22-tz-kathmandu-resolution 2, syn-05-scenarios-tree 4, syn-11-tz-southern-sydney 2, bridge-now-option 1, syn-14-workinghours-resolution 2, syn-07-deps-onstart-onend 1, bridge-parse-failure 1, bridge-scenario-warning 1, poc-sample 1.

Corpus plans (32, from tests/fidelity/corpus.json; times: worker totalMs, node engine/golden/run-wasm.mjs --repeat 3, fastest of 3 (measuredMs in corpus.json)): upstream-template, upstream-scrum, upstream-todolist, poc-sample, syn-01-shifts-resource, syn-02-shifts-allocation-task, syn-03-limits-resource-max, syn-04-limits-task-min-per-resource, syn-05-scenarios-tree, syn-06-scenarios-tracking, syn-07-deps-onstart-onend, syn-08-deps-gaps-alap, syn-09-tz-dst-berlin, syn-10-tz-fractional-offset, syn-11-tz-southern-sydney, syn-12-tz-unset, syn-13-calendars-leaves, syn-14-workinghours-resolution, syn-15-allocate-select, syn-16-constraints-violations, syn-17-priority-efficiency, syn-18-structure-include-macro, syn-19-errors-parse, syn-22-tz-kathmandu-resolution, bridge-header-only, bridge-parse-failure, bridge-schedule-error, bridge-scenario-warning, bridge-include-subfolder, bridge-bom-invalid-utf8, bridge-now-option, bridge-now-line.

Regression replays (text-only properties): 4, all must pass.

## P4: still schedules

423 engine runs over 220 edited cases (old and new workspace); ok kept in 216 of 216 cases that scheduled ok before; new error or fatal ids: 0. Wall time 57.8 s, p95 401 ms per case.

## Mutation meta-test

| Faulty wrapper | Caught | By | Cases to catch |
| --- | --- | --- | ---: |
| touches one byte outside the target | yes | P1-region | 1 |
| skips one required change (a removed site, item or statement) | yes | P3 | 14 |
| writes an inserted statement at the wrong place (the top of its file) | yes | P1-region | 1 |
| skips one reference fix of a deleteTask or moveTask | yes | P3 | 2 |
| drops one change of the inverse | yes | P6 | 1 |

