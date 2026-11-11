# Golden corpus

Plans whose native TaskJuggler outputs the browser engine must reproduce exactly
(`docs/phases/phase-0.md`, section 6). `manifest.json` lists them; `expected/<id>.json`
holds each plan's recorded output.

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
