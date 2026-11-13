# Phase 2 gate: Gantt and visual editing

Status: **in progress.** This file collects the gate evidence as the Phase 2 tasks land (T27
completes it). Sections so far: the edit API timing table (T6).

## Edit API timings (T6)

Spec: phase-2.md T6 and 11.3 ("T6 measures again and fixes anything over 50 ms p90 on Fedora,
because the drop path depends on it"), 19.19, and phase-1-audit.md §2.1.

**Method** (`tests/perf/text-mode-timings.test.ts`, cases in `tests/perf/edit-intent-cases.ts`):

- Every `EditIntent` type, plus the Gantt drop path (`checkAction` in `src/lib/gantt/intents.ts`:
  `planAction`, then the `applyIntent` dry run) for the 7.1 rows.
- **Cold runs.** Each run gets a fresh workspace and a fresh index (built outside the timing), so
  no cache from an earlier run helps; in the app every edit starts from a new snapshot. The
  audit's runs repeated one intent on one snapshot, 8 times.
- 30 timed runs per case after 3 warm-ups; p50, p90 and max of wall time.
- Plans: Fedora 20 with the engine's hints, as the app indexes it. Fedora declares no resources,
  leaves or allocations, so those intents run on **Fedora+res** (Fedora plus a global leave, a
  group of two resources, one with a leave, and `allocate dev` in one leaf). Fedora's project
  header is built by macros, so its project intents are refused at once (`text-only`); they run
  on **scale-1000** (5,628 lines, 2.3 times Fedora) instead.
- Machine: the shared 4-vCPU cloud sandbox of the audit, Node 22.23.4, other agent sessions on
  the same machine. The table is one run at load average 2.5 to 3. Absolute values are upper
  bounds for a dedicated desktop.

**Changes** (commits 52fe6804 and 145e84dd):

- The dependency loop check (`edit/dep-loops.ts`) walks integer indices and typed arrays instead
  of string keys. A property test checks it against the string-keyed walks it replaced
  (`dep-loops-testing.ts`, 20,000 random graphs).
- `edit/dep-graph.ts` checks scenarios that read every statement alike only once (Fedora's two
  scenarios have no prefixed statements), and `newLoop` reuses the cached loops of the edit's
  own index for the before side.
- `updateFile` keeps its last result per file, so `buildEdit` reuses the tree that the edit's
  checks already reparsed instead of parsing the edited file a second time.
- `valueDiagnostics` is cached per index (the runner and the project re-check ask for the same
  one).

**Before and after, structural intents** (cold harness, wall ms, run back to back at load average
10 to 13; before = the lib code at d7bb151f):

| Intent | Before p50 | Before p90 | After p50 | After p90 |
| --- | --- | --- | --- | --- |
| `addTask` | 38.7 | 51.2 | 33.4 | 44.0 |
| `deleteTask` | 43.0 | 48.3 | 28.8 | 36.4 |
| `moveTask` | 50.0 | 73.6 | 30.5 | 38.0 |
| `addDepends` | 31.9 | 50.5 | 21.5 | 33.2 |
| `removeDepends` | 14.4 | 20.5 | 13.1 | 19.5 |
| Gantt link (R3) | 33.1 | 50.2 | 21.9 | 32.4 |
| Gantt reorder (R5) | 41.9 | 54.5 | 38.2 | 45.1 |

**After: every intent** (wall ms; target 50 ms p90; status is what the intent returned):

| Intent | Plan | Status | p50 | p90 | max |
| --- | --- | --- | --- | --- | --- |
| `setAttr priority` | Fedora | edit | 4.33 | 6.94 | 22.74 |
| `setAttr length` | Fedora | edit | 3.98 | 6.55 | 24.67 |
| `setAttr start` | Fedora | edit | 4.04 | 6.18 | 8.59 |
| `setAttr complete` | Fedora | edit | 3.99 | 5.72 | 6.19 |
| `removeAttr flags` | Fedora | edit | 3.13 | 6.42 | 8.59 |
| `renameTask` | Fedora | edit | 3.00 | 4.57 | 5.60 |
| `addTask` | Fedora | edit | 22.79 | 26.03 | 36.70 |
| `deleteTask` | Fedora | edit | 20.31 | 25.96 | 40.91 |
| `moveTask` | Fedora | edit | 25.47 | 36.52 | 63.30 |
| `addDepends` | Fedora | edit | 20.68 | 26.02 | 34.61 |
| `removeDepends` | Fedora | edit | 12.72 | 16.17 | 20.73 |
| `setDependsGap` | Fedora | edit | 3.07 | 3.57 | 5.04 |
| `declareFlag` | Fedora | edit | 2.90 | 4.51 | 5.78 |
| `format` | Fedora | noop (already formatted) | 6.08 | 9.64 | 10.22 |
| `setProjectHeader` | scale-1000 | edit | 5.28 | 8.94 | 15.30 |
| `setProjectAttr` | scale-1000 | edit | 34.55 | 43.70 | 52.77 |
| `removeProjectAttr` | scale-1000 | edit | 33.51 | 49.80 | 55.72 |
| `setWorkingHours` | scale-1000 | edit | 35.60 | 50.76 | 72.10 |
| `allocate` | Fedora+res | edit | 4.97 | 8.14 | 9.09 |
| `addAllocation` | Fedora+res | edit | 3.70 | 6.54 | 9.54 |
| `removeAllocation` | Fedora+res | edit | 3.40 | 5.86 | 6.26 |
| `replaceAllocation` | Fedora+res | edit | 3.43 | 5.61 | 6.67 |
| `addResource` | Fedora+res | edit | 4.52 | 6.35 | 7.96 |
| `deleteResource` | Fedora+res | edit | 4.10 | 5.52 | 6.35 |
| `moveResource` | Fedora+res | edit | 4.17 | 6.82 | 9.81 |
| `renameResource` | Fedora+res | edit | 2.78 | 4.02 | 5.79 |
| `setResourceAttr` | Fedora+res | edit | 2.80 | 5.14 | 10.79 |
| `removeResourceAttr` | Fedora+res | edit | 2.94 | 6.10 | 8.66 |
| `addLeave` | Fedora+res | edit | 3.67 | 4.86 | 8.42 |
| `updateLeave` | Fedora+res | edit | 2.70 | 3.98 | 4.86 |
| `removeLeave` | Fedora+res | edit | 2.83 | 5.01 | 5.37 |
| Gantt resize (R1) | Fedora | edit | 3.65 | 5.18 | 7.26 |
| Gantt move, `start` (R2) | Fedora | edit | 4.41 | 6.87 | 7.51 |
| Gantt move, `gap` (R2) | Fedora | edit | 3.22 | 6.13 | 12.60 |
| Gantt link (R3) | Fedora | edit | 22.46 | 29.58 | 35.40 |
| Gantt unlink (R4) | Fedora | edit | 13.60 | 19.20 | 41.75 |
| Gantt reorder (R5) | Fedora | edit | 27.42 | 39.77 | 41.07 |
| Gantt progress (R9) | Fedora | edit | 4.09 | 6.37 | 7.43 |

**Result.** On Fedora every intent and every Gantt drop path is under 50 ms at p90 with cold
caches. The structural ones (add, delete, move, link) are 20 to 27 ms at p50; what is left is
mostly the re-index of the edited file that the task-tree and anchor checks need (about half)
and the loop check of the edit's own index on first use.

**Open.** The project intents, measured on the 1,000-task plan, are at 44 to 51 ms p90 cold. They
re-index the whole edited file and compare its value diagnostics (`edit/revalidate.ts`). In the
app the runner has usually computed the "before" diagnostics for the same index already, which
saves about 6 ms. They come from the project sheet, not from a drag, so they are not on the 7.3
drop path. Making the re-check incremental (only the statements after the changed setting) is
the next step if the gate wants them under 50 ms on that plan too.
