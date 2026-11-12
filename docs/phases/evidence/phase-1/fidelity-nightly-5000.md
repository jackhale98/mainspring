# Patch fidelity report, all shards

4 shard report(s); seeds 20261112 (shard 0/4), 20261112 (shard 1/4), 20261112 (shard 2/4), 20261112 (shard 3/4). Slowest shard: 52.6 s for the text-only properties, per-case p95 up to 57.7 ms.

| Intent | Cases | Edits | No-ops | Refusals | Refusal reasons |
| --- | ---: | ---: | ---: | ---: | --- |
| setAttr | 284 | 168 | 3 | 113 | text-only 70, invalid-value 3, already-set 3, macro-in-body 39, syntax-error 1 |
| removeAttr | 283 | 163 | 12 | 108 | text-only 105, not-present 12, inherited 3 |
| renameTask | 285 | 161 | 0 | 124 | text-only 95, unsafe-text 28, syntax-error 1 |
| declareFlag | 200 | 195 | 5 | 0 | already-set 5 |
| addDepends | 281 | 175 | 9 | 97 | text-only 97, already-linked 9 |
| removeDepends | 203 | 200 | 3 | 0 | not-present 3 |
| setDependsGap | 200 | 188 | 12 | 0 | not-present 12 |
| allocate | 280 | 180 | 6 | 94 | inherited 4, already-set 6, macro-in-body 90 |
| addAllocation | 276 | 176 | 6 | 94 | macro-in-body 94, already-set 6 |
| removeAllocation | 196 | 177 | 0 | 19 | conflicting-attribute 18, inherited 1 |
| replaceAllocation | 200 | 198 | 0 | 2 | inherited 2 |
| format | 212 | 189 | 21 | 2 | already-set 21, syntax-error 2 |
| addResource | 200 | 194 | 0 | 6 | id-collision 4, conflicting-attribute 2 |
| deleteResource | 196 | 176 | 0 | 20 | unfixable-reference 7, conflicting-attribute 13 |
| moveResource | 196 | 178 | 16 | 2 | already-set 16, conflicting-attribute 1, unfixable-reference 1 |
| renameResource | 196 | 166 | 0 | 30 | unsafe-text 30 |
| setResourceAttr | 196 | 196 | 0 | 0 |  |
| removeResourceAttr | 196 | 175 | 21 | 0 | not-present 21 |
| setProjectHeader | 192 | 175 | 0 | 17 | unsafe-text 17 |
| setProjectAttr | 192 | 185 | 4 | 3 | invalid-value 3, already-set 4 |
| removeProjectAttr | 192 | 184 | 7 | 1 | not-present 7, unfixable-reference 1 |
| setWorkingHours | 192 | 192 | 0 | 0 |  |
| addLeave | 192 | 192 | 0 | 0 |  |
| updateLeave | 192 | 183 | 0 | 9 | unsupported-form 9 |
| removeLeave | 192 | 192 | 0 | 0 |  |
| addTask | 192 | 189 | 0 | 3 | id-collision 1, conflicting-attribute 2 |
| deleteTask | 192 | 185 | 0 | 7 | unfixable-reference 6, conflicting-attribute 1 |
| moveTask | 192 | 173 | 7 | 12 | conflicting-attribute 3, id-collision 4, unfixable-reference 3, already-set 7, cycle 2 |

Intents aimed at text-only text, by refusal reason: text-only 367, unsafe-text 75, macro-in-body 221.

Regression replays per shard (text-only properties and P4): 7, all passed unless listed below. Tolerated schedule-dependent ids (corpus plans, 15.19 and 15.22): error:impossible_start_dep 1, error:sched_runaway 2, error:task_end_in_parent 1, error:booking_no_duty 1.

Six in seven ordinary generated cases are drawn again until the edit API makes an edit, so edit counts are not natural rates; no-op and refusal counts come from the remaining one in seven, the corpus and the aimed cases.

## P4: still schedules

9993 engine runs over 5121 edited cases; ok kept in 5081 of 5084 cases that scheduled ok before; new error or fatal ids: 0. Slowest shard 972.2 s, per-case p95 up to 1509 ms.

All rules hold.

