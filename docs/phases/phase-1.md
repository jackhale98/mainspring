# Phase 1: Document layer and text mode

Status: approved by the user on 2026-11-11, with every recommendation in section 13 (recorded in ADR-0003). Sources: `docs/BUILD_PLAN.md` ("Phase 1", "Architecture" (Document layer, Edit pipeline, State), "UX and interaction design" (Text mode, Direct manipulation, Layouts), "TaskJuggler capabilities to expose", "Testing and quality", "Risks and mitigations"), `docs/phases/phase-0.md`, `docs/phases/phase-0-gate.md`, ADR-0001, ADR-0002 and its addendum. The grammar design comes from `engine/tj/lib/taskjuggler/ProjectFileScanner.rb`, `TextParser/Scanner.rb` and `TjpSyntaxRules.rb` at `3b36c79`. Section 13 lists the open questions and section 14 the conflicts with the plan. This spec does not settle them silently.

## 1. Scope

| In scope | From the plan |
| --- | --- |
| Lezer TJP grammar with a TypeScript port of TaskJuggler's scanner; lossless round trip | Phase 1, bullet 1; "Document layer" |
| Symbol index of tasks, resources, dependencies, allocations, leaves and flags across `include`d files | Phase 1, bullet 1 |
| Engine diagnostics pinned to file, line and a derived column (see 14.1) | Phase 1, bullet 1 |
| Keyword completion and hover docs from TaskJuggler's `SyntaxReference`, through the engine's `syntax()` | Phase 1, bullet 2 |
| Edit API covering every MVP intent (section 7), each with unit tests; returns per-file CodeMirror `ChangeSet`s and refuses text-only targets | Phase 1, bullet 3; "Edit pipeline"; Risks row 1 |
| Format on demand | Product scope, Text editing (MVP) |
| Text mode in `/app`: CodeMirror 6 editor, TJP highlighting, inline errors, completion, hover docs, outline of tasks and resources, status strip with finish date and errors, scheduling 300 ms after typing stops; desktop, tablet and phone layouts, light and dark | Phase title; UX "Text" mode; Layouts; Edit pipeline step 4 |
| An in-memory workspace seeded from bundled samples (no storage) | Needed by text mode; storage comes in Phase 4 |
| Round-trip and patch-fidelity suites in CI; nightly 5,000-case run | Testing table |
| Carry-over from the Phase 0 gate: goldens re-recorded on Ruby 3.4, nightly Firefox and WebKit golden runs, nightly timings | `phase-0-gate.md`, "Open items carried forward" |

## 2. Non-goals

- No Gantt or other views, no Split or Visual mode, no mode toggle, no inspector, no gestures, no unified undo (Phase 2). The edit API returns transactions that Phase 2 can build on (6.5), and in Phase 1 only tests and format on demand call it.
- No UI action that sends edit intents (add, rename, move from the outline). The outline only navigates.
- No storage, file open or save, persistence across reloads, service worker or PWA (Phase 4). Reloading resets to the sample.
- No go-to-definition, rename symbol, id completion or snippets (v1 and later in the Text editing row).
- No renaming of task ids (`renameTask` edits the name string only, as in the Rename row).
- No edits to v1 constructs: scenario-prefixed attributes, shifts, limits, allocation `alternative`/`select`/`mandatory`/`persistent`, `onstart`/`onend`, `extend` attributes, bookings, journal, accounts. The grammar parses them and the edit API leaves them untouched. Exceptions are flagged in 14.4.
- No macro expansion in the document layer. It sees unexpanded text (5.4).
- No TJP-aware merge hints (Phase 4).
- No change to the worker protocol or the golden schema. No bridge change, except the test-only token oracle in T19.
- No parse-skipping fast path (Phase 2 spike).
- Performance budgets are measured and recorded, not enforced (8.4).

## 3. Starting point

- Engine: `createEngineClient()` has `schedule()`, `syntax()` (254 keywords from `engine/bridge/syntax.rb`, cached) and a latest-wins queue. `EngineMessage.column` and `SourceRef.column` are always `null` (ADR-0002 #10). `bootNodeEngine()` in `engine/golden/run-wasm.mjs` runs the same bundle in Node. Boot takes about 1.5 s; the small plans in the corpus take 9 to 729 ms each.
- Corpus: 34 golden plans. Their `GoldenFile.files` lists hold 41 `.tjp`/`.tji` files: 6 upstream, 1 PoC, 23 synthetic, 11 bridge. One file, `bridge/bom-invalid-utf8/plan.tjp`, holds a BOM and invalid UTF-8. No file has CR characters. TaskJuggler's own `engine/tj/test/TestSuite/Syntax/Correct/` (79 files) is a second, wider syntax corpus.
- App: `/app` shows only the engine status. `package.json` has no CodeMirror or Lezer packages yet.

## 4. Module layout

```text
src/lib/tjp/
  grammar/   tjp.grammar, tokens.ts (external tokenizer: scanner port), context.ts (ContextTracker),
             highlight.ts (styleTags), parser.generated.ts, parser.terms.generated.ts (committed)
  syntax/    keywords.generated.ts (from engine syntax(), committed), keywords.ts (context lookup), docs.ts
  values/    duration.ts, date.ts, interval.ts, ids.ts (relative ids), string-literal.ts, number.ts,
             workinghours.ts, leave.ts
  document.ts, tree.ts, text-only.ts
  index/     build.ts, tasks.ts, resources.ts, deps.ts, calendar.ts, mentions.ts, hints.ts, query.ts
  edit/      types.ts, apply.ts, layout.ts, refuse.ts, refs.ts, task-attrs.ts, task-tree.ts, deps.ts,
             allocation.ts, resources.ts, project.ts, calendar.ts
  format.ts, diagnostics.ts, diagnostic-refine.ts
  cm/        language.ts, complete.ts, hover.ts, lint.ts, commands.ts
src/lib/workspace/   workspace.ts, includes.ts, paths.ts, samples.ts, schedule-runner.ts
src/lib/schedule/    finish.ts
src/lib/state/       workspace.svelte.ts, schedule.svelte.ts, ui.svelte.ts (Svelte 5 runes)
src/components/app/  App.svelte, TopBar.svelte, TabBar.svelte
src/components/text/ Editor.svelte, Outline.svelte, StatusStrip.svelte, FileSwitcher.svelte,
                     SamplePicker.svelte, DocsSheet.svelte
scripts/             build-grammar.mjs, gen-tjp-keywords.mjs, ci/licenses.mjs
tests/               roundtrip/, index/, fidelity/, grammar/, fixtures/tjp/, e2e/text-mode.spec.ts
```

Every `src/lib` module has a `*.test.ts` beside it. Generated files and the keyword table may exceed 400 lines and say why in their header.

Data flow: the editor or format produces a CodeMirror transaction on a file's `EditorState` held by the workspace. The workspace reparses that file incrementally and rebuilds the index for it. The runner waits 300 ms, sends `schedule({files, entry, revision})`, and turns the result into diagnostics, engine hints for the index, the finish date and the status strip.

## 5. Grammar

### 5.1 Tokens: a port of `ProjectFileScanner`

One external tokenizer (`tokens.ts`) produces every token, so Lezer never applies its own longest-match rules. It follows TaskJuggler's rules exactly:

- **Order.** Patterns are tried in the scanner's order and the first match wins. Matches are anchored at the cursor and lines are read one at a time.
- **Whitespace.** ASCII `[ \t\n\v\f\r]` only, as Ruby's `\s`. JavaScript's `\s` also matches NBSP and U+FEFF, which is wrong here. Lines break on `\n` only. A single leading U+FEFF is a `Bom` trivia token; the bridge strips it (ADR-0002 #13).
- **Comments.** `#` and `//` run to the end of the line. A one-line `/* … */` is greedy to the last `*/` on its line. A multi-line comment ends at the last `*/` on its closing line.
- **Identifiers.** `ScenarioPrefix` (`[a-zA-Z_]\w*:`, as in `delayed:effort`) is tried before `AbsoluteId` (`a.b.c`), which is tried before `Identifier`. `\w` is ASCII.
- **Numbers and dates.** `Date` (`\d{4}-\d{1,2}-\d{1,2}(-\d{1,2}:\d{1,2}(:\d{1,2})?(-[-+]?\d{4})?)?`) before `Time` before `Float` (`\d*\.\d+`) before `Integer`. So `5d` is `Integer` + `Identifier`, as in TaskJuggler.
- **Strings.** `"…"` and `'…'` may span lines; `\"` and `\'` are the only escapes. A cut-here string starts with `-8<-`, which must end its line (trailing whitespace is allowed), and closes at a line whose first non-blank text is `->8-`.
- **Macro bodies.** `[` always starts a `MacroBody`. On one line it is greedy to the last `]` before the newline. Across lines it ends at the first line whose last character is `]`.
- **Macro calls.** `${ name "arg" … }`, with an optional `?`, may span lines. A glued prefix (`[-a-zA-Z_0-9>:.+]*`) and any directly following word characters form one `MacroWord` token, e.g. `${content}${major}` or `f${major}x`. Strings that contain `${` stay `String` tokens and are flagged as templated. `$(NAME)` is `EnvRef` and stays on one line.
- **Punctuation.** `<=`, `>=` and `!=` are single tokens; any other character is a one-character token.
- **Errors.** An unterminated string, comment or macro becomes an error token that runs to the end of the file, as TaskJuggler's `runaway_token`.

### 5.2 Structure and coverage boundary

| Level | Coverage |
| --- | --- |
| Blocks and ids, all 254 keywords | Full. A file is a sequence of statements. A statement is a `Keyword`, then its arguments, then an optional `Body { "{" Statement* "}" }`. Declarations (`project`, `task`, `resource`, `supplement`, `include`, `macro`, `flags`, `scenario`, `shift`, `account`, reports and others) get typed headers, so ids, names and block ranges are exact |
| Attribute names | Full. A `ContextTracker` keeps the stack of open bodies, keyed by scoped keyword id (`task`, `resource`, `project`, `limits.task`, …). The tokenizer emits `Keyword` only when the identifier is valid in the current context (from `keywords.generated.ts`) and `stack.canShift(Keyword)` holds. An identifier right after `,` or in a typed value slot is never a keyword, so `depends start` and `columns name, start, end` lex correctly |
| Values of MVP keywords | Fully typed (5.3) |
| Values of other keywords | Opaque: `OpaqueArg*`, which may be any token, a `( … )` group, a `,` continuation or a body. The keyword-led rule above ends the statement. If the rule splits an opaque statement in the wrong place, the text still round-trips and only highlighting and folding are affected. Edits never target opaque statements |
| Included `.tji` files | Parsed with the top context of their include site: prolog (before `project`), `project` (inside the header) or global. A file not included anywhere yet is parsed as global |

### 5.3 MVP keywords with typed values

| Context | Keyword | Typed value |
| --- | --- | --- |
| global | `project` | `Id? String String? Interval`, `Body` |
| global | `include` | `String` (must end in `.tji`), with an opaque optional `{ taskprefix/resourceprefix … }` body read by the index |
| global | `macro` | `Identifier MacroBody` |
| global | `flags` | `IdList` (declaration) |
| global | `leaves` | `LeaveList`: `LeaveType String? IntervalOrDate` separated by `,`. `LeaveType` is `project`, `annual`, `special`, `sick`, `unpaid`, `holiday` or `unemployed` |
| global, project, resource | `vacation` | `String? IntervalList` (read and remove only; new ones are written as `leaves`) |
| project | `timezone`, `timeformat`, `currency` | `String` |
| project | `now` | `Date` |
| project | `dailyworkinghours` | `Number` |
| project | `weekstartsmonday` | flag (no value) |
| project, resource | `workinghours` | `DayList (TimeIntervalList \| off)` |
| task | `task` | `Id? String`, `Body?` |
| task | `effort`, `length` | `WorkingDuration` (`Number Unit`, unit `min\|h\|d\|w\|m\|y`) |
| task | `duration` | `CalendarDuration` |
| task | `start`, `end`, `minstart`, `maxend` | `Date` (`DATE` or `%{ DATE ± Duration }`) |
| task | `scheduling` | `asap \| alap` |
| task | `milestone` | flag |
| task | `priority` | `Integer` |
| task | `complete` | `Number` (see 14.4) |
| task | `note` | `String` |
| task | `flags` | `IdList` |
| task | `responsible` | `IdList` (resources) |
| task | `depends`, `precedes` | `DepItem ("," DepItem)*`. `DepItem` is `TaskRef DepBody?`, where `TaskRef` is `"!"* (Identifier \| AbsoluteId)`. `DepBody` types `gapduration`, `gaplength`, `onstart` and `onend` |
| task | `allocate` | `AllocItem ("," AllocItem)*`. `AllocItem` is `ResourceRef AllocBody?`, and the body is opaque (v1) |
| resource | `resource` | `Id? String`, `Body?` |
| resource | `efficiency`, `rate` | `Number` |
| resource | `email` | `String` |
| resource | `managers` | `IdList` |
| resource | `leaves` | `LeaveList` |
| task, resource | `supplement task\|resource Ref Body` | typed header; the body uses the task or resource context |

Any typed slot also accepts a `MacroWord` or `MacroCall` value, which marks the statement text-only (5.4). A `ScenarioPrefix` is accepted before any statement where TaskJuggler accepts it, and is kept.

### 5.4 Macros, `include`, `supplement` and text-only ranges

Macro expansion happens in TaskJuggler's scanner, so the document layer only sees unexpanded text. A range is **text-only**, and every edit API intent that targets it is refused, when any of these holds:

| # | Rule | Reason code |
| --- | --- | --- |
| X1 | It lies inside a `MacroBody`. Declarations written inside macro definitions are not indexed | `macro-body` |
| X2 | It overlaps a `MacroCall`, `MacroWord`, `EnvRef` or templated `String` | `macro-call` / `env-var` |
| X3 | It is a statement whose keyword, prefix or any value token falls under X2. The whole statement is text-only, e.g. `effort ${phaseLen}` | `macro-call` |
| X4 | It belongs to a declaration whose id is not literal (a `MacroWord`, or a missing id, which TaskJuggler fills automatically) and the engine has not resolved the id (6.4 hints). With hints, only the id and name tokens stay text-only | `macro-id` / `auto-id` |
| X5 | The declaration exists only through expansion: the engine reports a task or resource whose source line has no literal header. It is indexed as `expandedOnly` at the call site and is entirely text-only | `expanded-only` |
| X6 | It lies inside a syntax error node | `syntax-error` |
| X7 | It lies inside an opaque statement | `opaque` |

Intents are also refused when their effect depends on text the layer cannot see:

- **Statement-level macro calls.** A declaration body that holds a statement-level macro call (e.g. `${allocate_developers}` in Tutorial) refuses an attribute edit unless three things hold: the macro is defined exactly once in the workspace, its body has no nested macro calls or arguments, and its tokenized body does not contain the edited keyword (`macro-in-body`).
- **References.** Moving or deleting a task or resource whose id is mentioned in a macro body or an opaque statement is refused, because those mentions cannot be fixed (`unfixable-reference`). `index/mentions.ts` scans them conservatively: the full id, or `!`/`.` plus the local id, counts as a mention.
- **Moved macro calls.** A moved block that contains macro calls may only land after the macro's definition in parse order.

**`include`.** Paths resolve the way TaskJuggler's `Scanner#include` does: relative to the including file's directory, `.tji` required, absolute paths and paths outside the workspace not resolved, recursion detected. The index applies `taskprefix` and `resourceprefix` from the include body. Files are visited in parse order from the entry.

**`supplement`.** Its blocks are indexed as extra sites of the target. Attributes written in a supplement block are edited in place. New attributes always go into the declaring block. For a single-valued attribute written several times, the last site in parse order (the one TaskJuggler uses) is the one rewritten.

### 5.5 What "parsing then printing" means

`printTree(tree, text)` concatenates every leaf token's text and every gap between leaves, and throws if a gap holds anything but whitespace. Lezer trees cover their input by construction, so the round-trip suite (9.1) also asserts: no non-whitespace gaps; no error nodes except in the two deliberate parse-error fixtures, where the first error is on the line the engine reports; every typed value parses to a typed value (no fallback); and the UTF-8 bytes of the printed text equal the file's bytes (see 14.2 for the invalid-UTF-8 fixture).

## 6. Interfaces

All offsets are UTF-16 offsets into the file text, as CodeMirror uses. Lines are 1-based. Documents use `EditorState.lineSeparator.of('\n')`, so a `\r` is kept as an ordinary character, as TaskJuggler's `gets` treats it. Without this, CodeMirror would normalise line endings and break the round trip.

### 6.1 Document (`src/lib/tjp/document.ts`)

```ts
import type { ChangeSet, Text } from '@codemirror/state';
import type { Tree, TreeFragment } from '@lezer/common';
import type { WorkspacePath } from '../../engine/protocol';

export type TopContext = 'global' | 'project' | 'prolog';
/** A scoped keyword id from KEYWORDS ('task', 'limits.task'), or '' for the global scope. */
export type ContextId = string;

export function parseTjp(text: string, opts?: { top?: TopContext; fragments?: readonly TreeFragment[] }): Tree;
/** Leaf tokens plus whitespace gaps, in order. Throws CoverageError on a non-whitespace gap. */
export function printTree(tree: Tree, text: string): string;
export interface SyntaxIssue { from: number; to: number; line: number }
export function syntaxIssues(tree: Tree, text: Text): SyntaxIssue[];

export interface TjpFile {
  readonly path: WorkspacePath;
  readonly text: Text;
  readonly tree: Tree;
  readonly version: number;   // bumps on every change to this file
  readonly top: TopContext;
}
/** Incremental reparse through TreeFragment.applyChanges. */
export function updateFile(file: TjpFile, changes: ChangeSet): TjpFile;
```

### 6.2 Workspace (`src/lib/workspace/`)

```ts
import type { EditorState, ChangeSet, Annotation } from '@codemirror/state';

export interface IncludeEdge {
  from: WorkspacePath; site: SourceRange; literal: string;
  target: WorkspacePath | null; top: TopContext;
  taskPrefix: string | null; resourcePrefix: string | null;
  problem: 'not-found' | 'outside-workspace' | 'bad-suffix' | 'recursive' | null;
}
export interface WorkspaceSnapshot {
  readonly entry: WorkspacePath;
  readonly version: number;                                // bumps on any change
  readonly files: ReadonlyMap<WorkspacePath, TjpFile>;
  readonly includes: { order: readonly WorkspacePath[]; edges: readonly IncludeEdge[] };
}
export type ChangeOrigin = 'typing' | 'format' | 'intent';
export interface Workspace {
  snapshot(): WorkspaceSnapshot;
  /** One EditorState per file (no DOM; TJP language, history). The editor view shows one of them. */
  state(path: WorkspacePath): EditorState;
  /** Called by the editor for each of its transactions. */
  commit(path: WorkspacePath, state: EditorState, origin: ChangeOrigin): void;
  /** Applies a TjpEdit: one transaction per file, all annotated with tjpEditId. 'stale' if a base version moved. */
  apply(edit: TjpEdit): 'applied' | 'stale';
  /** Full workspace text for ScheduleRequest.files. */
  texts(): Record<WorkspacePath, string>;
  /** Per-file composition of the changes made since a workspace version (for mapping diagnostics). */
  changesSince(version: number): ReadonlyMap<WorkspacePath, ChangeSet>;
  subscribe(listener: (s: WorkspaceSnapshot, origin: ChangeOrigin) => void): () => void;
}
export function createWorkspace(seed: { entry: WorkspacePath; files: Record<WorkspacePath, string> }): Workspace;
export const tjpEditId: AnnotationType<string>;

export interface Sample { id: string; label: string; load(): Promise<{ entry: WorkspacePath; files: Record<WorkspacePath, string> }> }
export const SAMPLES: readonly Sample[];
```

The samples are `poc-sample`, upstream Tutorial, `syn-18-structure-include-macro` (several files, macros, `supplement`) and upstream Fedora 20 (414 tasks, macro ids). Each is loaded lazily with a dynamic `?raw` import, decoded the way ADR-0002 #13 decodes files.

### 6.3 Keyword table and docs (`src/lib/tjp/syntax/`)

```ts
export interface KeywordEntry {
  keyword: string;            // scoped id, as KeywordDoc.keyword ('booking.task')
  name: string;               // as written ('booking')
  contexts: readonly ContextId[];
  syntax: string; summary: string; scenarioSpecific: boolean;
}
export const TJ_VERSION: string;                           // must equal SyntaxDocs.tjVersion
export const KEYWORDS: readonly KeywordEntry[];
export function resolveKeyword(name: string, context: ContextId): KeywordEntry | null;
/** Engine docs once syntax() resolves; the table alone before that. */
export interface KeywordDocsSource { table: readonly KeywordEntry[]; engine: SyntaxDocs | null }
export function keywordDoc(src: KeywordDocsSource, keyword: string): (KeywordEntry & { doc: string | null; seeAlso: readonly string[] }) | null;
```

`scripts/gen-tjp-keywords.mjs` builds `keywords.generated.ts` from `bootNodeEngine().syntax()`. With `--check`, CI fails if the committed file differs. The parser needs the table before the engine has booted; hover shows the full `doc` from `client.syntax()` once it arrives, and the summary before that.

### 6.4 Symbol index (`src/lib/tjp/index/`)

```ts
export type TaskId = string;       // full path, 'app.editor'
export type ResourceId = string;   // TaskJuggler resource ids are global (resourceprefix aside)
export interface SourceRange { file: WorkspacePath; from: number; to: number }
export type TextOnlyReason = 'macro-body' | 'macro-call' | 'env-var' | 'macro-id' | 'auto-id'
  | 'expanded-only' | 'syntax-error' | 'opaque';
export interface TextOnly { reason: TextOnlyReason; at: SourceRange }

export interface DeclSite { header: SourceRange; id: SourceRange | null; name: SourceRange | null;
  block: SourceRange; body: SourceRange | null; leadingComments: SourceRange | null }
export interface AttrSite {
  keyword: string; scenario: string | null;
  statement: SourceRange; value: SourceRange | null;
  parsed: TypedValue | null;                 // null for opaque or text-only values
  site: 'decl' | 'supplement'; textOnly: TextOnly | null;
}
export interface TaskSymbol {
  id: TaskId; localId: string; name: string | null; parent: TaskId | null; children: readonly TaskId[];
  idSource: 'text' | 'engine'; decl: DeclSite; supplements: readonly DeclSite[];
  attrs: readonly AttrSite[]; bodyMacroCalls: readonly SourceRange[]; textOnly: TextOnly | null;
}
export interface ResourceSymbol { id: ResourceId; name: string | null; parent: ResourceId | null;
  children: readonly ResourceId[]; idSource: 'text' | 'engine'; decl: DeclSite;
  supplements: readonly DeclSite[]; attrs: readonly AttrSite[]; textOnly: TextOnly | null }
export interface DependencySite {
  pred: TaskId | null; succ: TaskId | null;    // null when unresolvable
  form: 'depends' | 'precedes'; written: string; // '!compile', 'app.editor'
  item: SourceRange; statement: SourceRange; body: SourceRange | null; textOnly: TextOnly | null;
}
export interface ReferenceSite {
  kind: 'task' | 'resource' | 'flag'; target: string | null; written: string; at: SourceRange;
  via: 'depends' | 'precedes' | 'allocate' | 'responsible' | 'managers' | 'flags' | 'supplement' | 'taskprefix' | 'resourceprefix';
}
export interface SymbolIndex {
  readonly version: number;                 // WorkspaceSnapshot.version it was built from
  readonly project: ProjectSymbol | null;
  readonly tasks: ReadonlyMap<TaskId, TaskSymbol>; readonly taskRoots: readonly TaskId[];
  readonly resources: ReadonlyMap<ResourceId, ResourceSymbol>; readonly resourceRoots: readonly ResourceId[];
  readonly dependencies: readonly DependencySite[];
  readonly references: readonly ReferenceSite[];
  readonly leaves: readonly LeaveSite[];
  readonly flags: ReadonlyMap<string, SourceRange>;            // declared flags
  readonly macros: ReadonlyMap<string, readonly MacroDef[]>;
  readonly unresolved: readonly UnresolvedDecl[];
  symbolAt(file: WorkspacePath, pos: number): SymbolHit | null;
  mentions(kind: 'task' | 'resource', id: string): readonly TextOnly[];   // macro bodies, opaque statements
}
/** Engine ids for declarations the text cannot name (X4, X5). Lines are mapped to the current text. */
export interface EngineHints {
  readonly tasks: ReadonlyArray<{ id: string; parent: string | null; file: WorkspacePath; line: number }>;
  readonly resources: ReadonlyArray<{ id: string; parent: string | null; file: WorkspacePath; line: number }>;
}
export function buildIndex(ws: WorkspaceSnapshot, hints?: EngineHints): SymbolIndex;
export function hintsFromResult(r: ScheduleResult, mapLine: (file: WorkspacePath, line: number) => number | null): EngineHints;
```

Relative ids resolve the way `rule_taskDepId` does. With `@property` = the task being declared (or supplemented), each `!` moves one level up from it; the result is that ancestor's `fullId + '.' + rest`, or `rest` at the top level. Declarations and engine hints are matched by (file, header line). A line with several candidates is not matched, and the declaration stays unresolved.

### 6.5 Edit API (`src/lib/tjp/edit/`)

The plan's function names are kept. Each function is a thin wrapper that builds an `EditIntent` and calls `applyIntent`.

```ts
export type TaskAttr = 'effort' | 'duration' | 'length' | 'start' | 'end' | 'minstart' | 'maxend'
  | 'scheduling' | 'milestone' | 'priority' | 'note' | 'complete' | 'flags' | 'responsible';
export type ResourceAttr = 'efficiency' | 'rate' | 'email' | 'managers';
export type ProjectAttr = 'timezone' | 'now' | 'timeformat' | 'currency' | 'dailyworkinghours' | 'weekstartsmonday';
/** Text as TaskJuggler writes it ('5d', '2026-03-02-09:00', 'alap'); true/false for flags; ids for list attributes. */
export type AttrValue = string | boolean | readonly string[];
export type Scope = { kind: 'project' } | { kind: 'resource'; resource: ResourceId };
export type LeaveType = 'holiday' | 'annual' | 'special' | 'sick' | 'unpaid' | 'unemployed';
export interface LeaveSpec { type: LeaveType; name?: string; start: string; end?: string /* date, or '+2d' */ }

export type EditIntent =
  | { type: 'setAttr'; task: TaskId; attr: TaskAttr; value: AttrValue }
  | { type: 'removeAttr'; task: TaskId; attr: TaskAttr }
  | { type: 'renameTask'; task: TaskId; name: string }
  | { type: 'addTask'; parent: TaskId | null; index: number; id?: string; name: string;
      attrs?: ReadonlyArray<readonly [TaskAttr, AttrValue]> }
  | { type: 'deleteTask'; task: TaskId }
  | { type: 'moveTask'; task: TaskId; parent: TaskId | null; index: number }
  | { type: 'addDepends'; task: TaskId; target: TaskId }            // task = successor
  | { type: 'removeDepends'; task: TaskId; target: TaskId }
  | { type: 'setDependsGap'; task: TaskId; target: TaskId; gap: { kind: 'gapduration' | 'gaplength'; value: string } | null }
  | { type: 'allocate'; task: TaskId; resources: readonly ResourceId[] }   // replaces the task's own plain list
  | { type: 'addAllocation'; task: TaskId; resource: ResourceId }
  | { type: 'removeAllocation'; task: TaskId; resource: ResourceId }
  | { type: 'replaceAllocation'; task: TaskId; from: ResourceId; to: ResourceId }
  | { type: 'addResource'; parent: ResourceId | null; index: number; id?: string; name: string;
      attrs?: ReadonlyArray<readonly [ResourceAttr, AttrValue]> }
  | { type: 'deleteResource'; resource: ResourceId }
  | { type: 'moveResource'; resource: ResourceId; parent: ResourceId | null; index: number }
  | { type: 'renameResource'; resource: ResourceId; name: string }
  | { type: 'setResourceAttr'; resource: ResourceId; attr: ResourceAttr; value: AttrValue }
  | { type: 'removeResourceAttr'; resource: ResourceId; attr: ResourceAttr }
  | { type: 'setProjectHeader'; name?: string; start?: string; end?: string }
  | { type: 'setProjectAttr'; attr: ProjectAttr; value: AttrValue }
  | { type: 'removeProjectAttr'; attr: ProjectAttr }
  | { type: 'setWorkingHours'; scope: Scope; days: readonly Weekday[]; hours: ReadonlyArray<readonly [string, string]> | 'off' }
  | { type: 'addLeave'; scope: { kind: 'global' } | Scope; leave: LeaveSpec }
  | { type: 'updateLeave'; leave: LeaveRef; to: LeaveSpec }
  | { type: 'removeLeave'; leave: LeaveRef }
  | { type: 'declareFlag'; flag: string }
  | { type: 'format'; file: WorkspacePath };                      // produced by formatFile only

export type RefusalReason = 'unknown-target' | 'text-only' | 'macro-in-body' | 'invalid-value'
  | 'conflicting-attribute' | 'inherited' | 'id-collision' | 'cycle' | 'unfixable-reference'
  | 'undeclared-flag' | 'unsafe-text' | 'needs-schedule' | 'syntax-error' | 'unsupported-form';
export type NoopReason = 'already-set' | 'already-linked' | 'not-present';

export interface TjpEdit {
  readonly id: string;                                          // one undo step in Phase 2
  readonly intent: EditIntent;
  readonly base: Readonly<Record<WorkspacePath, number>>;       // TjpFile.version each change applies to
  readonly changes: Readonly<Record<WorkspacePath, ChangeSet>>; // ChangeSet is a CodeMirror ChangeSpec
  readonly inverse: Readonly<Record<WorkspacePath, ChangeSet>>;
  /** Declared target regions, in pre-edit coordinates; every change lies inside one. */
  readonly targets: Readonly<Record<WorkspacePath, readonly SourceRange[]>>;
  readonly select: SourceRange | null;                          // post-edit, e.g. the new value
}
export type EditResult =
  | { status: 'edit'; edit: TjpEdit }
  | { status: 'noop'; reason: NoopReason }
  | { status: 'refused'; reason: RefusalReason; at: readonly SourceRange[] };

export function applyIntent(ws: WorkspaceSnapshot, index: SymbolIndex, intent: EditIntent): EditResult;
export function setAttr(ws: WorkspaceSnapshot, index: SymbolIndex, task: TaskId, attr: TaskAttr, value: AttrValue): EditResult;
// … one wrapper per intent: addDepends, removeDepends, moveTask, allocate, addTask, deleteTask, renameTask, …
export function formatFile(ws: WorkspaceSnapshot, file: WorkspacePath): EditResult;
```

Rules:

- **Pure.** Edit functions never mutate anything. `Workspace.apply` dispatches one transaction per changed file, with `tjpEditId.of(edit.id)` and `userEvent` `input.tjp.<type>`.
- **Undo.** In Phase 1, each file's own history records these transactions. Phase 2 replaces that with a workspace-level undo keyed by `tjpEditId` and built on `inverse`.
- **Files.** Edits never create or delete files.
- **Dates.** Values are TaskJuggler text, as in the plan (`setAttr(taskId, 'effort', '5d')`), validated by `values/`. Converting `Minutes` to date text is Phase 2's job.

### 6.6 Diagnostics (`src/lib/tjp/diagnostics.ts`)

```ts
export interface TjpDiagnostic {
  file: WorkspacePath | null; from: number; to: number;
  severity: 'error' | 'warning' | 'info';     // fatal and error -> error; debug is dropped
  source: 'engine' | 'syntax';
  messageId: string; message: string; scenario: string | null;
  precision: 'token' | 'line' | 'none';
  line: number | null; column: number | null; // 1-based; column derived from `from` (UTF-16)
  revision: Revision | null;
}
/** Against the texts sent for result.revision; the caller maps positions through changesSince(). */
export function engineDiagnostics(result: ScheduleResult, sent: (p: WorkspacePath) => Text | null, index?: SymbolIndex): TjpDiagnostic[];
export function syntaxDiagnostics(file: TjpFile): TjpDiagnostic[];
```

How an engine message (file, line, no column) becomes a range:

1. Take `doc.line(line)` in the text that was sent. A line past the end is clamped to the last line. With `file` null or `line` null, `precision` is `'none'`, the diagnostic goes to the entry file at offset 0, and it is shown only in the status strip.
2. Refine to one token, so `precision` becomes `'token'`, when:
   - the text quotes a token (`Unexpected token '@' found…`) and that token occurs on the line;
   - the message names a task or resource id (a table in `diagnostic-refine.ts` keyed by message id, e.g. `unknown_task`, the `task <id>` phrases in constraint messages) that occurs on the line;
   - the line is a declaration header the message refers to; the range is then the header (keyword, id, name);
   - the line holds a macro call, which TaskJuggler reports at the call site because injected text keeps the call's line; the range is then the call.
3. Otherwise the range runs from the first to the last non-blank character of the line, excluding a trailing comment (`precision: 'line'`).
4. Diagnostics are mapped from the sent text to the current text through `Workspace.changesSince`. After that, CodeMirror's lint state maps them through later typing.
5. Syntax diagnostics cover structural errors only (unterminated tokens, unbalanced braces, error nodes). They appear immediately, without waiting for the debounce. The grammar must give no false positives on either corpus (9.1).

### 6.7 CodeMirror extensions (`src/lib/tjp/cm/`)

```ts
export function tjp(opts: { top: TopContext; docs: () => KeywordDocsSource }): Extension; // language, highlight, completion, hover
export function contextAt(tree: Tree, pos: number, top: TopContext): ContextId;
export function keywordCompletionSource(docs: () => KeywordDocsSource): CompletionSource;
export function keywordHover(docs: () => KeywordDocsSource): Extension;
export function setEngineDiagnostics(view: EditorView, d: readonly TjpDiagnostic[]): void;
export const formatCommand: Command;    // Shift-Alt-F and the Format button
export function keywordAtCursor(state: EditorState): KeywordEntry | null; // for the phone docs sheet
```

Completion lists only keywords valid in `contextAt`. Each entry shows the keyword name, the `syntax` line as detail and `summary` as info. The full `doc` appears once the engine docs have loaded. A `ScenarioPrefix` before the cursor narrows the list to scenario-specific keywords.

### 6.8 Schedule runner (`src/lib/workspace/schedule-runner.ts`) and finish date

```ts
export interface RunRecord {
  revision: Revision; workspaceVersion: number; result: ScheduleResult; latest: boolean;
  diagnostics: readonly TjpDiagnostic[]; hints: EngineHints; finish: Minutes | null;
}
export interface RunnerState { engine: EngineState; pending: boolean; latest: RunRecord | null; lastGood: RunRecord | null }
export interface ScheduleRunner {
  changed(kind: 'typing' | 'now'): void;   // 'typing': wait for 300 ms of quiet; 'now': schedule at once
  readonly state: RunnerState;
  subscribe(l: (s: RunnerState) => void): () => void;
  dispose(): void;
}
export function createScheduleRunner(o: { workspace: Workspace; client: EngineClient; debounceMs?: number; timers?: Timers }): ScheduleRunner;
// src/lib/schedule/finish.ts
/** Latest end over tasks in the first active scenario; null if none is scheduled. */
export function finishMinutes(r: ScheduleResult): Minutes | null;
```

Runner behaviour:

- Typing calls `changed('typing')`. Format calls `changed('now')`.
- Each run sends the full workspace text (Phase 0 protocol) with a new revision, and keeps the sent texts until the result is handled.
- Results with `latest: false` still update diagnostics and hints.
- When a result has `ok: false`, `lastGood` keeps the previous good run, and the status strip shows its finish date dimmed.
- The runner never sends `options.now`.

### 6.9 Engine

No protocol change. T19 adds a Node-only `Engine.tokens(text)` method on the runtime object, which the worker never exposes. It is a test oracle.

## 7. Edit intents

### 7.1 Intent table

The MVP set comes from the direct-manipulation table and the MVP rows of the capabilities table. Every intent refuses `unknown-target`, `text-only` (5.4) and `syntax-error` (target block inside an error region). The table lists only the other refusals.

| Intent | Plan row | Text change | Targets (pre-edit) | Other refusals and no-ops |
| --- | --- | --- | --- | --- |
| `setAttr` sizing (`effort`, `length`, `duration`) | Change effort or length | Rewrites the value of the task's last unprefixed own sizing statement. If its keyword differs, the keyword and value are rewritten together. Otherwise inserts `attr value` (7.2) | value range or statement range; else the insertion point | `conflicting-attribute` (milestone set); `invalid-value`; `macro-in-body`; noop `already-set` |
| `setAttr` `start`/`end`/`minstart`/`maxend`/`scheduling`/`priority`/`note`/`complete` | Move a task later; Mark progress; inspector | Rewrite the last own site, else insert | value range or insertion point | `invalid-value`; `macro-in-body` |
| `setAttr` `milestone` | Task tree | `true` inserts `milestone`, `false` removes it | insertion point or statement line | `conflicting-attribute` (sizing present) |
| `setAttr` `flags`/`responsible` | Task tree | Rewrites the id list of the last own site, else inserts | list range or insertion point | `undeclared-flag`; resource not found |
| `removeAttr` | inspector | Removes every own unprefixed site (declaration and supplements). The line goes if nothing else is left on it; a trailing comment is kept | each statement (with its line) | `inherited` (value only inherited); noop `not-present` |
| `renameTask` | Rename | Rewrites the name string only, in the same quote style, escaping `"` or `'` | name token | `unsafe-text` (contains `${`, `$(` or a newline) |
| `addTask` | add | Inserts `task <id> "<name>"`, with a body if `attrs` are given, after sibling `index-1`, or at the start or end of the parent body (creating a body if needed). The id comes from the name (ASCII slug, `_n` suffix on collision) | insertion point | `id-collision`; `unsafe-text`; parent text-only |
| `deleteTask` | delete | Removes the block and its attached leading comments. Removes `depends`/`precedes` items naming the task or its subtree elsewhere (7.2 list rules), and `supplement` blocks for the subtree | block; each reference item; each supplement block | `unfixable-reference` (mentions in macro bodies, opaque statements or `taskprefix`) |
| `moveTask` (reparent, reorder) | Reorder or reparent | Cuts the block and inserts it at the new position, possibly in another file, re-indented (7.2). Rewrites every reference whose meaning changes: absolute ids into the subtree, relative ids from outside into it, and relative ids inside it pointing outside. New references follow the `addDepends` form rule. Updates `supplement` paths | source block; destination point; each rewritten reference token | `cycle` (into own subtree); `id-collision`; `unfixable-reference`; macro calls before their definition; noop (same place) |
| `addDepends` | Link tasks | Appends `, <ref>` to the successor's last own `depends`, else inserts `depends <ref>`. `<ref>` is `!id` for a sibling, otherwise the absolute id | list end or insertion point | `cycle` (in the declared graph); noop `already-linked` (also through `precedes`) |
| `removeDepends` | Remove a link | Removes the item (with its `{…}` body and one adjacent comma) from the successor's `depends` or the predecessor's `precedes`. Removes the statement if it becomes empty | each matching item or statement | noop `not-present` |
| `setDependsGap` | Move a task later (gap option) | Adds, rewrites or removes `gapduration`/`gaplength` in the item's body, creating `{ … }` if needed | item range | `invalid-value` |
| `allocate` | Assign a person | Reshapes the task's own plain `allocate` lists with the fewest edits: removes ids no longer wanted, appends new ones to the last list, removes emptied statements | each list | `inherited` (removing an inherited resource); `unsupported-form` (item with a body) |
| `addAllocation`, `removeAllocation` | Assign a person | Same rules, for one id | list or insertion point | as above; noops |
| `replaceAllocation` | Rebalance load | Rewrites the one id token in place | id token | as above |
| `addResource`, `deleteResource`, `moveResource`, `renameResource` | Resources (groups, drag into groups) | As the task forms. Resource ids are global, so moving one changes no references. Deleting removes `allocate`/`responsible`/`managers` items and supplement blocks | as the task forms | `unfixable-reference` (bookings, opaque statements, macro bodies) |
| `setResourceAttr`, `removeResourceAttr` | Resources | As `setAttr`/`removeAttr` | as `setAttr` | `invalid-value` |
| `setProjectHeader` | Project frame | Rewrites the name string and/or interval tokens of the `project` header | those tokens | `invalid-value` (end before start) |
| `setProjectAttr`, `removeProjectAttr` | Project frame | As `setAttr`, in the header body | as `setAttr` | `invalid-value` |
| `setWorkingHours` | Calendars, working hours | Rewrites the statement whose day set equals `days`, else appends a new statement at the end of the scope's `workinghours` group (later statements override earlier ones) | statement or insertion point | `invalid-value` |
| `addLeave`, `updateLeave`, `removeLeave` | Calendars, leaves | Adds an item to the scope's last `leaves` list (in global scope, the last top-level list), else inserts `leaves …`. Rewrites or removes one item (list rules as above) | list end, item or insertion point | `invalid-value` |
| `declareFlag` | Task tree (flags) | Appends to the last global `flags` declaration, else inserts one before the first task | list end or insertion point | noop (already declared) |
| `formatFile` | Format on demand | 7.3 | changed indentation and trailing whitespace | `syntax-error` (file has error nodes) |

### 7.2 Layout rules for inserted and moved text

- **Indent unit.** Inferred per file from the most common indentation step between a block header and its body: a tab, or N spaces. The default is two spaces.
- **Statement order.** A new statement goes on its own line at the body's indentation, at its rank in the canonical order. Task: `note, flags, priority, responsible, start, end, minstart, maxend, scheduling, milestone, effort|duration|length, depends, precedes, allocate, complete`, then child tasks. Resource: `email, managers, efficiency, rate, workinghours, leaves, vacation`, then child resources. Project: `timezone, timeformat, currency, now, dailyworkinghours, weekstartsmonday, workinghours`.
  - The statement goes after the last statement of equal or lower rank, and never between a comment and the statement directly below it.
  - Opaque statements are skipped when ranking.
- **Bodies.** A header with no body gets ` {`, a new line and a closing `}`, both at the header's indentation. In a one-line body (`{ a b }`) the new statement is added inline, before `}`.
- **Blank lines.** Never added, except that a new or moved block copies the blank-line separation of its previous sibling.
- **Lists.** Items are separated by `, `. A list that wraps keeps its continuation indentation.
- **Re-indenting a moved block.** Every line of the block moves by the depth difference, except lines that start inside a `"`/`'` string, a block comment or a macro body. Cut-here string lines do move: TaskJuggler strips the first line's indentation from every line, so a uniform shift keeps the value.

### 7.3 Format on demand

- Each line that starts outside a string, comment or macro body gets indentation = depth × unit, where depth counts the open `{` before it. A line starting with `}` gets one level less.
- A continuation line (one that starts inside a statement begun on an earlier line) keeps its offset from that statement's first line.
- Trailing whitespace is removed, except at the end of lines that end inside a string or macro body.
- Nothing else changes: no blank-line, spacing, ordering or final-newline changes.
- Formatting is idempotent, keeps the token sequence and the schedule identical, and refuses files with syntax errors.

## 8. Text mode UI

### 8.1 Layouts

| Width | Layout |
| --- | --- |
| Desktop, 1024 px and up | Top bar (brand, sample picker, file tabs, Format button, engine state). Left: outline. Centre: editor. Bottom: status strip |
| Tablet, 600 to 1023 px | Outline in a drawer opened from the top bar; editor full width |
| Phone, under 600 px | One panel at a time. Bottom tab bar with **Plan** (outline and status summary) and **Text** (see 14.7). File picker as a select. Status strip above the tab bar. A Docs button opens `DocsSheet` for the keyword at the cursor, because hover does not exist on touch. Editor font at least 16 px, so iOS does not zoom on focus |

### 8.2 Behaviour

- **Editor.** CodeMirror 6 with `tjp()`: line numbers, a lint gutter, bracket matching, search and per-file history. Highlight styles come from the design tokens (JetBrains Mono, light and dark).
- **Outline.** Tasks and resources trees from the index, as an ARIA `tree` with arrow-key navigation. Selecting an item opens its file and puts the cursor on the declaration. Items carry a text-only badge (X4, X5) and an error-count badge. Items without engine hints show the id as written, e.g. `${content}${major}`. The tree is virtualised above 200 rows.
- **Status strip** (`role="status"`, polite):
  - engine state;
  - finish date, formatted with `Intl` in the project's time zone (UTC if unset), dimmed with a "last good" label after a failed run;
  - error and warning counts as a button that jumps to the next diagnostic in any file;
  - diagnostics without a location (`precision: 'none'`), listed in a popover.
- **Notice.** A line of copy says that changes stay in this tab until storage arrives (Phase 4).
- **Copy.** All user-facing text, including one string per `RefusalReason` for Phase 2 toasts, lives in `src/lib/strings.ts`.

### 8.3 State

`src/lib/state/*.svelte.ts` wraps `Workspace`, `ScheduleRunner` and UI state (open file, outline expansion, phone tab) in Svelte 5 runes. These are not the Mycelium `store` module (see 14.8).

### 8.4 Targets, recorded in the gate, not enforced

- Cold parse: Fedora `f-20.tjp` (2,442 lines) under 150 ms; `scale-1000` (5,628 lines) under 300 ms (Node, CI hardware).
- Incremental reparse after one keystroke: under 5 ms.
- Index rebuild for one changed file: under 30 ms (Fedora).
- Any intent on Fedora: under 50 ms.
- Keystroke to paint with Fedora open: 50 ms or less (Event Timing, desktop Chrome).
- `/app` JavaScript size: recorded.

## 9. Tests and CI

### 9.1 Round trip (`npm run test:roundtrip`, CI `check` job)

- **Golden corpus.** The corpus is the union of `files` across all 34 goldens, resolved under each manifest `root`. The test asserts 41 files and that the set matches the manifest exactly. For each file:
  1. read the bytes and decode them as the app does (`TextDecoder('utf-8', { ignoreBOM: true })`);
  2. parse, then `printTree`; the result must equal the decoded text;
  3. `TextEncoder` the printed text; it must equal the file's bytes (see 14.2 for the invalid-UTF-8 fixture);
  4. assert no non-whitespace gaps and that every typed value parses;
  5. assert no error nodes, except in `syn-19-errors-parse` (`lib/broken.tji`) and `bridge-parse-failure`, whose first error node must be on the line in their golden's message.
- **Wider corpus.** The same checks run on `engine/tj/test/TestSuite/Syntax/Correct/` (79 files), which must have zero error nodes. This is evidence in the gate, not the gate criterion.
- **Edge fixtures (T16).** CRLF, tabs, one-line blocks, cut-here strings, the greedy comment cases, macro edge cases, `taskprefix`/`resourceprefix`, `supplement`, scenario prefixes.
- **Mutation check.** A unit test shows `printTree` fails when one token is dropped from the tree.

### 9.2 Index checked against goldens (`tests/index/golden-index.test.ts`, unit)

For every golden plan, with hints from `GoldenFile.result`, the index's tasks and resources must equal the golden's `id`, `parent`, pre-order and `source.file`/`line`. Without hints, every literal-id declaration must match too, and the rest must be listed in `unresolved`. Golden messages are also put through `engineDiagnostics`: each lands on its reported line and file, and the known cases (`'@'` in syn-19, `'colour'` in bridge-parse-failure) resolve to `precision: 'token'`.

### 9.3 Patch fidelity: property tests

**Generator** (`tests/fidelity/gen/`, fast-check):

- **Plans.** A random plan model: 5 to 40 tasks, up to 4 levels deep; 1 to 6 resources in groups; 1 to 3 files linked by `include`, with optional `taskprefix`; a horizon of 6 months or less; durations that are whole hours.
- **Printing.** The model is printed with varied formatting: indent unit, one-line blocks, comments between statements, attribute order, and a mix of relative and absolute ids. With some probability the plan also gets macro definitions and uses, statement-level macro calls, `supplement` blocks and scenario-prefixed attributes.
- **Oracle.** The printer records the exact range of every element it writes. This gives the test its own oracle for each intent's target regions, independent of the edit code.
- **Intents.** Valid by construction against the model: no cycles, no hard constraints that can conflict, sizing kept consistent, declared flags. Some intents deliberately target text-only elements.

**Properties for each case** (one plan, one intent):

| # | Property |
| --- | --- |
| P1 | **Locality.** Old and new text are equal outside the changed ranges, and every changed range lies inside the oracle's target regions for that intent (7.1, "Targets"). For corpus plans, the oracle is `tests/fidelity/oracle.ts`, written from 7.1 against the pre-edit index, not imported from `edit/` |
| P2 | **Still parses.** The new text has no more error nodes than the old (zero for generated plans) |
| P3 | **Semantics.** The rebuilt index equals the oracle model with the intent applied: ids, parents, order, attribute values, dependencies, allocations, leaves |
| P4 | **Still schedules.** The engine runs on the old and new workspace. `ok` does not go from true to false, and no new `error`/`fatal` message ids appear (multiset of `(level, id)`, ignoring lines). For `renameTask` and `formatFile`, the results are equal apart from names, source lines and timings |
| P5 | **Refusals.** `refused` and `noop` leave the text unchanged, and intents aimed at text-only elements are always refused. No edit ever changes text inside a macro body or macro call |
| P6 | **Inverse.** Applying `inverse` restores the original text byte for byte (needed for Phase 2 undo) |

**How "the result still schedules" runs without Ruby.** `tests/fidelity/schedule.property.test.ts` uses `bootNodeEngine()` (the built `public/engine` bundle in Node): one boot per test file, about 1.5 s. There is no native Ruby, so the `no-ruby` job still passes; its checker must not trip on the string `ruby.wasm`.

**Case counts and time:**

| Run | Generated cases | Corpus cases | Engine runs | Expected time |
| --- | --- | --- | --- | --- |
| Every push (`test:fidelity`) | 200 | 50 | about 500 | 30 to 90 s; job budget 5 min |
| Nightly (`FIDELITY_RUNS=5000`, 4 shards) | 5,000 | 500 | about 11,000 | 5 to 25 min per shard |

- Generated plans take about 30 to 150 ms per run. Corpus cases on every push use plans whose worker `totalMs` in `golden-report.json` is under 500 ms; nightly adds Tutorial and Fedora with 20 cases each.
- If the p95 time per case goes over 300 ms, plans are made smaller, not fewer.
- The text-only properties (P1 to P3, P5, P6, with no engine) also run in `test:unit`, with 200 cases.

**Coverage and teeth:**

- A run fails unless every intent type in 7.1 produced at least 5 `edit` outcomes.
- The report prints per-intent counts of edits, no-ops and refusals, and the seed.
- Failing seeds are added to `tests/fidelity/regressions.json`, which replays on every run.
- Meta-test (`mutation.test.ts`): faulty wrappers that touch one byte outside the target, skip one reference fix, or drop an inverse change must each make P1, P3 or P6 fail within 200 cases.

### 9.4 Unit and end-to-end tests

- **Unit.** Every intent has a unit-test file beside it covering the 7.1 row: rewrite, insert, each refusal, each no-op. Also covered: tokenizer, values, include resolution, relative ids, diagnostics refinement, format idempotence, the runner (debounce, latest/lastGood, mapping), `finishMinutes`.
- **End-to-end.** `tests/e2e/text-mode.spec.ts`, on desktop Chrome, Pixel 7 and iPhone 14:
  - typing an error shows an inline diagnostic on the right line after the debounce and the run;
  - changing an `effort` updates the finish date;
  - completion inside a `task` body offers `effort` with TaskJuggler's syntax line;
  - hover (desktop) and the Docs sheet (phone) show the engine's doc text;
  - Format re-indents a fixture;
  - an outline click moves the cursor to the declaration, across files;
  - axe finds nothing;
  - screenshots: desktop and phone, light and dark.

### 9.5 CI changes

| Job | Change |
| --- | --- |
| `check` | Adds `build:grammar -- --check`, `test:roundtrip` and `node scripts/ci/licenses.mjs`. The license script walks the production dependency tree and fails on any license outside MIT, ISC, BSD-2/3-Clause, 0BSD or the GPL-2.0 family |
| `fidelity` (new) | `npm ci`, `build:engine`, `gen:keywords -- --check`, `test:fidelity`; uploads the report |
| `e2e` | Runs the new text-mode specs |
| `nightly.yml` | Enables `timings`; enables `golden-cross-browser`, which needs Firefox and WebKit projects in `playwright.golden.config.ts`, and `scripts/test-golden.mjs` passing its arguments through to Playwright (today it ignores them); adds `fidelity-nightly` (4 shards, 5,000 cases). None of these block |

## 10. Tasks

Each task runs in its own worktree and goes through `reviewer` before merge.

| # | Task | Owner | Files | Depends on |
| --- | --- | --- | --- | --- |
| T1 | **Carry-over.** Re-record all goldens on Ruby 3.4.x on glibc Linux (Debian or Ubuntu), run `golden:verify`, commit. Any diff is triaged before Phase 1 merges | `fixture-maker` runs it on a machine the **user provides** (this environment has 3.3.6), or the user runs it; `engine-specialist` triages diffs | `engine/golden/expected/**`, `native-timings.json` | none; **blocks the first Phase 1 merge** (Phase 0 gate) |
| T2 | Add `@codemirror/{state,view,language,autocomplete,lint,commands,search}` and `@lezer/{common,lr,highlight}`, plus dev dependency `@lezer/generator`. npm scripts `build:grammar`, `gen:keywords`, `test:roundtrip`, `test:fidelity`. License script and its test | `grammar-specialist` (dependencies, scripts); `test-writer` (license script) | `package.json`, `package-lock.json`, `scripts/ci/licenses.mjs`, `tests/ci/licenses.test.ts` | none; merged first to avoid lockfile conflicts |
| T3 | Keyword table generator and lookups (6.3) | `grammar-specialist` | `scripts/gen-tjp-keywords.mjs`, `src/lib/tjp/syntax/**` | T2 |
| T4 | Tokenizer, a port of `ProjectFileScanner` (5.1) | `grammar-specialist` | `src/lib/tjp/grammar/tokens.ts` | T2 |
| T5 | Grammar, context tracker, typed MVP statements, opaque fallback, highlighting, build script with `--check` | `grammar-specialist` | `src/lib/tjp/grammar/**`, `scripts/build-grammar.mjs` | T3, T4 |
| T6 | Typed values: parse, print, validate (durations, dates, `%{}`, intervals, ids, string escaping, working hours, leaves) | `grammar-specialist` | `src/lib/tjp/values/**` | T2 |
| T7 | Document, text-only rules, workspace, include graph, samples | `grammar-specialist`; `ui-builder` for `samples.ts` | `src/lib/tjp/{document,tree,text-only}.ts`, `src/lib/workspace/{workspace,includes,paths,samples}.ts` | T5 |
| T8 | Symbol index and engine hints (6.4) | `grammar-specialist` | `src/lib/tjp/index/**` | T6, T7 |
| T9 | Diagnostics mapping and refinement (6.6) | `grammar-specialist` | `src/lib/tjp/diagnostics*.ts` | T7; T8 for id refinement |
| T10 | Edit core: types, layout rules (7.2), refusal checks, building `TjpEdit`, `inverse`, `Workspace.apply` | `grammar-specialist` | `src/lib/tjp/edit/{types,apply,layout,refuse,refs}.ts` | T8 |
| T11a | `setAttr`, `removeAttr`, `renameTask`, `declareFlag` | `grammar-specialist` | `edit/task-attrs.ts` | T10 |
| T11b | `addTask`, `deleteTask`, `moveTask` with reference fixing | `grammar-specialist` | `edit/task-tree.ts` | T10 |
| T11c | `addDepends`, `removeDepends`, `setDependsGap`, allocation intents | `grammar-specialist` | `edit/deps.ts`, `edit/allocation.ts` | T10 |
| T11d | Resource, project, working-hours and leave intents | `grammar-specialist` | `edit/resources.ts`, `edit/project.ts`, `edit/calendar.ts` | T10 |
| T12 | Format on demand (7.3) | `grammar-specialist` | `src/lib/tjp/format.ts` | T7 |
| T13 | CodeMirror extensions (6.7) | `grammar-specialist` (logic); `ui-builder` (theme, tooltip and sheet styling) | `src/lib/tjp/cm/**` | T3, T5, T9, T12 |
| T14 | Schedule runner and finish date (6.8) | `engine-specialist` | `src/lib/workspace/schedule-runner.ts`, `src/lib/schedule/finish.ts` | T7, T9 |
| T15 | Text mode UI (section 8), strings, `/app` page | `ui-builder` | `src/components/**`, `src/lib/state/**`, `src/pages/app/index.astro`, `src/lib/strings.ts`, `src/styles/tokens.css` | T8, T13, T14 |
| T16 | Fixtures: macro-heavy plans (macro ids, statement-level macros, templated names, `${?x}`, nested calls), CRLF, tabs, one-line blocks, cut-here strings, comment quirks, prefixed includes, `supplement`, scenario prefixes | `fixture-maker` | `tests/fixtures/tjp/**` | none |
| T17 | Round-trip suite (9.1) and index cross-check against goldens (9.2) | `test-writer` | `tests/roundtrip/**`, `tests/index/**` | T5, T8; written earlier against the 6.1 and 6.4 types |
| T18 | Generator, oracle, fidelity properties P1 to P6, corpus cases, mutation meta-test, Vitest config | `test-writer` | `tests/fidelity/**`, `vitest.fidelity.config.ts` | T10 (types), T11a to T11d, T16 |
| T19 | Token oracle: `engine/bridge/tokens.rb` returns TaskJuggler's own scanner tokens for a buffer without macros, and runtime exposes `tokens()` for Node only. Differential test of `tokens.ts` on the corpora and on random token soup. Golden parity must stay green (the bundle hash changes) | `engine-specialist` (bridge, runtime); `test-writer` (test) | `engine/bridge/tokens.rb`, `src/engine/runtime.ts`, `tests/grammar/scanner-diff.test.ts` | T4 |
| T20 | End-to-end text-mode specs and screenshots (9.4) | `test-writer` | `tests/e2e/text-mode.spec.ts` | T15 |
| T21 | Performance and accessibility audit (8.4, axe, keyboard walkthrough of open, edit, read diagnostics) | `perf-a11y-auditor` | `tests/e2e/text-mode-perf.spec.ts`, report for the gate | T15 |
| T22 | CI changes (9.5), including the carry-over nightly jobs | `test-writer`; `engine-specialist` reviews the golden config | `.github/workflows/*.yml`, `scripts/test-golden.mjs`, `playwright.golden.config.ts`, `scripts/ci/no-ruby.mjs` | T2; jobs added as T17, T18 and T20 land |
| T23 | **Done.** ADR-0003 recording the user's answers to section 13 | `docs-writer` formats; **user decides** | `docs/decisions/0003-document-layer.md` | user answers; before T9, T17 and T22 merge |
| T24 | Gate evidence | main session; `test-runner` runs the suites | `docs/phases/phase-1-gate.md` | all |

### 10.1 Parallel waves

| Wave | Tasks |
| --- | --- |
| 0 | T1 (needs a Ruby 3.4 machine); user answers section 13; T23 |
| 1 | T2 (merged first), then T4, T6, T16, the nightly part of T22 |
| 2 | T3, T19; T17 drafted against the types |
| 3 | T5 |
| 4 | T7, T12 |
| 5 | T8, T9 |
| 6 | T10, T13, T14; T15 starts on T13 and T14 with a stub index |
| 7 | T11a, T11b, T11c, T11d in parallel; T15 continues; T18 |
| 8 | T17 and T18 complete; T20, T21; T22 complete |
| 9 | T24, then stop for approval |

## 11. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Tokenizer differs from TaskJuggler's scanner | Wrong ranges, so edits land in the wrong place | Exact port of pattern order (5.1); T19 differential oracle; 79-file `Syntax/Correct` corpus |
| Opaque statements split in the wrong place | Highlighting and folding glitches | Typed rules for every MVP keyword; edits never target opaque statements; round trip holds either way |
| Ids written as macros (Fedora's `${content}${major}`) | Fedora would be read-only | Engine hints by header line; refuse `needs-schedule` if hints are stale; index cross-check against goldens |
| Statement-level macros hide attributes | An edit is silently overridden | `macro-in-body` rule (5.4); macro-heavy fixtures in P5 |
| `supplement` and prefixed includes give wrong ids | References fixed incorrectly | 9.2 cross-check; T16 fixtures; P3 |
| Fidelity CI time | Slow merges | Small generated plans; one boot per file; budget and shrink rule (9.3); nightly shards |
| Flaky property tests | Lost trust in the suite | Seeds printed and replayed; regressions file; the generator never schedules against the clock (plans set `now`) |
| T1 re-record shows diffs on Ruby 3.4 | Delays every Phase 1 merge | Wave 0; `engine-specialist` triages; the user may approve merging pure-TS work first (13.5) |
| CodeMirror on phones (virtual keyboard, iOS zoom, no hover) | Phone text mode unusable | 16 px font, Docs sheet, e2e on Pixel 7 and iPhone 14 |
| CodeMirror increases the bundle | Shell budget (Phase 6) | Record size; the editor is the only island on `/app`; samples lazy |
| Keyword table drifts from the engine | Completion does not match the engine version | `gen:keywords --check` in CI |
| A license slips into the bundle | Legal | `licenses.mjs` in `check`. CodeMirror 6 and Lezer are MIT (checked on the npm registry: `@codemirror/view`, `state`, `autocomplete`, `@lezer/lr`), and so are their dependencies `crelt`, `style-mod`, `w3c-keyname` and `@marijn/find-cluster-break`. `@lezer/generator` is build-only. No Apache-2.0-only or GPL v3 dependency is added. The check cannot see OpenSSL linked inside ruby.wasm, which stays tracked in ADR-0001 |
| Parallel worktrees conflict on `package.json` and `strings.ts` | Merge churn | T2 merges first; strings grouped by component |

## 12. Gate acceptance criteria

Copied word for word from the plan:

> Gate: parsing then printing every golden file reproduces it byte for byte; property tests show each edit changes only its target range and the result still schedules.

### Criterion 1: "parsing then printing every golden file reproduces it byte for byte"

- **How it is shown:** `npm run test:roundtrip` (9.1) passes in CI (`check` job) on the gate commit.
- **Evidence in `phase-1-gate.md`:**
  - CI run link;
  - the asserted file count (41) and a table of file, bytes, error nodes and result;
  - the outcome for the invalid-UTF-8 fixture, under the rule the user chooses in 13.1;
  - the two parse-error fixtures with their error line beside the golden's line;
  - the `Syntax/Correct` result (79 files, zero error nodes);
  - the `printTree` mutation test output;
  - the T19 differential result.

### Criterion 2: "property tests show each edit changes only its target range and the result still schedules"

- **How it is shown:** the `fidelity` CI job (200 generated and 50 corpus cases, properties P1 to P6, engine through `bootNodeEngine`) passes on the gate commit, and one nightly run with 5,000 generated cases passes. "Each edit" is enforced by the minimum of 5 edits per intent type. "Only its target range" is P1 against the independent oracle. "Still schedules" is P4.
- **Evidence:**
  - CI and nightly run links with seeds;
  - a per-intent table of cases, edits, no-ops and refusals;
  - P4 counts (runs, `ok` kept, new errors: 0);
  - wall time and p95 per case;
  - the mutation meta-test output, showing each faulty wrapper is caught.

### Phase deliverables

These are phase bullets, not gate criteria; they are listed for completeness.

| Plan bullet (verbatim) | Demonstration |
| --- | --- |
| "Lezer TJP grammar with lossless round trip; symbol index across included files; diagnostics from the engine pinned to file, line and column." | Criterion 1 evidence; the 9.2 cross-check over all 34 goldens (ids, parents, order, file and line); diagnostics landing on golden lines with token precision where available (column derived, see 14.1) |
| "Completion and hover docs generated from TaskJuggler's own syntax rules (its `SyntaxReference` and keyword docs), so they match the engine version." | `gen:keywords --check` green; an e2e test showing completion and hover text equal to `syntax()` output; `TJ_VERSION` equal to `SyntaxDocs.tjVersion` |
| "Edit API with every MVP intent, each with unit tests." | The 7.1 table mapped to test files; unit test output; the per-intent counts from criterion 2 |
| Text mode (phase title; UX "Text" mode) | e2e on desktop, Pixel 7 and iPhone 14; screenshots in light and dark; 8.4 timings; axe report |

## 13. Open questions for the user

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| 13.1 | Invalid UTF-8 in `bridge-bom-invalid-utf8` cannot round-trip byte for byte through a decoded string (14.2) | Option A: assert byte-exact for the 40 valid files and text-exact for this one; Phase 4 decides what saving does with invalid bytes | T17 merge |
| 13.2 | Engine columns are always null (14.1) | Derive columns in the document layer (6.6); no bridge patch, no golden re-record | T9 merge |
| 13.3 | CI would run the wasm engine in Node for the fidelity job (14.5) | Approve; still no native Ruby | T22 merge |
| 13.4 | Include `setDependsGap` and `setAttr complete` in the Phase 1 edit API (14.4) | Include both; the Phase 2 gate needs them | T11a, T11c |
| 13.5 | Who runs the Ruby 3.4 re-record (T1), and may pure-TypeScript Phase 1 work merge before it is done? | The user provides a Debian or Ubuntu machine with Ruby 3.4; allow merges that do not touch `engine/` or goldens before T1 | all merges |
| 13.6 | Make the new `fidelity` check (and `golden`, `e2e`) required | Yes, in branch protection (your setting) | none |
| 13.7 | The rules this spec chooses: last-site rewrite for `supplement` (5.4), sibling-only relative ids (7.1), indentation-only format (7.3) | Approve as written | T10, T11a to T11d, T12 |

## 14. Conflicts and ambiguities

1. **"Pinned to file, line and column."** The plan says the PoC's errors came "with line and column". In fact TaskJuggler 3.8.4 records no columns (`Scanner#sourceFileInfo` passes 0; ADR-0002 #10), so `column` is always null. This spec derives a column from the refined range and marks it with `precision`. Exact engine columns would need a bridge patch to the scanner loaded on both sides, a schema bump and re-recorded goldens, and still could not place errors inside macro-expanded text.
2. **"Byte for byte"** cannot hold through a decoded string for a file with invalid UTF-8: decoding replaces the bytes with U+FFFD (ADR-0002 #13). Option B, decoding with "surrogate escapes", would make the round trip byte-exact, but it puts lone surrogates into `JSON.stringify` on the way to the bridge, which risks golden parity. A BOM does round-trip, because `ignoreBOM: true` keeps U+FEFF in the text.
3. **Lezer trees are lossless by construction**, so "parsing then printing" alone proves little. This spec adds the coverage, no-error and typed-value checks in 5.5 and 9.1, and those checks make the criterion meaningful.
4. **MVP scope against the direct-manipulation table.**
   - "Move a task later … or adds a dependency gap" is an MVP gesture, but gaps are listed as v1.
   - "Mark progress" edits `complete`, which is v1 tracking.
   - The Phase 2 gate requires "each row of the direct-manipulation table".
   - This spec therefore includes `setDependsGap` and `setAttr complete` (13.4).
   - "Rename" edits only the name string; renaming ids is v1.
5. **"Diagnostics … ChangeSpecs" and "one undoable transaction".** Edits such as `moveTask` across files or `deleteTask` with references touch several CodeMirror states, so they cannot be one CodeMirror transaction. This spec returns per-file `ChangeSet`s with a shared `tjpEditId` and an `inverse`. In Phase 1 each file's own history records them; Phase 2's unified undo groups them.
6. **"Posts the changed files"** (Edit pipeline step 4) does not match Phase 0's protocol, which sends the full workspace text on every request. Phase 1 keeps full text.
7. **Phone tab bar** (Plan, Gantt, People, Text). Phase 1 shows only Plan and Text. Gantt arrives in Phase 2 and People in Phase 3.
8. **`src/lib/store`** is the name the plan gives the Mycelium module copied in Phase 4. Phase 1's runes stores live in `src/lib/state/`, and Phase 4 must reconcile the two.
9. **"Full paths like `app.editor`"** applies to tasks only. Resource ids are global in TaskJuggler (`resourceprefix` aside), so moving a resource changes no references.
10. **"Refuses intents whose target range comes from a macro expansion."** The document layer never sees expansions. 5.4 defines text-only conservatively, and adds engine hints so that Fedora's tasks under a macro id are still editable.
11. **"Relative id (`!sibling`) when possible"** is not defined further. This spec uses `!id` for siblings only and absolute ids otherwise (13.7).
12. **Completion "matches the engine version"** while the engine boots asynchronously. A committed keyword table generated from the same bundle, checked in CI, serves the parser and completion before boot. Hover shows the full docs once `syntax()` resolves.
13. **Phase 0 spec 7.1 says CI never calls the Node wasm harness.** The fidelity job needs it to check "still schedules" without a browser for 500 runs (13.3).
14. **Carry-overs that need the user:** the Ruby 3.4 machine (T1), branch protection (13.6), and the OpenSSL-free ruby.wasm, which is still due before any public release and is not Phase 1 work. Phase 1 adds no Apache-2.0 dependency; Dexie is still due before Phase 4.

Relevant files: `/home/user/mainspring/docs/BUILD_PLAN.md`, `/home/user/mainspring/docs/phases/phase-0.md`, `/home/user/mainspring/docs/phases/phase-0-gate.md`, `/home/user/mainspring/docs/decisions/0002-engine-protocol.md`, `/home/user/mainspring/src/engine/protocol.ts`, `/home/user/mainspring/engine/golden/run-wasm.mjs`, `/home/user/mainspring/engine/tj/lib/taskjuggler/ProjectFileScanner.rb`, `/home/user/mainspring/engine/tj/lib/taskjuggler/TjpSyntaxRules.rb`, `/home/user/mainspring/engine/golden/plans/bridge/bom-invalid-utf8/plan.tjp`, `/home/user/mainspring/scripts/test-golden.mjs`, `/home/user/mainspring/.github/workflows/nightly.yml`.