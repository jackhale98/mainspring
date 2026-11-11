# Third-party notices

Mainspring is licensed under GPL-2.0-or-later (ADR-0001). This file lists the third-party code
that ships in the built site and how its license relates to the GPL version 2. The engine build
(`engine/build-bundle.mjs`) also publishes `/engine/NOTICES.txt` next to the engine assets, with
the full license texts of everything below.

## Shipped in the engine

| Component                        | Version                              | Ships in                                                    | License                                         | GPL-2.0 compatible                                     |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| TaskJuggler                      | 3.8.4, commit `3b36c79`              | `tj-bundle.*.json.gz` (`/tj/lib`, license at `/tj/COPYING`) | GPL-2.0-only                                    | Yes (the combined engine is distributed under GPL-2.0) |
| ruby.wasm, `@ruby/3.4-wasm-wasi` | 2.10.1, file `dist/ruby+stdlib.wasm` | `ruby.*.wasm.gz`                                            | MIT                                             | Yes                                                    |
| CRuby (inside that binary)       | 3.4.1                                | `ruby.*.wasm.gz`                                            | Ruby license or BSD-2-Clause (Ruby's `COPYING`) | Yes, taken under BSD-2-Clause                          |
| `@ruby/wasm-wasi` (JS glue)      | 2.10.1                               | engine worker script                                        | MIT                                             | Yes                                                    |
| `@bjorn3/browser_wasi_shim`      | 0.4.2                                | engine worker script                                        | MIT OR Apache-2.0                               | Yes, used under MIT                                    |

`@ruby/wasm-wasi` depends on `tslib` (0BSD), but only its `browser.script` entry imports it; the
engine worker does not, so `tslib` is not in the built site.

The ruby.wasm binary statically links further libraries. Its own `NOTICE` (reproduced in
`/engine/NOTICES.txt`) lists them:

| Library                                    | License                                                                         | GPL-2.0 compatible                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Onigmo (regular expressions)               | BSD-2-Clause                                                                    | Yes                                                                 |
| LibYAML                                    | MIT                                                                             | Yes                                                                 |
| zlib                                       | Zlib                                                                            | Yes                                                                 |
| wasi-libc                                  | Apache-2.0 WITH LLVM-exception, Apache-2.0 or MIT; parts CC0, MIT, BSD-2-Clause | Yes, taken under MIT                                                |
| wasi-vfs (packs the Ruby standard library) | Apache-2.0 WITH LLVM-exception                                                  | Yes: the LLVM exception waives the terms that conflict with GPL-2.0 |
| OpenSSL                                    | Apache-2.0 (version 3.2.0)                                                      | **No** (see below)                                                  |

## Shipped in the page scripts

The site's own scripts in `dist/_astro/` are bundled by Vite. Checked on a build with
`MAINSPRING_DEV_PAGES=1`, the only third-party code in them besides the engine worker (above) is
the Svelte client runtime (`svelte` 5.57.2, MIT, in `client.svelte.*.js`), which GPL-2.0 permits.
Astro 7.4.1 (MIT) adds no runtime of its own: the built pages contain no `astro-island` hydration
script. The Svelte license text is not yet reproduced in the built site; add it to `/engine/NOTICES.txt`
or a site-level notices file before a public release.

## Open point: OpenSSL inside ruby.wasm

Both binaries in `@ruby/3.4-wasm-wasi` 2.10.1 (`ruby.wasm` and `ruby+stdlib.wasm`) link OpenSSL
3.2.0 (the string `OpenSSL 3.2.0 23 Nov 2023` is in both), and Apache-2.0 is not compatible with
GPL version 2. CLAUDE.md allows no Apache-2.0-only code in the shipped bundle.

What is known:

- Mainspring never loads it. Neither TaskJuggler nor the bridge requires `openssl`; after a
  schedule and a syntax request, the VM's `$LOADED_FEATURES` contains no OpenSSL file (the native
  extensions loaded are `enumerator`, `fiber`, `rational`, `complex`, `encdb`, `transdb`,
  `monitor`, `json`, `date_core`, `stringio`, `strscan`, `zlib` and `js`).
- The code is still in the binary that the site serves.

This needs the user's decision (and an ADR) before a public release. Options: accept it on the
grounds that ruby.wasm is a separate program that runs TaskJuggler as interpreted code; or build
a ruby.wasm without the `openssl` extension (ruby.wasm's `rbwasm build` with a custom profile)
and ship that. Phase 0 uses the PoC's binary unchanged.

## Development only

Packages in `devDependencies` (Astro check, Playwright, Prettier, Vitest and others) and the
native recording gems in `engine/golden/Gemfile.lock` are not part of the built site.
