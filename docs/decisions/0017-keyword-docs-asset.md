# ADR-0017: Keyword docs from a build-time engine asset, not an eager `syntax()` request

Status: Proposed, 2026-11-18. The user chose the direction (stop fetching `syntax()` eagerly) on
2026-11-18; this ADR goes to them for approval before any code.
Source: the engine specialist's timings of 2026-11-18 (seconds, median of 3 fresh opens, local box at
low load); `src/lib/state/app.svelte.ts` 247-296; ADR-0002 #3, #6, #14 and queue rule 7
(`src/engine/queue.ts`); `docs/phases/phase-1.md` 6.3, 14.12 and the acceptance row at line 736;
ADR-0016 change 4.

## Context

- **When the app asks.** `AppState` calls `client.syntax()` the first time the engine goes idle
  (`#fetchDocs`, `app.svelte.ts` 266-272, 291-296). In practice that is right after the first
  schedule. The result is used for:
  - the full `doc` and "see also" in hover and completion info (`editor-bundle.ts` 22-32,
    `tjp/cm/hover.ts`, `tjp/cm/complete.ts`, `tjp/syntax/docs.ts`);
  - the docs sheet (`DocsSheet.svelte`, through `docsAtCursor`).

  Until it arrives, the committed tables are used (`keywords.generated.ts`, `summaries.generated.ts`,
  from `scripts/gen-tjp-keywords.mjs`, checked by `gen:keywords --check`).
- **What it costs.** The worker runs one request at a time and cannot interrupt a running one
  (ADR-0002 #3). Time for the `syntax()` request:

  | Where | After a small plan | After a big plan |
  | --- | --- | --- |
  | iPhone 14 emulation (WebKit) | 3.8 to 4.1 s | 1.1 s |
  | Chromium | 0.7 to 0.9 s | 0.7 to 0.9 s |

  For comparison, a WebKit open takes: boot 2.4 to 2.8 s; first run of a 16-task plan 4.0 s (0.2 s
  warm); first run of `fedora-res` 18.5 s. So the request is about 35% of a small-plan open on WebKit.
- **What the user sees today.**
  - While it runs, the pill reads "Engine: Scheduling" although nothing is being scheduled.
  - "Engine: Ready" comes only after it ends.
  - An edit made just after the plan appears waits behind it.
  - If the boot finishes before the first plan request is sent, the docs request is posted first,
    and the first schedule also waits behind it. This is possible but not measured.
- **The data never changes for a build.** `syntax()` depends only on the pinned `engine/tj` and
  `engine/bridge/syntax.rb`, not on the plan. It is a pure function of the engine build.
- **What it costs CI.** Every e2e rig waits for "Engine: Ready" (`tests/e2e/lib/settle.ts`
  `engineIdle`, `text-mode.ts`, `gantt-rig.ts`, `sheet-rig.ts` and the others). So every test pays for
  the docs request. That is about 15% of all iPhone e2e time on CI.

## Options

1. **On demand from the engine.** Call `syntax()` when something first needs it: the Text editor
   mounts, a hover or completion asks, or the docs sheet opens. Meanwhile the committed table is used.
   - Gain: it takes the request out of Visual-only sessions and most e2e tests.
   - The cost moves to the Text user. On an iPhone, the first hover or Docs tap starts a 4 s run.
     Until it ends, the tooltip shows the syntax line, the summary and the note "The full
     documentation appears once the scheduler has started". The tooltip does not update; the user
     must hover again.
   - An edit made during those 4 s waits. The pill still says "Scheduling".
   - About 20 lines in `app.svelte.ts`. The smallest change, and the fallback if option 3 is
     rejected.
2. **Idle-only and pre-emptible.** Post `syntax()` only after N seconds with no schedule in flight
   or pending.
   - Holding a request back is a client-only change to queue rule 7 (`queue.ts` `syntax()` posts at
     once today). The protocol is unchanged.
   - True pre-emption is not possible under ADR-0002. A posted request runs to the end, and `cancel`
     is client-side only (#6), so an edit made during the 1 to 4 s run still waits.
   - Real pre-emption needs one of two things:
     - a chunked request (`syntax({ from, count })` in the bridge, a protocol addendum to ADR-0002,
       and the client putting the pieces together). It helps only if the cost is in serializing.
       Building the SyntaxReference is a fixed cost that the first chunk still pays, and the split
       has not been measured.
     - terminating the worker. That loses the warm engine and the fast-path copy (ADR-0010), and the
       next edit pays a 2.4 to 2.8 s reboot.
   - Cost: a queue change and tests, and a protocol change for chunks. It is still the same request,
     only rarer.
3. **A static build asset.** The engine build boots the bundle it has just built in Node and writes
   the `syntax()` result next to it. The runtime never asks the engine for docs.
   - The worker does nothing but schedules, and docs load over HTTP in parallel with everything
     else.
   - The hard rules and how it stays in sync are covered under "Fit with the hard rules".
4. **Cache `syntax()` in IndexedDB, keyed by `bundleHash`.**
   - Later opens get the docs free.
   - The first open on each device still pays the full cost, and every CI test uses a fresh
     profile, so CI saves nothing. Rejected.
5. **A second worker for docs.** It needs a second ruby.wasm instance (30 MB of wasm, hundreds of
   MB of memory on a phone) just to read static text. Rejected.

## Decision

Option 3, loaded when the editor needs it (the trigger from option 1, without the engine).

- **Build.** `npm run build:engine` (`engine/build-bundle.mjs`) gets a last step:
  - It boots the freshly written bundle with `bootNodeEngine` (`engine/golden/run-wasm.mjs`) and
    writes `tj-docs.<hash12>.json.gz` into `public/engine/`. The file holds the exact `SyntaxDocs`
    JSON; the hash is SHA-256 of the uncompressed bytes, as for `tj-bundle`.
  - It adds an optional `docs` asset ref (`bytes`, `path`, `rawBytes`, `sha256`) to `manifest.json`.
    `schemaVersion` stays 1, `parseManifest` ignores the field, and a manifest without it means
    "table only".
  - `--check` covers the new file. `public/engine/` stays out of git (`.gitignore`), so nothing new is
    committed. The same build writes the docs and the bundle they describe, so they cannot drift.
- **Runtime loader.** A new module, `src/engine/docs-asset.ts`, imported only by `editor-bundle.ts`,
  so it lands in the editor chunk:

  ```ts
  export type EngineDocsState =
    | { status: 'idle' | 'loading' }
    | { status: 'loaded'; docs: SyntaxDocs }
    | { status: 'unavailable' };
  export interface EngineDocsLoader {
    readonly state: EngineDocsState;
    /** One fetch at a time; never rejects. Null when unavailable; a later call retries. */
    load(): Promise<SyntaxDocs | null>;
  }
  export function createEngineDocsLoader(opts: { manifestUrl: URL; fetch?: typeof fetch }): EngineDocsLoader;
  ```

  It works as follows:
  - It reads the manifest (already in the HTTP cache from boot), fetches the asset with
    `priority: 'low'`, and gunzips it with `DecompressionStream`.
  - If the docs fail `engineDocsMatch`, the result is `unavailable`. Nothing is mixed.
- **Trigger.**
  - `AppState.ensureEditor` starts `load()` once the editor support is attached. A Visual-only
    session never fetches the docs.
  - `#fetchDocs`, `#docs` and the docs trigger in `onState` are removed.
  - The app no longer calls `client.syntax()` anywhere.
- **Before the docs arrive.**
  - Hover and completion info wait at most 300 ms for `load()`. Hover becomes an async
    `hoverTooltip` source, and completion `info` becomes a function that returns a promise.
  - Past 300 ms they show the table's syntax line and summary with the note
    `editorStrings.hover.docsLoading`, reworded to "Loading the full documentation…". The note shows
    only while the status is `loading`.
  - `openDocs` waits the same way.
  - If the docs are unavailable (offline before the first fetch, or an old manifest), the summary
    shows with no note and no error. The next hover retries.
  - `KeywordDocsSource` gains `loading: boolean`. `docs.ts` `keywordDoc` is otherwise unchanged.
- **Protocol.** `syntax()` stays in the protocol, the worker and the client (ADR-0002 is unchanged).
  `gen:keywords`, the build step, `text-mode.ts` `engineKeyword` and the engine tests still use it.

### What "Engine: Ready" means afterwards

- The definition does not change: the worker has booted and owes no reply (`queue.ts` state `idle`).
- Because the app now posts only schedules, "Ready" comes right after the first result, and
  "Scheduling" shows only while a schedule runs.
- The rigs keep `engineIdle()` ("Engine: Ready" plus "Scheduled") as the single ready signal. It
  now means "the plan is scheduled and the worker is free", which is what an edit test needs.
- No test waits for docs, and none races them. The places that show docs wait for them (up to the
  300 ms bound), and a spec that tests the fallback blocks the asset with `page.route`.
- The re-hover loop in `text-mode.spec.ts` (`toPass` around move away and back) goes. The first
  hover must show the full doc.

### Tests to add

- **Unit, `src/engine/docs-asset.test.ts`.**
  - Two calls to `load()` while one is running make one fetch, and the path comes from the manifest.
  - A version mismatch gives `unavailable`.
  - A 404 or network error gives `unavailable`, and the next `load()` fetches again.
  - A manifest without `docs` gives `unavailable` with no fetch.
- **Unit, AppState** (beside `app.svelte.ts`, with `lib/workspace/testing/fake-engine-client.ts`).
  - `syntax()` is called zero times across boot, the first schedule, a worker restart and a plan
    switch.
  - `ensureEditor` starts the loader once.
  - A Visual-only session never calls it.
- **Unit, `hover.test.ts` and `complete.test.ts`.**
  - Docs that arrive within the bound give the full doc on the first hover or info.
  - Past the bound, the summary shows with the loading note.
  - When the docs are unavailable, there is no note.
- **Build: an engine-tier test.**
  - The asset, after gunzip, deep-equals `bootNodeEngine().syntax()`.
  - Its name hash and the manifest's `sha256` match its bytes.
  - `build:engine --check` fails if it is missing or stale.
- **`scripts/js-sizes.mjs`.** A Visual-first load makes no `tj-docs.*` request (enforced).
- **e2e, `tests/e2e/engine-docs.spec.ts`, all three projects, merge tier.** "The first edit is not
  delayed":
  - An init script wraps `Worker.prototype.postMessage` to record message types.
  - Open a small plan from `tests/fixtures/ui/` with `?hooks=edits`.
  - Wait for "Scheduled" (not "Ready"), dispatch an edit through `__mainspringEdits.action`, and
    wait for its settlement.
  - Assert that no `syntax` message was ever posted. This checks behaviour, not timing.
- **e2e, timing tier (`@timing`, ADR-0016).** The same flow records the queue wait: time from
  dispatch until the result for that revision arrives, minus `timings.totalMs`. It runs once on the
  commit before the change and once on the commit with it. This gives the not-yet-measured
  first-edit figure. The trend is recorded and nothing blocks on it.
- **e2e, existing tests.** `text-mode.spec.ts` keeps its hover, completion and Docs sheet tests
  against `engineKeyword` (a Node `syntax()`, the independent oracle). Each must pass on the first
  try. The Docs sheet test also runs on iPhone 14.
- **e2e, new fallback test.** With the asset blocked, hover shows the summary and the plan still
  schedules.

### Expected saving

The first-edit figures are projections from today's timings; the timing-tier spec above confirms
them.

- **CI.** About 15% of iPhone e2e worker time (the measured share). That is 3.8 to 4.1 s per
  small-plan test and 1.1 s per big-plan test on WebKit, plus 0.7 to 0.9 s per test on desktop and
  Pixel 7. As ADR-0016 change 4 moves specs to small plans, the iPhone share grows toward the
  small-plan figure. This counts toward ADR-0016's 12-minute target.
- **User, iPhone (WebKit), first edit.** Up to 3.8 to 4.1 s less wait right after a small plan
  appears, and up to 1.1 s after a big one. On Chromium, up to 0.7 to 0.9 s. "Engine: Ready" comes
  about 35% sooner on a small-plan WebKit open. The case where the first schedule waits behind the
  docs disappears.
- **Text user's first full doc.** It no longer waits for a free engine. It needs one static fetch,
  which starts when the editor loads.

## Fit with the hard rules

- **Text is the source of truth.** Docs are not plan data. No view and no edit reads them.
- **No schedule outside the browser engine at runtime.** Docs are not a schedule, and native `tj3`
  is not involved. The build boots the same wasm bundle in Node, as `gen:keywords` and the goldens'
  `run-wasm.mjs` already do.
- **Same pattern as the committed tables.** `keywords.generated.ts` and `summaries.generated.ts`
  are already engine-derived data shipped as static code and guarded by CI. This asset is the rest
  of the same `syntax()` result. It is better guarded than they are: built in the same step as the
  bundle, rather than committed and checked afterwards.
- **First-load caps (Visual 330,000, Text 440,000, total 650,000).** The asset is JSON in
  `public/engine/`, not JS in `dist/_astro`, so the JS caps do not count it. A Visual-first load never
  fetches it (enforced above). A Text-first load fetches it after the editor mounts, at low
  priority. The loader adds well under 1 KB to the editor chunk (cap 118,000). A committed
  `.ts`/`.json` module was rejected: imported as a module, it would land in `dist/_astro` and count
  against the 650,000 total.
- **Size is not measured yet.** Measure it before acceptance: boot with `bootNodeEngine`,
  `JSON.stringify(engine.syntax())`, and record the raw bytes and the gzip -9 bytes here. That is
  the mobile-data cost for a Text user.
- **Licensing.** The text is TaskJuggler's own documentation (GPL-2.0-only), shipped beside the
  bundle that already carries it, under the same `NOTICES.txt`. The licence position does not change
  (ADR-0001).
- **Offline.** No service worker exists yet. When it ships (build plan "Offline and caching"), the
  docs asset is precached with the engine assets, by content hash.

## Risks

- **Build time and environment.** `build:engine`, and so `npm run build` and Pages, now boots
  ruby.wasm in Node: about 1.5 s plus `syntax()`. A Node that cannot boot the bundle fails the build,
  which is right, because the bundle would be broken too.
- **Async hover.** If the pointer leaves while the docs load, the pending hover must be dropped.
  CodeMirror handles this for async sources; the unit test covers it.
- **The bridge's `syntax` path is used less at runtime.** The build, `gen:keywords` and the engine
  tests still run it, so it stays exercised, and the progress beats (ADR-0002 #14) are unchanged.
- **A stale asset after a deploy.** Not possible within one deploy (one manifest). Across a cached
  manifest, the content hash and `engineDocsMatch` keep old docs out.

## What does not change

- ADR-0002, the protocol (`syntax()` included), queue rule 7, the worker and `engine/tj/`.
- The committed tables and `gen:keywords --check`.
- Hover and completion content once loaded, and the e2e oracle (a Node `syntax()`).
- The rigs' ready signal (`engineIdle`).
- The JS budgets.
- Golden parity.

## Fit with the plan, and conflicts for the user to confirm

1. **Phase 1, 6.3 (line 251) and 14.12 (line 770), say hover shows the full doc "from
   `client.syntax()` once it arrives".** This ADR changes the source to the build asset of the same
   `syntax()`. The build plan's wording ("generated from TaskJuggler's own syntax rules … so they
   match the engine version", line 318) is still met. So is the Phase 1 acceptance row (line 736):
   the e2e tests still compare against `syntax()` output.
2. **Build plan line 196 (`syntax()` "returns keyword docs for completion").** The message stays.
   Only the app's runtime call goes.
3. **Scope.** This is not a task in `docs/phases/phase-3.md`. It is proposed as a new task, T26,
   in ADR-0016's hardening pass, because it serves change 4's time target. It needs approval
   (CLAUDE.md, "Before any work").
   - Owners: `engine-specialist` for the build step, the manifest, the loader and the
     `app.svelte.ts` wiring; `grammar-specialist` for the async hover, completion and sheet;
     `test-writer` for the tests.
   - Review: one `reviewer` pass with an engine reproduction (the asset equals `syntax()`).
   - Effort: about 1.5 days, one track.
