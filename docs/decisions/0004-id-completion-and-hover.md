# ADR-0004: Id completion and id hover in Phase 1

Status: accepted by the user, 2026-11-12.

## Context

Phase 1's spec (section 2) lists id completion as a non-goal, and the build plan puts go to
definition and rename symbol in v1. While building the CodeMirror extensions (T13), completion of
task and resource ids and a hover showing where an id is declared were built and tested on top of
the symbol index, at little extra cost.

## Decision

Phase 1 ships both: completion offers task ids after `depends` and `precedes` and resource ids
after `allocate`, `responsible` and `managers`, from the index; hovering an id shows its
declaration (file, line and header). Go to definition and rename symbol stay in v1.

## Consequences

- Text mode turns id completion on by default (`ids: true`).
- The Phase 1 gate's end-to-end and accessibility checks cover both features.
