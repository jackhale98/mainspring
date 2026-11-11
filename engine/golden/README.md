# Golden corpus

Plans whose native TaskJuggler outputs the browser engine must reproduce exactly
(`docs/phases/phase-0.md`, section 6). `manifest.json` lists them; `expected/<id>.json`
holds each plan's recorded output.
## Synthetic plans

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

## Recording native outputs

`record-native.mjs` produces `expected/<id>.json` and `native-timings.json` from the real
TaskJuggler 3.8.4 in `engine/tj/` on native Ruby. It is a developer script: CI never runs
Ruby, `tj3` or Bundler.

### Setup

- Ruby 3.4.x, the version ruby.wasm runs. Any other version needs `--allow-ruby`, and the
  version is recorded in every golden as `native.ruby`.
- The recorder's gems, pinned in `Gemfile.lock`:
  `BUNDLE_GEMFILE=engine/golden/Gemfile bundle install`. They are `term-ansicolor` (with
  `tins`, `sync`, `bigdecimal`), plus `drb` and `base64`, which Ruby 3.4 no longer ships as
  default gems but TaskJuggler requires on its scheduling path. `mail`, `webrick` and
  `prawn` are never loaded by scheduling or by the cross-check report. Native runs use
  these real gems, not `engine/stubs/`.

### Commands

| Command | What it does |
| --- | --- |
| `node engine/golden/record-native.mjs` (`npm run golden:record`) | Record every manifest plan |
| `... --only <id>` (repeatable) | Record only these plans; other goldens and timings stay |
| `... --verify` (`npm run golden:verify`) | Re-run natively and fail on any difference from the committed files |
| `... --allow-ruby` | Accept a Ruby other than 3.4.x |

The script refuses to run when `engine/tj` is not the tree pinned in `engine/tj.pin.json`,
when Ruby is not 3.4.x, or when `engine/bridge/` or `engine/golden/plans/` have uncommitted
changes (goldens must come from committed inputs). Commit plan and bridge changes first,
then record, then commit `expected/` and `native-timings.json`.

### What a run does

For each plan it runs `engine/bridge/native/record.rb` twice under `bundle exec`, with
`TZ=UTC` and `LANG=C.UTF-8`. `record.rb` loads unmodified TaskJuggler plus the shared
bridge code (`engine/bridge/request.rb`, `engine/bridge/serialize.rb`), never the
`engine/bridge/wasm/` patches or `engine/stubs/`.

1. The files under the plan's `root` that match its `files` globs (default `**/*.tjp`,
   `**/*.tji`) become the request's workspace. `GoldenFile.files` lists them, sorted; the
   parity test sends exactly these files to the worker.
2. They are copied into a private temporary workspace and `<workspace>/<entry>` is parsed
   and scheduled, as the worker does with `/workspace/<entry>`.
3. If the two runs' outputs differ, the plan fails (nondeterminism) and nothing is written.
4. Serializer cross-check: the real `tj3` CLI (`engine/tj/bin/tj3`) runs on the same
   workspace with `cross-check.tji` as a second file and writes a CSV report of every task's
   start and end per active scenario. The script checks it row by row against the golden's
   task dates. Both sides of the parity test share `serialize.rb`, so this is what catches
   serializer bugs.
5. Unless `--verify` is given and every plan passed, it writes `expected/<id>.json`
   (`JSON.stringify` of the sorted object with 2-space indent and a trailing newline, no
   timestamps, so re-recording unchanged plans gives no diff) and `native-timings.json`
   (minimum of the two runs; never compared).

### `now`

A plan's own `now` line always wins. When the plan has none, the manifest's `now` is used
as `options.now`, which stands in for the system clock that TaskJuggler reads for its
default: like the clock, it is aligned down to the whole hour (`TjTime.new.align(3600)`).
The cross-check pins `Time.now` of the `tj3` process to the same instant, so both see the
same `now`. Manifest `now` values should be whole hours.

### Text encoding

Workspace files are UTF-8 text on both sides, and both sides use the same rule
(`MainspringBridge.normalize_text` in `engine/bridge/request.rb`, shared code):

- invalid UTF-8 byte sequences become U+FFFD, one per maximal invalid subpart. This is what
  the browser's `TextDecoder` (and Node's `Buffer#toString`) produce, so the native recorder
  sees the text the browser would. Ruby's `String#scrub` was checked against `TextDecoder`
  on 22 invalid-sequence vectors and agreed on all of them;
- one leading byte-order mark (U+FEFF) is removed, as `TextDecoder` does by default. Doing
  it in the shared bridge keeps both sides equal whichever JS decoder read the files;
- CRLF and CR line ends become LF inside TaskJuggler itself, on both sides.

So a golden describes what the browser engine gets after decoding, not what `tj3` does with
raw invalid bytes (it stops with `UTF-8 encoding error`). The upstream Tutorial is valid
UTF-8: its `©` on line 37 is the two bytes `C2 A9`. Plain `tj3` fails on it only when the
locale is not UTF-8 (for example `LANG` unset, so Ruby reads files as US-ASCII). The
recorder sets `LANG=C.UTF-8`, passes `-EUTF-8` to Ruby, and the bridge sets
`Encoding.default_external` to UTF-8, so the locale cannot change results.

### Fields worth knowing

- `column` is always `null`: TaskJuggler 3.8.4 records line numbers only (every
  `SourceFileInfo` has column 0). `line` 0 is also emitted as `null`.
- Messages carry their scenario: the bridge turns off TaskJuggler's `hideScenario`, which
  `tj3` leaves on. Paths in `file` and in message text are workspace-relative.
- `ProjectInfo.version` and `ProjectInfo.timezone` are `null` unless the plan writes them.
- After a parse error, `project` is filled if the project header was complete, and `tasks`,
  `resources` and `bookings` are empty.
- `milestone` is scenario-specific in TaskJuggler; `TaskResult.milestone` is its value in
  the first active scenario.
