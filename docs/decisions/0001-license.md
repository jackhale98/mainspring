# ADR-0001: License

Status: accepted, 2026-11-11.

## Context

Mainspring bundles TaskJuggler 3.8.4, which is licensed GPL-2.0-only (`engine/tj/COPYING`,
`taskjuggler.gemspec`). Code combined with it must be under a GPL v2 compatible license.
GPL v3 and Apache-2.0 are not compatible.

## Decision

Mainspring's own code is licensed **GPL-2.0-or-later**. The repository's `LICENSE` file is the
GPL v2 text. TaskJuggler stays unmodified in `engine/tj/` with its own notices, under
GPL-2.0-only.

## Consequences

- The distributed app, which combines Mainspring with TaskJuggler, is effectively GPL-2.0.
- Source files carry `SPDX-License-Identifier: GPL-2.0-or-later`; `package.json` uses the same
  identifier.
- Dependencies shipped in the app bundle must be GPL v2 compatible (MIT, BSD, ISC and
  similar). Apache-2.0-only and GPL v3 only runtime dependencies are not allowed. Build and test
  tools that are not shipped (TypeScript, Playwright) are not affected.
- Open issue: Dexie (D1, used from Phase 4) is Apache-2.0. Before it ships, either replace it
  with a compatible IndexedDB wrapper or record a decision that accepts it.
- Mycelium modules copied in Phase 4 must be relicensed to GPL-2.0-or-later first. That is
  possible only if their sole author agrees, so check for outside contributions before copying.
