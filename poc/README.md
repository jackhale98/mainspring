# TaskJuggler in WebAssembly — proof of concept

Runs the unmodified TaskJuggler 3.8.4 scheduler (`github.com/taskjuggler/TaskJuggler`,
commit 3b36c79) inside the browser on CRuby 3.4 compiled to WebAssembly
(`@ruby/3.4-wasm-wasi` 2.10.1). No server: `site/` is a static folder you can drop on
GitHub Pages.

## Deploy the demo

Copy the three files in `site/` (`index.html`, `ruby.wasm.gz`, `tj-bundle.json.gz`) to any
static host, e.g. a `gh-pages` branch. `preview.html` is only a local test wrapper.
The page fetches the two `.gz` files from the same folder and decompresses them with
`DecompressionStream` (Chrome 80+, Safari 16.4+, Firefox 113+).

## Results

All runs below produced JSON output identical to native TaskJuggler (task dates,
resources, dependencies, messages), each run twice in one session.

| Project (bundled example)    | Tasks | Native parse+schedule | Browser (wasm), warm |
|------------------------------|------:|----------------------:|---------------------:|
| Tutorial (Europe/Paris)      |    15 |          204 + 47 ms  |         595 + 104 ms |
| Scrum                        |    18 |          122 + 21 ms  |          101 + 47 ms |
| ToDo list                    |     7 |         104 + 175 ms  |          47 + 528 ms |
| Project template (New York)  |    10 |          149 + 6 ms   |          281 + 19 ms |
| Fedora 20 release plan       |   414 |          436 + 544 ms |        1344 + 1885 ms |

Startup in headless Chrome: ~2 s after download (Ruby boot ~0.7 s, loading TaskJuggler
~0.9 s). Download is 9.3 MB gzipped, cacheable by a service worker.

## What had to change (all outside TaskJuggler's own files)

`bridge/`
- `tj_bridge.rb` — parse + schedule a string, return JSON with task dates, resources,
  dependencies, source line of each task, and error messages with line numbers.
  Errors are trapped (`trapSetup`) instead of calling `exit`.
- `tj_wasm_tz.rb` — WASI's libc only knows UTC, so `ENV['TZ']` was silently ignored and
  `timezone "America/New_York"` failed. `Time.local` / `Time#localtime` now get offsets
  from the browser's `Intl` time-zone database.
- `tj_parser_cache.rb` — the grammar's ~1,800-state parser is built once and reused.
  `extend` blocks add grammar rules at parse time; the cache restores the pristine
  grammar before each parse.
- `tj_wasm_perf.rb` — the big one. ruby.wasm emulates setjmp/longjmp by unwinding the
  WebAssembly stack, so `break`/`return` out of a block yielded by a C iterator
  (`Array#each`) costs ~120 µs (≈500× native), and array-keyed hash lookups ~20 µs.
  Re-implementing `Array#each`, `find`, `any?`, `hash`, `eql?`, `==` and `Hash#each*`
  in plain Ruby took the tutorial from **16–51 s to 0.7 s**.
- `tj_wasm_time.rb` — ruby.wasm is 32-bit, so integers above 2^30 (all epoch
  seconds) are Bignums and `Time` math is 10–60× slower than native. `TjTime` now keeps
  seconds-since-2000 as a small integer and builds `Time` objects only when needed.
  Fedora 20: 3.3 s → 3.0 s.

`stubs/` — no-op `term/ansicolor` (terminal colors) and `drb` (only used by the
`tj3d` daemon; there are no sockets in the browser). The `mail` gem is never loaded
by the scheduler.

`web/tj-runtime.mjs` — boots ruby.wasm with `@bjorn3/browser_wasi_shim`, mounts the
TaskJuggler sources in an in-memory filesystem, exposes `schedule(text)`.

## Rebuild

```
git clone --depth 1 https://github.com/taskjuggler/TaskJuggler.git vendor/tj
npm install @ruby/3.4-wasm-wasi @ruby/wasm-wasi @bjorn3/browser_wasi_shim esbuild@0.24.0
node build_bundle.mjs                       # -> web/tj-bundle.json
gzip -9 -c web/tj-bundle.json > web/tj-bundle.json.gz
gzip -9 -c node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm > web/ruby.wasm.gz
npx esbuild web/tj-runtime.mjs --bundle --format=iife --global-name=TJRuntime --minify --outfile=web/tj-runtime.js
node build_page.mjs                         # -> site/
```

Verify against native Ruby (needs Ruby 3.3+):
`ruby -I vendor/tj/lib -I stubs -I bridge native_ref.rb <files.tjp>` and
`node compare_wasm.mjs <files.tjp>`.

## Known gaps for the real app

- Single file only: `include` files need the repo's other files mounted into the
  virtual filesystem (easy: write them next to `plan.tjp` before parsing).
- Scheduling runs on the main thread; move `tj-runtime` into a Web Worker.
- Reports (`taskreport`, HTML/CSV output) were not exercised; the app reads the
  scheduled model directly as JSON instead.
- Bookings, time sheets and multiple scenarios were not tested.
- License: TaskJuggler is **GPLv2 only** (no "or later" clause). An app that bundles it
  should be GPLv2 or a GPLv2-compatible license (MIT, BSD). GPLv3 and Apache-2.0 code
  cannot be combined with it.
