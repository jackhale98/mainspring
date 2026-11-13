# Round-trip report

Parse, print, re-encode UTF-8, compare bytes (phase-1.md 9.1). `bytes` rows are byte-exact; the
`text` row is the invalid-UTF-8 file, text-exact after decoding (ADR-0003 #1).

| Corpus | Plans | Files | Bytes | Passed | Failed | Files with error nodes | Typed | Opaque | Values |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| golden | 36 | 43 | 288365 | 43 | 0 | 2 | 6739 | 662 | 2076 |
| fixture | 25 | 37 | 12388 | 37 | 0 | 2 | 320 | 22 | 77 |
| syntax-correct | 85 | 85 | 69984 | 85 | 0 | 0 | 931 | 729 | 352 |

## Golden corpus

| File | Bytes | Context | Compared | Error nodes | Result |
| --- | ---: | --- | --- | ---: | --- |
| `engine/tj/examples/Tutorial/tutorial.tjp` | 15004 | global | bytes | 0 | pass |
| `engine/tj/examples/Fedora-20/f-20.tjp` | 77161 | global | bytes | 0 | pass |
| `engine/tj/examples/Fedora-20/reports.tji` | 11418 | global | bytes | 0 | pass |
| `engine/tj/examples/ProjectTemplate/template.tjp` | 9257 | global | bytes | 0 | pass |
| `engine/tj/examples/Scrum/scrum.tjp` | 2559 | global | bytes | 0 | pass |
| `engine/tj/examples/ToDo-List/todolist.tjp` | 1858 | global | bytes | 0 | pass |
| `engine/golden/plans/poc-sample/plan.tjp` | 1345 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/01-shifts-resource/plan.tjp` | 1031 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/02-shifts-allocation-task/plan.tjp` | 1211 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/03-limits-resource-max/plan.tjp` | 906 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/04-limits-task-min-per-resource/plan.tjp` | 1814 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/05-scenarios-tree/plan.tjp` | 809 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/06-scenarios-tracking/plan.tjp` | 2082 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/07-deps-onstart-onend/plan.tjp` | 886 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/08-deps-gaps-alap/plan.tjp` | 1007 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/09-tz-dst-berlin/plan.tjp` | 817 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/10-tz-fractional-offset/plan.tjp` | 727 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/11-tz-southern-sydney/plan.tjp` | 919 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/12-tz-unset/plan.tjp` | 546 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/13-calendars-leaves/plan.tjp` | 1325 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/14-workinghours-resolution/plan.tjp` | 1375 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/15-allocate-select/plan.tjp` | 2907 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/16-constraints-violations/plan.tjp` | 1008 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/17-priority-efficiency/plan.tjp` | 1593 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/18-structure-include-macro/lib/resources.tji` | 211 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/18-structure-include-macro/lib/tasks.tji` | 204 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/18-structure-include-macro/plan.tjp` | 565 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/19-errors-parse/lib/broken.tji` | 244 | global | bytes | 1 (line 6) | pass |
| `engine/golden/plans/synthetic/19-errors-parse/plan.tjp` | 590 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/20-scale-1000/plan.tjp` | 138811 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/21-tz-dst-edges-newyork/plan.tjp` | 2818 | global | bytes | 0 | pass |
| `engine/golden/plans/synthetic/22-tz-kathmandu-resolution/plan.tjp` | 986 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/header-only/plan.tjp` | 428 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/parse-failure/plan.tjp` | 386 | global | bytes | 2 (line 14) | pass |
| `engine/golden/plans/bridge/schedule-error/plan.tjp` | 504 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/scenario-warning/plan.tjp` | 614 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/include-subfolder/parts/deep/more.tji` | 179 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/include-subfolder/parts/shared.tji` | 102 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/include-subfolder/parts/tasks.tji` | 149 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/include-subfolder/plan.tjp` | 597 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/bom-invalid-utf8/plan.tjp` | 525 | global | text | 0 | pass |
| `engine/golden/plans/bridge/now-option/plan.tjp` | 487 | global | bytes | 0 | pass |
| `engine/golden/plans/bridge/now-line/plan.tjp` | 400 | global | bytes | 0 | pass |
