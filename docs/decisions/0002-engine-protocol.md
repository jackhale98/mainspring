# ADR-0002: Engine protocol decisions

Status: accepted, 2026-11-11. Answers `docs/phases/phase-0.md` section 11, items 4, 5, 6 and 14.

## Context

The build plan defines the engine worker's messages as
`schedule({files, entry, revision})`, `syntax()` and `cancel(revision)`, and says stale
results are dropped. Writing the Phase 0 spec raised four points the plan leaves open.

## Decisions

1. **`now` (11.4).** `ScheduleRequest` gets an optional `options.now` (ISO 8601 UTC). It is
   used only when the plan has no `now` line. Goldens and tests always set it, so native and
   browser runs never depend on the clock. The app may later use it for the status date.
2. **`bookings` (11.5).** `ScheduleResult.bookings` holds all allocated time after
   scheduling, per scenario, resource and task, including user-written `booking` lines. This
   matches TaskJuggler's own export and feeds the resource and workload views.
3. **Results that arrive after a newer edit (11.6).** A finished result is delivered with
   `latest: false` while a newer revision is pending or running, so long runs still update the
   view. A result older than one already delivered is dropped. `cancel` drops pending
   requests and discards in-flight results; a running schedule cannot be interrupted.
4. **Dates (11.14).** Task and booking dates are integers: minutes since the project start
   in UTC, in the worker protocol and in golden files. Only the project's `start`, `end` and
   `now` are ISO 8601 UTC strings.

## Consequences

- The protocol in `docs/phases/phase-0.md` sections 3.1 to 3.3 stands as written.
- The bridge must convert every task and booking time to whole minutes; a non-integral value
  is a bridge bug and fails parity.
- Views read minutes directly, with no `Date` parsing on the main thread.

## Addendum, 2026-11-11: details settled while building T4, T7 and T9

5. **Client transport.** `EngineClientOptions.transport` accepts a `WorkerLike` or a
   `WorkerFactory`. Only a factory can be restarted after a crash or timeout; a single worker
   instance goes to `failed` instead.
6. **`cancel` is client-side only.** The client never posts `cancel`: with one request in
   flight, the worker never holds an unstarted request, so the message would do nothing. The
   type stays in `ToWorker`, and the worker treats it as a no-op.
7. **Rejections.** `ready()` and `syntax()` reject with `EngineRequestError`, which carries an
   `EngineError`. `schedule()` still never rejects, except `RangeError` for a revision that is
   not greater than the last one.
8. **Boot timeout.** Boot and every reboot have their own watchdog (`bootTimeoutMs`, longer
   than the run timeout because the first load downloads about 9 MB). If it expires, the
   client fails with kind `boot`. A failed boot is final; the app creates a new client.
9. **Worker error contract.** Wasm traps and out-of-memory are reported as `crash`, and the
   client restarts the worker. `internal` and `invalid-request` for a revision fail only that
   request and keep the worker.
10. **Nullable fields.** TaskJuggler never records source columns, so `SourceRef.column` is
    `number | null`. `pathCriticalness` is `number | null`, because scheduling can stop before
    it is computed.
11. **`now` resolution.** `options.now` must be a valid ISO 8601 UTC instant with seconds, on a
    whole UTC hour (TaskJuggler aligns its own clock default to the hour). Any other value is
    rejected with `invalid-request` rather than silently rounded. A `now` line written in the
    plan is passed to TaskJuggler unchanged.
12. **Stable sorting.** TaskJuggler breaks ties in some choices (for example `select
    minallocated`) by sort order. Native Ruby on glibc keeps tied items in order, and ruby.wasm's
    own quicksort does not, so a wasm-only patch (`engine/bridge/wasm/tj_wasm_sort.rb`) makes
    `sort` keep ties in order. The native recorder refuses to run on platforms whose sort
    reorders ties.
13. **Text decoding.** Files are decoded as UTF-8 with invalid sequences replaced by U+FFFD,
    and exactly one leading BOM is dropped, the same way on both sides. Browser code decodes
    bytes with `TextDecoder('utf-8', { ignoreBOM: true })` and leaves BOM removal to the bridge.
