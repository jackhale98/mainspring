# Mainspring: rules for Claude Code

Mainspring is a static, offline-first PWA for TaskJuggler plans. The real TaskJuggler 3.8.4
scheduler runs in the browser on ruby.wasm, inside a Web Worker. The `.tjp`/`.tji` text is the
only source of truth.

## Before any work

- Read `docs/BUILD_PLAN.md` and the current phase spec `docs/phases/phase-N.md`.
- Work only on tasks in the current phase spec. Anything outside it needs an ADR in
  `docs/decisions/` that the user has approved.
- Stop at each phase gate: record the evidence in `docs/phases/phase-N-gate.md` and wait for
  the user's approval before starting the next phase.

## Hard rules

- Text is the source of truth. Views never change the schedule directly; every edit goes
  through the `src/lib/tjp` edit API and becomes a minimal text patch.
- Never modify `engine/tj/` (upstream TaskJuggler at commit `3b36c79`). Change behaviour with
  patches in `engine/bridge/` instead.
- Golden parity (`npm run test:golden`) must pass before any merge.
- No schedule is ever computed outside the browser engine at runtime. Native `tj3` runs only in
  the developer script that produces the golden outputs.
- Mobile counts: every UI change ships with a phone-emulation screenshot.
- Licensing: Mainspring is GPL-2.0-or-later (ADR-0001). TaskJuggler in `engine/tj/` is
  GPL-2.0-only; keep it unmodified with its notices. Runtime dependencies must be GPL v2
  compatible (no Apache-2.0-only or GPL v3 code in the shipped bundle).

## Conventions

- TypeScript strict; no `any` in `src/lib`.
- Every module in `src/lib` has unit tests beside it.
- No file over 400 lines without a reason in its header.
- User-facing copy lives in one strings file.
- Commits follow Conventional Commits.
- Dates in views are plain integers (minutes since project start); use `Intl` for display only.

## Delegation

Delegate by the agent table in `docs/BUILD_PLAN.md` ("Claude Code execution plan"). Do not do
Haiku-sized work (fixtures, test runs, log triage, docs formatting) in the main session.

| Agent | Use it for |
| --- | --- |
| `architect` | Phase specs, interfaces, ADRs. Read-only: it returns the text and the main session saves it unchanged |
| `engine-specialist` | `engine/`, `src/engine/`, golden parity, fast-path spike |
| `grammar-specialist` | Lezer TJP grammar, symbol index, edit API, merge hints |
| `ui-builder` | Svelte components, canvas views, gestures, layouts, design tokens |
| `test-writer` | Unit, property and Playwright tests from acceptance criteria |
| `perf-a11y-auditor` | Performance budgets, axe, Lighthouse |
| `reviewer` | Read-only review of every branch before merge |
| `fixture-maker` | Synthetic golden plans, native `tj3` output script, sample data |
| `test-runner` | Run suites, return only a failure summary |
| `docs-writer` | Help pages, README, changelog, ADR formatting |

## Working loop for each phase

1. `architect` writes `docs/phases/phase-N.md`; the user approves it.
2. The main session splits tasks and runs independent ones in parallel subagents, each in its
   own worktree.
3. `test-writer` writes tests from the acceptance criteria before or alongside the code.
4. `test-runner` runs suites; failures go back to the owning agent.
5. `reviewer` reviews each branch; merge only after a clean review.
6. Record the gate evidence (test output, desktop and phone screenshots, timings) in
   `docs/phases/phase-N-gate.md` and stop for approval.

## Current status

- Phase 0 approved 2026-11-11 (`docs/phases/phase-0-gate.md`).
- Phase 1 in progress (`docs/phases/phase-1.md`, approved 2026-11-11; ADR-0003). Goldens are
  provisional (Ruby 3.3.6) until the user re-records them on Ruby 3.4 (ADR-0003 #5, amended).
- Public preview on GitHub Pages from `main` (ADR-0006); the OpenSSL issue in ADR-0001 still blocks a real release.
- `poc/` is the frozen proof of concept; see `poc/INVENTORY.md`. Never edit it.
