# PoC inventory (Phase 0, T1)

`poc/` holds the proof of concept exactly as delivered in `tj-wasm-poc.zip` (built
2026-11-11). It is a frozen reference: do not edit it. Production code lives in `engine/`
and `src/engine/`.

- Zip SHA-256: `878e67857f55e931aeff588fd5d4cc4d8c003c5bd157ca34653fe64c19a0229d`
- Left out (built outputs, rebuilt by `engine/build-bundle.mjs`):
  - `site/ruby.wasm.gz` (8,951,128 bytes): `gzip -9` of
    `@ruby/3.4-wasm-wasi@2.10.1` `dist/ruby+stdlib.wasm`
  - `site/tj-bundle.json.gz` (372,652 bytes): output of `build_bundle.mjs`
  - `site/index.html`, `site/preview.html`: output of `build_page.mjs` (demo page with the
    esbuild-bundled runtime and the sample inlined)
- One script writes to a session-specific path: `compare_wasm.mjs` line 13 writes
  `/tmp/claude-0/wasm_results.json`. Leave it; the production scripts replace it.

Items from `docs/phases/phase-0.md` section 5.1:

| # | Item | Found | Notes |
| --- | --- | --- | --- |
| 1 | `bridge/` | Yes | `tj_bridge.rb` (entry and serializer in one file: `TJBridge.run(src, file)` writes one file, parses, schedules, returns JSON). Wasm-only patches: `tj_wasm_tz.rb` (Intl time zones through `globalThis.tjTz`), `tj_wasm_perf.rb` (pure-Ruby `Array#each/find/any?/all?/hash/eql?/==`, `Hash#each*`), `tj_wasm_time.rb` (`TjTime` as seconds since 2000, small integers). Shared: `tj_parser_cache.rb` (reuses the grammar FSM and undoes `extend` rules between parses). **The serializer is not separate from the entry point yet**; T4 splits it. The perf and time patches also load natively when `TJ_FORCE_PERF_PATCH` is set, which is how the PoC checked they change no results |
| 2 | `stubs/` | Yes | `drb.rb` (defines `DRb::DRbUndumped` only), `term/ansicolor.rb` (colour helpers return text unchanged) |
| 3 | `web/tj-runtime.mjs` | Yes | `bootTaskJuggler({wasmModule, bundle})` mounts the bundle as `/tj` with `PreopenDirectory`, sets `LANG=C.UTF-8`, `HOME=/tj/work`, `chdir /tj/work`, `require "tj_bridge"`. `schedule(src)` calls `TJBridge.run` and parses the JSON. `loadTaskJuggler` fetches both `.gz` files and decompresses with `DecompressionStream` when the gzip magic is present. **Runs on the main thread, not in a worker.** Works in Node too |
| 4 | Build scripts | Yes | `build_bundle.mjs`: every `.rb` under `vendor/tj/lib`, `stubs/` and `bridge/`, mapped to `lib/...`, into one JSON object `{path: text}`. Gzip is done by hand (`gzip -9`). Versions: `@ruby/3.4-wasm-wasi` 2.10.1, `@ruby/wasm-wasi` (same release, version not pinned in the README), `@bjorn3/browser_wasi_shim` (not pinned), `esbuild@0.24.0`. Ruby wasm file: `dist/ruby+stdlib.wasm` |
| 5 | Sample plan | Yes | `web/sample.tjp`: 13 tasks, 3 resources, `America/New_York`, holidays, `now 2026-11-16`. Joins the corpus as `poc-sample` |
| 6 | How parity was checked | Partly | `native_ref.rb` runs `TJBridge.run` on native Ruby 3.3+ with `-I vendor/tj/lib -I stubs -I bridge`; `compare_wasm.mjs` runs the same files twice in wasm under Node. The README says JSON output was identical for task dates, resources, dependencies and messages. **Only five upstream examples were run** (Tutorial, Scrum, ToDo list, Project template, Fedora 20), plus the sample. No booking, multi-scenario or `include` coverage. Native used the real `term-ansicolor` gem or the stub depending on `-I` order (stubs come after `vendor/tj/lib`, so the stub wins) |
| 7 | Baseline timings | Yes | From the PoC README, warm runs in headless Chrome, parse + schedule: Tutorial 595 + 104 ms, Scrum 101 + 47 ms, ToDo 47 + 528 ms, Template 281 + 19 ms, Fedora 20 1344 + 1885 ms. Native: 204 + 47, 122 + 21, 104 + 175, 149 + 6, 436 + 544 ms. Boot about 2 s (Ruby 0.7 s, TaskJuggler load 0.9 s); download 9.3 MB gzipped |

Gaps the PoC README lists, all covered by Phase 0 tasks: single file only (no `include`),
main thread (no worker), reports not exercised, bookings and multiple scenarios untested.
