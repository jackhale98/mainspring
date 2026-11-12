// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The state of Text mode (phase-1.md 8.3) as Svelte 5 runes: which sample is open, the
 * workspace and the schedule runner that follow it, and the UI state around them (open file,
 * phone tab, drawers, outline collapse). These are not the Mycelium `store` module (14.8).
 *
 * Views never change the schedule. Typing goes through the editor's `workspaceDispatch` and the
 * format command; the runner watches the workspace and schedules by itself, so nothing here
 * calls `changed('now')` except the retry button. Outline and status are derived from the
 * runner's state: `run.index` for the tree (compare `run.indexVersion` with `run.version` for
 * lag), `run.diagnostics` for problems.
 *
 * Samples load in memory; nothing is stored (Phase 4).
 */
import type { EditorView } from '@codemirror/view';
import { createEngineClient, type EngineClient } from '../../engine/client';
import type { EngineState } from '../../engine/client';
import type { SyntaxDocs, WorkspacePath } from '../../engine/protocol';
import { editorStrings, strings } from '../strings';
import {
	docsAtCursor,
	workspaceExtensions,
	type FormatOutcome,
	type HoverContent,
} from '../tjp/cm';
import { KEYWORDS } from '../tjp/syntax/keywords';
import type { KeywordDocsSource } from '../tjp/syntax/docs';
import { SAMPLES, type Sample, type SampleWorkspace } from '../workspace/samples';
import {
	createScheduleRunner,
	type RunnerState,
	type ScheduleRunner,
} from '../workspace/schedule-runner';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { nextProblem } from './diagnostics-nav';
import { editorSetup } from './editor-setup';
import { buildOutline, EMPTY_OUTLINE, errorCounts, type OutlineNode } from './outline';
import { statusView, type StatusView } from './status';

export type PhoneTab = 'plan' | 'text';
export type Phase = 'loading' | 'ready' | 'failed';

/** A request to put the cursor on a range of a file; `nonce` makes repeats distinct. */
export interface Reveal {
	readonly file: WorkspacePath;
	readonly from: number;
	readonly to: number;
	readonly nonce: number;
}

export interface AppStateOptions {
	client?: EngineClient;
	samples?: readonly Sample[];
	/** Sample id to open first; default the first sample. */
	initial?: string | null;
	/** Asks before replacing edited work; default `window.confirm`. */
	confirm?: (message: string) => boolean;
}

/** How long a format message stays in the toolbar. */
const NOTE_MS = 5000;

export class AppState {
	readonly client: EngineClient;
	readonly samples: readonly Sample[];

	sampleId = $state('');
	phase = $state<Phase>('loading');
	loadError = $state<string | null>(null);
	workspace = $state.raw<Workspace | null>(null);
	run = $state.raw<RunnerState | null>(null);
	engine = $state<EngineState>('booting');
	activeFile = $state<WorkspacePath>('');
	phoneTab = $state<PhoneTab>('text');
	outlineOpen = $state(false);
	docsOpen = $state(false);
	collapsed = $state.raw<ReadonlySet<string>>(new Set());
	/** The newest format message, shown briefly. */
	note = $state<string | null>(null);
	reveal = $state.raw<Reveal | null>(null);
	/** True once the open plan has been edited, so replacing it needs a confirmation. */
	dirty = $state(false);
	/** What the docs sheet shows: the documentation at the cursor when it was opened. */
	docsContent = $state.raw<HoverContent | null>(null);
	/** The editor view, set by the editor panel. Not reactive. */
	editor: EditorView | null = null;

	readonly files = $derived<readonly WorkspacePath[]>(
		this.workspace ? [...this.workspace.snapshot().includes.order] : [],
	);
	/** The index; its identity changes only when the runner derives a new one. */
	readonly index = $derived(this.run?.index ?? null);
	readonly diagnostics = $derived(this.run?.diagnostics ?? []);
	readonly outline = $derived(
		this.index
			? buildOutline(
					this.index,
					(r) =>
						this.workspace?.snapshot().files.get(r.file)?.text.sliceString(r.from, r.to) ?? null,
				)
			: EMPTY_OUTLINE,
	);
	/** Error counts per outline node, for the badges. */
	readonly errors = $derived(
		errorCounts([...this.outline.tasks, ...this.outline.resources], this.diagnostics),
	);
	readonly status = $derived<StatusView | null>(this.run ? statusView(this.run) : null);

	#runner: ScheduleRunner | null = null;
	#unsubscribe: Array<() => void> = [];
	#docs: SyntaxDocs | null = null;
	#nonce = 0;
	#token = 0;
	#noteTimer: ReturnType<typeof setTimeout> | null = null;
	readonly #confirm: (message: string) => boolean;
	readonly #offClient: () => void;

	constructor(opts: AppStateOptions = {}) {
		this.client = opts.client ?? createEngineClient();
		this.samples = opts.samples ?? SAMPLES;
		this.#confirm = opts.confirm ?? ((m) => globalThis.confirm(m));
		this.engine = this.client.state;
		let last = this.engine;
		this.#offClient = this.client.onState((s) => {
			this.engine = s;
			// Full keyword docs need a booted engine; ask once it is ready, and again after a restart.
			if (s === 'idle' && last !== 'idle' && this.#docs === null) this.#fetchDocs();
			last = s;
		});
		if (this.engine === 'idle') this.#fetchDocs();
		const first = this.samples.find((s) => s.id === opts.initial) ?? this.samples[0];
		if (first) void this.#load(first);
	}

	/** Keyword docs for hover and the docs sheet: the table, plus the engine's once it arrives. */
	readonly docsSource = (): KeywordDocsSource => ({ table: KEYWORDS, engine: this.#docs });

	#fetchDocs(): void {
		this.client.syntax().then(
			(docs) => (this.#docs = docs),
			() => undefined,
		);
	}

	/** Opens another sample; asks first when the open plan was edited. Returns whether it opened. */
	async openSample(id: string): Promise<boolean> {
		const sample = this.samples.find((s) => s.id === id) ?? null;
		if (!sample || id === this.sampleId) return false;
		if (this.dirty && !this.#confirm(strings.topBar.confirmSwitch)) return false;
		return this.#load(sample);
	}

	async #load(sample: Sample): Promise<boolean> {
		const token = ++this.#token;
		this.phase = 'loading';
		this.loadError = null;
		this.sampleId = sample.id;
		let seed: SampleWorkspace;
		try {
			seed = await sample.load();
		} catch {
			if (token !== this.#token) return false;
			this.phase = 'failed';
			this.loadError = strings.topBar.loadFailed(sample.label);
			return false;
		}
		if (token !== this.#token) return false;
		this.#teardown();
		let ws: Workspace | null = null;
		let runner: ScheduleRunner | null = null;
		const extensions = workspaceExtensions({
			docs: this.docsSource,
			workspace: () => ws,
			index: () => runner?.state.index ?? null,
			onFormat: (o) => this.#onFormat(o),
		});
		ws = createWorkspace(seed, {
			extensions: (path, top) => [extensions(path, top), editorSetup(path)],
		});
		runner = createScheduleRunner({ workspace: ws, client: this.client });
		this.#runner = runner;
		this.#unsubscribe = [
			ws.subscribe(() => (this.dirty = true)),
			runner.subscribe((s) => (this.run = s)),
		];
		this.dirty = false;
		this.collapsed = new Set();
		this.workspace = ws;
		this.activeFile = seed.entry;
		this.reveal = null;
		this.phase = 'ready';
		return true;
	}

	#teardown(): void {
		for (const off of this.#unsubscribe) off();
		this.#unsubscribe = [];
		this.#runner?.dispose();
		this.#runner = null;
	}

	/** Shows another file of the plan in the editor. */
	openFile(path: WorkspacePath): void {
		if (this.files.includes(path)) this.activeFile = path;
	}

	/** Puts the cursor on a range of a file, opening the file and the Text panel (module comment). */
	revealRange(file: WorkspacePath, from: number, to: number): void {
		this.openFile(file);
		this.phoneTab = 'text';
		this.reveal = { file, from, to, nonce: ++this.#nonce };
	}

	/** Selects an outline node's declaration. The index may be older than the text: map it. */
	revealNode(node: OutlineNode): void {
		const ws = this.workspace;
		const version = this.run?.indexVersion;
		let changes;
		try {
			changes =
				ws && version !== undefined ? ws.changesSince(version).get(node.at.file) : undefined;
		} catch {
			changes = undefined;
		}
		const from = changes ? changes.mapPos(node.at.from, 1) : node.at.from;
		const to = changes ? changes.mapPos(node.at.to, -1) : node.at.to;
		this.revealRange(node.at.file, from, Math.max(from, to));
		this.outlineOpen = false;
	}

	toggleNode(key: string): void {
		const next = new Set(this.collapsed);
		if (!next.delete(key)) next.add(key);
		this.collapsed = next;
	}

	/** Jumps to the next error or warning in any file; false when none has a place. */
	goToNextProblem(): boolean {
		const run = this.run;
		if (!run) return false;
		const head = this.editor?.state.selection.main.head ?? 0;
		const hit = nextProblem(run.diagnostics, this.files, { file: this.activeFile, pos: head });
		if (!hit || hit.file === null) return false;
		this.revealRange(hit.file, hit.from, hit.to);
		return true;
	}

	/** Opens the docs sheet for the keyword or id at the cursor (hover does not exist on touch). */
	openDocs(): void {
		if (!this.editor) return;
		this.docsContent = docsAtCursor(this.editor.state);
		this.docsOpen = true;
	}

	/** Runs the scheduler again after a failure. */
	retry(): void {
		this.#runner?.changed('now');
	}

	#onFormat(outcome: FormatOutcome): void {
		const f = editorStrings.format;
		this.note =
			outcome.status === 'formatted'
				? f.formatted
				: outcome.status === 'unchanged'
					? f.unchanged
					: outcome.reason === 'stale'
						? f.stale
						: f.refused;
		if (this.#noteTimer !== null) clearTimeout(this.#noteTimer);
		this.#noteTimer = setTimeout(() => (this.note = null), NOTE_MS);
	}

	dispose(): void {
		this.#token++;
		this.#teardown();
		this.#offClient();
		if (this.#noteTimer !== null) clearTimeout(this.#noteTimer);
		this.client.dispose();
	}
}
