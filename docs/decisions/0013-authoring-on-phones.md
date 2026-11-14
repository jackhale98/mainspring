# ADR-0013: Authoring on phones

Status: accepted by the user, 2026-11-14 (out-of-phase scope, approved through phase-3 18.11 (a)
to (e)).
Source: `docs/phases/phase-3.md` sections 1, 6.8, 7.1 (W9, W11), 9.8 and 18.11. The track is
built early in Phase 3 (T3, T4 and T5).

## Context

Plans open only from the built-in samples. The app cannot make a new plan. Adding a task needs
a selected row, then the row menu (`...`, Add) or Insert. An empty plan has no visual way to add
its first task. The user said on 2026-11-14: "Right now on mobile it's difficult to actually
create a plan and add tasks."

The edit API already has `addTask`. The engine already reports a header-only plan as `no_tasks`.
The gap is in the app shell. This work was not in the Phase 3 bullets, so it needs this ADR.

## Decision

1. **Add task (+).** The Gantt toolbar has a + control on every layout. It is 44 px on a coarse
   pointer. It is also in the phone's Plan tab header.
   - With no task selected, or in an empty plan, the task is added at the end of the plan.
   - With a task selected, a two-item menu offers "Add task after" (the default) and
     "Add subtask".
   - The edit goes through `addTask` and the dispatcher. The new task is selected. The details
     open (half height on a phone), and the name field is focused with its text selected.
   - The name is set by `renameTask`. See item 4.
   - The edit API's refusals apply unchanged.
2. **New plan.** The plan chooser lists "New plan…" first, then a "Samples" group.
   - The form has three fields. Name is required. Start is a date, today by default. Time zone
     is a select, with the device's zone by default. "None (UTC)" is also offered.
   - The new plan is a header only, with nothing else:
     `project <id> "<name>" <start> +1y { timezone "<zone>" }`.
   - The frame runs one year from the start. The project sheet can change it later. A short
     frame would make a beginner's tasks run past the end.
   - "Create" opens the plan as a new in-tab workspace with an empty history. The chooser lists it
     as "Name (new)" above the samples.
   - Choosing "New plan…" again, or a sample, replaces it. If the new plan was edited, the app
     asks first.
   - The note "Changes stay in this tab until saving arrives" applies, as it does for samples.
3. **Empty states.** The engine's `no_tasks` is an empty plan, not an error.
   - The status reads "No tasks yet". Deleting the last task settles as "Deleted. The plan has no
     tasks."
   - No error pin is shown.
   - Each layout shows a prompt with the Add task button (9.8).
4. **Add, then rename, is two undo steps.** Each step is labelled in History (18.11 (e)).
   Merging them would need a dispatcher change for little gain.

## Consequences

- No new intent is added. No storage is added. A new plan exists only in the tab until saving
  arrives in Phase 4.
- Phase 4 adds saving a new plan to a folder or a repository.
- Preferences for a new plan use the key `new`, as the other per-plan preferences do
  (ADR-0008 #3).
- Every UI state in this track ships with a phone-emulation screenshot (CLAUDE.md, "Mobile
  counts").
- The track is small and runs before the workload work. T3 and T4 depend on this ADR.
