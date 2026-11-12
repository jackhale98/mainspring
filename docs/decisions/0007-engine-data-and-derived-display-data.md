# ADR-0007: Engine data and derived display data

Status: accepted by the user, 2026-11-12 ("Approve as recommended"). Source:
`docs/phases/phase-2.md` sections 5.2, 18.1 and 18.2, and 19.6.

## Context

The Gantt needs more from the engine than schedule v1 gives. v1 has `start`, `end`,
`scheduled`, `allocated`, `criticalness` and `pathCriticalness`. It does not have:

- resolved dependencies (after inheritance, with `precedes`, gaps and `onstart`/`onend`);
- `complete`;
- scheduling direction (asap or alap);
- the project's working time and `dailyworkinghours`.

TaskJuggler resolves these itself. Doing it again on the main thread would mean
reimplementing parser semantics.

The Gantt also wants a critical path, float and day snapping. CLAUDE.md says no schedule is
computed outside the browser engine. TaskJuggler's `criticalness` and `pathCriticalness` are
resource-contention scores that it uses to order scheduling. They are not a critical path
in the CPM sense, and they give no float. They cannot drive the highlight.

## Decision

1. **Bridge schema v2 (18.1).** The bridge adds the fields listed above to the schedule
   result. The change is in `engine/bridge/serialize.rb` and `src/engine/protocol.ts`.
   `engine/tj/` does not change. `GoldenFile.schemaVersion` becomes 2, and every golden is
   re-recorded. The goldens are provisional on Ruby 3.3.6 until the user records them on
   Ruby 3.4 (ADR-0003 #5, amended). If that re-record is still open when schema v2 merges,
   the user records once after the merge.
2. **Derived display data (18.2, section 5.2).** Critical path, total float and day snapping
   are computed on the main thread. They are pure functions of the engine result and the
   symbol index. Their output:
   - is never sent to the engine;
   - never becomes a task's start or end;
   - is never shown as a date the engine produced.

   Float and the critical path are labelled as estimates. They ignore resource limits and
   leveling. A snapped date in a drag label is a target, not a result.
3. **No TaskJuggler criticalness in the highlight (19.6).** The critical highlight comes from
   the derived driving path. The `criticalness` and `pathCriticalness` values stay in the
   result, but they do not drive the highlight.

## Consequences

- The bridge, the protocol types, the goldens and the cross-check change in one schema bump.
  The cross-check gets a dependency column only if TaskJuggler's CSV report can print one.
  If it cannot, the gate says so.
- Golden parity runs on the schema v2 goldens. They stay provisional until the Ruby 3.4
  re-record.
- The main thread computes driving links, the critical path and float in an idle task. The
  budget is 10 ms or less for 500 tasks on desktop.
- The UI labels float and the critical path as estimates ("about", and "float (estimate)" in
  the outline).
- With resource leveling, the critical path is a driving path and float is an estimate. A
  user may see a path or float that differs from what they expect. Phase 3 explains the
  drivers that resources and calendars cause.
