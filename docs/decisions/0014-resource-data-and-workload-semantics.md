# ADR-0014: Resource data and workload semantics

Status: accepted by the user, 2026-11-14 ("every recommendation in section 18 accepted as
written").
Source: `docs/phases/phase-3.md` sections 5, 6.1 to 6.6, 12 and 18.1 to 18.14, except 18.11,
which is in ADR-0013. Extends ADR-0007.

## Context

The heatmap, the lanes, the calendar and the explainer need each person's available time, leaves
and requested allocations. Schema v2 has none of them. `ResourceResult` holds only `group` and
`efficiency`. `ProjectInfo` has no week start and no leave list.

Bookings already hold every scoreboard slot. Booked time can be derived from them exactly.

TaskJuggler levels as it schedules. It does not book a person twice in one slot, except for
`overtime` bookings. So booked time above available time almost never happens. A heatmap that
turns red only above 100% would almost never be red. Demand that does not fit shows in
TaskJuggler as work that waits, or as work that runs without its people.

Fedora 20 declares no resources. The gate therefore uses `fedora-res`, a copy of Fedora 20 with a
generated resource pool (18.1).

## Decision

1. **Bridge schema v3 (18.4, 6.1).** One schema bump adds these fields.
   - `ProjectInfo.weekStartsMonday` and `ProjectInfo.leaves` (global leaves with type and name).
   - Per resource scenario: `workingTime` (the slots the person could work) and `leaves` (leave
     slots by type).
   - Per task scenario: `allocate` (the requested candidates after inheritance).

   Every golden is re-recorded. The goldens stay provisional on Ruby 3.3.6 (ADR-0003 #5, amended).
   The user records on Ruby 3.4 once, after the bridge change merges. A native `tj3` weekly-load
   cross-check checks the new fields against the goldens' bookings (5.3).
2. **Load is derived from bookings (18.2, 18.4).**
   - Booked time per person and per bucket is the sum of the `bookings` intervals in that bucket.
     It is exact, in integer minutes. No per-day load field is added.
   - Available time is the sum of `workingTime`. A group row is the sum of its members.
   - A cell shows booked time, not time weighted by efficiency. Available time is not weighted
     either. The cell details show the effective effort, weighted by efficiency, beside the
     hours.
3. **Bands and "over" (18.3, 5.4, 6.2).**
   - Two thresholds are set per plan: spare below 80%, and over above 100%. They can be changed
     in the Workload toolbar. They are stored in the browser for each plan (ADR-0008 #3).
   - The band rules are:
     - `off` when both booked and available are 0;
     - `over` when booked is above available, or work is held or unmet for that person in the
       cell, or the percentage is above the upper threshold;
     - `spare` when the percentage is below the lower threshold;
     - `full` in every other case.
   - **Held** work: an effort task starts later than its dependencies, frame and constraints
     allow, while every person it asked for was booked elsewhere or on leave.
   - **Unmet** work: a length or duration task runs while a person it asked for is booked on
     another task, so part of its span is done without them.
   - The cell says why, for example "Full, and 2 tasks wait for Dev 1".
4. **The ADR-0007 display-data rule covers the new derived data (18.13).** Load, demand, causes
   and health are pure functions of the `ScheduleResult` and the index. They are:
   - never sent to the engine;
   - never a task's date;
   - never shown as a date the engine produced.

   Interpretations are labelled. Estimated minutes are shown with "about". The explainer names
   what the schedule shows. It never says "would have started". When it cannot tell, it says
   "The schedule does not show why." A `limits` statement is reported as "may hold it", because
   limits are not engine data until Phase 5. The explainer covers the placement (the earliest
   start for ASAP, the latest end for ALAP) and the gaps inside effort bars.
5. **Edit intents and rebalancing (6.5, 6.6, 18.7, 18.9, 18.12).**
   - Two new intents go through the edit API: `clearLeave` and `gapToTask`. Each has refusals,
     fidelity families and engine tests.
   - Dropping a task on another person is `replaceAllocation`. Moving it to another week is the
     Phase 2 `move` action. The move preference (start, gap, or end for ALAP) and the one-time
     constraint warning apply.
   - One drop is one intent. A cell with several movable tasks asks "Move which task?".
   - A drop on a group row is refused.
   - Work booked through a group allocation is refused, with "Booked through Team. Change the
     task's people in its details."
   - "Add group" adds a resource. People join a group by drag or by the "Group" select in the
     details (`moveResource`). Moving a person into a person who has allocations is refused
     (`not-a-group`).
   - Allocation alternatives get no intent. Tasks with alternatives are refused with a sentence
     and "Show in text". Placeholders, limits shown as caps, shifts editing and alternatives stay
     in Phase 5.
6. **Plan health set H1 to H9 (18.8, section 12).** These checks ship.
   - H1 no predecessor; H2 no successor; H3 hard constraint; H4 constraint warning; H5 long gap;
     H6 long task; H7 held by people; H8 work without its people; H9 TaskJuggler resource
     warnings.
   - Defaults: a long gap is over 5 working days (`gapduration` is measured at its own rate). A
     long task is over 20 working days.
   - The start and finish milestones are exempt from H1 and H2.
   - Each check can be turned off per plan.
   - Each check has a pass fixture and a fail fixture (16.2).
7. **Leave text (18.5).**
   - A person's leave goes in the person's declaration body. Global holidays go after the project
     header.
   - The form is `<type> "<name>" <start> - <end>`. The end is the exclusive next day. The edit
     API chooses this form, and the engine checks it.
   - The defaults are `annual` for a person and `holiday` for Everyone.
   - `vacation` stays readable. It is edited as `holiday`.
   - Leaves that come from shifts or macros stay text-only.

## Consequences

- One schema bump and one re-record of every golden. The goldens stay provisional on Ruby 3.3.6.
- The bridge reads the resource scoreboard after scheduling. Its cost is recorded per golden
  (`serializeMs`). The target is at most 10% more total engine time on the two large goldens.
- Golden parity runs on schema v3. The fast-path equivalence suite is run on v3 before the bridge
  change merges (5.3).
- The derived work runs in idle tasks, after the Gantt's analysis (8.3). Its timings are recorded,
  not enforced.
- The gate's heatmap criterion is shown on `fedora-res`. The Workload view on Fedora 20 shows "No
  people in this plan yet", and the gate file says so rather than counting it as evidence (16.1).
- A cell's hours are booked time. TaskJuggler's effort report is weighted by efficiency. The
  cross-check compares bookings times efficiency (5.3), and the cell details show both (18.2).
- "Over" appears through held and unmet work as well as through the thresholds. The fixtures must
  show red appearing (section 15).
- Phone checks are judged under emulation, with the Pixel 7 DOM-node cap enforced. The phone frame
  target of 90% is recorded, not enforced (18.14).
