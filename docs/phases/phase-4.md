# Phase 4: Storage, sync and PWA (MVP release)

Status: **draft for the user's approval.** Sources:
- `docs/BUILD_PLAN.md`: "Decisions and defaults" (D1 to D3, D8, D9, and the open question "Which storage first?"); "Product scope" (Workspace, Saving and sync, Platform, Export); "Architecture" (State, the store/storage arrow); "Storage and sync"; "Phase 4"; "Testing and quality"; "Risks and mitigations"; "Claude Code execution plan".
- ADR-0001 (licence, Dexie, OpenSSL, Mycelium relicensing), ADR-0002 #13 (decoding), ADR-0003 #1 (invalid UTF-8 is left to Phase 4), ADR-0006 (Pages preview, base path, the service worker scope), ADR-0008 (one undo stack, preferences), ADR-0012 (update check), ADR-0013 (saving a new plan), ADR-0016 (test tiers, iPhone allowlist, CI rules, primitives), ADR-0017 (docs asset, to be precached), ADR-0018 (targets read on an old index, `changesSince`).
- `docs/phases/phase-3.md` (structure), `phase-3-gate.md` (open items), `phase-2.md` 18.10 (export in Phase 4), `phase-0-gate.md` (wasm code cache in Phase 4), `phase-2-polish.md` items 20 to 22, `docs/backlog.md`.
- Code: `src/lib/state/app.svelte.ts`, `storage.ts`, `src/lib/workspace/{workspace,paths,samples}.ts`, `src/lib/tjp/document.ts`, `src/engine/manifest.ts`, `src/lib/app/update-check.ts`, `public/manifest.webmanifest`, `astro.config.mjs`, `wrangler.jsonc`, `playwright.config.ts`, `scripts/ci/licenses.mjs`.

Section 18 lists the open questions, each with a recommended answer. Section 19 lists the conflicts with the build plan. This spec does not settle any of them silently.

## 1. Scope

The MVP is the build plan's "complete loop for one person": open a plan from a folder or GitHub, edit it, see the schedule and workload, and save it. It also has to survive a reload, work offline after one visit, and be installable. The Phase 4 gate is the MVP release.

| In scope | From |
| --- | --- |
| **Plans kept in the browser** (IndexedDB): every open plan is stored, autosaved and reopened after a reload. One tab owns a plan at a time | Phase 4 bullet 2 ("offline editing"); Architecture, State; ADR-0012 and ADR-0013 consequences |
| **Local folder**: open a folder and save in place where the File System Access API exists (Chromium). Elsewhere: open files, import a folder, export (download or share sheet) | Phase 4 bullet 1; Storage table; Product scope, Workspace (MVP) |
| **GitHub**: sign in, pick a repository, branch and folder, pull, commit and push, a generated commit message, and an offline queue | Phase 4 bullet 1; Saving and sync (MVP) |
| **Sync and conflicts**: three-way text merge, TJP-aware conflict hints, a conflict view, a schedule check before every commit | Phase 4 bullet 1; "Merging plans safely" |
| **Multi-file plans** (`include`d `.tji`) on every provider | Product scope, Workspace (MVP, include) |
| **Service worker and PWA**: precache, offline open, install, update flow, engine cache by content hash, persistent-storage request, the wasm code-cache spike | Phase 4 bullet 2; "Offline and caching"; phase-0 gate deviation 2 |
| **Security**: token storage and scopes, CSP and headers, no secrets in the repo or the bundle, a network allowlist | Implied by the GitHub provider; CLAUDE.md licensing |
| **The release**: an OpenSSL-free ruby.wasm, the licence checks clean, a deploy to the staging origin | Phase 4 gate; ADR-0001; ADR-0006 #3 |
| **Export**: copy the Gantt as PNG, and a CSV of tasks | Product scope, Export (MVP); phase-2 18.10 ("export in Phase 4 before the MVP release") |
| Phone, tablet and desktop layouts, light and dark, for every new UI | CLAUDE.md "Mobile counts" |

## 2. Non-goals

- **No OneDrive or Dropbox** in this gate. They come right after the MVP release, behind the same provider interface (18.1).
- **No GitLab or Bitbucket.** No branch switcher, schedule diff between branches, pull requests or history browser (Later).
- **No real-time co-editing** (D9). Two devices meet only through the provider.
- **Files are not created or deleted from views** (amended 2026-11-23, section 21: "New file…" creates a `.tji`; nothing deletes or renames one). Edits never add or remove a file (`workspace.ts`). Phase 4 writes only the files that changed. The one exception is "Save to…", which writes every file of a plan that is not stored anywhere yet. Mainspring never deletes a file on a provider.
- **No last-schedule cache** for instant open. ADR-0015 is reserved for it (18.12).
- **No templates gallery** (Phase 6 onboarding). "New plan…" stays as built (ADR-0013).
- **No change to `engine/tj/`, the bridge protocol or the edit API's intents.** Merges are text. A resolution is text, applied through `Workspace.apply` as one change.
- **No schedule outside the browser engine.** The schedule check is the app's own runner result for the exact text being committed.
- **Real devices.** The full real-device pass stays in Phase 6. A short release smoke is asked in 18.15.
- **No Lighthouse PWA score gate** (Phase 6).

## 3. Starting point

- **The workspace lives only in memory.**
  - It is seeded from bundled samples or "New plan…" (`app.svelte.ts` `#load`).
  - `dirty` makes `confirmSwitch` and `confirmReload` ask first.
  - The note says "Changes stay in this tab until saving arrives. Reloading the page discards them." (`strings.ts` 882). The landing copy says the same (`landing-copy-more.ts` 118, 156).
- **Persistence today** is UI preferences in `localStorage`, keyed per sample (`storage.ts`, ADR-0008 #3: "No plan text is ever stored").
- **Text fidelity.**
  - Files are decoded as UTF-8, with invalid bytes replaced and a BOM kept as U+FEFF (ADR-0002 #13).
  - Lines break on `\n` only, so CRLF round-trips (`document.ts`).
  - Paths are POSIX, relative to the workspace root. Includes resolve as TaskJuggler does, with `outside-workspace` and `not-found` (`paths.ts`).
  - `bridge-bom-invalid-utf8` cannot round-trip byte for byte (ADR-0003 #1).
- **History.** There is one undo stack per workspace. A change from outside the history clears both stacks (ADR-0008 #1). `Workspace.changesSince(version)` maps ranges across versions (ADR-0018).
- **PWA pieces.**
  - `public/manifest.webmanifest` exists (start `./app/`, scope `./`, icons). There is no service worker.
  - Builds are named, and `version.json` drives "New version · Reload" (ADR-0012 #6: Phase 4 reuses the signal).
  - The Pages preview runs under `/mainspring/`, so the service worker's scope and precache list must follow the base (ADR-0006).
- **Engine assets** (`ruby.<hash>.wasm.gz`, `tj-bundle.<hash>.json.gz`, `tj-docs.<hash>.json.gz`, `manifest.json`) are content-hashed and checked by SHA-256 in the worker (`manifest.ts`).
- **Not in the repo:** no Mycelium module (`auth`, `git`, `sync`, `store`), no Dexie, no git proxy configuration. `scripts/ci/licenses.mjs` fails a GPL-2.0-incompatible runtime dependency and reports OpenSSL inside ruby.wasm as its one embedded exception.
- **Budgets carried in.**
  - Visual-first first load: 329,562 of 340,000 bytes gzip.
  - **Text-first first load: 436,653 of 440,000, so about 3.3 KB of headroom.**
  - Total: 608,183 of 650,000.
  - The first schedule of a 200-task plan takes 4.6 to 5.1 s against 4 s (P3; "the wasm code cache is Phase 4").
  - CI takes 16 to 19 min (target waived 2026-11-23). The iPhone allowlist holds 5 of 6 entries.
- **Open from Phase 3:**
  - goldens provisional on Ruby 3.3.6;
  - real devices waived to Phase 6;
  - polish 20, 21 and 22;
  - "Find and replace offline on first use" (needs the precache);
  - Safari's failed-chunk retry.

## 4. What each platform can do

Stated plainly, because the UI must say where a plan really lives.

| Capability | Chrome, Edge (desktop) | Chrome Android | Safari macOS | Safari iOS and iPadOS | Firefox |
| --- | --- | --- | --- | --- | --- |
| Open a folder and save into it in place | Yes (File System Access) | The plan says 132+; unverified until Phase 6 (19.5) | No | **No** | No |
| Open files (a copy) | Yes | Yes | Yes | Yes: Files app, iCloud Drive, several files at once | Yes |
| Import a whole folder (a copy) | Yes | Unverified | Yes (`webkitdirectory`) | **No** | Yes |
| Keep plans in the app's own storage | Yes | Yes | Yes | Yes, but see eviction (9.5) | Yes |
| Export | Download `.tjp` or `.zip` | Download | Download | Share sheet ("Save to Files"), else download | Download |
| GitHub | Yes | Yes | Yes | Yes | Yes |
| Install | Install prompt | Install prompt | Add to Dock | Share, then Add to Home Screen (instructions only) | No (desktop) |
| Offline after one visit | Yes | Yes | Yes | Yes | Yes |

**On an iPhone or iPad, Mainspring cannot open a folder, cannot save back into a file you picked, and cannot see when another app changes a file.** It can open copies of files, keep plans in its own storage, export them through the share sheet, and sync with GitHub. GitHub is the recommended way to work on one plan from a phone and a computer. The UI never says "saved to your files" for a plan that is only in browser storage.

## 5. Module layout

```text
src/lib/storage/
  types.ts            # 6.1 provider contract, locations, errors (T3)
  codec.ts            # bytes <-> text, round-trip rules (6.2)
  idb.ts              # a small IndexedDB wrapper (no Dexie, 18.5)
  local-store.ts      # plans, files, sync bases, queue, conflicts, credentials (6.2)
  autosave.ts, lock.ts  # debounced writes; one owner tab per plan (Web Locks)
  folder.ts           # File System Access provider (7.2)
  import.ts, export-files.ts  # open files, import folder, export .tjp/.zip, share
  github/             # auth.ts, api.ts (REST), provider.ts, credentials.ts (7.3)
  net.ts              # fetch wrapper with the host allowlist (10.1)
src/lib/sync/
  types.ts            # 6.3 status, controller (T3)
  merge.ts            # workspace three-way merge (6.4)
  controller.svelte.ts, queue.ts, check.ts, commit-message.ts   # 6.3, 6.5
src/lib/tjp/merge/    # hints.ts, refine.ts: grammar-aware conflicts (6.4)
src/lib/export/       # csv.ts, gantt-png.ts
src/pwa/sw.ts, src/pwa/messages.ts; scripts/astro-sw.mjs; src/lib/app/pwa.svelte.ts   # 6.6, 9
src/components/storage/   # PlanChooser, OpenFromGitHub, SignIn, SaveTo, Settings (lazy)
src/components/sync/      # SyncStatus (first load), SyncPanel, CommitSheet, ConflictView (lazy)
src/lib/strings-storage.ts, strings-sync.ts, strings-conflict.ts   # copy per lazy view
public/_headers; tests/fakes/github/**; tests/fixtures/storage/**
tests/e2e/{persist,folder,files-fallback,github,sync-two-devices,conflict,offline,pwa-update,csp,export}.spec.ts
```

Everything except `SyncStatus`, `autosave`, `idb`, `codec`, the restore path and the service worker registration loads lazily (12.1). Every `src/lib` module has its `*.test.ts` beside it.

## 6. Interfaces

The interface task (T3) merges these types and contract comments before any consumer is built (CLAUDE.md, 2026-11-13). The contract also lists the exact GitHub endpoints that the provider and the fake use (7.3), so the fake is never written against a guess.

### 6.1 Providers (`src/lib/storage/types.ts`)

```ts
export type WorkspaceId = string;                       // random, stable per stored plan
export type Location =
  | { kind: 'browser' }                                  // only in this browser's storage
  | { kind: 'folder'; handle: string; name: string }     // key of a stored FileSystemDirectoryHandle
  | { kind: 'github'; account: string; owner: string; repo: string; branch: string; dir: string };

/** Plan files only (.tjp, .tji), paths relative to the location's root. */
export interface RemoteSnapshot {
  readonly revision: string;     // github: commit sha; folder: fingerprint of names, sizes, mtimes
  readonly files: ReadonlyMap<WorkspacePath, Uint8Array>;
}
export interface WriteRequest {
  readonly base: string;                                   // the revision the change was made on
  readonly files: ReadonlyMap<WorkspacePath, Uint8Array>;  // changed or added files; never deletes
  readonly message: string | null;                         // required for github
  readonly parents?: readonly string[];                    // github merge commit (18.10)
}
export type WriteResult =
  | { status: 'written'; revision: string }
  | { status: 'moved'; head: string }          // someone else wrote first: pull, merge, try again
  | { status: 'failed'; error: StorageError };
export interface StorageError {
  kind: 'offline' | 'auth' | 'permission' | 'not-found' | 'quota' | 'rate-limited'
      | 'too-large' | 'unsupported' | 'server';
  retryAfterMs: number | null; detail: string;
}
export type Access = 'granted' | 'prompt' | 'signed-out' | 'denied';
export interface StorageProvider<L extends Location> {
  readonly kind: L['kind'];
  access(loc: L): Promise<Access>;
  /** Folder permission or sign-in; must run inside a user gesture. */
  requestAccess(loc: L): Promise<Access>;
  /** Cheap check of the current revision; null when the location is gone. */
  head(loc: L, signal?: AbortSignal): Promise<string | null>;
  read(loc: L, signal?: AbortSignal): Promise<RemoteSnapshot>;
  /** Conditional on `req.base`; never forces. github: one commit; folder: per file (7.2). */
  write(loc: L, req: WriteRequest, signal?: AbortSignal): Promise<WriteResult>;
}
```

Limits per plan: at most 200 plan files, 2 MB per file and 8 MB in all. Past them, the result is `too-large` with a sentence.

### 6.2 Codec and local store (`codec.ts`, `local-store.ts`)

```ts
/** ADR-0002 #13 decoding; `lossy` when invalid UTF-8 sequences were replaced. */
export function decodePlanFile(bytes: Uint8Array): { text: string; lossy: boolean };
/** UTF-8; U+FEFF and '\r' are kept, so every valid file round-trips byte for byte. */
export function encodePlanFile(text: string): Uint8Array;

export interface StoredPlan {
  readonly id: WorkspaceId; readonly name: string; readonly entry: WorkspacePath;
  readonly location: Location; readonly updatedAt: number;
  readonly from: { sample: SampleId } | { newPlan: true } | { opened: true };
}
export interface SyncBase {                  // the provider's text as last read or written
  readonly revision: string;
  readonly files: ReadonlyMap<WorkspacePath, string>;
  readonly lossy: ReadonlySet<WorkspacePath>;
  readonly summary: ScheduleSummary | null;  // for the commit message (6.5)
}
export interface PendingWrite {              // the sync queue, oldest first
  readonly id: string; readonly createdAt: number; readonly base: string;
  readonly files: ReadonlyMap<WorkspacePath, string>; readonly message: string | null;
  readonly checkedVersion: number;           // the workspace version the engine checked (6.5)
}
export interface LocalStore {
  plans(): Promise<readonly StoredPlan[]>;
  open(id: WorkspaceId): Promise<{ plan: StoredPlan; files: ReadonlyMap<WorkspacePath, string>;
    base: SyncBase | null; queue: readonly PendingWrite[]; conflict: StoredConflict | null } | null>;
  create(p: Omit<StoredPlan, 'id' | 'updatedAt'>, files: ReadonlyMap<WorkspacePath, string>,
    base: SyncBase | null): Promise<WorkspaceId>;
  /** Autosave: the whole text of each changed file, tagged with the workspace version. */
  saveFiles(id: WorkspaceId, files: ReadonlyMap<WorkspacePath, string>, version: number): Promise<void>;
  setBase(id: WorkspaceId, b: SyncBase): Promise<void>;
  enqueue(id: WorkspaceId, w: PendingWrite): Promise<void>;
  dequeue(id: WorkspaceId, writeId: string): Promise<void>;
  setConflict(id: WorkspaceId, c: StoredConflict | null): Promise<void>;
  remove(id: WorkspaceId): Promise<void>;      // asks first in the UI; offers Export
  estimate(): Promise<{ usage: number; quota: number; persisted: boolean }>;
}
/** One owner tab per plan (Web Locks). A second tab is offered "Open here instead". */
export function acquire(id: WorkspaceId): Promise<{ release(): void } | 'held-elsewhere'>;
```

The rules for writing:
- A file whose text equals its base text is never written.
- A `lossy` file that was changed asks before it is written (18.11).
- Credentials are kept in their own object store, never in `localStorage` (10.1).

### 6.3 Sync controller (`src/lib/sync/types.ts`)

```ts
export type SyncStatus =
  | { kind: 'browser-only'; savedAt: number | null }      // stored here, no provider
  | { kind: 'saved'; at: number; revision: string }
  | { kind: 'changes'; files: number }                    // not yet saved or committed
  | { kind: 'working'; what: 'saving' | 'committing' | 'pulling' | 'checking' }
  | { kind: 'queued'; writes: number; why: 'offline' | 'needs-access' | 'retrying'; retryAt: number | null }
  | { kind: 'conflict'; conflicts: number }
  | { kind: 'blocked'; errors: number }                   // the text to commit does not schedule
  | { kind: 'needs-access'; access: Access }
  | { kind: 'failed'; error: StorageError };
export interface SyncController {
  readonly status: SyncStatus;                            // runes state
  /** Folder: write. GitHub: commit (queued when offline). Browser-only: no-op, says so. */
  save(o?: { message?: string; anyway?: boolean }): Promise<SyncOutcome>;
  /** Pull, merge, then push the queue. Runs on open, on focus (at most once a minute), online, tap. */
  sync(): Promise<SyncOutcome>;
  resolve(r: readonly Resolution[]): Promise<SyncOutcome>;
  discardQueued(writeId: string): Promise<void>;          // asks first; the text stays in the workspace
}
```

### 6.4 Merge and hints (`src/lib/sync/merge.ts`, `src/lib/tjp/merge/`)

```ts
export type Files = ReadonlyMap<WorkspacePath, string>;
export interface WorkspaceMerge {
  readonly files: Files;                          // merged text; a file in conflict keeps ours
  readonly conflicts: readonly MergeConflict[];   // empty: clean
}
export function mergeWorkspace(base: Files, ours: Files, theirs: Files): WorkspaceMerge;

export interface Owner { kind: 'project' | 'task' | 'resource' | 'other'; id: string | null; name: string | null }
export type ConflictSubject =
  | { kind: 'attribute'; owner: Owner; attr: string }    // "effort of Build API"
  | { kind: 'block'; owner: Owner; change: 'deleted-ours' | 'deleted-theirs' | 'added-twice' | 'both-edited' }
  | { kind: 'file'; change: 'deleted-ours' | 'deleted-theirs' | 'added-twice' }
  | { kind: 'text' };                                     // outside any block: header, comments, macros
export interface MergeConflict {
  readonly id: string; readonly file: WorkspacePath; readonly subject: ConflictSubject;
  readonly base: string | null; readonly ours: string | null; readonly theirs: string | null;
  readonly at: SourceRange;                               // where it lands in the merged file
}
export type Resolution = { readonly conflict: string;
  readonly take: 'ours' | 'theirs' | 'both' | { readonly text: string } };
export function resolve(m: WorkspaceMerge, r: readonly Resolution[]): Files | { unresolved: readonly string[] };
```

The rules (T6, `grammar-specialist`):
1. **Per file, three-way on lines** with `node-diff3` (MIT, as Mycelium uses), splitting on `\n` only so `\r` is kept. A file present on one side only is taken as it is. A file deleted on one side and changed on the other is a `file` conflict.
2. **Grammar-aware refinement.** A conflicting hunk that falls inside one task, resource or project block is merged again statement by statement, using the Lezer tree of all three texts:
   - a statement changed on one side only merges cleanly;
   - the same statement changed differently on both sides becomes an `attribute` conflict;
   - identical changes merge cleanly.

   This is what turns "you changed effort to 5d, they changed it to 8d" into one conflict, and it keeps two edits to different attributes of one task from conflicting.
3. **`both`** is offered only where putting both in is meaningful: `text` hunks, and blocks added on both sides with different ids. A block added twice with the same id is a conflict, never a silent duplicate.
4. **Never auto-pick a side.** The merge resolves only what diff3 and rule 2 prove clean.
5. **Cost:** at most 50 ms p90 on desktop for `fedora-res`-sized files with 20 edits per side, and no task over 50 ms at 4x CPU (chunked by file).

### 6.5 Schedule check and commit message

```ts
// src/lib/workspace/schedule-runner.ts (addition; engine-specialist)
/** The first result for `version` or a later one, with the snapshot it scheduled. Never rejects. */
checked(version: number, signal?: AbortSignal): Promise<{ version: number; snapshot: WorkspaceSnapshot;
  ok: boolean; errors: readonly Diagnostic[] }>;

// src/lib/sync/commit-message.ts (grammar-specialist)
export interface ScheduleSummary {
  readonly finish: Minutes | null; readonly start: string; readonly zone: string | null;
  readonly tasks: ReadonlyMap<TaskId, { name: string; parent: TaskId | null; start: Minutes | null; end: Minutes | null }>;
  readonly booked: ReadonlyMap<ResourceId, number>;      // minutes, first active scenario
}
export function summarize(r: ScheduleResult, index: SymbolIndex): ScheduleSummary;
export function commitMessage(before: ScheduleSummary | null, after: ScheduleSummary,
  files: readonly WorkspacePath[]): { subject: string; body: string };
```

- **The check is the app's own runner.** A merge, a pull or a commit applies its text to the workspace, and the runner schedules it as it schedules any edit. A commit writes **exactly the snapshot of a version whose result is ok**. If the user types meanwhile, the newer version is checked first. So no extra engine request is needed, the latest-wins queue (ADR-0002 #3) is untouched, and nothing schedules outside the engine.
- **Blocking (18.9).** A merge whose result does not schedule, or whose dependency now points at a deleted task, cannot be committed. The errors are pinned to file and line as usual.
- **The message** is generated from `before` (the base's summary, captured when the base was synced) and `after`: tasks added, removed and moved (start or end changed), the finish before and after, and the people whose booked time changed. Dates use `Intl` in the plan's zone. Example: `Plan: 2 tasks added, 1 moved; finish 12 Mar -> 19 Mar 2027`, with the body listing the tasks and people. The user can edit it. The copy lives in `strings-sync.ts`. A base without a summary gives a message without the finish line.

### 6.6 Service worker messages (`src/pwa/messages.ts`)

```ts
export type ToServiceWorker = { type: 'skip-waiting' } | { type: 'status' };
export type FromServiceWorker = { type: 'status'; build: string; offlineReady: boolean;
  engine: { ruby: string; bundle: string; docs: string | null } | null };   // the cached hashes
export interface PwaState { offlineReady: boolean; updateWaiting: boolean; installable: boolean;
  installed: boolean; persisted: boolean | null }
```

### 6.7 App state additions (`app.svelte.ts`)

```ts
openStored(id: WorkspaceId): Promise<boolean>;
openFolder(): Promise<boolean>;                        // Chromium; needs a user gesture
openFiles(files: readonly File[]): Promise<boolean>;   // every browser; makes a browser-only plan
openGitHub(loc: Extract<Location, { kind: 'github' }>): Promise<boolean>;
saveTo(target: Location): Promise<SyncOutcome>;        // a browser-only plan, a sample copy, a new plan
readonly sync: SyncController | null;
readonly pwa: PwaState;
```

- `dirty` now means "has changes the provider does not have". Switching plans no longer asks, because nothing is lost: the plan stays stored.
- The "Changes stay in this tab" note is replaced by the location line (11.2).
- Preferences move from per-sample keys to per-plan keys (`ws:<id>`). Existing sample keys are read once as defaults (ADR-0008 #3 amendment, T1).

## 7. Providers

### 7.1 Browser storage (every browser)

- **Autosave.** Every opened plan is stored. Each change is written 400 ms after the last keystroke, in an idle task, and at once on `pagehide` or when the page is hidden. A save failure (quota, blocked storage) is a `failed` status with Export, never swallowed.
- **Restore.** On start, the last plan opens with its exact text, its sync base and its queue. The undo history starts empty, and the first undo says so.
- **One owner.** A second tab opening the same plan is told "This plan is open in another tab", with "Open here instead". The other tab then becomes read-only, with a note.
- **Samples (18.7).** A sample opens unstored. Its first edit stores a copy ("Tutorial (copy)"). The sample itself never changes.

### 7.2 Local folder (Chromium)

- **Open.** "Open folder…" calls `showDirectoryPicker({ mode: 'readwrite' })`. The plan files are listed. If the folder holds several `.tjp` files, the user is asked which plan to open, and the choice is remembered (19.7). The handle is stored in IndexedDB.
- **Reopen.** After a reload, `queryPermission` usually returns `prompt`. The status shows "Reconnect to folder plans" (a button, as a gesture is needed). Edits made meanwhile are autosaved and queued.
- **Save.** Each changed file is written with `createWritable` (Chromium writes a swap file and replaces the file on close).
  - Before writing, each file's size and `lastModified` are compared with what was last read or written. A difference whose text is not the base text means `moved`, and the change goes through the merge (8.2).
  - Several files are not written atomically. The queue keeps the set until every file is written, and the next attempt writes the rest.
  - Save behaviour per provider is 18.6.
- **External changes.** On focus and on `visibilitychange`, never by polling, changed files are read again.
  - With no local changes, the new text is applied as one undo step ("Reloaded from disk: plan.tji", 18.8).
  - With local changes, it is a three-way merge against the base.
- **Fallback where the API is missing** (Safari, Firefox, iOS):
  - "Open files…" (`<input type=file multiple accept=".tjp,.tji">`) and "Import folder…" (`webkitdirectory`, desktop only) make a browser-only plan.
  - "Export" downloads the entry file when the plan has one file, else a `.zip` (`fflate`, MIT). On iOS it uses the share sheet when `navigator.canShare({ files })` is true.
  - The location line says "Only in this browser on this device. Export or save to GitHub to keep a copy."

### 7.3 GitHub

**Sign-in options.** There is no backend of our own. GitHub's sign-in endpoints document no CORS support, and the web flow's token exchange needs the client secret. The REST API at `api.github.com` does allow CORS with a bearer token.

| Option | Server in the loop | Phones and installed apps | Scope | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| A. Fine-grained personal token pasted by the user | None | Works, but copying a token on a phone is clumsy | One or more chosen repos; Contents read and write, Metadata read; the user sets the expiry | Small | Good as an advanced option; poor as the default |
| B. GitHub App, device flow (code shown, entered at github.com/login/device) | The existing worker relays two sign-in calls (no CORS). No secret for the exchange; refresh needs the secret, held by the worker | Robust: no redirect, so it works inside an iOS home-screen app | Per-repo install; token = the app's permissions intersected with the user's access; 8 h tokens with a refresh token | Medium | **Recommended default** |
| C. GitHub App, web flow with PKCE (the build plan's D3) | The worker exchanges the code with the secret | A redirect out of an installed iOS app can open in an in-app browser and fail to come back | As B | Medium, plus redirect state and callback URLs | Later, if users ask for it |
| D. OAuth App | As B or C | As B or C | Broad `repo` scope over every repository | Medium | Rejected (scope) |

The recommendation (18.2) is B as the default and A as "Use a token instead". A needs no worker at all, and it is also the fallback when the worker is down. Both feed the same token store and transport.

**Transport (18.3).** The REST Git Data API, called directly from the page (no proxy for plan content):

| Purpose | Endpoint |
| --- | --- |
| Who is signed in; installations; repositories | `GET /user`, `GET /user/installations`, `GET /user/installations/{id}/repositories` (A: `GET /user/repos`) |
| Head of the branch (with `If-None-Match`) | `GET /repos/{o}/{r}/git/ref/heads/{branch}` |
| The plan's files at a commit | `GET /repos/{o}/{r}/git/commits/{sha}`, `GET .../git/trees/{tree}?recursive=1` (only `dir`), `GET .../git/blobs/{sha}` |
| Commit | `POST .../git/blobs`, `POST .../git/trees` (`base_tree`), `POST .../git/commits` (one or two parents), `PATCH .../git/refs/heads/{branch}` with `force: false` |

- A ref update that is not a fast-forward returns 422, which is `moved`. There is never a force push.
- Rate limits: conditional requests answered 304 do not count. `rate-limited` waits for `retry-after` or `x-ratelimit-reset`.
- Every call goes through `net.ts` (10.1) on the main thread, not in a worker, so Playwright can route it on every browser (13.3).
- Committing to the branch that was opened is the only branch behaviour.

**Queue (offline).**
- A commit made offline is stored as a `PendingWrite` with its message and the checked snapshot.
- On reconnect (the `online` event, focus, then backoff of 5 s, 30 s, 2 min and 10 min), queued writes are committed in order on their base and the ref is fast-forwarded.
- If the remote moved, the queue's last snapshot is merged with the remote head (8.2), checked, and committed as a merge commit with both parents (18.10).

**New plans and samples.** "Save to GitHub…" writes every file into the chosen folder as one commit. If a file of that name already exists there, the user picks another folder or cancels. It never overwrites.

### 7.4 Multi-file plans

- The workspace root is the folder, or the repository's `dir`. Every `.tjp` and `.tji` file under it is read, within the limits of 6.1. Other files are never read or written.
- Includes resolve as today (`paths.ts`). An include that climbs above the root is `outside-workspace`, and a missing file is `not-found`. Both are diagnostics, not storage errors.
- Merges, writes and the commit message work per file. One commit carries every changed file.
- The two-device and round-trip fixtures include a three-file plan with nested directories (T20).

## 8. Sync, merge and conflicts

### 8.1 Never silent loss (invariants, each with a test in 13.1)

1. Local text is in the browser store before any network write, and before any merge result replaces it.
2. Remote or on-disk text never replaces local text that is not yet synced, except through a three-way merge.
3. A merge result is applied only when it is clean, or when every conflict is resolved. It is applied as one undo step (18.8).
4. Every write is conditional on its base (a ref update without force, or the folder check of 7.2).
5. Mainspring deletes nothing on a provider.
6. Discarding local changes or a queued write always asks first, and offers Export.
7. Two tabs never write the same stored plan (6.2 `acquire`).
8. Storage failures are shown, with Export, and never swallowed.

### 8.2 Pull and push

- **Pull.** If the remote moved:
  - with no local changes, its text is applied (one undo step) and becomes the base;
  - with local changes, the result is `mergeWorkspace(base, workspace now, remote)`. A clean merge is applied and the base moves to the remote head, while the local changes stay as changes. A merge with conflicts opens the conflict state (8.3).
- **Push.** After a pull, or a fast-forward, queued writes are committed once `checked()` passes for their snapshot.

### 8.3 What the user sees on a conflict

- **The status** reads "Conflict · 2" (icon and words). A strip says "GitHub has changes to the same tasks. Choose what to keep." with a Resolve button. A folder's strip says "on disk" instead.
- **The conflict view** (11.1):
  - **Header:** "2 conflicts with GitHub: commit 3f2a91b by its author, 10 min ago".
  - **One group per task or resource**, for example "Build API, effort": You `5d`, GitHub `8d`, before `3d`. The choices are **Keep mine**, **Take theirs**, and **Edit…**, which opens both texts in the editor.
  - **Text and block conflicts** show the two line blocks side by side (stacked on a phone), with the same choices, plus **Keep both** where 6.4 rule 3 allows it.
- **What it never does:**
  - **Later** closes the view and keeps your text, the queue and the stored conflict, and the badge stays.
  - **Download both versions** exports yours and theirs as a `.zip`.
  - Editing goes on while a conflict waits. On Apply, the merge is computed again from the current text, and earlier choices are kept where their subject still exists.
- **Apply and check** applies the resolved text (one undo step) and waits for the engine. Then **Commit merge** is enabled when the check is ok. When it is not, the errors are listed with "Show in text", and the status is `blocked`.

## 9. Offline and the PWA

### 9.1 Service worker (`src/pwa/sw.ts`, about 200 lines, hand-written; no Workbox)

- **Registration.** It registers from `<base>sw.js` with scope `<base>`, after the first schedule result, in an idle task. So first-open budgets are unchanged, and the engine files are taken from the HTTP cache rather than downloaded twice. The base path follows ADR-0006, and `test:base-path` extends to it.
- **Two caches.**
  - `mainspring-app-<buildId>` holds the pages (`/`, `/app/`), every `_astro` chunk (lazy views included, which fixes "Find and replace offline on first use" and the Safari failed-chunk case), fonts, icons, the web manifest and the engine `manifest.json`.
  - `mainspring-engine` holds the engine assets by content-hashed name: ruby, bundle and docs (ADR-0017).

  The precache list is generated at build time by `scripts/astro-sw.mjs` from `dist/` and baked into `sw.js`, with the build id of ADR-0012.
- **Fetch rules.**
  - Same-origin GET only.
  - Navigations get the cached shell (search ignored, so `?plan=` and test hooks still open it).
  - Hashed assets are cache-first.
  - `version.json` is network-only.
  - Everything else passes through. The service worker never touches `api.github.com` or the worker host.
- **Versioning.** On activate, older app caches are deleted. Engine entries that the new `manifest.json` does not name are deleted after the new ones verify. The worker's SHA-256 check stays the guard, so a corrupt cache entry fails the boot check and is fetched again.
- **Update flow (ADR-0012 #6).** A new service worker waits. The existing "New version · Reload" control appears. Reload sends `skip-waiting`, then reloads on `controllerchange`. It asks first only while a save or commit is in flight or the conflict view is open, because stored plans survive a reload. The `version.json` check stays and also calls `registration.update()`.
- **Offline readiness.** Settings show "Ready to work offline" once both caches are complete.

### 9.2 Install

- Chromium's `beforeinstallprompt` is kept and offered as "Install app" in the app menu and in Settings.
- iOS shows the Add to Home Screen steps.
- One dismissable hint appears after the first save. Nothing prompts on the first visit (18.21).

### 9.3 Wasm code cache (spike, T12)

The engine-specialist tries storing the decompressed `ruby.wasm` as an `application/wasm` response in `mainspring-engine` and compiling it with `WebAssembly.compileStreaming`, so that Chromium's code cache removes the compile on repeat visits (phase-0 deviation 2, P3). It is adopted only if:
- the repeat-visit first schedule of `gantt-200` gains at least 25% on desktop;
- the boot long task disappears;
- the extra about 30 MB of storage is acceptable on Pixel 7 emulation.

The SHA-256 check must stay (hash a tee of the stream).

### 9.4 Quota, eviction and persistence

- Expected use is about 11 MB of engine and app files, plus plans (KBs to a few MB). The engine cache would be about 40 MB if 9.3 is adopted.
- `navigator.storage.persist()` is requested after the first save of a plan or after install, never on the first visit. Settings show the result, usage and quota.
- **Eviction.** A marker in both `localStorage` and IndexedDB records that plans exist. If the store is empty while the marker says otherwise, the app says plainly that the browser cleared its stored plans and points to GitHub or Export. WebKit may clear a site's storage after seven days of browser use without a visit, and a Home Screen app is counted separately. Plans in browser storage on iOS are therefore described as "in this browser", and GitHub is recommended.

## 10. Security, privacy and licensing

### 10.1 Tokens and network

- **Tokens** live in IndexedDB (`credentials`), one record per account: kind (`app` or `token`), token, refresh token, expiry, login and permissions.
  - Never in `localStorage`, URLs, logs, error reports or toasts.
  - "Sign out" deletes them. For the GitHub App, the user is linked to GitHub's settings to revoke the app.
  - Session-only sign-in is an option (18.2).
- **Scopes.** App: Contents read and write, Metadata read, installed on chosen repos only. Token: the same fine-grained permissions, and the copy says which to tick.
- **Network allowlist.** `net.ts` sends a token only to `https://api.github.com`, and sign-in calls only to the configured worker host. Any other host is refused in code.
- **No secrets in the repo or the bundle.**
  - The GitHub App's client id is public and may be in the bundle. Its secret lives only in the worker's environment.
  - A `check` job step (`scripts/ci/secret-scan.mjs`) fails on token-like strings (`ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`, private-key headers) in the repo and in `dist/`.
  - CI uses fakes only (13.3).
- **What tokens are as safe as.** Any script on the origin can read IndexedDB, so tokens are as safe as the origin. The protection is CSP, no third-party scripts, and short-lived app tokens. The settings copy says the token stays on this device.

### 10.2 CSP and headers

- **Cloudflare** (`public/_headers`, static assets):
  - `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https://api.github.com https://<worker host>; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  - `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and a restrictive `Permissions-Policy`.
- **Pages** cannot set headers, so the app page carries the same policy in a `<meta>` tag, without `frame-ancestors`.
- **What T19 measures first:**
  - whether Astro inlines scripts, which then need hashes (Astro's own CSP support if the pinned version has it, else a build step);
  - whether `style-src` can drop `'unsafe-inline'`.
- `csp.spec.ts` fails on any `securitypolicyviolation` event across a full open, edit, sync and offline run.

### 10.3 Licences of proposed runtime code (checked by `scripts/ci/licenses.mjs` at the pinned versions)

| Package | Use | Licence | Status |
| --- | --- | --- | --- |
| `node-diff3` | Line merge | MIT | Allowed |
| `fflate` | Export `.zip` | MIT | Allowed |
| (none) | IndexedDB: a small own wrapper | | Dexie (Apache-2.0) is not used (18.5) |
| (none) | Service worker | | Workbox not needed |
| `isomorphic-git`, `@isomorphic-git/lightning-fs` | Only if 18.3 chooses git transport | MIT | Allowed |
| `fake-indexeddb` | Unit tests only | Apache-2.0 | Allowed: dev only, not shipped (ADR-0001) |
| Mycelium modules | Only after the audit (T2) | Must be relicensed GPL-2.0-or-later | ADR-0001 |

## 11. UI and layouts

### 11.1 Where things live

| Piece | Desktop (1024 px and up) | Tablet (600 to 1023 px) | Phone (under 600 px) |
| --- | --- | --- | --- |
| Sync status | Top bar, beside the plan chip: an icon and a short label ("Saved", "3 changes", "Offline · 2 waiting", "Conflict"); a fixed slot so nothing shifts | As desktop | Top bar icon with a state dot; the label is in its accessible name and the sheet |
| Sync panel | Popover (T25 `Popover`): where the plan lives, last saved or synced, Save, Commit or Sync, queue, Export, Settings | Bottom `Sheet` | `Sheet` at half height |
| Commit | Dialog: the generated message (editable), the changed files, the schedule check line, Commit (enabled once checked) | `Sheet` | `Sheet`, full height |
| Conflict view | Large dialog, groups by task, Mine and Theirs side by side | `Sheet`, full height | `Sheet`, full height, Mine above Theirs, 44 px choices |
| Plan chooser | Menu from the plan chip: "Your plans" (name, location badge, status), Open folder… (Chromium), Open files…, Import folder…, Open from GitHub…, New plan…, Samples | As desktop | Full-height `Sheet` |
| Open from GitHub | Dialog: sign in (device code with Copy and Open GitHub; or token), repository, branch (default preselected), folder, plan | `Sheet` | `Sheet`, full height |
| Settings | Dialog: Storage (where, usage, persistence), GitHub account, Install, Offline readiness, Save behaviour | `Sheet` | `Sheet`, full height |

- Keys: Ctrl/Cmd+S saves (folder), opens Commit (GitHub), or says where a browser-only plan is, with Save to….
- Only the T25 primitives are used (Sheet, Menu, Select, Popover, roving grid focus). A change to a primitive runs its contract spec (ADR-0016 #3).

### 11.2 Copy

- `strings.ts` holds only the status control and the location line (first load).
- `strings-storage.ts`, `strings-sync.ts` and `strings-conflict.ts` hold the rest.
- Locations read as:
  - "Only in this browser";
  - "Folder plans on this computer";
  - "GitHub: owner/repo, main, plans/".
- The landing page's "changes stay in your browser tab" copy changes with T25 (the landing-copy test stays).
- Polish 22 ("No problems" beside Health findings) is reworded in T14, which owns the status files.

## 12. Performance and accessibility budgets

### 12.1 Bundle

- Phase 4 adds **at most 3,000 bytes gzip to each first load**: the status control, autosave, the IndexedDB wrapper, the codec, the restore path and service worker registration.
- Everything else is lazy: providers, merge, sync, the conflict view, the chooser, settings and export.
- Text-first headroom is about 3.3 KB, so the user is asked before any cap changes (18.16).
- `js-sizes.mjs` gets caps for the new chunks and fails a first load that fetches them. `sw.js` is reported separately and not counted in the first load.

### 12.2 Timings (desktop enforced as regression catchers in the timing tier; phones recorded, ADR-0016)

| Measure | Target |
| --- | --- |
| Autosave write | Within 1 s of the last change; no task over 50 ms on `fedora-res`, also at 4x CPU |
| Reload to plan shown (outline from the index) | At most 100 ms more than opening the same sample today |
| Folder save of `fedora-res` (all files changed) | Under 300 ms on desktop |
| Merge and hints (6.4 rule 5) | 50 ms p90 desktop; no task over 50 ms at 4x |
| Conflict view open, 50 conflicts | Under 300 ms desktop; at most 800 DOM nodes on Pixel 7 (enforced, deterministic) |
| Offline open, desktop, from cache | App shell under 1.5 s; engine ready under 4 s (build plan budgets) |
| First open online | Unchanged: the service worker registers after the first result |

### 12.3 Accessibility (WCAG 2.2 AA)

- **The status control** has a name that states the state ("Saved to GitHub 2 minutes ago", "3 changes not saved").
- **Announcements** are polite and throttled: autosave is never announced; queued, conflict, blocked and failed states are announced once each.
- **The conflict view.** Each conflict is a `fieldset` with a legend ("Build API, effort") and a radio group (Keep mine, Take theirs, Edit). The focus starts on the first unresolved conflict. Mine and theirs are told apart by words, not colour alone.
- **Keyboard and targets.** Every flow works by keyboard, including the device-code Copy and the token field (password input, show and hide). Targets are 44 x 44 px on a coarse pointer.
- **axe** runs on every new state, light and dark, on desktop, Pixel 7 and iPhone 14.

## 13. Tests and CI

### 13.1 Unit and property (Vitest, fast-check)

| Module | Tests |
| --- | --- |
| `storage/codec` | Property: `encode(decode(b)) = b` for valid UTF-8 (BOM, CRLF, lone `\r`, astral characters); `decode(encode(s)) = s` for well-formed strings; `bridge-bom-invalid-utf8` is `lossy` |
| Round-trip over the corpus | Every golden and storage fixture: read through each provider (folder on an in-memory handle, GitHub on the fake, browser store), save, read again: **identical bytes**. Open then save with no edit writes nothing |
| `local-store`, `autosave`, `lock` | `fake-indexeddb`: open, restore, queue order, quota error surfaced, eviction marker, a second owner refused |
| `sync/merge`, `tjp/merge` | Laws: `merge(b,o,b)=o`, `merge(b,b,t)=t`, `merge(b,x,x)=x`, conflicts symmetric under swapping sides. **Commutation property:** random edit-API intents A and B (the fidelity arbitraries) on different tasks of one plan give a clean merge equal to applying B on top of A. The same attribute changed both ways gives one `attribute` conflict naming it. Every one-side change is in a clean result |
| Merged plans schedule | The fidelity harness (wasm in Node): merges of disjoint intents schedule with no new errors; 100 cases on push, 2,000 nightly |
| `sync/queue`, controller | **Model test** (fast-check commands): edit, save, offline, online, remote push, sync, resolve, reload. Invariants of 8.1; nothing reaches the fake remote without a passing check; after a clean sync both sides are byte-equal |
| `github/*` | Every endpoint against the fake; 401 (expired, refresh), 403 and 429 (rate limit), 422 (moved), network failure; refusal of other hosts |
| `commit-message` | Added, removed, moved, finish delta, load changes; zone display; no base summary |
| `export/csv` | Columns, quoting, multi-file plans |
| SW logic | Precache list generation (every `dist` file, base path); cache pruning; fetch rules as pure functions |

### 13.2 End to end (desktop Chrome, Pixel 7, iPhone 14; merge tier unless marked)

- `persist.spec.ts`: edit, reload, same text; a sample's first edit makes a copy; two tabs (the owner prompt).
- `folder.spec.ts`: Chromium, through a picker stand-in (13.4): open, save, external change (reload and merge), reconnect after a reload.
- `files-fallback.spec.ts`: every project. Open files, import, export (download; share stubbed where `canShare` exists).
- `github.spec.ts`: device-flow sign-in and the token path against the fake, pick a repo, commit with the generated message, offline queue then push, `rate-limited` and `auth` states.
- `conflict.spec.ts`: an attribute conflict, Keep mine and Take theirs, Later then resume, Download both, a merge that does not schedule (blocked, then fixed and committed).
- `sync-two-devices.spec.ts`: the gate spec (16.1).
- `offline.spec.ts` and `pwa-update.spec.ts`: the gate spec (16.2); an update waiting, then Reload.
- `csp.spec.ts`, `export.spec.ts`, axe in every new state, screenshots of every state (light and dark, desktop, tablet and both phones) in `docs/phases/screenshots/phase-4/`.

### 13.3 A fake GitHub, and no real network in CI

- **`tests/fakes/github/`** is one in-memory implementation of the 7.3 endpoints: repos, refs, commits, trees, blobs, ETags, rate-limit headers, the device flow and the worker relay.
  - It exposes `handle(Request): Promise<Response>`.
  - It has test controls: push as another device, fail the next call, expire the token.
- **Unit tests** pass it as `fetch`.
- **Playwright** wires it with `context.route('https://api.github.com/**')` and the worker host. One fake instance is shared by both contexts of the two-device spec, because route handlers run in the test process.
- **Drift guard.** A unit test validates the fake's responses against GitHub's published OpenAPI description, for the endpoints used. It is a dev-only download, pinned and cached in CI.
- **A network guard fixture** fails any test that requests a host other than the local server.
- The real GitHub is exercised only by the user's staging smoke (18.15).

### 13.4 WebKit and the allowlist (ADR-0016)

- **Feature detection, not skips.**
  - On iPhone 14 the folder spec asserts the fallback branch: no "Open folder", while Open files, Export and the "Only in this browser" line are present.
  - On Chromium, `showDirectoryPicker` is replaced by an init script that returns a subdirectory of `navigator.storage.getDirectory()` (a real handle). The permission methods are stubbed to `granted` or `prompt` to test Reconnect.
- **Service workers.** The default e2e projects set `serviceWorkers: 'block'`, so routing and caching never interfere. Only `offline` and `pwa-update` allow them, and they do not route GitHub.
- **If Playwright's WebKit cannot run the offline spec**, it gets one allowlist entry with its reason (`webkit-sw`), which makes 6 of 6. No other new entry is allowed.

### 13.5 CI changes

| Job | Change |
| --- | --- |
| `check` | New unit and property tests; `secret-scan.mjs`; `licenses.mjs` with no embedded exception after T13 |
| `fidelity` | The merged-plan family (13.1) |
| `golden` | Re-run on the OpenSSL-free ruby.wasm (T13) |
| `e2e` | New specs on the existing matrix, small plans from `tests/fixtures/ui/` and `storage/` (ADR-0016 #4); service-worker specs in their own shard |
| `base-path` | The service worker registers under `/mainspring/`, then offline open |
| `gates` | JS sizes with the new chunk caps |
| `deploy-staging.yml` | New: `wrangler deploy` to the staging origin from a green `main` commit, then a smoke run against it (open, schedule, offline) |

Locally, run only the checks for what changed. Push in batches; CI is the gate.

## 14. Tasks

Every task runs in its own worktree, and its report includes end-to-end evidence.
- **Storage, merge, sync, the GitHub provider, the service worker and the OpenSSL-free engine** (T4 to T8, T11, T13) get a `reviewer` pass with a reproduction: the model test, the two-device spec, an offline run, or golden parity.
- **UI tasks** get one review before merge.
- A few-line fix is made in the main session.

| # | Task | Owner | Files | Depends on |
| --- | --- | --- | --- | --- |
| T1 | ADR-0019 (storage, sync, auth, transport, merge policy, bytes) and ADR-0020 (PWA, CSP, release), plus ADR-0001 and ADR-0008 amendments, from the answers to 18 | **User** decides; `docs-writer` formats | `docs/decisions/0019-*.md`, `0020-*.md` | Answers |
| T2 | Mycelium audit, only if 18.4 says copy: sole authorship, dependencies' licences, fit to section 6 | Main session with the **user** | Read-only | T1 |
| T3 | **Interface PR, types and contracts only** (6.1 to 6.7, the endpoint list of 7.3). Merged before any consumer | `engine-specialist` (storage, provider, `checked`, PWA); `grammar-specialist` (sync, merge, hints, summary) | `src/lib/storage/types.ts`, `src/lib/sync/types.ts`, `src/lib/tjp/merge/types.ts`, `src/pwa/messages.ts`, runner contract comment | T1 |
| T4 | Codec, IndexedDB wrapper, local store, autosave, restore, owner lock, eviction marker, the samples rule | `engine-specialist` | `src/lib/storage/{codec,idb,local-store,autosave,lock}.ts`, `app.svelte.ts` | T3 |
| T5 | Folder provider, external changes, open files, import, export, share | `engine-specialist` | `src/lib/storage/{folder,import,export-files}.ts` | T4 |
| T6 | Workspace merge, TJP hints and refinement, `resolve` | `grammar-specialist` | `src/lib/sync/merge.ts`, `src/lib/tjp/merge/**` | T3 |
| T7 | Sync controller, queue, pull and push, `checked()` in the runner, summary and commit message | `grammar-specialist`; `engine-specialist` for `checked()` | `src/lib/sync/**`, `schedule-runner.ts` | T4, T6 |
| T8 | GitHub provider: auth (18.2), credentials, REST transport, listing, rate limits, `net.ts` | `engine-specialist` | `src/lib/storage/github/**`, `net.ts` | T3; T9 alongside |
| T9 | Fake GitHub, OpenAPI drift test, network guard | `test-writer` | `tests/fakes/github/**`, `tests/e2e/lib/network-guard.ts` | T3 |
| T10 | Register the "Mainspring" GitHub App (Contents read and write, Metadata read, device flow on), worker relay routes and secret, `ALLOWED_ORIGINS` for staging and Pages | **User**; main session writes the checklist | Outside the repo | T1; before the staging smoke |
| T11 | Service worker, precache integration, engine cache, update flow, install plumbing, persistence request, offline readiness | `engine-specialist` | `src/pwa/sw.ts`, `scripts/astro-sw.mjs`, `src/lib/app/pwa.svelte.ts`, `astro.config.mjs` | T3 |
| T12 | Wasm code-cache spike (9.3); adopt only on the numbers | `engine-specialist` | `src/engine/**`, `src/pwa/sw.ts` | T11 |
| T13 | OpenSSL-free ruby.wasm: a reproducible build recipe, the bundle on it, golden parity, sizes and timings, notices, licence exception removed | `engine-specialist`; `reviewer` with parity | `engine/ruby-wasm/**`, `engine/build-bundle.mjs`, `THIRD_PARTY_NOTICES.md`, `scripts/ci/licenses.mjs` | 18.13 |
| T14 | Sync status, Sync panel, Commit sheet, queue and blocked states, location line, polish 22 | `ui-builder` | `src/components/sync/**`, `status.ts`, `strings*.ts` | T4 (browser states); T7 |
| T15 | Plan chooser, open and Save to… flows, sign-in and repo pick, reconnect | `ui-builder` | `src/components/storage/**`, `PlanChip.svelte` | T4, T5, T8 |
| T16 | Conflict view (8.3) | `ui-builder` | `src/components/sync/ConflictView*.svelte` | T6, T7 |
| T17 | Settings, install hint and iOS steps, update Reload via the service worker | `ui-builder` | `src/components/storage/Settings*.svelte` | T8, T11 |
| T18 | Export: Gantt PNG, tasks CSV (phase-2 18.10) | `ui-builder` | `src/lib/export/**`, Gantt toolbar menu | None |
| T19 | CSP and headers, inline-script hashes if needed, secret scan | `engine-specialist` | `public/_headers`, `src/layouts/**`, `scripts/ci/secret-scan.mjs` | T8, T11 |
| T20 | Storage fixtures (BOM, CRLF, invalid bytes, three files in nested folders) and two-device scenario plans, from 13.1 and 16.1 | `fixture-maker` | `tests/fixtures/storage/**` | T3 |
| T21 | Unit and property tests (13.1), alongside each task | `test-writer` | Beside each module | Per module |
| T22 | E2E specs (13.2), gate specs, screenshots | `test-writer` | `tests/e2e/**` | T14 to T17 |
| T23 | Perf and a11y audit (12) | `perf-a11y-auditor` | Perf and a11y specs, fixes | T14 to T17 |
| T24 | CI changes (13.5) and the staging deploy workflow | `test-writer`; main session for deploy; `engine-specialist` reviews golden | `.github/workflows/*.yml` | As suites land |
| T25 | Help page "Where your plans live", README, changelog, notices, landing copy | `docs-writer` | `docs/**`, `src/lib/landing-copy*.ts` | T15, T13 |
| T26 | Staging release and gate evidence | Main session; `test-runner`; **user** (Cloudflare, smoke) | `docs/phases/phase-4-gate.md` | All |

### 14.1 Waves (at most three tracks at once)

| Wave | Track A (UI) | Track B (engine-specialist) | Track C (grammar-specialist, then UI) |
| --- | --- | --- | --- |
| 0 | User answers section 18; T1; T10 and T2 start (user) | | |
| 1 | T18 export | T13 feasibility: the build boots and parity holds | T3 with B's part (short, merged first); T20 alongside |
| 2 | Polish 20 and 21 (main session), T18 finish | T4 | T6 |
| 3 | T14 (browser-only states first) | T5 | T7 |
| 4 | T15 (folder, files) | T8, with T9 alongside | T16 (second `ui-builder`; grammar work done) |
| 5 | T15 (GitHub), T14 (commit, queue) | T11, then T12 | T17 |
| 6 | T22 gate specs on the running UI | T13 finish, T19 | T23 |
| 7 | T21 to T24 complete; T25; T26; stop for approval | | |

## 15. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Lost work from a bad merge, a second tab or a failed write | Severe: trust | The 8.1 invariants, each tested; model test; Web Locks; reviewer with reproduction |
| A merge that parses but means something else | Wrong plan committed | Hints per task; schedule check before every commit; the commit message shows the finish delta |
| False conflicts from line-based diff3 inside one block | Annoying conflicts | Statement-level refinement (6.4 rule 2); the commutation property |
| OAuth redirect inside an iOS home-screen app | Sign-in fails on iPhone | Device flow (no redirect); token option |
| The worker cannot be changed in time (D3 belongs to Mycelium) | No app sign-in | Token option works without it; T10 early |
| The fake drifts from GitHub | Green CI, broken staging | OpenAPI validation; the user's staging smoke |
| Text-first JS headroom (3.3 KB) | Cap failure | 3 KB budget, lazy everything else, ask before a cap change |
| The OpenSSL-free build is hard (toolchain, extensions) | Release slips | Feasibility in wave 1; ADR-acceptance is the stated alternative (18.13) |
| The service worker serves a stale or mixed build | Broken app after deploy | Per-build app cache, engine by hash, hash checks in the worker, update flow test |
| Safari eviction of browser-only plans | Lost plans on iOS | Plain copy, persistence request, eviction notice, GitHub recommended, Export |
| WebKit cannot run the offline spec in Playwright | Gate on two projects | One allowlist entry with its reason; desktop and Pixel 7 still gate; the user's phone smoke |
| CI time grows | Slower loop (waived target) | Small plans; service-worker specs in their own shard; 18.19 |
| Tokens readable by script on the origin | Account exposure | CSP, no third-party scripts, short-lived app tokens, minimal scopes, allowlist |

## 16. Gate acceptance criteria

Copied word for word from the plan:

> Gate: end-to-end tests edit the same plan on two simulated devices, merge, and produce a valid schedule; the app opens and schedules offline after one visit; MVP release deployed to the staging origin.

### 16.1 Criterion 1: "end-to-end tests edit the same plan on two simulated devices, merge, and produce a valid schedule"

- **How it is shown.** `sync-two-devices.spec.ts` in CI on the gate commit, on desktop, Pixel 7 and iPhone 14. Each test makes two browser contexts with separate storage: "device A", the project's device, and "device B", a second context. Both use one fake GitHub.
  1. Both open the same three-file plan (T20) from the fake repo.
  2. A changes `effort` of task X and commits. B, offline, changes `allocate` of X and adds a task in an included file, then goes online and syncs. The merge must be clean, attribute-level in X.
  3. B's app schedules the merged text and commits a merge commit. Then A pulls.
  4. **Valid schedule:** the result has `ok: true` and no error messages, and it equals the result of a Node wasm schedule of the expected merged text (the oracle, as in Phase 3's gate). Both devices hold byte-identical files, which equal the fake remote's.
  5. **Conflict case:** both change X's `effort`. The conflict view shows one attribute conflict, Take theirs is chosen, and the steps of 4 follow.
  6. **Blocked case:** A deletes task T, and B adds `depends` on T. The commit is blocked with the engine error pinned. B removes the dependency in the text and commits.
- **Evidence:** CI run link; per project, the three cases with the merged bytes' SHA-256 and the oracle comparison (`test-results/sync-two-devices.json`); phone and desktop screenshots of the conflict view and the blocked state.

### 16.2 Criterion 2: "the app opens and schedules offline after one visit"

- **How it is shown.** `offline.spec.ts` on the production build, with service workers allowed.
  1. One online visit to `/app/`, until "Ready to work offline".
  2. `context.setOffline(true)`, the page closed, and a new page opened at the start URL.
  3. The app opens from the cache, the engine boots from the cache, and the last plan shows and schedules ("Scheduled").
  4. An edit reschedules. A reload, still offline, keeps the edit.
  5. A commit is queued. Back online, it is pushed to the fake.

  It runs on desktop, Pixel 7 and iPhone 14 (13.4), and under `/mainspring/` in `base-path`.
- **Evidence:** CI run link; timings from cache for the shell, engine ready and first result (`test-results/offline.json`); screenshots of the offline state and Settings "Ready to work offline" on both phones.

### 16.3 Criterion 3: "MVP release deployed to the staging origin"

- **How it is shown.** `deploy-staging.yml` deploys the gate commit. The smoke run against the staging URL (open, schedule, offline) passes, and `version.json` there names the gate commit's build. The release checklist below is complete.
- **Release checklist** (18.13 to 18.15):
  - ruby.wasm without OpenSSL, golden parity green on it;
  - `licenses.mjs` with no embedded exception;
  - `THIRD_PARTY_NOTICES.md` updated;
  - no Apache-2.0 runtime dependency;
  - any copied Mycelium code relicensed;
  - CSP and headers live (checked with `curl -I`);
  - secret scan clean;
  - the GitHub App and worker configured for the staging origin;
  - goldens on Ruby 3.4, and the user's real-device smoke, if 18.15 is accepted.
- **Evidence:** staging URL, the deploy run link, `curl -I` headers, the checklist with links, and the user's smoke notes.

### 16.4 Phase deliverables (plan bullets, verbatim)

| Plan bullet | Demonstration |
| --- | --- |
| "Local folders and GitHub first; then OneDrive and Dropbox. TJP-aware conflict view; schedule check before commit; generated commit messages." | `folder`, `files-fallback`, `github`, `conflict` specs; 16.1; `commit-message` unit tests and a commit screenshot. OneDrive and Dropbox: 18.1 |
| "Service worker, install prompt, offline editing with a sync queue." | 16.2; `pwa-update.spec.ts`; install entry screenshots (Chromium prompt, iOS steps); the queue model test |

The gate also records: JS sizes; 12.2 timings; the code-cache spike result; the OpenSSL-free engine's sizes, boot time and golden parity; the iPhone allowlist count; CI wall time; and the state of polish items 20 to 22.

## 17. Evidence files

- `docs/phases/phase-4-gate.md`, opening with the ADR-0016 status line.
- `docs/phases/screenshots/phase-4/*.png`.
- `test-results/{sync-two-devices,offline,js-sizes}.json`.
- ADR-0019 and ADR-0020, plus the ADR-0001 and ADR-0008 amendments.

## 18. Open questions for the user

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| 18.1 | MVP scope, and OneDrive and Dropbox (bullet: "then OneDrive and Dropbox") | MVP = browser storage, local folder, GitHub. OneDrive and Dropbox follow right after the release as a short Phase 4b with its own spec, on the same interface, before Phase 5 | Scope |
| 18.2 | GitHub sign-in (7.3) | A "Mainspring" GitHub App, installed per repo, with the device flow relayed by the existing worker and tokens refreshed through it. Also "Use a token instead" (fine-grained, no worker). Signed in on this device by default, with a session-only option. Web flow with PKCE later | T8, T10 |
| 18.3 | Transport: REST Git Data API from the page, or isomorphic-git through the git proxy (D3, tech stack) | REST: plan content never passes through a proxy, no clone on phones, atomic commits by ref update, a smaller lazy chunk and a simpler fake. isomorphic-git can return for GitLab or Bitbucket behind the same interface | T3, T8 |
| 18.4 | Copy Mycelium's modules (D2)? | Do not copy wholesale. After T2 confirms sole authorship, reuse only pieces that fit section 6 (likely diff3 helpers), relicensed GPL-2.0-or-later | T2 |
| 18.5 | Dexie (Apache-2.0, ADR-0001) | Not used: a small own IndexedDB wrapper. Close the ADR-0001 issue | T4 |
| 18.6 | Saving per provider | Browser storage autosaves always. Folder: explicit Save (Ctrl/Cmd+S), with "Save to the folder automatically" as an opt-in setting. GitHub: explicit Commit, queued offline | T7, T14 |
| 18.7 | Samples and the first plan on start | A sample opens unstored; its first edit stores "Tutorial (copy)". New plans are stored at once. On start, the last plan opens | T4, T15 |
| 18.8 | Undo after pulled or reloaded text | One labelled undo step ("Merged changes from GitHub", "Reloaded from disk"); the stacks are kept. This amends ADR-0008 #1, since the change goes through `apply` | T7 |
| 18.9 | Schedule check strictness | A merge that does not schedule cannot be committed (no override). An ordinary commit of a plan with engine errors needs a confirmation naming the errors ("Commit anyway"). Saving to the browser or a folder is never blocked | T7, T14 |
| 18.10 | History shape | Queued commits stay separate commits. Fast-forward when possible, else a merge commit with both parents. Never a force push | T7, T8 |
| 18.11 | Invalid UTF-8 on save (ADR-0003 #1) | Unchanged files are never written. A changed file that had invalid bytes asks first: "plan.tji will be saved with replacement characters where it had bytes that are not UTF-8" | T4 |
| 18.12 | Last-schedule cache for instant open (build plan, State; ADR-0015 held) | Not in Phase 4; ADR-0015 decides it on its own | Scope |
| 18.13 | **The release and OpenSSL (ADR-0001)** | Build ruby.wasm without the openssl extension (T13, feasibility in wave 1) and ship only that build, on staging and on Pages. Accepting OpenSSL by ADR is the fallback, not recommended | T13, gate |
| 18.14 | Which origin is "staging" | Cloudflare static assets (`wrangler.jsonc`) on a staging hostname you choose; the Pages preview stays a preview. You provide the Cloudflare account and hostname | T10, T24, T26 |
| 18.15 | Release items left open from Phase 3 | Re-record the goldens on Ruby 3.4 before the release. A 15-minute real-device smoke by you on staging (iPhone home-screen app, Android Chrome: open, edit, commit, offline). The full device pass stays in Phase 6 | T26 |
| 18.16 | First-load bytes | At most 3,000 bytes gzip added to each first load, everything else lazy; ask before any cap change | T4, T14 |
| 18.17 | Owners (the agent table names no storage owner) | Store, providers, service worker and engine work: `engine-specialist`. Merge, hints and sync core: `grammar-specialist` | Tasks |
| 18.18 | Polish items 20, 21, 22 | 22 inside T14 (same files). 20 and 21 fixed in the main session in wave 2 as bugs | Waves |
| 18.19 | CI time | New specs on small plans, service-worker specs in their own shard; the target stays waived; report if the gate run passes 22 min | T24 |
| 18.20 | Export (phase-2 18.10) | In Phase 4: copy the Gantt's visible range as PNG in the current theme, and a tasks CSV (id, name, start, end, effort, people, complete) | T18 |
| 18.21 | Install prompt | "Install app" in the menu and Settings, one dismissable hint after the first save, the iOS steps; nothing on the first visit | T17 |
| 18.22 | A folder or repo folder with several `.tjp` files | Ask which plan, remember it per location; the full "plan picker per folder" stays v1 | T15 |

## 19. Conflicts and ambiguities

1. **"Then OneDrive and Dropbox"** is in the Phase 4 bullet, but the open question says "right after", the Product scope puts them in v1, and the gate does not name them (18.1).
2. **Pull, three-way merge and the conflict view** are in Product scope's v1 column, but the Phase 4 bullet and gate require them. This spec follows the phase.
3. **D2, D3 and the tech stack** (copy Mycelium's modules "unchanged", isomorphic-git, lightning-fs, Dexie, PKCE through the worker) conflict with ADR-0001 (Dexie is Apache-2.0; relicensing) and with the recommendations of 18.2 to 18.5. The caller's "no backend" also differs from D3, which keeps the worker. This spec uses it only for sign-in.
4. **The Storage table's "GitHub (also GitLab, Bitbucket)"**: Phase 4 does GitHub only.
5. **"Chrome Android 132+"** for folders cannot be checked under Pixel 7 emulation, which is desktop Chromium and always has the API. It is unverified until Phase 6.
6. **"Dexie caches … the last schedule per plan"** (State) overlaps the held ADR-0015 (18.12).
7. **"Recent workspaces" and "plan picker per folder"** are v1, but persistence needs a "Your plans" list and folders need an entry choice. Both are minimal here (18.22).
8. **"The staging origin"** is defined nowhere (18.14). A deploy there is a release, which ADR-0001 blocks until OpenSSL is gone (18.13).
9. **Export** is MVP and was moved to Phase 4 by phase-2 18.10, but it is not in the Phase 4 bullets (18.20).
10. **"New plan from templates"** (MVP Workspace) is left to Phase 6's onboarding.
11. **The testing table's "real-device pass before each release"** conflicts with the Phase 6 waiver for an MVP release (18.15).
12. **ADR-0008 #3, `storage.ts`** ("No plan text is ever stored") and ADR-0012's "Unsaved edits are still lost on reload" stop being true. This needs amendments (T1).
13. **ADR-0003 #1** leaves invalid bytes on save to Phase 4 (18.11).
14. **The Storage table's "Detect external changes on focus by modified time"** is followed, plus a content comparison so that a touch with no change does not prompt.
15. **"Schedule check before commit"** is stated for every commit, but "Merging plans safely" blocks only after a merge (18.9).

## 20. Decisions (user, 2026-11-23)

The user approved this spec with every section 18 recommendation, except:

- **18.14 Staging origin: GitHub Pages for now** (the existing Pages site, ADR-0006), possibly a Cloudflare
  domain later. Consequences:
  - 16.3's "staging origin" is the Pages site; the deploy is the existing Pages workflow from `main`, and
    `deploy-staging.yml` is not written until the user moves to Cloudflare.
  - Headers: Pages cannot set them, so the policy of 10.2 ships as the `<meta>` tag (no `frame-ancestors`,
    no `Referrer-Policy` header; the page sets `<meta name="referrer" content="no-referrer">`). The release
    checklist's "`curl -I` headers" item becomes "the served page carries the CSP `<meta>` and
    `csp.spec.ts` passes under `/mainspring/`". `public/_headers` is still written (T19), so a later move
    to Cloudflare needs no code change.
  - T10: the GitHub App's device-flow relay still needs the worker; `ALLOWED_ORIGINS` names the Pages
    origin. The worker's host is the user's choice at T10.
- **18.2 GitHub sign-in:** as recommended: the "Mainspring" GitHub App with the device flow relayed by the
  worker, plus "Use a token instead" (fine-grained, no worker).
- **18.15 Release items:** both accepted: the user re-records the goldens on Ruby 3.4 before the release,
  and does a 15-minute real-device smoke on the Pages site (iPhone home-screen app, Android Chrome).

## 21. Amendment: New file (user, 2026-11-23)

The user asked for a way to split a plan into files from the app, for example a file for the people or
for one part of the project. Before this, a second file could only arrive by opening a folder or a
repository that already had one.

- **What it does.** "New file…" in the file switcher (a "+" after the tabs; an entry beside the select on
  phones) opens a sheet (the shared Sheet primitive) with:
  - **Name**: a workspace path ending in `.tji` (`paths.ts` rules; folders allowed, as `parts/build.tji`);
    refused with a sentence when it is invalid or already exists.
  - **What it is for**: "People and settings" or "Tasks". This only decides where the `include` line
    goes in the entry file, because TaskJuggler reads in order and a task's `allocate` needs its person
    declared first: people and settings go after the project header and any includes already there;
    tasks go at the end of the file.
  The app then creates the file, inserts `include "<name>"` in the entry `.tjp`, and opens the new file in
  the editor.
- **Rules.**
  - The `include` line is an ordinary edit through the edit API: a new intent `addInclude`, a minimal
    text patch with its inverse, refused (`text-only`, `already-set`) like the other intents. It needs a
    fidelity family and an engine test (the plan still schedules with the empty file included). This is
    the one exception to section 2's "no change to the edit API's intents".
  - Creating the file is a workspace operation (`Workspace.addFile`), not an undo step. Undo removes the
    `include` line; the file stays in the workspace and the switcher marks it "Not included" (the
    workspace already parses files outside the include graph). So nothing is ever deleted, in the app or
    on a provider.
  - No delete and no rename of files from the app. An include inside a task body, or from a `.tji`, is
    still written as text.
  - Storage: a new file is stored and saved like a changed one (browser storage at once; the folder's
    Save writes it; a GitHub commit adds it). The contracts of 6 already carry added files.
  - The views do not change where they write: a person added in a view still goes where the edit API
    puts it today. Moving people into the new file is cut and paste in the text.
- **Tests.** Unit: name validation, the `addInclude` placement for both kinds on plans with and without
  includes, the inverse. Fidelity family for `addInclude`. E2E on a small plan, on desktop, Pixel 7 and
  iPhone 14: create a people file, type a resource into it, the schedule and the Resources view show
  it; undo marks the file "Not included"; after T4, a reload keeps both files. axe on the sheet; phone
  and desktop screenshots.

| # | Task | Owner | Files | Depends on |
| --- | --- | --- | --- | --- |
| T27a | `addInclude` intent, `Workspace.addFile`, name validation, fidelity family, engine test | `grammar-specialist`; `reviewer` with an engine reproduction | `src/lib/tjp/edit/include-add.ts`, `types.ts`, `src/lib/workspace/workspace.ts`, `tests/fidelity/families/**` | T3; before T7 in track C |
| T27b | "New file…" in the file switcher, the sheet, the "Not included" mark, strings | `ui-builder` | `FileSwitcher.svelte`, `src/components/storage/NewFileSheet.svelte`, `strings*.ts` | T27a; with T15 |

## 22. Amendments from T3 (the interface PR, 2026-11-23)

The settled contracts are in `src/lib/storage/{types,store-types}.ts`, `src/lib/storage/github/{endpoints,schemas}.ts`,
`src/lib/sync/types.ts`, `src/lib/tjp/merge/types.ts`, `src/lib/workspace/run-types.ts`, `src/pwa/messages.ts` and
`src/lib/state/app-storage.ts`. Where they differ from section 6, the contract files win. The differences:

- **A file deleted on the remote is kept** (review decision; 8.1 #5 and section 21). The merge never drops a file
  that only one side deleted: unchanged on the other side, it is kept with its base text and the merge is clean;
  changed, it is a `file` conflict. The sync base lists such files (`SyncBase.kept`) and does not write them back
  while their text is unchanged; a changed one is added again and the Commit sheet names it (`CommitDraft.readded`).
  If its `include` line went with it, the switcher shows it as "Not included". Only a file deleted on both sides
  leaves the result.
- **Merge (6.4).** `mergeWorkspace` takes a fourth parameter, `MergeContext { includes }` (ours' include graph), and
  `mergeFile` is the per-file unit so the controller can split the work. Refinement also runs at a file's top
  level. Conflict ids come from the file, the subject, the region's range in the base and its text on theirs, so
  they survive a merge computed again from newer local text and change when theirs moves. `MergeConflict.both`
  says whether "Keep both" is allowed; `atOurs` is where "Edit…" opens.
- **13.1's commutation property** leaves out two adds at the same place in the same parent: by rule 3 that is a
  conflict offering Keep both, not a clean merge (T21).
- **Applying pulled text (18.8).** After autosave has finished: files the workspace lacks are added with
  `Workspace.addFile(path, text)` outside the undo step; everything else is one `Workspace.apply` with a label;
  `'stale'` means merge again; `saveFiles` finishes before `setBase`. So `Workspace.addFile` (T27a) takes the
  file's text, not only an empty file.
- **History (18.10).** Queued commits are chained through `WriteResult.moved.commit`. A merge commit writes a
  checked workspace version; `sync()` makes it unasked only when no local changes follow the queue, otherwise it
  waits for `save()`.
- **Status order (6.3).** A store failure outranks everything; then working, conflict, blocked, provider failure,
  queued (also when it waits for access), needs-access, changes, saved or browser-only.
- **Saving to a folder never waits for or asks about the schedule check** (18.9).
- **Additions to 6.1 and 6.2:** `RemoteSnapshot.author` and `at`; `StorageFailure` for `head` and `read`; limits of
  2 MiB per file and 8 MiB per plan; `PendingWrite.changed` and `summary`; `StoredConflict` (theirs as text, the
  user's choices; the merge is recomputed); `LocalStore.cleared()`; the plan lock's `steal` and `lost`;
  `CredentialStore.accounts()` without tokens; the `branches` endpoint; the sign-in relay paths, which T10
  confirms.
- **Summary (6.5).** `summarize` takes the index of the checked snapshot itself, never the published index
  (ADR-0018). `ScheduleCheck` carries the record and a failure.
