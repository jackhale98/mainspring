# Phase 0: Foundation and engine

Status: approved 2026-11-11. T0, T1, T3 and T15 are done (see the task table). Source: `docs/BUILD_PLAN.md` ("Phase 0: Foundation and engine", "Engine worker", "Testing and quality", "Risks and mitigations"). The plan's open points and conflicts are listed in section 11. This spec does not settle them.

## 1. Scope

| In scope | From the plan |
| --- | --- |
| Import the PoC into `poc/` as a frozen reference | Kickoff prompt |
| Scaffold the repo from mycelium-web's tooling | "Scaffold from mycelium-web tooling" |
| Vendor TaskJuggler 3.8.4 at `3b36c79` into `engine/tj/` | Tech stack, repo layout |
| Bridge and stubs in `engine/bridge/` and `engine/stubs/`, ported from the PoC | "Move the PoC engine into `engine/`" |
| Web Worker engine, client API and latest-wins queue in `src/engine/` | "...and a Web Worker with the latest-wins queue" |
| `engine/build-bundle.mjs`, which builds the hashed engine assets | "build script for the hashed bundle" |
| Golden corpus, the native recording script and committed outputs | "Golden corpus..." |
| Golden parity suite and the UI-thread responsiveness test | Gate |
| CI on every push: type check, unit, e2e, golden parity. No Ruby | "CI runs type check, unit tests and end-to-end tests on every push"; Testing table |
| A placeholder `/app` shell that shows engine status (desktop and phone) | Needed so "the UI thread" has something to measure; CLAUDE.md screenshot rule |

## 2. Non-goals

- No Lezer grammar, CodeMirror editor, symbol index or edit API (Phase 1).
- No completion UI. `syntax()` is built and tested, but nothing uses it yet.
- No Gantt, resource, workload or calendar views. No gestures (Phases 2 and 3).
- No derived schedule data: critical path, float, load per day and health checks are Phase 2 and 3.
- No bridge fields beyond the v1 shape in section 3.1. Effort done and left, load per day and float inputs come later, with a `schemaVersion` bump and re-recorded goldens.
- No parse-skipping fast path (Phase 2 spike).
- No storage, sync or auth. No Mycelium `auth/git/dropbox/onedrive/sync/store` modules (Phase 4).
- No service worker, PWA install or offline mode. No deploy to staging or production (Phase 4).
- No SharedArrayBuffer, COOP/COEP or preemptive cancel.
- Golden parity in Firefox or WebKit does not gate this phase (see 11.12).
- Performance budgets are not enforced. Boot and schedule timings are only recorded.
- No LICENSE file and no `license` field until T0 is decided (CLAUDE.md).

## 3. Interfaces

### 3.1 Shared types (`src/engine/protocol.ts`)

```ts
/** Strictly increasing per EngineClient. */
export type Revision = number;
/** Integer minutes since ProjectInfo.start (a UTC instant). See 11.14. */
export type Minutes = number;
/** Workspace-relative POSIX path: no leading '/', no '..', no backslashes. */
export type WorkspacePath = string;

export interface ScheduleRequest {
  files: Readonly<Record<WorkspacePath, string>>; // full workspace text, UTF-8
  entry: WorkspacePath;                           // the .tjp to schedule; must be a key of files
  revision: Revision;
  options?: ScheduleOptions;                      // EXTENSION to the plan, see 11.4
}
export interface ScheduleOptions {
  /** ISO 8601 UTC ("2026-01-05T09:00:00Z"). Used only when the plan has no `now`. Golden/test use. */
  now?: string;
}

export interface ScheduleResult {
  revision: Revision;
  ok: boolean;                    // false if a fatal or error message stopped scheduling
  project: ProjectInfo | null;    // null if parsing failed before the project header
  tasks: TaskResult[];            // declaration pre-order
  resources: ResourceResult[];    // declaration pre-order
  bookings: BookingResult[];      // canonical order, see 6.3
  messages: EngineMessage[];      // emission order
  timings: Timings;               // never compared
}

export interface ProjectInfo {
  id: string; name: string; version: string | null;
  start: string; end: string; now: string; // ISO 8601 UTC with 'Z'
  timezone: string | null;                 // as written in the plan; null if unset
  timingResolutionMin: number;
  scenarios: ScenarioInfo[];               // declaration pre-order
}
export interface ScenarioInfo { id: string; name: string; parent: string | null; active: boolean }

export interface SourceRef { file: WorkspacePath; line: number; column: number } // 1-based

export interface TaskResult {
  id: string;                 // full path, e.g. "app.editor"
  name: string;
  parent: string | null;
  source: SourceRef;
  milestone: boolean;
  scenarios: Record<string, TaskScenarioResult>; // keyed by scenario id; active scenarios only
}
export interface TaskScenarioResult {
  scheduled: boolean;
  start: Minutes | null;
  end: Minutes | null;
  allocated: string[];        // resource ids, sorted by resource pre-order
  criticalness: number;
  pathCriticalness: number;
}

export interface ResourceResult {
  id: string; name: string; parent: string | null; source: SourceRef;
  group: boolean;
  scenarios: Record<string, { efficiency: number }>;
}

/** Allocated time from the scoreboard after scheduling, including user `booking`s. See 11.5. */
export interface BookingResult {
  scenario: string; resource: string; task: string;
  intervals: Array<[start: Minutes, end: Minutes]>; // ascending, contiguous slots merged
}

export type MessageLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
export interface EngineMessage {
  level: MessageLevel;
  id: string;                     // TaskJuggler message id
  text: string;                   // no ANSI codes, no absolute paths
  file: WorkspacePath | null; line: number | null; column: number | null;
  scenario: string | null;
}

export interface Timings { writeFsMs: number; parseMs: number; scheduleMs: number; serializeMs: number; totalMs: number }

export interface SyntaxDocs { tjVersion: string; keywords: KeywordDoc[] }
export interface KeywordDoc {
  keyword: string;            // e.g. "effort" or "limits.dailymax"
  contexts: string[];
  syntax: string;
  summary: string;
  doc: string;
  scenarioSpecific: boolean;
  seeAlso: string[];
} // Filled from TaskJuggler's own keyword documentation. Phase 1 may extend it.

export type EngineErrorKind = 'boot' | 'crash' | 'internal' | 'timeout' | 'invalid-request';
export interface EngineError { kind: EngineErrorKind; message: string; detail?: string }
```

### 3.2 Worker message protocol (`src/engine/worker.ts`)

```ts
export type ToWorker =
  | { type: 'schedule'; request: ScheduleRequest }
  | { type: 'syntax'; id: number }
  | { type: 'cancel'; revision: Revision };

export type FromWorker =
  | { type: 'ready'; versions: EngineVersions; bootMs: number }
  | { type: 'scheduled'; result: ScheduleResult }
  | { type: 'syntax'; id: number; result: SyntaxDocs }
  | { type: 'failed'; revision?: Revision; id?: number; error: EngineError };

export interface EngineVersions { tj: '3.8.4'; tjCommit: string; rubyWasm: string; bundleHash: string }
```

Worker rules:

- On start, the worker fetches `/engine/manifest.json`, then the hashed assets. It checks each against its `sha256` and decompresses only if the bytes start with the gzip magic `1f 8b`. It then boots Ruby and loads the bundle into `/tj`, and posts `ready`.
- Each `schedule` replaces `/workspace` with `files` and runs the entry as `/workspace/<entry>`. This is how `include` resolves.
- The worker runs one request at a time. Ruby runs synchronously, so a running schedule cannot be interrupted. `cancel` only matters for requests the worker has not started yet.
- TaskJuggler errors come back as `messages` with `ok: false`. Only bridge exceptions, wasm traps and out-of-memory produce `failed`.
- All paths in `messages` and `source` are made workspace-relative inside the bridge, the same way on the native side.

### 3.3 Client API and latest-wins queue (`src/engine/client.ts`, `src/engine/queue.ts`)

```ts
export type ScheduleOutcome =
  | { status: 'done'; result: ScheduleResult; latest: boolean } // latest=false: a newer revision is pending
  | { status: 'superseded'; revision: Revision; by: Revision }
  | { status: 'cancelled'; revision: Revision }
  | { status: 'failed'; revision: Revision; error: EngineError };

export type EngineState = 'booting' | 'idle' | 'busy' | 'failed';

export interface EngineClient {
  readonly state: EngineState;
  ready(): Promise<EngineVersions>;
  schedule(request: ScheduleRequest): Promise<ScheduleOutcome>; // never rejects, except RangeError for a non-increasing revision
  syntax(): Promise<SyntaxDocs>;                                // cached after the first success
  cancel(revision: Revision): void;
  onState(listener: (s: EngineState) => void): () => void;
  dispose(): void;
}

export interface EngineClientOptions {
  workerUrl?: URL;            // default: the bundled worker entry
  timeoutMs?: number;         // default 60_000: terminate, reboot, resolve 'failed'/'timeout'
  transport?: WorkerLike;     // injectable for unit tests
}
export function createEngineClient(opts?: EngineClientOptions): EngineClient;
```

The queue lives on the client, so the worker stays single-flight. `queue.ts` is pure and has no DOM dependency. Its rules:

1. At most one request is in flight and at most one is pending.
2. A `revision` that is not greater than the last one requested throws `RangeError`.
3. If nothing is in flight, the request is posted at once. Otherwise any pending request resolves `superseded` and the new one takes its place.
4. When an in-flight result arrives:
   - If its revision was cancelled, it resolves `cancelled`.
   - If its revision is no newer than the last delivered revision, it is dropped as stale.
   - Otherwise it resolves `done`, with `latest` set to whether nothing is pending.
   - Then the pending request, if any, is posted.
5. `cancel(r)`: a pending request resolves `cancelled` at once. An in-flight request is marked and resolves `cancelled` when its result arrives. An unknown `r` does nothing.
6. On a crash or timeout, the in-flight request resolves `failed`. The client then terminates and restarts the worker, and posts the pending request after `ready`.
7. `syntax()` skips the latest-wins slot. It is posted FIFO and served after any run in progress.

### 3.4 Golden output shape (`engine/golden/expected/<id>.json`)

```ts
export interface GoldenFile {
  schemaVersion: 1;
  id: string;                         // manifest id
  entry: WorkspacePath;
  files: WorkspacePath[];             // sorted list of files loaded
  options: { now: string | null };
  native: {
    tjVersion: '3.8.4';
    tjCommit: string;                 // must equal engine/tj.pin.json
    ruby: string;                     // e.g. "3.4.x"
    tzdata: string;
    gems: Record<string, string>;     // from engine/golden/Gemfile.lock
  };
  result: Omit<ScheduleResult, 'revision' | 'timings'>;
}
```

File format: UTF-8, object keys sorted, 2-space indent, trailing newline. There is no timestamp, so re-recording unchanged plans produces no diff. Native wall-clock times go to `engine/golden/native-timings.json`, which is never compared.

Manifest (`engine/golden/manifest.json`):

```ts
export interface GoldenPlan {
  id: string;                         // e.g. "upstream-fedora-20", "syn-09-tz-dst-berlin"
  kind: 'upstream' | 'poc' | 'synthetic' | 'bridge';
  root: string;                       // repo-relative directory mounted as /workspace
  entry: WorkspacePath;               // relative to root
  files?: string[];                   // globs under root; default ["**/*.tjp", "**/*.tji"]
  now: string | null;                 // options.now; null if the plan sets `now`
  features: string[];
  timeoutMs?: number;
}
```

### 3.5 Bundle build script (`engine/build-bundle.mjs`)

| | |
| --- | --- |
| Command | `node engine/build-bundle.mjs [--out public/engine] [--check]`, run by `npm run build:engine` and run before `astro build` in `npm run build` |
| Inputs | `engine/tj/lib/**` (the Ruby files TaskJuggler loads at runtime; the exact list comes from the PoC's build script, see T1); `engine/bridge/**` except `engine/bridge/native/`; `engine/stubs/**`; the Ruby wasm binary from `node_modules/@ruby/3.4-wasm-wasi` (version pinned in `package-lock.json`; the PoC's file name to be confirmed); `engine/tj.pin.json` |
| Outputs (in `--out`) | `ruby.<hash12>.wasm.gz`; `tj-bundle.<hash12>.json.gz`, a gzip of `{ "schemaVersion": 1, "files": { "/tj/...": "<utf-8 text>" } }` with sorted keys; `manifest.json` (not hashed; `EngineManifest` below) |
| Determinism | `<hash12>` is the first 12 hex digits of SHA-256 over the uncompressed bytes, so a different zlib cannot change the name. Gzip uses level 9, mtime 0 and no file name. Node is pinned in `.nvmrc`. Any input that is not UTF-8 fails the build |
| `--check` | Rebuilds in memory and exits non-zero if the result differs from `--out`. CI builds twice and compares |
| Git | `public/engine/` is gitignored. CI and the developer build it (see 11.9) |

```ts
export interface EngineManifest {
  schemaVersion: 1;
  ruby: AssetRef; bundle: AssetRef;
  tj: { version: '3.8.4'; commit: string };
  rubyWasm: { package: '@ruby/3.4-wasm-wasi'; version: string };
  wasiShim: { package: '@bjorn3/browser_wasi_shim'; version: string };
}
export interface AssetRef { path: string; sha256: string; bytes: number; rawBytes: number }
```

## 4. Repository layout (Phase 0 parts)

```text
poc/                          # T1: PoC as delivered, read-only reference (+ INVENTORY.md)
engine/
  tj/                         # git subtree, TaskJuggler 3b36c799605621103d7d065c69e3f958a3dd6698, never edited
  tj.pin.json                 # { commit, tree, version: "3.8.4", upstream }
  bridge/
    serialize.rb              # ScheduleResult v1 serializer; loads on native Ruby AND ruby.wasm
    tj_bridge.rb              # wasm entry: FS, request handling, now override, timings
    wasm/                     # wasm-only patches: tz (Intl), parser cache, hot iterators, small-int dates
    native/record.rb          # native entry used only by the record script
  stubs/                      # term/ansicolor, drb
  build-bundle.mjs
  golden/
    manifest.json
    README.md                 # how to record, what each plan covers
    Gemfile, Gemfile.lock     # native gems for recording only
    record-native.mjs         # developer script (npm run golden:record / golden:verify)
    cross-check.tji           # native CSV report used by the serializer cross-check (T9)
    plans/poc-sample/...
    plans/synthetic/NN-<name>/plan.tjp (+ .tji where needed)
    generators/scale-1000.mjs # seeded generator; its output is committed
    expected/<id>.json
    native-timings.json
public/engine/                # built, gitignored
src/
  engine/ protocol.ts, queue.ts, client.ts, worker.ts, runtime.ts, wasi-fs.ts, *.test.ts
  lib/strings.ts              # user-facing copy
  pages/app/index.astro       # placeholder shell: engine status only (version and last timings deferred to Phase 2)
  pages/dev/_engine.astro     # test harness; scripts/astro-dev-pages.mjs injects it as /dev/engine when MAINSPRING_DEV_PAGES=1
tests/
  golden/ canonical.ts, compare.ts, compare.test.ts, parity.spec.ts
  e2e/ shell.spec.ts, engine-responsiveness.spec.ts, lib/trace-max-task.ts
.github/workflows/ ci.yml, nightly.yml
package.json, package-lock.json, .nvmrc, astro.config.mjs, svelte.config.js, tsconfig.json,
vitest.config.ts, playwright.config.ts, .prettierrc, wrangler.jsonc, .gitignore
docs/decisions/0001-license.md, 0002-engine-protocol.md
```

## 5. Tasks

Every task runs in its own worktree and goes through `reviewer` before merge (CLAUDE.md working loop).

| # | Task | Owner | Files | Depends on |
| --- | --- | --- | --- | --- |
| T0 | **Done.** GPL-2.0-or-later, recorded in ADR-0001 | **User** decides; `docs-writer` formats | `docs/decisions/0001-license.md` | none; blocks the phase (section 10) |
| T1 | **Done.** Import the PoC zip unchanged into `poc/`. Record the zip's SHA-256. Leave out built binaries (ruby.wasm, bundles); note their source and version instead. Write `poc/INVENTORY.md` covering the items in 5.1 | `engine-specialist` (user provides the zip) | `poc/**` | T0, the zip being available |
| T2 | Scaffold from mycelium-web: Astro, Svelte 5, TS strict, Prettier, Vitest, Playwright with axe, `wrangler.jsonc` for static assets. Copy the configs and adapt names; do not copy app code. npm scripts per 7.1. Placeholder `/app` shell with desktop and phone screenshots. `strings.ts` | `ui-builder` | root configs, `src/pages/app/`, `src/lib/strings.ts`, `.gitignore`, `.nvmrc` | T0, mycelium-web attached |
| T3 | **Done.** `git subtree add --squash` TaskJuggler at `3b36c79` into `engine/tj/`, keeping its notices. Write `engine/tj.pin.json` with commit, tree SHA and version. Confirmed already: `lib/taskjuggler/version.rb` at this commit says `VERSION = '3.8.4'` | `engine-specialist` | `engine/tj/**`, `engine/tj.pin.json` | T0 |
| T4 | Port the bridge and stubs from `poc/`. Split them into `serialize.rb` (loads natively) and `wasm/` patches. Emit ScheduleResult v1 (3.1), with workspace-relative paths, canonical booking order, the `now` override, and no report generation (D7) | `engine-specialist` | `engine/bridge/**`, `engine/stubs/**` | T1, T3 |
| T5 | Bundle build script (3.5) | `engine-specialist` | `engine/build-bundle.mjs` | T1, T2, T3 (the file list comes from T4; can start against the PoC list) |
| T6 | Worker and runtime: port `poc/web/tj-runtime.mjs` to TypeScript in a dedicated worker. WASI in-memory FS, manifest and hash checks, `syntax()` | `engine-specialist` | `src/engine/worker.ts`, `runtime.ts`, `wasi-fs.ts` | T4, T5 |
| T7 | Protocol types, latest-wins queue and client (3.3). Unit tests plus fast-check properties: every promise settles exactly once; `done` revisions strictly increase; at most one request in flight; the newest non-cancelled revision always ends `done` or `failed` | `engine-specialist` (code), `test-writer` (tests) | `src/engine/protocol.ts`, `queue.ts`, `client.ts`, `*.test.ts` | T2 |
| T8 | 20 synthetic plans (section 6.1) and the seeded `scale-1000` generator. Each file's header names the feature it targets | `fixture-maker` | `engine/golden/plans/synthetic/**`, `generators/` | none; check locally with native tj3 |
| T9 | Native record script (6.2) and the serializer cross-check | `engine-specialist` | `engine/golden/record-native.mjs`, `engine/bridge/native/record.rb`, `Gemfile*`, `cross-check.tji` | T3, T4 |
| T10 | Write `manifest.json` (upstream examples, PoC sample, synthetic plans), run `golden:record` twice (it must be deterministic), and commit `expected/` and `native-timings.json` | `fixture-maker` | `engine/golden/manifest.json`, `expected/**`, `native-timings.json` | T8, T9, T1 (PoC sample) |
| T11 | Parity harness: `canonical.ts` and `compare.ts` with unit tests (including a one-minute mutation that must fail), `parity.spec.ts`, `/dev/engine` page (file `src/pages/dev/_engine.astro`, injected by `scripts/astro-dev-pages.mjs` when `MAINSPRING_DEV_PAGES=1`) | `test-writer`; `engine-specialist` reviews | `tests/golden/**`, `src/pages/dev/_engine.astro`, `scripts/astro-dev-pages.mjs` | T6, T7, T10 (can be written against T7's fakes earlier) |
| T12 | Responsiveness test and trace analysis (section 9, criterion 2) | `perf-a11y-auditor` with `test-writer` | `tests/e2e/engine-responsiveness.spec.ts`, `tests/e2e/lib/trace-max-task.ts` | T6, T7, T8 (scale-1000) |
| T13 | Shell e2e on desktop Chrome, Pixel 7 and iPhone 14: shell loads, engine reaches `ready`, the PoC sample schedules, axe is clean | `test-writer` | `tests/e2e/shell.spec.ts`, `playwright.config.ts` | T2, T6 |
| T14 | CI workflows (section 7), plus `nightly.yml` that records engine timings for every golden plan and runs golden on Firefox and WebKit without blocking | `test-writer` | `.github/workflows/*.yml` | T2; jobs are added as T5, T11, T12, T13 land |
| T15 | **Done.** ADR-0002, engine protocol decisions: the user's answers to 11.4 to 11.6 and 11.14 | `docs-writer` | `docs/decisions/0002-engine-protocol.md` | User answers 11.x; before T7 and T4 merge |
| T16 | Gate evidence: CI run link, parity table, long-task and trace results, screenshots | Main session; `test-runner` runs the suites | `docs/phases/phase-0-gate.md` | all |

### 5.1 What Phase 0 needs from the PoC (T1 inventory)

The zip's contents are not known yet. Record each item below as found, or as missing.

1. `bridge/`: the entry point and serializer, the Intl time-zone shim, the reusable parser cache, the hot-iterator rewrites, and the small-integer date patches. Note whether the serializer is already separate from the wasm-only patches.
2. `stubs/`: `term/ansicolor`, `drb`.
3. `web/tj-runtime.mjs`: wasm boot, WASI FS setup, bundle loading, how it calls the bridge, and whether it already runs in a worker.
4. Build scripts: the bundle file list and format, the Ruby wasm source file, and the exact `@ruby/3.4-wasm-wasi` and `@bjorn3/browser_wasi_shim` versions.
5. The PoC sample plan (it joins the corpus).
6. How the PoC checked "identical to native": which six examples it used, what it compared, and which native Ruby and tj3 it ran.
7. Measured PoC timings per example, to use as the baseline.

### 5.2 Parallel waves

| Wave | Tasks running in parallel |
| --- | --- |
| 0 | T0 (user); user attaches mycelium-web and provides the zip |
| 1 | T1, T2, T3, T8 |
| 2 | T4, T7, T14 (type check and unit jobs) |
| 3 | T5, T9, T15 |
| 4 | T6, T10 |
| 5 | T11, T12, T13; T14 completes |
| 6 | T16, then stop for approval |

## 6. Golden corpus and parity

### 6.1 Corpus

**Upstream examples.** These are read in place from `engine/tj/examples/` and not copied.

| id | entry |
| --- | --- |
| upstream-tutorial | `Tutorial/tutorial.tjp` |
| upstream-fedora-20 | `Fedora-20/f-20.tjp` (+ `reports.tji`) |
| upstream-template | `ProjectTemplate/template.tjp` |
| upstream-scrum | `Scrum/scrum.tjp` |
| upstream-todolist | `ToDo-List/todolist.tjp` |

**PoC sample:** `poc-sample`, in `engine/golden/plans/poc-sample/`.

**Synthetic plans** (`syn-NN-<name>`). Every plan sets `now` explicitly, and none uses `select random` (see 11.17).

| # | Name | Covers |
| --- | --- | --- |
| 01 | shifts-resource | `shift` definitions; resource `shifts` with date ranges; leaves inside a shift |
| 02 | shifts-allocation-task | per-allocation `shifts`; task-level `shifts` |
| 03 | limits-resource-max | resource `limits` with `dailymax`, `weeklymax`, `monthlymax` |
| 04 | limits-task-min-per-resource | task `limits` with per-resource limits (`{ resources r }`) that bind; one min variant kept as a recorded no-op, because TaskJuggler 3.8.4 never checks lower limits (`limitsOk?` checks upper limits only) |
| 05 | scenarios-tree | nested `scenario`, `active no`, scenario-prefixed attributes (`delayed:effort`) |
| 06 | scenarios-tracking | `trackingscenario`, `complete`, user `booking`s, fixed `now` |
| 07 | deps-onstart-onend | `depends` and `precedes` with `onstart` and `onend` |
| 08 | deps-gaps-alap | `gapduration`, `gaplength`, `scheduling alap`, `precedes` chains |
| 09 | tz-dst-berlin | `timezone "Europe/Berlin"`, work spanning the March and October DST changes |
| 10 | tz-fractional-offset | `Asia/Kathmandu` (+05:45), `timingresolution 15min` |
| 11 | tz-southern-sydney | `Australia/Sydney`: southern-hemisphere DST, across the year boundary |
| 12 | tz-unset | no `timezone`; shows that UTC normalisation holds |
| 13 | calendars-leaves | global and resource `leaves` (holiday, annual, special, sick, unpaid, unemployed), `vacation` |
| 14 | workinghours-resolution | project and resource `workinghours`, `dailyworkinghours`, `weekstartsmonday`, non-default `timingresolution` |
| 15 | allocate-select | `alternative`, `select` (maxloaded, minloaded, minallocated, order), `persistent`, `mandatory` |
| 16 | constraints-violations | `start`, `end`, `minstart`, `maxend`, plus constraints that cannot be met, so error messages are compared |
| 17 | priority-efficiency | `priority` contention, `efficiency` < 1 and > 1, overallocation warnings |
| 18 | structure-include-macro | `include` from subfolders, `macro`, `supplement`, `extend`; non-ASCII names, for column counting |
| 19 | errors-parse | syntax error inside an included `.tji` at a known line, with non-ASCII text before the bad token; `ok: false`. Native tj3 reports column 0 for scanner errors, so the column is whatever the shared serializer reports on both sides |
| 20 | scale-1000 | generated: at least 1,000 tasks, at least 50 resources in groups, 4-level nesting, dependency chains, a 3-year horizon. Used by the gate's responsiveness test |

**Bridge fixtures** (`bridge-<name>`, in `engine/golden/plans/bridge/`), added during T9 review so parity covers the bridge's error paths: header-only project, parse failure, scheduling error with tasks, scenario warning, include from a subfolder, BOM plus invalid UTF-8, `options.now`, and a `now` line taking precedence over `options.now`.

Expected total: 34 plans (5 upstream + 1 PoC + 20 synthetic + 8 bridge); see 11.1. The parity spec asserts the exact count from the manifest.

### 6.2 Native outputs (developer script, never run in CI)

`npm run golden:record [-- --only <id>]` runs `engine/golden/record-native.mjs`.

1. It refuses to run if:
   - `engine/tj` is not the pinned tree in `tj.pin.json`;
   - `ruby -v` is not 3.4.x, to match ruby.wasm (`--allow-ruby` overrides this and records the version; see 11.7);
   - the working tree has uncommitted changes under `engine/bridge/` or `engine/golden/plans/`.
2. For each manifest plan it runs `bundle exec ruby -I engine/tj/lib engine/bridge/native/record.rb --root <root> --entry <entry> [--now <iso>]` with `TZ=UTC` and `LANG=C.UTF-8`.
   - This is unmodified TaskJuggler on native Ruby, plus `serialize.rb`. No `wasm/` patches are loaded.
   - Gems come from `engine/golden/Gemfile.lock` (see 11.8).
3. It runs each plan twice. If the two outputs differ, it fails and writes nothing, which catches nondeterminism.
4. It writes `expected/<id>.json` (3.4) and updates `native-timings.json`.
5. Serializer cross-check: it also runs native `tj3` (the CLI from `engine/tj/bin`) with `cross-check.tji` added on the command line. That file is a CSV task report of id, start and end per active scenario. The script asserts it agrees with the serializer's task dates. The serializer is shared by both sides, so parity alone cannot catch serializer bugs.
6. `npm run golden:verify` does the same without writing, and exits non-zero on any difference.

`fixture-maker` runs the script; it never hand-edits outputs. If no session has Ruby 3.4, the user runs it locally. This environment has Ruby 3.3.6.

### 6.3 What "exactly" means

Comparison is string equality of canonical JSON: keys sorted recursively, 2-space indent. Both sides are canonicalised by `tests/golden/canonical.ts`. A mismatch prints a per-path diff, with minute values also shown as ISO times.

| Aspect | Rule |
| --- | --- |
| Fields compared | Everything in `GoldenFile.result`. Only `revision` and `timings` are excluded. Any further exclusion or tolerance needs an approved ADR |
| Dates | Project `start`, `end`, `now`: identical ISO 8601 UTC strings. Task and booking dates: identical integer `Minutes`. Not integral means the bridge failed |
| Allocations | `allocated` lists equal in order; `bookings` intervals equal after merging contiguous slots |
| Messages | Same count, same order (emission order), and equal `level`, `id`, `text`, `file`, `line`, `column`, `scenario` |
| Floats | `criticalness` and `pathCriticalness` compared exactly, as Ruby serialises them. A difference is a finding to report, not something to absorb with a tolerance |
| Ordering | `tasks`, `resources` and `scenarios` in declaration pre-order. `bookings` sorted by scenario pre-order, then resource pre-order, then task pre-order, then first interval start. The bridge sorts, so both sides share the rule |
| Time zones | All instants are UTC. Minutes are offsets from `project.start` in UTC. Native runs with `TZ=UTC`, and the wasm environment is UTC. The plan's `timezone` is applied by TaskJuggler (zoneinfo natively, the Intl shim in wasm). `native.tzdata` is recorded. Fixture dates use 2026 to 2028 in zones whose rules are not changing |
| Paths | Workspace-relative POSIX on both sides. Absolute host paths and `/workspace/` never appear |
| State leakage | `parity.spec.ts` runs the whole corpus through one long-lived worker, in a seeded shuffled order (as the app would), then runs `upstream-fedora-20` again in a fresh worker. Both must match |
| Golden freshness | Every golden's `native.tjCommit` must equal `tj.pin.json`; manifest ids and `expected/` files must match one to one |

## 7. CI (`.github/workflows/ci.yml`, on `push` and `pull_request`)

### 7.1 npm scripts

`format:check`, `typecheck` (`astro check` and `tsc --noEmit`), `test:unit` (Vitest), `build:engine`, `build`, `test:e2e`, `test:golden`. `golden:record`, `golden:verify` and `golden:wasm` (runs the corpus through the engine in Node, `engine/golden/run-wasm.mjs`) are developer-only, and CI never calls them.

### 7.2 Jobs

| Job | Steps | Needs |
| --- | --- | --- |
| check | `npm ci`, `format:check`, `typecheck`, `test:unit` | none |
| engine | `build:engine`, then `build:engine -- --check`; check that `engine/tj` matches `tj.pin.json` (`git rev-parse HEAD:engine/tj` equals the pinned tree); upload `public/engine` | none |
| e2e | Playwright browsers; `MAINSPRING_DEV_PAGES=1 npm run build`; `test:e2e` (desktop Chrome, Pixel 7, iPhone 14, axe, responsiveness spec on Chromium); upload screenshots, traces and the long-task report | engine |
| golden | `build:engine` itself (it does not use `needs: engine`), then `test:golden` on Chromium; upload the diff report on failure | none |
| no-ruby | Fail if any workflow step, npm script used in CI, or test file invokes `ruby`, `tj3`, `bundle` or `gem` | none |

No Ruby is installed or invoked. The GitHub runner image has Ruby preinstalled, so the guarantee comes from the `no-ruby` job and the scripts, not the image.

Making `golden` and `e2e` required for merge is a branch-protection setting the user enables.

Nightly (`nightly.yml`): engine timings per golden plan against `native-timings.json`, plus golden on Firefox and WebKit. Results are recorded, not blocking.

## 8. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| PoC zip missing or different from the plan's description | Blocks T4 to T6 | T1 goes first. INVENTORY lists the gaps; missing pieces become explicit tasks before T4 |
| Shared serializer hides bugs on both sides | False parity | CSV cross-check from native `tj3` (6.2 step 5) |
| Nondeterminism (`now` defaulting to the clock, `select random`, hash order, absolute paths, Time.now in messages) | Flaky goldens | `now` override, no random select, sorting in the bridge, path normalisation, double run during recording |
| Intl and zoneinfo disagree | Time-zone parity fails | Four tz fixtures; tzdata recorded; stable-rule years; any failure becomes a bridge fix |
| Native Ruby version differs from ruby.wasm (3.4) | Spurious diffs | Record script enforces 3.4.x |
| Large result clone or parse on the main thread takes over 50 ms | Gate criterion 2 fails | Measure scale-1000 straight after T6. If needed, change the encoding of `bookings` (typed arrays, transferable) through ADR-0002 |
| 32-bit wasm limits (memory, small-integer dates) on scale-1000 | Crash or wrong dates | scale-1000 has a 3-year horizon; `failed`/`crash` path with automatic restart; memory peak recorded |
| WebKit or Firefox run ruby.wasm differently | Later phases blocked | Nightly runs on both from Phase 0; not gating yet |
| Worker state leaks between runs (parser cache) | Wrong results in the app | Single-worker shuffled corpus run |
| License undecided | Legal; blocks the phase | T0 first |
| mycelium-web not available to the session | T2 blocked | User attaches the repo before wave 1 |
| CI time (34 plans in wasm, about 3× native) | Slow merges | One shared worker; per-plan timeouts; timings recorded nightly |

## 9. Gate acceptance criteria

Copied word for word from the plan:

> Gate: every golden plan scheduled in the worker matches native output exactly; the UI thread stays responsive (no task over 50 ms) while a 1,000-task plan schedules.

### Criterion 1: "every golden plan scheduled in the worker matches native output exactly"

- **How it is shown:** `npm run test:golden` (Chromium, the real built worker, using the 6.3 rules) passes in CI on the gate commit.
- **Evidence in `phase-0-gate.md`:**
  - the CI run link;
  - a table per plan: id, task count, worker `totalMs`, native ms, ratio, pass;
  - the asserted plan count;
  - output of the one-minute mutation unit test, showing the comparison would fail;
  - `npm run golden:verify` output on the developer machine, showing the committed goldens still reproduce natively;
  - the cross-check result.

### Criterion 2: "the UI thread stays responsive (no task over 50 ms) while a 1,000-task plan schedules"

**How it is shown:** `tests/e2e/engine-responsiveness.spec.ts`, Chromium, against the production build with dev pages enabled.

1. An init script installs `PerformanceObserver({ type: 'longtask', buffered: true })` and a rAF gap monitor on `/dev/engine`. The page runs a CSS and rAF animation, and the test types into an input every 100 ms.
2. **Cold window:** from `createEngineClient()` until the `syn-20-scale-1000` result has been handled, plus two frames.
3. **Warm window:** the same plan scheduled again with a new revision.
4. Assertions:
   - zero `longtask` entries in either window (the Long Tasks API reports only tasks over 50 ms, which matches "over 50 ms");
   - the result has `ok: true` and at least 1,000 tasks;
   - worker `scheduleMs` is at least 1,000 ms, so the window really covers a long run.
5. The test runs three times.
6. **Cross-check:** a Chromium performance trace (`browser.startTracing`, `devtools.timeline`) of one warm run. `trace-max-task.ts` reports the longest top-level task on the renderer main thread. It must be 50 ms or less.

**Evidence:** the long-task count, the trace's maximum task duration, the max rAF gap and the input latency for each run. Also a run with 4× CPU throttling, reported but not asserted (see 11.13). The trace file is a CI artifact.

### Phase deliverables

These are phase bullets, not gate criteria; they are listed for completeness.

| Plan bullet (verbatim) | Demonstration |
| --- | --- |
| "Scaffold from mycelium-web tooling; CI runs type check, unit tests and end-to-end tests on every push." | Green `ci.yml` run on a push; config files listed in the gate doc; `/app` screenshots, desktop and Pixel 7 |
| "Move the PoC engine into `engine/` and a Web Worker with the latest-wins queue; build script for the hashed bundle." | `src/engine` unit and property tests; `build:engine --check` passes; manifest with hashes in the gate doc |
| "Golden corpus: TaskJuggler's six examples, the PoC sample, plus 20 synthetic plans (shifts, limits, scenarios, `onstart`/`onend`, time zones, 1,000+ tasks). Native `tj3` outputs are generated once by a script and committed." | Manifest listing; `expected/` committed; `golden:verify` output |

## 10. Open questions: which block Phase 0

| Open question | Blocks Phase 0? | Why |
| --- | --- | --- |
| License | **Yes.** The risk table says "Decide the license before phase 0". T0 is needed before any copying (T1 to T3) | The PoC bridge contains rewrites of GPL v2 TaskJuggler code; `engine/tj` is vendored; package metadata |
| Shared code with Mycelium (copy or package) | No | Phase 0 copies tooling configs only; the sync modules arrive in Phase 4 |
| Which storage first | No | Phase 4 |
| Browser floor | Not blocking; Phase 0 assumes the recommended answer | It decides the Playwright matrix, `DecompressionStream` use and whether WebKit or Firefox golden runs could ever gate. A different answer changes only T13 and T14 |
| Tracking scope in v1 | No | Bookings are serialised anyway, as part of the schedule |
| Product name | Decided | |

## 11. Conflicts and ambiguities

None of these are resolved silently. Items 4, 5, 6 and 14 were answered by the user on 2026-11-11 and are recorded in ADR-0002; each was resolved as this spec proposes.

1. **"Six bundled examples." Resolved by T1.** At `3b36c79`, upstream `examples/` holds five project files, and the PoC README shows it ran exactly those five plus its own sample. The plan's "six" counts the sample. The corpus is 26 plans.
2. **PoC location.** Plan line 14 says copy `bridge/`, `stubs/` and `web/tj-runtime.mjs` straight into the repo. The kickoff says they are in `poc/`. The plan's layout has no `poc/`. Neither has happened. This spec keeps `poc/` as a frozen reference through Phase 0; whether to delete it is decided at the gate.
3. **"Native `tj3` JSON outputs."** `tj3` has no JSON output. This spec defines native output as unmodified TaskJuggler on native Ruby plus the shared bridge serializer, and adds a CSV cross-check against the real `tj3` CLI. Both are additions to the plan.
4. **`now`.** `tj3` has no option to set `now`, and plans without it default to the clock. This spec adds `ScheduleRequest.options.now` (golden and test use only). That deviates from the plan's `schedule({files, entry, revision})`.
5. **`bookings`.** This could mean user `booking` statements or scheduled allocations. This spec returns all scoreboard allocations per scenario, resource and task, the same way TaskJuggler's export emits bookings.
6. **`cancel(revision)` and "stale results are dropped".** Ruby cannot be preempted, so `cancel` only drops pending requests and discards in-flight results. This spec delivers a finished result marked `latest: false` when a newer revision is pending, rather than dropping it, so long runs still show progress. It drops only results older than one already delivered. A strict reading would drop it instead.
7. **Ruby version for recording.** ruby.wasm is Ruby 3.4; this session has 3.3.6. The spec requires 3.4.x natively.
8. **Native gems and stubs.** Native recording uses real gems pinned in a Gemfile, not the wasm stubs. The PoC README says the `mail` gem is never loaded by the scheduler; T9 confirms this for the native recorder.
9. **`public/engine/`.** The layout says "built, hashed". This spec gitignores it and builds in CI, rather than committing about 9 MB binaries.
10. **No owner for tooling and CI** in the agent table. This spec assigns the scaffold to `ui-builder` and CI to `test-writer`.
11. **mycelium-web is not attached.** T2 copies the tooling categories the plan names. Versions and the `wrangler.jsonc` contents are taken from that repo once attached, not assumed here. Deploying is out of scope.
12. **The testing table** puts end-to-end tests on iPhone 14 emulation (WebKit), but whether ruby.wasm behaves the same in WebKit or Firefox is unknown. Phase 0 gates golden parity on Chromium only.
13. **"No task over 50 ms" names no device.** The blocking test runs on CI hardware without throttling; the 4× throttled run is evidence only. Phase 6 measures the real budgets on reference devices.
14. **Date representation.** CLAUDE.md requires minutes since project start "in views". This spec also uses them in the protocol and goldens, with ISO only for the project frame.
15. **"No Ruby in CI"** is enforced by checks, because runner images ship Ruby.
16. **"Required for merge"** depends on GitHub branch protection, which the user must configure.
17. **`select random`** is excluded from the corpus because it may be nondeterministic. If v1 exposes it, it needs its own parity approach.
