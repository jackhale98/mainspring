// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The in-memory workspace (phase-1.md 6.2): every file of a plan as a CodeMirror `EditorState`
 * (no DOM) and a `TjpFile` (text and tree), the include graph, and the full text for the engine.
 * Storage arrives in Phase 4; edits never create or delete files.
 *
 * - Each change, typed or applied, reparses its file incrementally, then the include graph is
 *   walked again from the entry; a file whose parse context changed is parsed again from scratch.
 * - The workspace version bumps once per `commit` or `apply` that changes text; a file's version
 *   bumps whenever its text or tree changes. `TjpEdit.base` holds file versions.
 * - Text is held exactly as decoded (ADR-0002 #13): UTF-8 with invalid sequences replaced, a BOM
 *   kept as U+FEFF for the bridge to strip. `decodeWorkspaceFile` decodes bytes that way.
 *
 * `commit` takes the editor's transactions rather than only the new state (spec 6.2 shows a
 * state): the incremental reparse and `changesSince` need each transaction's change set.
 *
 * Editor extensions (T13) come from `opts.extensions(path, top)` and sit in a compartment. When a
 * change moves a file to another parse context, the workspace reconfigures that file's state with
 * the extensions for the new top and lists it in `ChangeInfo.reconfigured`; an editor showing that
 * file then takes `state(path)` again.
 *
 * Undo (phase-2.md 6.7, 6.11): the file states carry no CodeMirror history. One workspace history
 * (history.ts) records every change from the listeners' `ChangeInfo` and undoes through `apply`
 * with origin 'history'. `apply` takes the origin, per-file selections, annotations and a user
 * event for that; `ChangeInfo.edit` is the edit an `apply` dispatched.
 */
import {
	Annotation,
	Compartment,
	EditorSelection,
	EditorState,
	type AnnotationType,
	type ChangeSet,
	type Extension,
	type Transaction,
} from '@codemirror/state';
import type { Revision, ScheduleRequest } from '../../engine/protocol';
import {
	createFile,
	LINE_SEPARATOR,
	updateFile,
	withTop,
	type TjpFile,
	type TopContext,
} from '../tjp/document';
import { buildIncludeGraph, type IncludeGraph } from './includes';
import { assertWorkspacePath, pathLookup, type PathLookup, type WorkspacePath } from './paths';

export type { IncludeEdge, IncludeGraph, IncludeProblem, IncludeVisit } from './includes';

/** Annotates every transaction of one TjpEdit with its id (one undo step in Phase 2). */
export const tjpEditId: AnnotationType<string> = Annotation.define<string>();

/** 'history' is an undo or redo (history.ts); the runner treats it like 'intent'. */
export type ChangeOrigin = 'typing' | 'format' | 'intent' | 'history';

export interface WorkspaceSnapshot {
	readonly entry: WorkspacePath;
	/** Bumps on any change. */
	readonly version: number;
	readonly files: ReadonlyMap<WorkspacePath, TjpFile>;
	readonly includes: IncludeGraph;
}

/** The part of a TjpEdit (edit/types.ts) that the workspace applies. */
export interface WorkspaceEdit {
	readonly id: string;
	readonly intent: { readonly type: string };
	/** TjpFile.version each change applies to. */
	readonly base: Readonly<Record<WorkspacePath, number>>;
	readonly changes: Readonly<Record<WorkspacePath, ChangeSet>>;
}

export interface ChangeInfo {
	/** The files whose text changed. */
	readonly paths: readonly WorkspacePath[];
	readonly transactions: readonly Transaction[];
	/** Files whose parse context changed, so their state was reconfigured (module comment). */
	readonly reconfigured: readonly WorkspacePath[];
	/** The edit `apply` dispatched (absent for `commit`); `transactions[i]` changed `paths[i]`. */
	readonly edit?: WorkspaceEdit;
}

/** How `apply` dispatches an edit (phase-2.md 6.11); every field is optional. */
export interface ApplyOptions {
	/** Default 'format' for a format edit, else 'intent'. */
	readonly origin?: ChangeOrigin;
	/** The selection each changed file gets, in post-edit coordinates (clamped to the text). */
	readonly selection?: Readonly<Record<WorkspacePath, EditorSelection>>;
	/** Added to every transaction of the edit, after `tjpEditId`. */
	readonly annotations?: readonly Annotation<unknown>[];
	/** Default `input.tjp.<intent type>`. */
	readonly userEvent?: string;
}

export type WorkspaceListener = (
	s: WorkspaceSnapshot,
	origin: ChangeOrigin,
	info: ChangeInfo,
) => void;

export interface Workspace {
	snapshot(): WorkspaceSnapshot;
	/** One EditorState per file (no DOM, no history; '\n' line separator). The editor shows one. */
	state(path: WorkspacePath): EditorState;
	/** Called by the editor with its transactions, which must start from `state(path)`. */
	commit(path: WorkspacePath, tr: Transaction | readonly Transaction[], origin: ChangeOrigin): void;
	/**
	 * Applies an edit: one transaction per file, annotated with tjpEditId (and `opts`), all or
	 * nothing. 'stale' if a base moved.
	 */
	apply(edit: WorkspaceEdit, opts?: ApplyOptions): 'applied' | 'stale';
	/** Full workspace text for ScheduleRequest.files. */
	texts(): Record<WorkspacePath, string>;
	/** Per-file composition of the changes made since a workspace version (changed files only). */
	changesSince(version: number): ReadonlyMap<WorkspacePath, ChangeSet>;
	subscribe(listener: WorkspaceListener): () => void;
}

export interface WorkspaceSeed {
	entry: WorkspacePath;
	files: Readonly<Record<WorkspacePath, string>>;
}

export interface WorkspaceOptions {
	/** Extra extensions for each file's EditorState (the TJP language, T13), per parse context. */
	extensions?: (path: WorkspacePath, top: TopContext) => Extension;
	/** How many change-log entries `changesSince` keeps (default 10,000). */
	logLimit?: number;
}

/** Decodes file bytes as the app and the bridge do (ADR-0002 #13): the BOM stays in the text. */
export function decodeWorkspaceFile(bytes: BufferSource): string {
	return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/** The engine request for the workspace as it is now. The runner never sends `options.now`. */
export function scheduleRequestOf(ws: Workspace, revision: Revision): ScheduleRequest {
	return { files: ws.texts(), entry: ws.snapshot().entry, revision };
}

export function createWorkspace(seed: WorkspaceSeed, opts: WorkspaceOptions = {}): Workspace {
	return new MemoryWorkspace(seed, opts);
}

interface LogEntry {
	readonly version: number;
	readonly path: WorkspacePath;
	readonly changes: ChangeSet;
}

class MemoryWorkspace implements Workspace {
	private readonly entry: WorkspacePath;
	private readonly lookup: PathLookup;
	private readonly seedTexts = new Map<WorkspacePath, string>();
	private readonly files = new Map<WorkspacePath, TjpFile>();
	private readonly states = new Map<WorkspacePath, EditorState>();
	private readonly listeners = new Set<WorkspaceListener>();
	private readonly log: LogEntry[] = [];
	/** `changesSince(v)` needs v >= floor: entries up to `floor` were dropped. */
	private floor = 0;
	private version = 0;
	private graph: IncludeGraph;
	private snap: WorkspaceSnapshot | null = null;
	private readonly editorExtensions = new Compartment();

	constructor(
		seed: WorkspaceSeed,
		private readonly opts: WorkspaceOptions,
	) {
		for (const [path, text] of Object.entries(seed.files)) {
			this.seedTexts.set(assertWorkspacePath(path), text);
		}
		if (!this.seedTexts.has(seed.entry)) {
			throw new Error(`entry ${JSON.stringify(seed.entry)} is not a workspace file`);
		}
		this.entry = seed.entry;
		this.lookup = pathLookup(this.seedTexts.keys());
		this.graph = this.walk();
		for (const [path, file] of this.files) this.states.set(path, this.newState(path, file));
		this.seedTexts.clear();
	}

	snapshot(): WorkspaceSnapshot {
		this.snap ??= {
			entry: this.entry,
			version: this.version,
			files: new Map(this.files),
			includes: this.graph,
		};
		return this.snap;
	}

	state(path: WorkspacePath): EditorState {
		const s = this.states.get(path);
		if (!s) throw new Error(`unknown workspace file ${JSON.stringify(path)}`);
		return s;
	}

	commit(
		path: WorkspacePath,
		tr: Transaction | readonly Transaction[],
		origin: ChangeOrigin,
	): void {
		const list: readonly Transaction[] = Array.isArray(tr) ? tr : [tr as Transaction];
		let state = this.state(path);
		for (const t of list) {
			if (t.startState !== state) {
				throw new Error(`transaction for ${path} does not start from the workspace state`);
			}
			state = t.state;
		}
		const changed = list.filter((t) => t.docChanged);
		if (changed.length === 0) {
			this.states.set(path, state);
			return;
		}
		this.version++;
		let file = this.fileOf(path);
		for (const t of changed) {
			file = updateFile(file, t.changes);
			this.record(path, t.changes);
		}
		this.files.set(path, file);
		this.states.set(path, state);
		this.afterChange(origin, [path], list);
	}

	apply(edit: WorkspaceEdit, opts: ApplyOptions = {}): 'applied' | 'stale' {
		const paths = Object.keys(edit.changes);
		for (const path of paths) {
			const file = this.fileOf(path);
			const cs = edit.changes[path];
			if (edit.base[path] !== file.version) return 'stale';
			if (!cs || cs.length !== file.text.length) {
				throw new RangeError(`edit ${edit.id}: change set does not fit ${path}`);
			}
		}
		const changed: Array<{ path: WorkspacePath; tr: Transaction }> = [];
		for (const path of paths) {
			const cs = edit.changes[path];
			if (!cs || cs.empty) continue;
			const sel = opts.selection?.[path];
			const tr = this.state(path).update({
				changes: cs,
				...(sel ? { selection: clampSelection(sel, cs.newLength) } : {}),
				annotations: [tjpEditId.of(edit.id), ...(opts.annotations ?? [])],
				userEvent: opts.userEvent ?? `input.tjp.${edit.intent.type}`,
			});
			changed.push({ path, tr });
		}
		if (changed.length === 0) return 'applied';
		this.version++;
		for (const { path, tr } of changed) {
			this.files.set(path, updateFile(this.fileOf(path), tr.changes));
			this.states.set(path, tr.state);
			this.record(path, tr.changes);
		}
		this.afterChange(
			opts.origin ?? (edit.intent.type === 'format' ? 'format' : 'intent'),
			changed.map((c) => c.path),
			changed.map((c) => c.tr),
			edit,
		);
		return 'applied';
	}

	texts(): Record<WorkspacePath, string> {
		const out: Record<WorkspacePath, string> = {};
		for (const [path, file] of this.files) out[path] = file.text.toString();
		return out;
	}

	changesSince(version: number): ReadonlyMap<WorkspacePath, ChangeSet> {
		if (version < this.floor) {
			throw new RangeError(`changes since version ${version} are no longer kept`);
		}
		const out = new Map<WorkspacePath, ChangeSet>();
		for (const e of this.log) {
			if (e.version <= version) continue;
			const prev = out.get(e.path);
			out.set(e.path, prev ? prev.compose(e.changes) : e.changes);
		}
		return out;
	}

	subscribe(listener: WorkspaceListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private fileOf(path: WorkspacePath): TjpFile {
		const f = this.files.get(path);
		if (!f) throw new Error(`unknown workspace file ${JSON.stringify(path)}`);
		return f;
	}

	private record(path: WorkspacePath, changes: ChangeSet): void {
		this.log.push({ version: this.version, path, changes });
		const limit = this.opts.logLimit ?? 10_000;
		if (this.log.length > limit) {
			const dropped = this.log.splice(0, this.log.length - Math.floor(limit / 2));
			this.floor = dropped[dropped.length - 1]?.version ?? this.floor;
		}
	}

	/** The file parsed with `top`, from the seed on the first call. */
	private parsed(path: WorkspacePath, top: TopContext): TjpFile {
		const have = this.files.get(path);
		const seed = this.seedTexts.get(path);
		const file = have ? withTop(have, top) : createFile(path, seed ?? '', top);
		if (file !== have) this.files.set(path, file);
		return file;
	}

	/** Walks the include graph, parsing each file in its context; the rest as 'global'. */
	private walk(): IncludeGraph {
		const graph = buildIncludeGraph(this.entry, {
			lookup: this.lookup,
			parse: (path, top) => {
				const f = this.parsed(path, top);
				return { tree: f.tree, read: (from, to) => f.text.sliceString(from, to) };
			},
		});
		const paths = this.seedTexts.size > 0 ? [...this.seedTexts.keys()] : [...this.files.keys()];
		for (const path of paths) if (!graph.tops.has(path)) this.parsed(path, 'global');
		return graph;
	}

	private afterChange(
		origin: ChangeOrigin,
		paths: readonly WorkspacePath[],
		transactions: readonly Transaction[],
		edit?: WorkspaceEdit,
	): void {
		const before = new Map([...this.files].map(([p, f]) => [p, f.top]));
		this.graph = this.walk();
		const reconfigured: WorkspacePath[] = [];
		for (const [path, file] of this.files) {
			if (before.get(path) === file.top) continue;
			reconfigured.push(path);
			const ext = this.opts.extensions;
			if (!ext) continue;
			const state = this.state(path).update({
				effects: this.editorExtensions.reconfigure(ext(path, file.top)),
			}).state;
			this.states.set(path, state);
		}
		this.snap = null;
		const snap = this.snapshot();
		const info: ChangeInfo = edit
			? { paths, transactions, reconfigured, edit }
			: { paths, transactions, reconfigured };
		for (const l of [...this.listeners]) l(snap, origin, info);
	}

	private newState(path: WorkspacePath, file: TjpFile): EditorState {
		return EditorState.create({
			doc: file.text,
			extensions: [
				EditorState.lineSeparator.of(LINE_SEPARATOR),
				this.editorExtensions.of(this.opts.extensions?.(path, file.top) ?? []),
			],
		});
	}
}

/** A selection with every position clamped to [0, length]. */
function clampSelection(sel: EditorSelection, length: number): EditorSelection {
	const at = (n: number) => Math.min(Math.max(0, n), length);
	return EditorSelection.create(
		sel.ranges.map((r) => EditorSelection.range(at(r.anchor), at(r.head))),
		sel.mainIndex,
	);
}
