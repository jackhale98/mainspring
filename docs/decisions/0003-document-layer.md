# ADR-0003: Document layer decisions for Phase 1

Status: accepted by the user, 2026-11-11. Answers `docs/phases/phase-1.md` section 13.

## Context

Writing the Phase 1 spec raised seven questions the build plan leaves open (spec sections 13
and 14).

## Decisions

1. **Invalid UTF-8 (13.1).** The round-trip suite checks every corpus file byte for byte except
   `bridge-bom-invalid-utf8`, which is checked text-exact after decoding (invalid bytes become
   U+FFFD, ADR-0002 #13). Phase 4 decides what saving does with invalid bytes.
2. **Error columns (13.2).** TaskJuggler records no columns, so the document layer derives a
   column from the refined range and marks its precision. No bridge patch, no golden re-record.
3. **Wasm engine in CI (13.3).** The `fidelity` job runs the wasm engine in Node to check that
   edited plans still schedule. Native Ruby still never runs in CI.
4. **Edit API scope (13.4).** Phase 1 includes `setDependsGap` and `setAttr` for `complete`,
   because the Phase 2 gate covers every row of the direct-manipulation table.
5. **Ruby 3.4 re-record (13.5).** The user re-records the goldens on a Debian or Ubuntu machine
   with Ruby 3.4. Until then, Phase 1 work that touches neither `engine/` nor the goldens may
   merge; changes under `engine/` wait for the re-record.
6. **Required checks (13.6).** `fidelity`, `golden` and `e2e` should be required checks; the user
   sets this in branch protection.
7. **Edit rules (13.7).** Accepted as written in the spec: last-site rewrite for `supplement`
   (5.4), relative ids (`!id`) for siblings only (7.1), and indentation-only formatting (7.3).

## Consequences

- The Phase 1 gate's "byte for byte" criterion holds for 40 of the 41 corpus files, and
  text-exact for the one file with invalid bytes.
- Diagnostics in the editor carry a derived column with a precision flag.
