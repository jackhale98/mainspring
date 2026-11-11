# Golden corpus: synthetic plans

Synthetic TaskJuggler plans for Phase 0 (spec section 6.1). Each plan's header comment names the feature it targets. Validate a plan with native tj3 from its own directory (the run command uses `poc/stubs` until `engine/stubs` exists):

```
ruby -I /ABS/WORKTREE/poc/stubs -I /ABS/WORKTREE/engine/tj/lib /ABS/WORKTREE/engine/tj/bin/tj3 --no-reports --silent plan.tjp
```

| id | entry | features | expected outcome |
| --- | --- | --- | --- |
| syn-01-shifts-resource | `plans/synthetic/01-shifts-resource/plan.tjp` | shift definitions; resource shifts with date ranges; leaves inside a shift | ok (exit 0); build (34d) runs 02-02 to 03-05 through the shift leave 02-16/17, past partTime end 02-27 and into fullTime |
| syn-02-shifts-allocation-task | `plans/synthetic/02-shifts-allocation-task/plan.tjp` | per-allocation shifts (one body per allocation); task-level shifts | ok (exit 0); part3 ranged shifts and part4 task shift overlap the work (part4 ends 02-13 instead of 01-21) |
| syn-03-limits-resource-max | `plans/synthetic/03-limits-resource-max/plan.tjp` | resource limits: dailymax, weeklymax 14h, monthlymax 48h | ok (exit 0); alpha ends 02-24 (was 02-12 with weeklymax 20h) |
| syn-04-limits-task-min-per-resource | `plans/synthetic/04-limits-task-min-per-resource/plan.tjp` | task limits with `{ resources r }` per-resource upper limits; dailymin/weeklymin (no-op in 3.8.4) | warning (exit 0): `plan.tjp:65` task `minimums.f` end "is too late"; no warning for the min limits (never checked) |
| syn-05-scenarios-tree | `plans/synthetic/05-scenarios-tree/plan.tjp` | nested scenarios; `active no`; scenario-prefixed attributes | ok (exit 0) |
| syn-06-scenarios-tracking | `plans/synthetic/06-scenarios-tracking/plan.tjp` | trackingscenario; bookings in the tracking scenario (task and resource via supplement); complete; fixed now | ok (exit 0); actual projects `second` to 02-16 after real bookings, plan does not |
| syn-07-deps-onstart-onend | `plans/synthetic/07-deps-onstart-onend/plan.tjp` | depends and precedes with onstart and onend (incl. `precedes ... { onend }`) | ok (exit 0); h ends 01-20 17:00 with g |
| syn-08-deps-gaps-alap | `plans/synthetic/08-deps-gaps-alap/plan.tjp` | gapduration, gaplength, scheduling alap, precedes chains | ok (exit 0) |
| syn-09-tz-dst-berlin | `plans/synthetic/09-tz-dst-berlin/plan.tjp` | timezone Europe/Berlin; work across March and October DST | ok (exit 0); spring crosses 03-29 (+0100 to +0200), autumn 10-19 to 10-30 crosses 10-25 (+0200 to +0100) |
| syn-10-tz-fractional-offset | `plans/synthetic/10-tz-fractional-offset/plan.tjp` | Asia/Kathmandu (+05:45); timingresolution 15min | ok (exit 0) |
| syn-11-tz-southern-sydney | `plans/synthetic/11-tz-southern-sydney/plan.tjp` | Australia/Sydney; southern DST (2026-10-04, 2027-04-04); year boundary | ok (exit 0); octwork crosses +1000 to +1100, aprwork +1100 to +1000 |
| syn-12-tz-unset | `plans/synthetic/12-tz-unset/plan.tjp` | no timezone (UTC default) | ok (exit 0) |
| syn-13-calendars-leaves | `plans/synthetic/13-calendars-leaves/plan.tjp` | global leaves (holiday, annual, special, sick, unpaid, unemployed); resource leaves; vacation, each inside scheduled work | ok (exit 0) |
| syn-14-workinghours-resolution | `plans/synthetic/14-workinghours-resolution/plan.tjp` | project and resource workinghours (resource without own hours; weekly limit); dailyworkinghours; weekstartsmonday; timingresolution 15min | ok (exit 0); weekstartsmonday observed NOT to change the schedule in 3.8.4 |
| syn-15-allocate-select | `plans/synthetic/15-allocate-select/plan.tjp` | alternatives with select maxloaded/minloaded/minallocated/order; persistent; mandatory | ok (exit 0); picks: maxl ada, minl cy, mina bea, ordered dev; sticky p1 only (fluid q1+q2); pair ends 03-10 |
| syn-16-constraints-violations | `plans/synthetic/16-constraints-violations/plan.tjp` | start, end, minstart, maxend constraints; unmeetable constraints | ok (exit 0) with warning: `plan.tjp:24` "The start time (2026-01-05-09:00-+0000) of task limits.tight is too early. Must be after 2026-02-02-00:00-+0000." |
| syn-17-priority-efficiency | `plans/synthetic/17-priority-efficiency/plan.tjp` | priority contention; efficiency; user booking exceeding planned effort | ok (exit 0) with warning: `plan.tjp:49` "The total effort (3.5d or 28.0h) of the provided bookings for task contend.booked exceeds the specified effort of 2.0d or 16.0h." |
| syn-18-structure-include-macro | `plans/synthetic/18-structure-include-macro/plan.tjp` | include from subfolders; macro; supplement; extend; non-ASCII names | ok (exit 0) |
| syn-19-errors-parse | `plans/synthetic/19-errors-parse/plan.tjp` | syntax error inside an included .tji; multi-byte text before the bad token | error (exit 1): `lib/broken.tji:6` "Unexpected token '@' found. Expecting '}'"; native column is 0, the bridge column is settled in T4/T9 |
| syn-20-scale-1000 | `plans/synthetic/20-scale-1000/plan.tjp` (generated) | 1,000 leaf tasks; 54 resources in 6 groups; 4-level nesting; phases chained across time | ok (exit 0); schedule runs 2026-01-05 to 2028-11-30 |

Expected task counts (lines starting with `task`, including included files): 5, 5, 6, 8, 5, 5, 9, 9, 5, 5, 6, 4, 6, 6, 15, 4, 9, 4, 2 (plan 19 fails to parse at the include), and 1,225 for plan 20.

## Regenerating plan 20

`plans/synthetic/20-scale-1000/plan.tjp` is produced by a seeded, deterministic script (mulberry32 with the 32-bit seed 0x5ca1e100 = 1554768128, no `Math.random`, no clock). Regenerate it from the repository root with:

```
node engine/golden/generators/scale-1000.mjs
```

Check without writing: `node engine/golden/generators/scale-1000.mjs --check` (exit 1 if the committed file differs). Do not hand-edit the generated file. Re-running the script must leave `git diff` empty.
