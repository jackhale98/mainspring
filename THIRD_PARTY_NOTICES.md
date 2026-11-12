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

## Shipped as fonts

The app self-hosts two variable fonts (Latin subset, `dist/_astro/*.woff2`), under ADR-0005.
Fonts are data files that the page loads; they are not linked into Mainspring's code, so the
combination stays GPL-2.0. Their license texts ship at `/fonts/NOTICES.txt`
(`public/fonts/NOTICES.txt`; `tests/ci/fonts.test.ts` checks it against the packages).

| Component                                             | Version | Use                 | License                               |
| ----------------------------------------------------- | ------- | ------------------- | ------------------------------------- |
| Inter, `@fontsource-variable/inter`                   | 5.3.0   | UI text             | SIL Open Font License 1.1 (`OFL-1.1`) |
| JetBrains Mono, `@fontsource-variable/jetbrains-mono` | 5.3.0   | Source text and ids | SIL Open Font License 1.1 (`OFL-1.1`) |

`scripts/ci/licenses.mjs` accepts `OFL-1.1` only for these two named packages (`FONT_PACKAGES`).

## Shipped in the page scripts

The site's own scripts in `dist/_astro/` are bundled by Vite. Checked on a build with
`MAINSPRING_DEV_PAGES=1`, the only third-party code in them besides the engine worker (above) is
the Svelte client runtime (`svelte` 5.57.2, MIT, in `client.svelte.*.js`), which GPL-2.0 permits.
Astro 7.4.1 (MIT) adds no runtime of its own: the built pages contain no `astro-island` hydration
script. The Svelte license text is not yet reproduced in the built site; add it to `/engine/NOTICES.txt`
or a site-level notices file before a public release.

## Editor packages (from Phase 1)

Phase 1's text mode bundles CodeMirror 6 and Lezer into the page scripts. All of them are MIT
(checked in each package's `package.json` and `LICENSE`), which GPL-2.0 permits. Their license
texts must also go into the site-level notices before a public release.

| Package                    | Version | License |
| -------------------------- | ------- | ------- |
| `@codemirror/state`        | 6.7.6   | MIT     |
| `@codemirror/view`         | 6.43.15 | MIT     |
| `@codemirror/language`     | 6.13.1  | MIT     |
| `@codemirror/autocomplete` | 6.20.4  | MIT     |
| `@codemirror/lint`         | 6.9.7   | MIT     |
| `@codemirror/commands`     | 6.11.1  | MIT     |
| `@codemirror/search`       | 6.7.2   | MIT     |
| `@codemirror/streamparser` | 6.0.0   | MIT     |
| `@lezer/common`            | 1.5.3   | MIT     |
| `@lezer/lr`                | 1.4.11  | MIT     |
| `@lezer/highlight`         | 1.2.5   | MIT     |
| `style-mod`                | 4.1.4   | MIT     |
| `w3c-keyname`              | 2.2.8   | MIT     |
| `crelt`                    | 1.0.7   | MIT     |

`@codemirror/streamparser`, `style-mod`, `w3c-keyname` and `crelt` come in as dependencies of
the packages above. `@lezer/generator` (MIT) is a development dependency: it generates the
parser tables at build time and does not ship.

## Sample plans (from Phase 1)

Text mode bundles four sample workspaces (`src/lib/workspace/samples.ts`), loaded on demand. Two
are Mainspring's own golden plans. The other two are TaskJuggler's examples, shipped unmodified
with their notices in the file text:

| Sample               | Files                                                  | Authors                              | License                                   | GPL-2.0 compatible |
| -------------------- | ------------------------------------------------------ | ------------------------------------ | ----------------------------------------- | ------------------ |
| TaskJuggler tutorial | `engine/tj/examples/Tutorial/tutorial.tjp`             | the TaskJuggler authors              | GPL-2.0-only (part of TaskJuggler 3.8.4)  | Yes                |
| Fedora 20 schedule   | `engine/tj/examples/Fedora-20/f-20.tjp`, `reports.tji` | John Poelstra, Robyn Bergeron (2011) | MIT (Expat), notice in each file's header | Yes                |

## License check in CI

`node scripts/ci/licenses.mjs` (CI `check` job) walks the production dependency tree in
`package-lock.json` and fails on any license that is not GPL-2.0 compatible. Packages that run
only in Node at build time (`sharp`, `lightningcss`, `typescript`, `aria-query`,
`axobject-query`) are listed in the script with the reason each never reaches `dist/`. The
OpenSSL inside ruby.wasm (below) is reported on every run as a known exception, not a failure.

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
