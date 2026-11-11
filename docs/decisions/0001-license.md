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
- Open issue, blocks any public release: the ruby.wasm binaries in `@ruby/3.4-wasm-wasi`
  2.10.1 statically link OpenSSL 3.2.0 (Apache-2.0, about 154 `ossl_*` symbols). Mainspring
  never loads it, but the code ships inside `public/engine/ruby.*.wasm.gz`. The options are to
  build a custom ruby.wasm without the openssl extension (`rbwasm build` with a custom
  profile; recommended) or to record a decision that accepts it. See
  `THIRD_PARTY_NOTICES.md`.
- Mycelium modules copied in Phase 4 must be relicensed to GPL-2.0-or-later first. That is
  possible only if their sole author agrees, so check for outside contributions before copying.

## Addendum, 2026-11-11: ports of TaskJuggler code

Some Mainspring files are close translations of TaskJuggler's Ruby code into TypeScript or Ruby
patches (the tokenizer port of `ProjectFileScanner`, parts of the value parsers, the wasm time
patch, and the keyword table built from TaskJuggler's documentation). Those files are derived
from GPL-2.0-only code, so they carry `SPDX-License-Identifier: GPL-2.0-only` and a header line
naming the TaskJuggler source they follow. All other Mainspring files stay GPL-2.0-or-later. The
distributed app is GPL-2.0 either way.
