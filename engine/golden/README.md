# Golden corpus: synthetic plans

Synthetic TaskJuggler plans for Phase 0 (spec section 6.1). Each plan's header comment names the feature it targets. Validate a plan with native tj3 from its own directory:

```
ruby -I /ABS/WORKTREE/poc/stubs -I /ABS/WORKTREE/engine/tj/lib /ABS/WORKTREE/engine/tj/bin/tj3 --no-reports --silent plan.tjp
```

| id | entry | features | expected outcome |
| --- | --- | --- | --- |
| syn-01-shifts-resource | `plans/synthetic/01-shifts-resource/plan.tjp` | shift definitions; resource shifts with date ranges; leaves inside a shift | ok (exit 0) |
| syn-02-shifts-allocation-task | `plans/synthetic/02-shifts-allocation-task/plan.tjp` | per-allocation shifts; task-level shifts | ok (exit 0) |
| syn-03-limits-resource-max | `plans/synthetic/03-limits-resource-max/plan.tjp` | resource limits: dailymax, weeklymax, monthlymax | ok (exit 0) |
| syn-04-limits-task-min-per-resource | `plans/synthetic/04-limits-task-min-per-resource/plan.tjp` | task limits: dailymin, weeklymin; resource dailymax | warning (exit 0): task `f` maxend too late |
| syn-05-scenarios-tree | `plans/synthetic/05-scenarios-tree/plan.tjp` | nested scenarios; `active no`; scenario-prefixed attributes | ok (exit 0) |
| syn-06-scenarios-tracking | `plans/synthetic/06-scenarios-tracking/plan.tjp` | trackingscenario; complete; task and resource bookings; fixed now | ok (exit 0) |
| syn-07-deps-onstart-onend | `plans/synthetic/07-deps-onstart-onend/plan.tjp` | depends and precedes with onstart and onend | ok (exit 0) |
| syn-08-deps-gaps-alap | `plans/synthetic/08-deps-gaps-alap/plan.tjp` | gapduration, gaplength, scheduling alap, precedes chains | ok (exit 0) |
| syn-09-tz-dst-berlin | `plans/synthetic/09-tz-dst-berlin/plan.tjp` | timezone Europe/Berlin; work across March and October DST | ok (exit 0) |
| syn-10-tz-fractional-offset | `plans/synthetic/10-tz-fractional-offset/plan.tjp` | Asia/Kathmandu (+05:45); timingresolution 15min | ok (exit 0) |
| syn-11-tz-southern-sydney | `plans/synthetic/11-tz-southern-sydney/plan.tjp` | Australia/Sydney; southern DST; year boundary | ok (exit 0) |
| syn-12-tz-unset | `plans/synthetic/12-tz-unset/plan.tjp` | no timezone (UTC default) | ok (exit 0) |
| syn-13-calendars-leaves | `plans/synthetic/13-calendars-leaves/plan.tjp` | global leaves (holiday, annual, special, sick, unpaid, unemployed); resource leaves; vacation | ok (exit 0) |
| syn-14-workinghours-resolution | `plans/synthetic/14-workinghours-resolution/plan.tjp` | project and resource workinghours; dailyworkinghours; weekstartsmonday; timingresolution 15min | ok (exit 0) |
| syn-15-allocate-select | `plans/synthetic/15-allocate-select/plan.tjp` | alternative; select (maxloaded, minloaded, minallocated, order); persistent; mandatory | ok (exit 0) |
| syn-16-constraints-violations | `plans/synthetic/16-constraints-violations/plan.tjp` | start, end, minstart, maxend; unmeetable constraints | error (exit 1): `plan.tjp:29` "Task limits.reverse has a start, an end and a duration specification" |
| syn-17-priority-efficiency | `plans/synthetic/17-priority-efficiency/plan.tjp` | priority contention; efficiency below and above 1; overallocation | ok (exit 0) |
| syn-18-structure-include-macro | `plans/synthetic/18-structure-include-macro/plan.tjp` | include from subfolders; macro; supplement; extend; non-ASCII names | ok (exit 0) |
| syn-19-errors-parse | `plans/synthetic/19-errors-parse/plan.tjp` | syntax error inside an included .tji | error (exit 1): `lib/broken.tji:6` (column 10, the first `@`), "Unexpected token '@'" |
| syn-20-scale-1000 | `plans/synthetic/20-scale-1000/plan.tjp` (generated) | 1,000 leaf tasks (1,225 including groups); 54 resources in 6 groups; 4-level nesting; dependency chains; 2026-01-05 to 2028-12-29 | ok (exit 0) |

Expected task counts (lines starting with `task`, including included files): 5, 5, 6, 7, 5, 4, 8, 9, 5, 5, 4, 4, 4, 4, 7, 5, 8, 4, 2 (plan 19 fails to parse at the include), and 1,225 for plan 20.

## Regenerating plan 20

`plans/synthetic/20-scale-1000/plan.tjp` is produced by a seeded, deterministic script (mulberry32 with a fixed seed, no `Math.random`, no clock). Regenerate it from the repository root with:

```
node engine/golden/generators/scale-1000.mjs
```

Do not hand-edit the generated file. Re-running the script must leave `git diff` empty.
