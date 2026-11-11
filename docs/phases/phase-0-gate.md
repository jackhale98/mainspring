# Phase 0 gate: Foundation and engine

Status: **waiting for approval.** Evidence recorded 2026-11-11 on branch
`claude/new-session-6tly46`. Spec: `docs/phases/phase-0.md`.

## Verdict

Both gate criteria pass, with one deviation that needs your approval (item 2 below) and one
provisional input (the goldens were recorded on Ruby 3.3.6, not 3.4.x).

| Gate criterion (verbatim) | Result |
| --- | --- |
| "every golden plan scheduled in the worker matches native output exactly" | **Pass.** 34 of 34 plans match in Chromium through the real worker |
| "the UI thread stays responsive (no task over 50 ms) while a 1,000-task plan schedules" | **Pass, with deviation 2.** No long task while scheduling or handling the result; engine boot on first load stalls frames for about 100 ms |

## Decisions needed from you

1. **Approve the gate**, so Phase 1 can start.
2. **Approve the engine-boot deviation** (spec section 11, item 18). On first load, V8 compiles
   the 30 MB ruby.wasm on every renderer thread-pool worker; raster work queues behind it, so a
   frame that shows newly typed text waits about 100 ms (up to 2 such frames, 62 to 104 ms in
   the runs below). The main thread itself is idle (about 1 ms of CPU). No web API limits compile
   parallelism. The test caps each boot long task at 250 ms and asserts zero long tasks once the
   engine is ready. Mitigation planned for Phase 4: Chrome's wasm code cache through
   `WebAssembly.compileStreaming`, which removes the compile on repeat visits.
3. **OpenSSL inside ruby.wasm** (ADR-0001, open issue). `@ruby/3.4-wasm-wasi` 2.10.1 statically
   links OpenSSL 3.2.0 (Apache-2.0). Mainspring never loads it, but it ships in
   `public/engine/ruby.*.wasm.gz`. Recommended: build a ruby.wasm without the openssl extension
   before any public release. Does not block Phase 1.

## Criterion 1: golden parity

`npm run test:golden` (Chromium 1243, the production build with dev pages, the real worker):

- 34 of 34 manifest plans match their golden: 5 upstream examples, the PoC sample, 20 synthetic
  plans and 8 bridge fixtures (spec 6.1). One long-lived client ran them in seeded shuffled
  order (seed 20261111); `upstream-fedora-20` matched again in a fresh page and client.
- Comparison is canonical JSON equality of the whole result except `revision` and `timings`
  (spec 6.3). Unit tests show a one-minute date change and a message-text change both fail.
- The suite also asserts: the exact plan count, manifest ids one to one with `expected/`, every
  golden's `tjCommit` equal to `engine/tj.pin.json`, the built engine's commit equal to the pin,
  each golden's `now` and `entry` equal to the manifest's, and that a long-lived worker forgets a
  file a later request leaves out (`bad_include`).
- Native side: `npm run golden:verify -- --allow-ruby` reproduces all 34 committed goldens, and
  the independent cross-check against the real `tj3` CLI (CSV report, project frame, scenarios,
  messages) agrees on all 34.
- CI: the `golden` job runs on every push (for example run 14,
  https://github.com/jackhale98/mainspring/actions/runs/43075857637, all jobs green).

Timings (worker total ms, this machine, 4 vCPU; native from `engine/golden/native-timings.json`):

| Plan | Tasks | Worker ms | Native ms | Ratio |
| --- | ---: | ---: | ---: | ---: |
| upstream-fedora-20 (shuffled) | 414 | 3754 | 684 | 5.5 |
| upstream-fedora-20 (fresh client) | 414 | 4624 | 684 | 6.8 |
| syn-20-scale-1000 | 1225 | 7296 | 2100 | 3.5 |
| upstream-tutorial | 15 | 870 | 184 | 4.7 |
| poc-sample | 13 | 535 | 79 | 6.8 |
| other 29 plans | 0 to 18 | 9 to 729 | 47 to 154 | 0.2 to 13.4 |

The full per-plan table is written to `test-results/golden-report.md` by every run and uploaded
by CI. Small plans are dominated by fixed parse cost; the PoC measured about 3x native for Fedora
on a faster machine. Engine boot (download excluded): 1.3 to 1.8 s.

## Criterion 2: UI-thread responsiveness

`npm run test:responsiveness` (`tests/e2e/engine-responsiveness.spec.ts`, Chromium, plan
`syn-20-scale-1000`, a CSS and a rAF animation running, a key typed every 100 ms). Three asserted
runs plus a 4x CPU-throttled run (reported only). Second local run:

| Run | Window | Long tasks (over 50 ms) | Trace max task ms (its CPU) | Max rAF gap ms | Max keystroke-to-paint ms (whole / after ready) | Worker scheduleMs |
| --- | --- | --- | --- | ---: | --- | ---: |
| 1 | cold | 1, during boot; 0 after ready | 103.7 (1.4) | 116.7 | 136 / 48 | 3762 |
| 1 | warm | 0 | 6.5 (5.8) | 16.8 | 48 | 3687 |
| 2 | cold | 2, during boot; 0 after ready | not traced | 100.0 | 144 / 48 | 3679 |
| 2 | warm | 0 | not traced | 16.8 | 48 | 3841 |
| 3 | cold | 0 | not traced | 33.3 | 64 / 48 | 4056 |
| 3 | warm | 0 | not traced | 16.8 | 48 | 4099 |
| 4x throttled | cold | 2, during boot; 0 after ready | not traced | 83.4 | 128 / 72 | 4373 |
| 4x throttled | warm | 0 | not traced | 33.4 | 64 | 4435 |

Assertions in every run: zero long tasks after the engine is ready and in the warm window; each
boot long task at most 250 ms; keystroke-to-paint (Event Timing) at most 100 ms after ready and
in the warm window; result `ok` with 1,225 tasks and worker `scheduleMs` of at least 1,000. Run 1
also records Chromium traces: the longest warm main-thread task must be at most 50 ms, and the
cold trace must carry thread CPU time showing the boot task was blocked, not busy. CI runs this
suite in the `e2e` job and always uploads the report and traces.

## Phase deliverables

| Plan bullet | Evidence |
| --- | --- |
| Scaffold from mycelium-web tooling; CI on every push | `ci.yml`: format, typecheck, 255 unit tests, e2e on desktop, Pixel 7 and iPhone 14 with axe, golden parity, responsiveness, engine build `--check`, no-Ruby check |
| PoC engine in `engine/`, Web Worker, latest-wins queue, hashed bundle | `engine/bridge/`, `src/engine/` (queue and client with fast-check properties), `engine/build-bundle.mjs` (deterministic, `--check`) |
| Golden corpus with committed native outputs | `engine/golden/manifest.json` (34 plans), `expected/`, `native-timings.json`, `record-native.mjs` |

Assets: `ruby.4b814fc9d135.wasm.gz` 9,058,728 bytes (30.6 MB raw);
`tj-bundle.2296c6271e73.json.gz` 390,436 bytes. Pinned `@ruby/3.4-wasm-wasi` and
`@ruby/wasm-wasi` 2.10.1, `@bjorn3/browser_wasi_shim` 0.4.2.

Screenshots (placeholder shell, engine Ready): `screenshots/phase-0/app-desktop.png`,
`app-phone.png` (Pixel 7), `app-phone-dark.png`.

## Decisions made during Phase 0

- ADR-0001: GPL-2.0-or-later. ADR-0002 and its addendum: `options.now` (whole UTC hours only),
  bookings are all allocated time, results after a newer edit are delivered as `latest: false`,
  dates as minutes, client transport and error contract, nullable source fields, stable sorting
  in wasm, UTF-8 decoding with one BOM stripped.
- Corpus grew from 26 to 34 plans (bridge error-path fixtures).
- Findings about TaskJuggler 3.8.4, recorded in the fixtures: lower limits (`dailymin` and
  similar) are never enforced; `weekstartsmonday` does not affect scheduling; `select` ties are
  broken by sort order (the reason for the stable-sort patch).

## Open items carried forward

| Item | When |
| --- | --- |
| Re-record goldens on Ruby 3.4.x on a glibc Linux (Debian or Ubuntu), then `golden:verify` | Before Phase 1 work merges; needs a machine with Ruby 3.4 |
| ruby.wasm without OpenSSL (or an ADR accepting it) | Before any public release |
| Dexie is Apache-2.0 (ADR-0001) | Before Phase 4 ships it |
| wasm code cache to remove the boot stall on repeat visits | Phase 4 (service worker) |
| Golden parity in Firefox and WebKit (nightly, not gating) | `nightly.yml` still disabled; enable in Phase 1 |
| Make `golden` and `e2e` required checks | GitHub branch protection, your setting |
| `/app` shows only engine status; version and timings | Phase 2 |
| Plan 06: task `first` ends 02-16 in the tracking scenario although fully booked | Investigate when tracking UI starts (Phase 5); parity is unaffected |
