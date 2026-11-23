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
  `THIRD_PARTY_NOTICES.md`. ADR-0006 (2026-11-12) lets the GitHub Pages preview ship the stock
  binary; that exception covers the preview only, and this issue still blocks the real release
  on Cloudflare.
- Mycelium modules copied in Phase 4 must be relicensed to GPL-2.0-or-later first. That is
  possible only if their sole author agrees, so check for outside contributions before copying.

## Addendum, 2026-11-11: ports of TaskJuggler code

Some Mainspring files are close translations of TaskJuggler's Ruby code into TypeScript or Ruby
patches (the tokenizer port of `ProjectFileScanner`, parts of the value parsers, the wasm time
patch, and the keyword table built from TaskJuggler's documentation). Those files are derived
from GPL-2.0-only code, so they carry `SPDX-License-Identifier: GPL-2.0-only` and a header line
naming the TaskJuggler source they follow. All other Mainspring files stay GPL-2.0-or-later. The
distributed app is GPL-2.0 either way.

## Amendment 2026-11-23: Phase 4 decisions (user, Phase 4 approval)

Source: `docs/phases/phase-4.md` section 18, items 18.4, 18.5 and 18.13, and section 20. The
decisions are recorded in ADR-0019 and ADR-0020.

- **Dexie is not used (18.5).** Storage uses a small IndexedDB wrapper of Mainspring's own (ADR-0019
  #5). The Dexie open issue above is closed.
- **OpenSSL path (18.13).** The chosen path is a custom ruby.wasm built without the openssl
  extension (task T13), which is the recommended option above. Accepting OpenSSL by ADR is the
  fallback. It is not taken. The Pages site and any later staging ship only the new build. The
  ADR-0006 exception ends when that build ships on Pages. The open issue above stays open until then,
  and it still blocks a real release.
- **Mycelium is not copied wholesale (18.4).** Task T2 first confirms sole authorship. After that,
  only pieces that fit the interfaces are reused, likely the diff3 helpers, relicensed
  GPL-2.0-or-later. The check for outside contributions above still applies to any copied code.
