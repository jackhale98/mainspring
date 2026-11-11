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
