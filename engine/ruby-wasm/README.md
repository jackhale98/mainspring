# OpenSSL-free ruby.wasm (phase 4, T13)

Status: wave 1, feasibility (2026-11-23). The app still builds and ships the binary of
`@ruby/3.4-wasm-wasi` 2.10.1; nothing here changes `npm run build:engine` unless
`--ruby-wasm` (or `MAINSPRING_RUBY_WASM`) is given. Switching the app over is T13's finish (wave 6).

Why: the shipped interpreter links OpenSSL 3.2.0, which is Apache-2.0 and not compatible with
GPL-2.0 (ADR-0001, `THIRD_PARTY_NOTICES.md`). Phase 4's release checklist needs a ruby.wasm without
it, golden parity on it, and `scripts/ci/licenses.mjs` with no embedded exception (spec 16.3, 18.13).

## 1. What links OpenSSL today

- **The binary.** `dist/ruby+stdlib.wasm` of `@ruby/3.4-wasm-wasi` 2.10.1: CRuby 3.4.1, built by
  the ruby_wasm 2.10.1 packager with its `full` profile, the static (non-component) flavour, the
  stdlib and `/bundle` packed by wasi-vfs. Its producers section names clang 18.1.2 (wasi-sdk 22,
  the SDK ruby_wasm pins for Ruby 3.4) and rustc 1.92 (wasi-vfs).
- **Through which extension.** Only `openssl`, the last entry of the profile's extension list. It
  is linked statically (registered as `openssl.so`) and pulls in libssl and libcrypto of OpenSSL
  3.2.0. The other candidates do not link it in Ruby 3.4.1:
  - `digest` and `digest/{md5,sha1,sha2,rmd160}` build Ruby's own implementations
    (`ext/digest/digest_conf.rb` uses CommonCrypto on macOS, never OpenSSL);
  - `securerandom` uses `Random.urandom` and requires `openssl` only if that raises
    (`lib/securerandom.rb`), and WASI has `random_get`;
  - `net/https` is Ruby code that requires `openssl` when used; nothing in the engine uses it.
- **How much.** `check-binary.mjs --compare` against the stock debug binary: the OpenSSL-free build
  lacks 8,450 functions.
  - 1,761 are the extension (`ossl_*`, `Init_ossl*`; 1.0 MB of code).
  - 6,594 are almost all libcrypto and libssl (3.0 MB). A few are libc internals that differ
    between wasi-sdk 22 and Ubuntu's wasi-libc. For the same reason the local build has 22
    functions the stock one lacks: libm internals and compiler-rt's 128-bit division.
  - 95 are wasi-vfs (59 KB). They are absent only because the local build below has no wasi-vfs.
- **Is it reachable?** No.
  - Statically: the only `require` in TaskJuggler 3.8.4, the bridge and the stubs that touches
    the list above is `digest/md5` in `SheetReceiver.rb`, the mail-based time-sheet receiver,
    which the engine never loads. Digest does not use OpenSSL anyway.
  - At run time: `run-engine.mjs` on the current engine runs syntax docs, tokens, all 72 golden
    plans, the 71 time-zone cases and a `retain` run, then reads `$LOADED_FEATURES`. That gives
    236 features, 14 native (`enumerator fiber rational complex encdb transdb monitor parser
    generator date_core stringio strscan zlib js`), none naming openssl, digest or
    securerandom; `OpenSSL`, `Digest` and `SecureRandom` are undefined. Only then does it
    `require "openssl"`, which loads ("OpenSSL 3.2.0 23 Nov 2023"). So the code is present and
    loadable but never reached.

## 2. The recipe

| File | What it is |
| --- | --- |
| `build.sh` | Fetches every input in `inputs.json`, checks its SHA-256, sets up the toolchain, installs the gems offline, runs `build.rb`, strips the result, runs `check-binary.mjs` and writes `out/provenance.json` |
| `build.rb` | Drives ruby_wasm 2.10.1's own packager (the code that built the stock binary) with four changes only: the extension list is the `3.4` full profile minus `openssl`; the OpenSSL library is neither fetched nor built; sources come from the checked files; the host-side build logs of gem extensions are not packed. It checks that ruby_wasm's `3.4` alias still names the pinned Ruby tarball, applies no patches and lists `openssl`, so a gem bump cannot change the build silently |
| `inputs.json` | Every input with its URL, SHA-256 and licence |
| `Gemfile`, `Gemfile.lock` | ruby_wasm 2.10.1 (build tool), js 2.10.1 and logger 1.7.0 (packed). The stock binary also packs test-unit 3.6.2 and power_assert 2.0.3; the engine never loads them, so they are left out |
| `check-binary.mjs` | Fails if a binary has OpenSSL (the libcrypto version banner, `openssl.so` registered, or OpenSSL functions in the name section); `--expect-openssl` checks the check on the stock binary; `--compare` reports what was removed |
| `run-engine.mjs` | Boots an engine in Node on a given binary (with `--fs` for a build without wasi-vfs), checks syntax docs, tokens, every golden, the time-zone cases and `retain`, then reports `$LOADED_FEATURES` and tries `require "openssl"` |
| `gem-licenses.rb` | The declared licences of every gem the binary packs |
| `ci-job.yml` | The CI job that builds and checks the shipping binary. Not active: it is a sketch for T24 and T13's finish |

**Modes.**
- `--toolchain wasi-sdk` (default): wasi-sdk 22.0, the shipping toolchain. It needs `github.com`
  (section 5).
- `--toolchain ubuntu`: Ubuntu 24.04's clang-18 and lld-18, with its wasi-libc and wasm32
  compiler-rt packages, all from `archive.ubuntu.com`.
- `--no-vfs`: no wasi-vfs. This writes `ruby.wasm` plus `fs/`, the `/usr` and `/bundle` trees that
  wasi-vfs would pack. It is not a drop-in engine binary; `run-engine.mjs --fs` mounts the trees.

**Steps of a build** (ruby_wasm's own sequence):
1. Unpack Ruby 3.4.1.
2. Build a native baseruby from it.
3. Cross-build LibYAML 0.2.5 and zlib 1.3.1.
4. Configure Ruby with `--host wasm32-wasi --with-static-linked-ext --with-ext=<list>`, plus the
   js gem's extension.
5. Link, then `wasm-opt --asyncify -O3 -g` (binaryen 108).
6. `make install`.
7. Pack `/usr` and `/bundle` with wasi-vfs.
8. `wasm-opt --strip-debug`, as ruby.wasm's npm packaging does.

```sh
engine/ruby-wasm/build.sh                                  # CI: wasi-sdk 22, wasi-vfs
node engine/build-bundle.mjs --ruby-wasm engine/ruby-wasm/out/ruby+stdlib.wasm --ruby-wasm-version 2.10.1+no-openssl
node engine/golden/run-wasm.mjs --syntax --tokens          # parity in Node
node engine/ruby-wasm/run-engine.mjs                       # features; require "openssl" must fail
MAINSPRING_RUBY_WASM=engine/ruby-wasm/out/ruby+stdlib.wasm npm run test:golden   # Chromium
```

**A toolchain trap found on the way.** With Ubuntu's newer wasi-libc snapshot (`20240708`),
`ruby_init` exits with status 1 and prints nothing. The cause:
- that libc's `libwasi-emulated-mman.a` defines `mprotect`, which overrides Ruby 3.4.1's no-op
  stub (`wasm/missing.c`, a weak symbol);
- the emulation refuses `PROT_NONE`, so `Init_Cont` fails to set the fiber pool's guard pages;
- the resulting `FiberError` is raised before that class exists, which gives a `TypeError`.

The 2023 snapshot has no `mprotect`, and neither can wasi-sdk 22's libc, because the stock binary
boots. Do not move the 3.4 build to a newer wasi-sdk or wasi-libc without checking this.

## 3. What was built here (wave 1)

Here, `github.com` is blocked (section 5), so the shipping configuration could not be built. It
was built as `--toolchain ubuntu --no-vfs`: the same ruby_wasm packager, Ruby, extensions,
LibYAML, zlib sources and binaryen 108; Ubuntu's LLVM 18.1.3 and wasi-libc instead of wasi-sdk 22;
and the stdlib mounted by the engine's WASI shim instead of wasi-vfs.

- **Build.** It succeeds. A clean build, baseruby included, takes 5 to 6 min on 4 cores (about
  12 under heavy load). `check-binary.mjs`: no banner, `openssl.so` not registered, 0 OpenSSL
  functions; 90 native extensions, the stock binary's 91 minus `openssl`.
- **Reproducible.** Two clean builds at the same paths gave byte-identical `ruby.wasm`,
  `ruby.debug.wasm` and `fs/`. `ruby.wasm` has sha256 `ba183cdf4400fe46…`; build paths are
  compiled in, so another work directory gives other bytes.
- **Boot and parity** (`run-engine.mjs --ruby out/ruby.wasm --fs out/fs`):
  - keyword docs equal to the engine's `tj-docs` asset (canonical JSON);
  - 83 of 83 token streams consistent;
  - 72 of 72 plans equal to their goldens;
  - 71 of 71 time-zone cases;
  - `retain` on `fedora-res` matches;
  - `$LOADED_FEATURES` identical to the stock engine's, entry for entry and in order (236);
  - `require "openssl"` raises `LoadError: cannot load such file -- openssl`.
- **Sizes** (raw / gzip -9, as `build-bundle.mjs` compresses):

  | Binary | Raw | Gzip |
  | --- | --- | --- |
  | stock `ruby+stdlib.wasm` (shipped today) | 30,635,497 | 9,058,728 |
  | stock `ruby.wasm` (no stdlib) | 16,655,034 | 5,050,303 |
  | new `ruby.wasm` (no stdlib, no wasi-vfs) | 11,374,578 | 3,672,151 |
  | new `fs/` (1,821 files, what wasi-vfs would pack) | 14,003,875 | 3,873,979 |

  The interpreter shrinks by 5.28 MB raw and 1.38 MB gzip (27%). Estimate for the drop-in
  `ruby+stdlib.wasm`: about 25.4 MB raw and 7.7 MB gzip, against 9.06 MB gzip today. The exact
  figure comes from the CI build.
- **Timings, Node, Fedora** (`fedora-res`, best of 3 per round, three interleaved rounds on a quiet
  machine, load below 1.3):

  | | Stock | New |
  | --- | --- | --- |
  | Total | 4,685 / 4,687 / 4,718 ms | 4,515 / 4,457 / 4,689 ms |
  | Schedule | 1,740 / 1,830 / 1,869 ms | 1,719 / 1,736 / 1,917 ms |
  | Memory at the end | 110 to 120 MB | 98 MB |

  Under load (5 earlier rounds) the medians were 5,137 and 5,146 ms. So scheduling is unchanged
  within noise; the new binary is not slower.
- **Boot, Node:**

  | | Stock | New |
  | --- | --- | --- |
  | Total | 1,291 to 1,386 ms | 1,064 to 1,180 ms |
  | Compile | 37 to 46 ms | 13 to 20 ms |

  Assets and instantiation are not like for like: the new binary skips the SHA-256 check, and its
  stdlib reads go through the JS shim instead of wasi-vfs.

What this does not show: the shipping (wasi-vfs, wasi-sdk 22) binary itself, and `npm run
test:golden` in Chromium on it. Both need the CI job.

## 4. Licences of what the new build ships

Every item below ships in the stock binary today too; the build removes OpenSSL and adds nothing.

| Component | Licence | GPL-2.0 compatible |
| --- | --- | --- |
| CRuby 3.4.1, its extensions and stdlib | Ruby OR BSD-2-Clause. Ruby's LEGAL lists permissive parts: Onigmo BSD-2-Clause, `missing/*` BSD and public domain, `st.c` public domain, MT19937 BSD-3-Clause, digest implementations BSD-style, Unicode data tables. `parse.c` is a Bison/Lrama skeleton under the GPL with the Bison exception, which lets the work take other terms | Yes, under BSD-2-Clause |
| 78 gems packed (`gem-licenses.rb`: 53 default, 23 bundled, js and logger) | MIT, BSD-2-Clause, or Ruby OR BSD-2-Clause; test-unit Ruby OR BSDL OR PSFL. All 78 have an allowed choice | Yes |
| js gem 2.10.1 (extension and lib) | MIT | Yes |
| LibYAML 0.2.5 | MIT | Yes |
| zlib 1.3.1 | Zlib | Yes |
| wasi-libc | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT (musl parts MIT) | Yes, under MIT |
| compiler-rt builtins | Apache-2.0 WITH LLVM-exception | Yes: the exception's GPLv2 clause |
| wasi-vfs 0.6.2 (`--vfs` only) | Apache-2.0 WITH LLVM-exception | Yes, as above |
| Rust `core`, `alloc` and the `wasi` crate inside wasi-vfs (`--vfs` only) | MIT OR Apache-2.0; `wasi` Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | Yes, under MIT |
| ~~OpenSSL 3.2.0~~ | Apache-2.0 | Removed |

Build tools that do not ship: ruby_wasm (MIT), binaryen (Apache-2.0), LLVM, the host Ruby.

Gaps in today's `THIRD_PARTY_NOTICES.md`, for T13's finish:
- compiler-rt builtins and the Rust parts of wasi-vfs are not listed;
- test-unit 3.6.2 and power_assert 2.0.3 leave `/bundle` (Ruby's own bundled copies, 3.6.7 and 2.0.5, stay in the stdlib tree as today);
- the OpenSSL rows and the open point go.

## 5. Blocked here

- **`github.com`** (403 from the egress proxy). It hosts the three inputs that are published
  only there:
  - wasi-sdk 22.0 (`WebAssembly/wasi-sdk` releases);
  - libwasi_vfs 0.6.2 (`kateinoigakukun/wasi-vfs` releases; crates.io has only wasi-vfs 0.1.1);
  - the zlib 1.3.1 release asset.

  Their SHA-256s are not recorded: wasi-sdk and wasi-vfs are `null` in `inputs.json`, and zlib
  carries the hash zlib.net publishes. The CI job's first run records them (`--record-unpinned`).
- **`zlib.net`** answers automated clients with a bot-check page instead of the tarball. The
  Ubuntu toolchain uses the Ubuntu archive's repack of zlib 1.3.1 (`contrib/` removed; the
  library sources are upstream's).
- **Shipping-shape build.** Without wasi-vfs there is no packed binary, so `build-bundle.mjs`
  cannot boot it to write the docs, and `npm run test:golden` was not run on the new
  interpreter. Golden parity on it was checked in Node, with the same `runtime.ts` boot and bridge
  path as the browser worker.
- No Docker daemon is running, and `ghcr.io` (the ruby.wasm builder image) is not reachable.

## 6. For T13's finish

1. Run `ci-job.yml` once and pin the SHA-256s it logs.
2. Make the new binary the default input of `build-bundle.mjs`, with its own notices: ruby_wasm's
   NOTICE without OpenSSL, plus compiler-rt and the Rust parts.
3. Remove the embedded exception from `scripts/ci/licenses.mjs`.
4. Update `THIRD_PARTY_NOTICES.md`.
5. Run `test:golden` on all three browsers.
6. The goldens still have to be re-recorded on Ruby 3.4 (the user, ADR-0003 #5).

A decision worth an ADR before then: drop wasi-vfs and ship the stdlib as its own hashed asset,
mounted by the worker's WASI shim, as `run-engine.mjs --fs` does here.
- For: one component fewer; the stdlib could shrink to what the engine loads, a small part of
  the 1,821 files; and parity already holds in this shape.
- Against: it changes `src/engine` and the manifest.
