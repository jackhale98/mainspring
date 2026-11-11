# Mainspring Build Plan

Nov 11, 2026 · @Jack Hale

## Summary

We are building Mainspring, a static, offline-first PWA that makes TaskJuggler as easy to use as a modern planning app, while the plan stays a plain `.tjp` text file under version control. The real TaskJuggler 3.8.4 scheduler runs in the browser on ruby.wasm, so every edit is scheduled by the same engine as the command line, with no server.

- **Who it is for:** engineers, technical program managers and small teams who want plans-as-code with real resource leveling, and anyone they share a plan with on a phone.
- **Core promise:** edit the same plan as text, as a Gantt and resource view, or side by side. Every visual edit becomes a minimal, exact text change, so diffs stay clean and nothing you did not touch moves.
- **Where plans live:** GitHub, OneDrive, Dropbox, or a local folder on desktop. The app never stores your plan on its own server.
- **Starting point:** a working proof of concept (tj-wasm-poc.zip, built 2026-11-11) already schedules TaskJuggler's six bundled example projects in the browser with results identical to native, at about 3× native time.

How to use this plan with Claude Code: export this doc to Markdown, commit it as `docs/BUILD_PLAN.md`, copy the PoC's `bridge/`, `stubs/` and `web/tj-runtime.mjs` into the new repo, then start Claude Code with the kickoff prompt in the execution plan section. Each phase ends with acceptance criteria that Claude Code must demonstrate before moving on.

## Decisions and defaults

The plan reuses Mycelium's proven stack and sync code, keeps the `.tjp` text as the only source of truth, and schedules everything in the browser. No GitHub Action computes schedules.

| # | Decision | Choice | Why |
| --- | --- | --- | --- |
| D1 | App stack | Astro + Svelte 5 + TypeScript, CodeMirror 6, Dexie, Vitest, Playwright | Same as mycelium-web, so code, patterns and CI carry over |
| D2 | Sync code | Copy Mycelium's `auth`, `git`, `dropbox`, `onedrive`, `sync`, `store` modules into `src/lib/` | Already handles GitHub/GitLab/Bitbucket, Dropbox, OneDrive, local folders and three-way merge |
| D3 | Git proxy | Reuse the deployed `mycelium-sync` Cloudflare Worker; add the new origin to `ALLOWED_ORIGINS` | GitHub's git and OAuth endpoints refuse browser requests; the worker already solves it |
| D4 | Scheduler | Unmodified TaskJuggler 3.8.4 on ruby.wasm, in a Web Worker, plus the PoC's bridge and shims | Identical results to native; UI never freezes |
| D5 | Source of truth | The `.tjp`/`.tji` files. Every visual edit is a minimal text patch | Clean diffs; text and visual views can never disagree |
| D6 | Rendering | Custom Gantt, resource and workload views on canvas + SVG overlays, written in Svelte | No Gantt library covers TaskJuggler's model, two-way text patching and touch gestures together |
| D7 | Reports | The app draws its own views from the scheduled model; TaskJuggler's HTML report generator is not used in v1 | Faster, themeable, interactive; reports can come later as an export |
| D8 | Hosting | Static build on Cloudflare (like my-celium.org) with a GitHub Pages mirror | No server code; free tier is enough |
| D9 | Collaboration | Through the storage provider (commits, cloud sync), not real-time co-editing | Matches plans-as-code; avoids running a server |

**Open questions (recommended answer in bold)**

- [x] Product name: **Mainspring** (decided 2026-11-11). TaskJuggler stays the name of the engine inside it.
- [ ] License? TaskJuggler is GPL v2 only, so a GPL v3 app cannot bundle it. **License the app GPL-2.0-or-later**, and relicense the Mycelium modules you copy (possible if you are their only author; check for outside contributions first).
- [ ] Shared code with Mycelium: copy now, or extract a shared package? **Copy now**, extract a `@jackhale98/sync` package after both apps stabilise.
- [ ] Which storage first? **Local folder + GitHub in phase 4, OneDrive + Dropbox right after**, since the PoC users are git users.
- [ ] Browser floor? **Current Chrome, Edge, Firefox; Safari 16.4+ on macOS and iOS** (needed for `DecompressionStream` and modern PWA install).
- [ ] Tracking scope in v1: completion percentages only, or bookings too? **Both**, but freeze (rolling bookings forward) after v1.

## TaskJuggler capabilities to expose

TaskJuggler's value is its scheduler: effort-based scheduling, automatic resource leveling, shifts, limits and scenarios. The app must surface these visually and fall back to text for everything else. The [syntax reference](https://taskjuggler.org/manual/toc.html) lists over 200 keywords; most are report formatting, which the app replaces with its own views.

| Area | Key keywords | In the visual UI | Release |
| --- | --- | --- | --- |
| Project frame | `project`, `timezone`, `now`, `timeformat`, `currency`, `workinghours`, `dailyworkinghours`, `weekstartsmonday` | Project settings sheet | MVP |
| Calendars | `leaves` (holiday, annual, special, sick, unpaid, unemployed), `vacation`, `workinghours` on resources, `shift` | Calendar view; leave painting on the resource timeline | MVP (holidays, leaves), v1 (shifts) |
| Task tree | `task`, nesting, `milestone`, `note`, `flags`, `responsible`, `priority` | Outline table, Gantt rows, drag to reparent and reorder | MVP |
| Sizing | `effort`, `duration`, `length`, `start`, `end`, `maxend`, `minstart`, `scheduling` (asap / alap) | Inspector fields; bar resize for effort or length | MVP |
| Dependencies | `depends`, `precedes`, `gapduration`, `gaplength`, `onstart`, `onend` | Drag from bar end to bar to link; link inspector for lag and type | MVP (finish-to-start), v1 (start/end variants, gaps) |
| Resources | `resource` groups, `efficiency`, `rate`, `email`, `managers` | Resource table; drag people into groups | MVP |
| Allocation | `allocate` with `alternative`, `select` (maxloaded, minloaded, minallocated, order, random), `persistent`, `mandatory`, per-allocation `shifts` and `limits` | Assignment chips; drop a person on a bar; allocation inspector | MVP (plain), v1 (alternatives, select, mandatory) |
| Limits | `limits` with `dailymax`, `weeklymax`, `monthlymax` and min variants | Workload view: set a cap per person or task | v1 |
| Scenarios | `scenario` tree, `active`, scenario-prefixed attributes such as `delayed:effort` | Scenario switcher and compare overlay | v1 |
| Tracking | `complete`, `booking`, `trackingscenario`, `projection`, freeze via `tj3 --freeze` | Progress handles on bars; bookings on the resource timeline | v1 (complete, bookings), v1.x (freeze) |
| Journal | `journalentry` with `alert` levels, `summary`, `details` | Status notes on tasks with red/yellow/green alerts | v1.x |
| Costs | `account`, `charge`, `chargeset`, `rate`, `startcredit` | Cost column and budget panel | v1.x |
| Structure | `include` (`.tji` files), `macro`, `supplement`, `extend` (custom attributes) | Multi-file workspace; custom attributes as inspector fields | MVP (include), v1 (extend), text-only (macros) |

Constructs the visual UI cannot edit safely (macros, conditional logic, report definitions) stay editable in text and appear read-only in views, marked with a small text-only badge.

**What the proof of concept already proved (2026-11-11)**

- TaskJuggler 3.8.4 parses and schedules in the browser with output identical to native on all six bundled examples, including the 414-task Fedora 20 plan.
- Speed: 0.2 to 0.7 s for small plans; about 3.0 s for Fedora versus about 1.0 s native. Startup is about 2 s after a 9.3 MB gzip download.
- Required shims: `term/ansicolor` and `drb` stubs, `Intl`-based time zones, a reusable grammar parser, Ruby re-implementations of hot iterators, and small-integer dates for 32-bit WebAssembly.
- Error messages come back with line and column, ready for editor diagnostics.
- The bridge returns each task's source line, which visual editing builds on.

## Planning best practices the app builds in

A best-in-class planner does more than draw bars: it keeps the schedule's logic valid, makes overload obvious, and shows what drives the finish date. The practices below come from the [GAO schedule guide](https://gaoinnovations.gov/schedule-guide/common-barriers-to-a-valid-critical-path.html) and the capacity views in leading tools, and each maps to a concrete feature.

| Practice | Why it matters | What the app does |
| --- | --- | --- |
| Complete logic: every task has a predecessor and successor | Missing or dangling links distort float and hide the true critical path | Plan health panel flags tasks with no predecessor or successor, with one-tap fixes |
| Minimal hard constraints | Fixed dates create separate critical sequences | Health panel lists every `start`, `end`, `maxend`, `minstart`; explains each conflict |
| No lags that hide work | A lag cannot represent work; waiting should be a tracked task | Warn on gaps over a threshold; offer "convert gap to task" |
| Show the driving path | Readers need the chain that sets the finish date, from status date to the end | Critical-path highlight, computed in the app from the scheduled dates and dependencies |
| Level resources without moving the finish if avoidable | [Leveling](https://gaoinnovations.gov/schedule-guide/resource-leveling.html) should absorb float first and reveal critical resources | TaskJuggler levels automatically; the app shows which person drives each delay and how much float each task has left |
| Review leveling output | Automatic leveling can be inefficient | "Why is this task here?" explainer: blocking dependency, busy resource, leave or limit |
| Watch capacity, not just dates | Overload is invisible on a Gantt | Workload heatmap per person and group, by day, week or month; red for over, blue for spare, green for full, with adjustable thresholds as in [Project's capacity view](https://support.microsoft.com/en-us/project/evaluate-resource-capacity-in-project-online) |
| Balance by reassigning or moving work | The standard fixes for overload | Drag a task from a red cell to another person or week; the patch updates `allocate` or adds a constraint |
| Plan with placeholders | Teams often know the role before the person ([Runn](https://runn.io/blog/resource-heatmap)) | Placeholder resources ("Backend dev 1") styled distinctly, with a swap-in action |
| Baselines and what-ifs | Compare the plan with reality and alternatives | TaskJuggler scenarios as baselines; compare overlay shows slips per task |
| Track against a status date | Progress only means something relative to "now" | Status date line; `complete` handles; bookings; ahead/behind badges |
| Break down long work | Long tasks hide slips | Health panel flags leaf tasks longer than a configurable threshold (default 20 working days) |
| Document changes | Stakeholders need to know why the plan moved | Every commit carries an auto-generated summary: tasks moved, finish date delta, people affected |

Table-stakes features in modern planning tools, which the app needs to feel fast: a command palette, inline rename, keyboard navigation of the outline, zoom from days to quarters, undo/redo across text and visual edits, a today line, collapse and expand, filtering by person or flag, and export to image, PDF and CSV.

## Product scope

The MVP is a complete loop for one person: open a plan from a folder or GitHub, edit it as text, Gantt or both, see workload, and save. v1 adds the depth that sets TaskJuggler apart (scenarios, tracking, limits, cloud sync). Later releases add costs, journals and exports.

| Area | MVP | v1 | Later |
| --- | --- | --- | --- |
| Workspace | Open a local folder (Chromium) or a GitHub repo; multi-file plans with `include`; new plan from templates | OneDrive and Dropbox; recent workspaces; plan picker per folder | Shared `.tji` resource pools across projects |
| Text editing | CodeMirror with TJP highlighting, inline errors, keyword completion and hover docs generated from TaskJuggler's own syntax rules, format-on-demand | Go to definition for task and resource ids; rename symbol across files | Snippets per house style |
| Gantt | Zoom day to quarter; summary bars; milestones; dependency lines; today and status-date lines; critical path; collapse; filters | Scenario compare overlay; baseline ghost bars; progress fill | Print and PDF layout |
| Visual editing | Move, resize, link, unlink, reparent, reorder, add, delete, rename, assign; inspector for every MVP keyword | Allocation alternatives, select modes, limits, `onstart`/`onend` links, custom attributes | Bulk edit across a selection |
| Resources | Resource table and groups; leaves and holidays; working hours | Shifts; placeholders; efficiency and rates | Skills tags and "find someone free" |
| Workload | Heatmap per person by day, week or month; over/under thresholds; drill into assignments | Drag to rebalance; utilisation summary per group; limits shown as caps | Cross-project load from shared pools |
| Plan health | Dangling logic, hard constraints, long tasks, overallocation warnings from TaskJuggler | "Why is this here?" explainer; float per task | Custom checks |
| Tracking | Status date | `complete` handles, bookings, ahead/behind badges | Freeze, journal and status alerts |
| Saving and sync | Save to folder; commit and push to GitHub with an auto summary; offline queue | Pull with three-way text merge and re-schedule; conflict view | Branch switcher and schedule diff between branches |
| Platform | Installable PWA, offline after first load, desktop and phone layouts, light and dark | Tablet layout with pencil and gestures; keyboard shortcuts sheet | Share target (open a `.tjp` shared from another app) |
| Export | Copy Gantt as PNG; CSV of tasks | iCalendar of milestones; PDF | TaskJuggler HTML reports via the engine |

## UX and interaction design

One plan, three editing modes, four views. The mode decides how much text you see; the view decides what the visual side shows. Mode and view persist per workspace.

**Editing modes** (toggle in the top bar, shortcut Cmd/Ctrl+1/2/3)

- **Text:** full-width editor with diagnostics, completion and an outline of tasks and resources. Scheduling still runs; a slim status strip shows the finish date and errors.
- **Split:** editor and view side by side on wide screens (draggable divider), stacked with a swipeable divider on tablets. Selecting a bar highlights its source block; moving the cursor into a task selects its bar.
- **Visual:** views only, with the inspector for fields. A "show source" button opens the selected task's block in a sheet.

**Views**

1. **Gantt:** outline column (id, name, effort, people, dates) plus timeline. Critical path in the accent colour; float shown as a faint tail after each bar.
2. **Resources:** one lane per person, assignments as bars, leaves as hatched blocks, overload marked in red on the lane itself.
3. **Workload:** heatmap of people (rows) by day, week or month (columns), each cell showing hours or percent; group rows roll up their members.
4. **Calendar:** holidays, leaves and milestones by month; paint leaves by dragging across days.

**Direct manipulation** (each action becomes one text patch, shown as a toast with Undo)

| Action | Desktop | Touch | Text change |
| --- | --- | --- | --- |
| Change effort or length | Drag a bar's right edge | Long-press bar, drag the end handle | Rewrites the number in `effort`/`length`/`duration` |
| Move a task later | Drag the bar body | Long-press, then drag | Adds or edits `start` (warns that this creates a constraint) or adds a dependency gap; the user picks in a one-time preference |
| Link tasks | Drag from a bar's end dot onto another bar | Tap link handle, then tap target | Adds `depends` to the successor, with a relative id (`!sibling`) when possible |
| Remove a link | Select line, Delete | Tap line, tap Remove | Removes that id from `depends`, or the whole line |
| Reorder or reparent | Drag a row in the outline | Long-press row handle, drag; drop indented to nest | Moves the task block, re-indents it, and fixes ids in `depends` across files |
| Assign a person | Drag from the people palette onto a bar | Tap bar, then tap people chips | Adds or edits `allocate` |
| Rebalance load | Drag a task from a red heatmap cell to another person's row | Same, long-press first | Rewrites `allocate` |
| Rename | Double-click the name | Tap name in inspector | Edits the task's name string only |
| Mark progress | Drag the progress handle inside a bar | Drag the handle | Edits `complete` |
| Navigate | Scroll, Shift+scroll to pan time, Ctrl+scroll to zoom | One-finger pan, pinch to zoom time, two-finger pan | None |

Rules for gestures: long-press (350 ms) before dragging on touch so scrolling never edits by accident; snap to working days; show the resulting dates live while dragging; Escape or dragging back cancels; every gesture has a keyboard and inspector equivalent.

**Layouts**

- **Desktop (1024 px and up):** top bar, left outline, centre view, right inspector; split mode puts the editor on the left.
- **Tablet (600 to 1023 px):** outline collapses into a drawer; inspector becomes a bottom sheet.
- **Phone (under 600 px):** one panel at a time with a bottom tab bar (Plan, Gantt, People, Text); a frozen narrow name column; bottom-sheet inspector with large stepper controls; edits made through sheets, gestures limited to pan, pinch and long-press drag.

**Design system**

- Tokens for colour, type, spacing and radius in CSS custom properties, light and dark, reusing Mycelium's token structure with a new palette.
- Type: Inter for UI, JetBrains Mono for source and ids (both already self-hosted in Mycelium).
- Semantic colours kept separate from the accent: over-allocated, critical, behind schedule, done.
- Motion: 150 to 200 ms for sheet and panel transitions; bars animate to new positions after a reschedule so people can see what moved; respect reduced motion.
- Accessibility: WCAG 2.2 AA; every view usable by keyboard; Gantt rows exposed as an ARIA grid; axe checks in end-to-end tests.

**Performance budgets**

- First open on a fast connection: app shell under 1.5 s; engine ready under 4 s; cached afterwards for offline use.
- Gestures and scrolling: 60 fps on a mid-range phone with 500 tasks visible (canvas rendering, virtualised rows).
- Feedback during a drag: under 16 ms (optimistic, no engine call). Rescheduled result: under 1 s for plans up to 200 tasks.

## Architecture

Three layers talk through one store: a document layer that owns the text, an engine worker that turns text into a schedule, and views that render the schedule and emit edit intents. The text is always authoritative; the schedule is derived and disposable.

```text
(Text version of the original diagram: app architecture, 6 parts)

  Views (Gantt, Resources, Workload, Calendar)      Text editor (CodeMirror 6)
        | edit intents                                   | text changes
        v                                                v
  Document layer (src/lib/tjp: Lezer tree, symbol index, edit API -> text patches)
        |
        v
  Store (workspace, schedule, selection, viewState)  <---->  Storage (folder, GitHub, OneDrive, Dropbox)
        | files + revision                 ^ schedule
        v                                  |
  Engine worker (ruby.wasm + TaskJuggler 3.8.4 + bridge, latest-wins queue)
```

Views and the text editor only ever change text; the engine worker turns the latest text into the schedule the views draw, and storage moves files in and out.

**Document layer** (`src/lib/tjp/`)

- A Lezer grammar for TJP gives a lossless syntax tree with exact character ranges for every property, attribute and value, in every file of the workspace. It covers the full syntax at the level of blocks, ids and attribute names, and fully types the MVP keywords' values.
- A symbol index maps task and resource ids (full paths like `app.editor`) to their declaring ranges, across `include`d files.
- An edit API turns intents into minimal patches: `setAttr(taskId, 'effort', '5d')`, `addDepends(taskId, targetId)`, `moveTask(taskId, newParentId, index)`, `allocate(taskId, resourceIds)`. Each returns CodeMirror `ChangeSpec`s; nothing else in the file changes. This is the TJP equivalent of Mycelium's byte-exact org patches.
- Formatting rules for inserted text follow the surrounding indentation and attribute order.

**Engine worker** (`src/engine/`)

- ruby.wasm, TaskJuggler 3.8.4 and the PoC's bridge run in a dedicated Web Worker. The main thread never blocks.
- Messages: `schedule({files, entry, revision})` returns `{revision, project, tasks, resources, bookings, messages, timings}`; `syntax()` returns keyword docs for completion; `cancel(revision)`.
- Latest-wins queue: while a run is in progress, only the newest pending revision is kept. Stale results are dropped by revision number.
- Workspace files are written into the worker's in-memory filesystem, so `include` works exactly as on the command line.
- The bridge grows to return what the views need: per-task scheduled start and end per scenario, effort done and left, allocated resources per day, criticalness, float inputs, and resource load per day.
- Fast path for visual edits (phase 2 spike): keep the parsed but unscheduled project in memory and apply attribute changes directly, skipping the parse that takes about 45% of a run. If the spike fails its equivalence tests, the app keeps full reparses.

**Edit pipeline**

1. A view emits an intent (for example, resize bar `app.gantt` to 8 days).
2. The view shows the result optimistically at once (bar redrawn), marked as pending.
3. The document layer applies the patch to the file in CodeMirror, as one undoable transaction.
4. The store bumps the revision and posts the changed files to the engine worker (debounced 300 ms for typing, immediate for gestures).
5. The worker returns the schedule; views animate from the optimistic state to the real one. Errors pin to their file and line, and the last good schedule stays visible, dimmed.

**State**

- Svelte 5 runes stores: `workspace` (files, dirty state, provider), `schedule` (latest result per revision), `selection`, `viewState` (zoom, filters, collapsed rows).
- Dexie (IndexedDB) caches workspaces, sync bases and the last schedule per plan, so a reopened plan shows instantly before the engine finishes.

**Rendering**

- Gantt and workload grids draw on `<canvas>` with virtualised rows and columns; selection handles, dependency editing and focus rings sit in an SVG or DOM overlay for accessibility and hit testing.
- Pointer Events for all input; one gesture state machine shared by mouse, pen and touch.

## Storage and sync

All four storage options come from Mycelium's existing modules; the new work is a TJP-aware merge and a schedule check after every merge. Plans never touch a server the user does not choose; the only server in the loop is the existing git proxy worker, which keeps nothing.

| Storage | Sign-in | Transport | Conflicts | Notes |
| --- | --- | --- | --- | --- |
| Local folder | None | File System Access API: read and write files in place | Detect external changes on focus by modified time; reload or merge | Chrome and Edge desktop, Chrome Android 132+. Not in Safari or Firefox ([support](https://web-platform-dx.github.io/web-features-explorer/features/file-system-access)), which get open-file and save-as instead |
| GitHub (also GitLab, Bitbucket) | GitHub App with per-repo install; PKCE, token exchange through the worker | isomorphic-git clone, commit, pull, push through the worker's git proxy; repo kept in IndexedDB | Three-way merge per file; conflict view | Reuse `src/lib/git` and `src/lib/auth/oauth.ts` unchanged |
| OneDrive and SharePoint | Microsoft Entra PKCE in the browser, no secret, no worker | Microsoft Graph delta listing and file upload | Automatic three-way merge against the last synced base | Reuse `src/lib/onedrive` and `src/lib/sync/engine.ts` |
| Dropbox | Dropbox PKCE in the browser, no worker | Dropbox list-folder cursor and upload | Same as OneDrive | Reuse `src/lib/dropbox` |

**Offline and caching**

- A service worker precaches the app shell, the 9 MB gzipped Ruby runtime and the TaskJuggler bundle, versioned by content hash.
- Every workspace lives in IndexedDB; edits made offline queue up and sync on reconnect, as in Mycelium.
- On Safari and Firefox, "local" plans live in the app's own storage with explicit open-file and download actions; the UI says where the file actually is.

**Merging plans safely**

1. Merge text three-way with `node-diff3`, as Mycelium does.
2. TJP-aware conflict hints: when both sides touched the same task block, show the conflict per task ("You changed effort to 5d; they changed it to 8d"), not per line.
3. After any merge, schedule the merged plan before committing. If it no longer parses or a dependency now points at a deleted task, block the commit and show the errors.

**Commits**

- Default commit message is generated from the change: tasks added, removed and moved, the finish date before and after, and people whose load changed. Users can edit it.
- Branches: v1 commits to the current branch; the branch switcher and schedule diff between branches come later.

## Tech stack and repository layout

Start from a copy of mycelium-web's tooling (Astro, Svelte 5, TypeScript strict, Prettier, Vitest, Playwright with axe, the Cloudflare `wrangler.jsonc` for static assets) and add only what the scheduler and timeline need.

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Astro 7 static output + Svelte 5 islands | One `/app` route hosts the whole client app |
| Editor | CodeMirror 6 with a Lezer TJP grammar | Lezer gives incremental, lossless parsing and exact ranges |
| Engine | `@ruby/3.4-wasm-wasi` 2.10.x, `@bjorn3/browser_wasi_shim`, TaskJuggler 3.8.4 sources pinned to commit `3b36c79` | Bundle built by a script, gzipped, content-hashed |
| Git | isomorphic-git + lightning-fs, through the existing worker | As Mycelium |
| Storage | Dexie 4 | As Mycelium |
| Merge | node-diff3 | As Mycelium |
| Gestures | Pointer Events; no gesture library | Shared state machine in `src/lib/gesture/` |
| Dates | Plain integers (minutes since project start) in views; `Intl` for display | Never `Date` math in hot loops |
| Tests | Vitest, fast-check (property tests), Playwright (desktop, Pixel 7, iPhone 14 emulation), axe | Golden schedule corpus checked against native `tj3` |

```text
mainspring/
  CLAUDE.md                  # rules for Claude Code (see execution plan)
  .claude/agents/            # subagent definitions
  docs/BUILD_PLAN.md         # this document
  docs/decisions/            # one short ADR per decision that changes the plan
  engine/
    tj/                      # TaskJuggler sources at the pinned commit (git subtree)
    bridge/                  # tj_bridge.rb, tz, parser cache, perf, time patches
    stubs/                   # term/ansicolor, drb
    build-bundle.mjs         # packs engine/ into tj-bundle.json.gz
    golden/                  # .tjp corpus + native tj3 JSON outputs
  public/engine/             # ruby.wasm.gz, tj-bundle.json.gz (built, hashed)
  src/
    engine/                  # worker entry, client API, latest-wins queue
    lib/tjp/                 # Lezer grammar, syntax tree helpers, symbol index, edit API
    lib/schedule/            # derived data: critical path, float, load per day, health checks
    lib/gesture/             # pointer state machine, snapping, long-press
    lib/auth|git|dropbox|onedrive|sync|store/   # copied from mycelium-web
    components/              # Svelte: shell, gantt, workload, resources, calendar, inspector
    pages/app/               # the app route
  tests/e2e/                 # Playwright specs and screenshots
```

Conventions: TypeScript strict with no `any` in `src/lib`; every module in `src/lib` has unit tests beside it; no file over 400 lines without a reason in its header; user-facing copy in one strings file; commits follow Conventional Commits.

## Build phases and milestones

Seven phases; phases 0 to 4 make the MVP and 5 to 6 make v1. Each phase ends at a gate: Claude Code must show every acceptance criterion passing (tests, screenshots or a recorded demo) and you approve before the next phase starts. Phone layouts are built in every phase, not bolted on at the end.

```text
(Text version of the original diagram: build roadmap, 7 phases, 7 gates; <> = gate needing approval)

  Phase 0  Foundation and engine ............... <>
  Phase 1  Document layer and text mode ......... <>
  Phase 2  Gantt and visual editing ............. <>
  Phase 3  Resources, workload and plan health .. <>
  Phase 4  Storage, sync and PWA ................ <>  MVP release
  Phase 5  Tracking, scenarios and depth ........ <>
  Phase 6  Polish and launch .................... <>  v1 release
```

Each diamond is a gate that needs your approval; the MVP ships at the phase 4 gate and v1 at the phase 6 gate.

**Phase 0: Foundation and engine**

- Scaffold from mycelium-web tooling; CI runs type check, unit tests and end-to-end tests on every push.
- Move the PoC engine into `engine/` and a Web Worker with the latest-wins queue; build script for the hashed bundle.
- Golden corpus: TaskJuggler's six examples, the PoC sample, plus 20 synthetic plans (shifts, limits, scenarios, `onstart`/`onend`, time zones, 1,000+ tasks). Native `tj3` outputs are generated once by a script and committed.
- Gate: every golden plan scheduled in the worker matches native output exactly; the UI thread stays responsive (no task over 50 ms) while a 1,000-task plan schedules.

**Phase 1: Document layer and text mode**

- Lezer TJP grammar with lossless round trip; symbol index across included files; diagnostics from the engine pinned to file, line and column.
- Completion and hover docs generated from TaskJuggler's own syntax rules (its `SyntaxReference` and keyword docs), so they match the engine version.
- Edit API with every MVP intent, each with unit tests.
- Gate: parsing then printing every golden file reproduces it byte for byte; property tests show each edit changes only its target range and the result still schedules.

**Phase 2: Gantt and visual editing**

- Canvas Gantt with outline, zoom, collapse, dependency lines, critical path, float tails, today and status-date lines.
- Split, Text and Visual modes with two-way selection sync; inspector; all MVP gestures on mouse and touch; unified undo across text and visual edits.
- Spike: the parse-skipping fast path; adopt only if equivalence tests pass.
- Gate: each row of the direct-manipulation table works on desktop and in phone emulation, produces the documented patch, and is undoable; 500-task scroll at 60 fps on a mid-range Android device.

**Phase 3: Resources, workload and plan health**

- Resources view, workload heatmap with thresholds, drag to rebalance, calendar with leave painting, resource table and groups.
- Plan health panel with the checks from the best-practices section and "why is this here?" explanations.
- Gate: on the Fedora plan, the heatmap's hours per person per week match the engine's load data exactly; every health check has a passing and a failing fixture.

**Phase 4: Storage, sync and PWA (MVP release)**

- Local folders and GitHub first; then OneDrive and Dropbox. TJP-aware conflict view; schedule check before commit; generated commit messages.
- Service worker, install prompt, offline editing with a sync queue.
- Gate: end-to-end tests edit the same plan on two simulated devices, merge, and produce a valid schedule; the app opens and schedules offline after one visit; MVP release deployed to the staging origin.

**Phase 5: Tracking, scenarios and depth (v1)**

- Status date, `complete` handles, bookings on the resource timeline, ahead/behind badges.
- Scenario switcher and compare overlay; baseline ghost bars.
- Allocation alternatives, select modes, mandatory, limits, shifts, custom attributes from `extend`.
- Gate: golden plans for each feature schedule identically to native; scenario compare lists every task whose dates differ.

**Phase 6: Polish and launch (v1 release)**

- Phone and tablet pass with real devices (iOS Safari, Android Chrome); performance budgets measured and recorded; WCAG 2.2 AA audit; onboarding with three templates; help pages; landing page.
- Gate: Lighthouse PWA and accessibility scores of 95 or more; every budget in the UX section met on the reference devices; zero open severity-1 bugs.

## Claude Code execution plan

The main session (Opus) plans and integrates; correctness-critical work goes to Opus subagents; UI and tests go to Sonnet; high-volume, low-judgement work goes to Haiku. Subagents are Markdown files in `.claude/agents/` whose frontmatter sets `model`, `effort`, `tools` and optional `isolation: worktree` ([docs](https://code.claude.com/docs/en/sub-agents)).

| Agent | Model, effort | Tools | Use it for |
| --- | --- | --- | --- |
| Main session (orchestrator) | opus, high | All | Phase plans, task breakdown, integration, merges, gate demos |
| `architect` | opus, high | Read-only | Phase specs, interfaces between layers, ADRs; never writes code |
| `engine-specialist` | opus, xhigh | All, worktree | Ruby bridge, wasm shims, worker protocol, golden-test parity, fast-path spike |
| `grammar-specialist` | opus, high | All, worktree | Lezer TJP grammar, symbol index, edit API, merge hints |
| `ui-builder` | sonnet, high | All, worktree | Svelte components, canvas views, gestures, layouts, design tokens |
| `test-writer` | sonnet, medium | All | Unit, property and Playwright tests from a spec's acceptance criteria |
| `perf-a11y-auditor` | sonnet, medium | All | Performance traces against budgets, axe and Lighthouse runs, fixes for findings |
| `reviewer` | opus, high | Read-only | Fresh-eyes review of every diff against the plan, the spec and the gate before merge |
| `fixture-maker` | haiku, low | All | Synthetic `.tjp` golden plans, running the native `tj3` output script, sample data |
| `test-runner` | haiku, low | Bash, Read | Running suites and returning only a failure summary, keeping logs out of the main context |
| `docs-writer` | haiku, medium | Read, Write, Edit | Help pages, README, changelog, ADR formatting from notes |

Optional: for the two hardest design problems (the parse-skipping fast path and TJP-aware merging), ask the `architect` to run with `model: fable` for one design pass, then return to opus.

**Working loop for each phase**

1. `architect` writes `docs/phases/phase-N.md`: scope, interfaces, task list, acceptance criteria copied from this plan. You approve it.
2. The orchestrator splits the tasks and runs independent ones in parallel subagents, each in its own worktree.
3. `test-writer` writes tests from the acceptance criteria before or alongside the code.
4. `test-runner` runs suites; failures go back to the owning agent.
5. `reviewer` reviews each branch; the orchestrator merges only after a clean review.
6. Gate: the orchestrator records evidence (test output, screenshots on desktop and phone, timings) in `docs/phases/phase-N-gate.md` and stops for your approval.

**Cost controls**

- Haiku handles anything repetitive: fixtures, test runs, log triage, docs formatting.
- Read-only agents (`architect`, `reviewer`) cannot write code, which keeps reviews independent.
- Set `maxTurns` on Haiku agents (30) so a stuck loop stops early.
- Keep agent descriptions short: all of them count against a 15,000-token startup limit.

**Example agent file** (`.claude/agents/engine-specialist.md`)

```markdown
---
name: engine-specialist
description: Owns the TaskJuggler-on-ruby.wasm engine, bridge, shims and golden parity tests. Use for any change under engine/ or src/engine/.
model: opus
effort: xhigh
isolation: worktree
---
You maintain the in-browser TaskJuggler engine. Never edit files under engine/tj/
(upstream TaskJuggler); fix behaviour with bridge patches instead. Every change must
keep all golden plans identical to native tj3 output (npm run test:golden).
Report timings before and after for the Fedora plan.
```

**CLAUDE.md essentials**

- Read `docs/BUILD_PLAN.md` and the current `docs/phases/phase-N.md` before any work.
- Text is the source of truth: views never mutate the schedule directly; every edit goes through `src/lib/tjp` edit API.
- Never modify `engine/tj/`. Golden parity (`npm run test:golden`) must pass before any merge.
- Mobile counts: every UI change ships with a phone-emulation screenshot.
- Delegate by the agent table; do not do Haiku-sized work in the main session.
- Stop at each phase gate and wait for approval.

**Kickoff prompt**

```text
Read docs/BUILD_PLAN.md. We are starting Phase 0. Create CLAUDE.md and the
subagents in .claude/agents/ exactly as the execution plan describes. Then have
the architect write docs/phases/phase-0.md and stop for my approval. The PoC is in
poc/ (bridge/, stubs/, web/tj-runtime.mjs, build scripts); reuse it.
```

## Testing and quality

Two properties matter more than anything else: the browser schedule must equal native TaskJuggler, and a visual edit must change only what it claims to. Each has its own test suite that blocks merges.

| Suite | What it proves | Runs |
| --- | --- | --- |
| Golden parity | Every corpus plan scheduled in the worker matches committed native `tj3` JSON exactly (dates, allocations, messages) | Every push; required for merge |
| Round trip | Lezer parse then print reproduces each corpus file byte for byte | Every push |
| Patch fidelity (property tests) | Random intents on random plans change only the target range, keep the file parseable, and schedule without new errors | Every push, 200 cases; 5,000 nightly |
| Unit | Edit API, symbol index, derived schedule data (critical path, float, load), gesture state machine, merge hints | Every push |
| End-to-end | Each row of the direct-manipulation table on desktop Chrome, Pixel 7 and iPhone 14 emulation; open, edit, save, sync and merge flows | Every push; real-device pass before each release |
| Accessibility | axe on every view; keyboard-only walkthrough of the MVP loop | Every push; manual audit in phase 6 |
| Performance | Engine timings for golden plans; frame times while panning and dragging a 500-task plan | Nightly, with results recorded so regressions show |
| Visual | Screenshots of each view, light and dark, desktop and phone | Every push, reviewed in pull requests |

Native outputs for the golden corpus are produced by a developer script with a local Ruby and `tj3`, then committed. CI only compares against them, so no Ruby is needed in CI and no schedule is ever computed outside the browser engine at runtime.

## Risks and mitigations

The biggest risk is visual editing on plans that use advanced syntax; the plan contains it by keeping text authoritative and marking anything the UI cannot edit safely.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Visual edits break plans that use macros or `supplement` | High: users lose trust | Edit API refuses intents whose target range comes from a macro expansion; text-only badge; property tests on macro-heavy fixtures |
| Large plans feel slow (about 3× native) | Medium | Worker plus optimistic UI; parse-skipping fast path; cached last schedule on open; measured budgets |
| 9 MB first download on mobile data | Medium | Load the engine after the app shell; show cached schedule meanwhile; precache once; consider Brotli for about 20% less |
| ruby.wasm or TaskJuggler upstream changes | Medium | Pin both versions; golden parity gates any upgrade |
| Safari and Firefox lack folder access | Medium for desktop users of those browsers | Open-file and save-as fallback; recommend git or cloud storage there |
| GPL v2 licensing mistakes | High, legal | Decide the license before phase 0 (open question); keep TaskJuggler unmodified in its own folder with its notices |
| Merge produces a plan that no longer schedules | Medium | Schedule check before commit; per-task conflict view |
| Scope creep from TaskJuggler's 200+ keywords | Medium | Release table is the contract; anything else stays text-only until promoted by an ADR |
| Agents drift from the plan | Medium | Phase specs, read-only reviewer, gates that stop for approval |

## Sources

- [The TaskJuggler User Manual, table of contents and syntax reference](https://taskjuggler.org/manual/toc.html)
- [TaskJuggler manual: Day To Day Juggling (scenarios, tracking, bookings, time and status sheets)](https://taskjuggler.org/manual/Day_To_Day_Juggling.html)
- [TaskJuggler manual: allocate](https://taskjuggler.org/manual/allocate.html)
- [TaskJuggler features and highlights](https://taskjuggler.org/manual-git/features_and_highlights.html)
- [GAO Schedule Assessment Guide: common barriers to a valid critical path](https://gaoinnovations.gov/schedule-guide/common-barriers-to-a-valid-critical-path.html)
- [GAO Schedule Assessment Guide: resource leveling](https://gaoinnovations.gov/schedule-guide/resource-leveling.html)
- [Microsoft: evaluate resource capacity in Project Online](https://support.microsoft.com/en-us/project/evaluate-resource-capacity-in-project-online)
- [Runn: resource heatmaps](https://runn.io/blog/resource-heatmap)
- [Web features explorer: File System Access support](https://web-platform-dx.github.io/web-features-explorer/features/file-system-access)
- [Claude Code docs: create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [jackhale98/mycelium-web](https://github.com/jackhale98/mycelium-web) (stack, sync modules and worker reused by this plan)
- [ruby.wasm](https://github.com/ruby/ruby.wasm) and [TaskJuggler source](https://github.com/taskjuggler/TaskJuggler) (engine used by the PoC)
