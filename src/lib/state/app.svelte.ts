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
 * Undo (phase-2.md 6.7, ADR-0008): each workspace gets one `WorkspaceHistory`, created right
 * after it. `history` (HistoryControls) follows it for the top bar; the editor's keys and the
 * window's keys call it too. After an undo or redo the changed range is revealed (an intent's is
 * selected; typing and format keep the selection the history restored), and a change that was not
 * typing in the open file is named in the editor's note ("Undone: set effort (plan.tjp)").
 *
 * Visual edits (phase-2.md 6.8): each workspace gets one `EditDispatcher` (`edits`), created after
 * the runner and the history. Views dispatch through it (its module comment is the contract);
 * `Toasts.svelte` draws its toasts. Its Android gate asks the editor (`editorKeys`, set by the
 * editor panel) whether CodeMirror holds a key in a file the edit changes.
 *
 * Selection (phase-2.md 6.10, selection.svelte.ts): `selection` holds what is selected and where
 * the selection came from. A view selects through `selectTask(key)` and `inspector.showLink`; the
 * editor reports its cursor through `cursorMoved`. A selection that came from a visual sets
 * `sourceMark`, which the editor panel shows (highlight, scroll, cursor if it has no focus); the
 * mark is made again when the index catches up with the text. A selection that came from the text
 * clears the mark and asks the Gantt to scroll the task's row into view. Following a rename and the
 * toast's "Show" in Visual mode (the source sheet) are here too.
 *
 * Samples load in memory; nothing is stored (Phase 4). So does a plan made with "New plan…"
 * (`openNewPlan`, ADR-0013): its key is `sampleId === 'new'`, it replaces the open plan the way a
 * sample does (asking first when that was edited), and `newPlanName` is what the chooser lists it
 * as, "Name (new)".
 *
 * The editor packages are not imported here: `ensureEditor` loads them (editor-bundle.ts) when an
 * editor first mounts and then gives each workspace its editor support, so a Visual-first load
 * does not fetch them (phase-2.md 11.3).
 *
 * Keyword docs (ADR-0017): the full docs come from the engine build's static asset, which
 * `ensureEditor` starts loading once (editor-bundle.ts `engineDocsLoader`). The app never asks the
 * engine for them (`client.syntax()`), so the worker runs only schedules and "Engine: Ready" follows
 * the first result. A Visual-only session never fetches the docs.
 *
 * Over 400 lines: one class holds the app state and its derived views so the runes stay in one
 * reactive graph; splitting it would spread the effects that keep them in step.
 */
import { untrack } from 'svelte';
import type { EditorView } from '@codemirror/view';
import { createTimeZoneHost } from '../../engine/timezone';
import { createEngineClient, type EngineClient } from '../../engine/client';
import type { EngineState } from '../../engine/client';
import type { EngineDocsLoader } from '../../engine/docs-asset';
import type { EngineVersions, WorkspacePath } from '../../engine/protocol';
import { editorStrings, strings } from '../strings';
import type { FormatOutcome, HoverContent } from '../tjp/cm';
import { NEW_PLAN_ID, SAMPLES, type Sample, type SampleWorkspace } from '../workspace/samples';
import { cleanPlanName, newPlanText, type NewPlanSpec } from '../tjp/new-plan';
import {
	createScheduleRunner,
	type RunnerState,
	type ScheduleRunner,
} from '../workspace/schedule-runner';
import type { Timers } from '../workspace/run-types';
import { afterAndroidKey } from '../tjp/cm/android-key';
import { createHistory, type HistoryOutcome, type WorkspaceHistory } from '../workspace/history';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import type { PickRole } from '../inspector/depends-picker';
import { currentRange } from '../inspector/range';
import type { Minutes } from '../../engine/protocol';
import type { ResourceId, SourceRange, TaskId } from '../tjp/index';
import { nextProblem } from './diagnostics-nav';
import { EditDispatcher, renamedBy } from './edits.svelte';
import { GanttFilterState } from './gantt-filter.svelte';
import { HealthState } from './health.svelte';
import { HistoryControls } from './history-controls.svelte';
import { InspectorState } from './inspector.svelte';
import { bindHistoryKeys } from './history-keys';
import { buildOutline, EMPTY_OUTLINE, errorCounts, type OutlineNode } from './outline';
import { resourceAtCursor } from './resource-cursor';
import {
	linkPlace,
	originOf,
	placeOf,
	resourcePlace,
	SelectionState,
	taskAtCursor,
	type Place,
	type Selection,
	type SourceMark,
} from './selection.svelte';

export type { SourceMark };
import { statusView, type StatusView } from './status';
import { browserStorage } from './storage';

export type PhoneTab = 'plan' | 'gantt' | 'people' | 'text';
export type Phase = 'loading' | 'ready' | 'failed';

/** A request to put the cursor on a range of a file; `nonce` makes repeats distinct. */
export interface Reveal {
	readonly file: WorkspacePath;
	readonly from: number;
	readonly to: number;
	readonly nonce: number;
	/** Whether the editor takes the keyboard focus (not wanted when a touch keyboard would open). */
	readonly focus: boolean;
	/** False to scroll to the range and keep the selection (after an undo of typing). */
	readonly select?: boolean;
}

/** What the shell (App.svelte) tells the app about the screen. */
export interface Shell {
	/** Whether an editor is on screen (Text or Split, or a phone's Text tab). */
	editorShown(): boolean;
	/** Brings the editor on screen, then reveals the range in it. */
	showInText(at: SourceRange): void;
	/** Shows a chart view: the Gantt, the heatmap or the calendar (a phone: the tab or segment). */
	showView?(view: 'gantt' | 'workload' | 'calendar'): void;
}

/**
 * A request to show a person at a time in the heatmap (the health panel's "Open in Workload", a
 * "Why here?" link to a person's cell). The heatmap takes it when it is on screen and has a model,
 * selects the cell and opens its details, and clears it; `serial` tells one request from the next.
 */
export interface PeopleGoto {
	readonly resource: ResourceId;
	readonly at: Minutes;
	readonly serial: number;
}

export interface AppStateOptions {
	client?: EngineClient;
	samples?: readonly Sample[];
	/** Sample id to open first; default the first sample. */
	initial?: string | null;
	/** Asks before replacing edited work; default `window.confirm`. */
	confirm?: (message: string) => boolean;
	/** Where the undo and redo keys are bound outside the editor; default the window, null for none. */
	keyTarget?: EventTarget | null;
	/** The keyword docs loader; default the editor bundle's (`engineDocsLoader`), made by `ensureEditor`. */
	docs?: EngineDocsLoader;
	/** The runner's idle timers; set only by the end-to-end hook (`createIndexGate`), never in production. */
	idle?: Promise<Pick<Timers, 'requestIdle' | 'cancelIdle'>>;
}

/** How long a format message stays in the toolbar. */
const NOTE_MS = 5000;

export class AppState {
	readonly client: EngineClient;
	readonly samples: readonly Sample[];

	/** The open plan's key: a sample's id, or `new` for a plan made with "New plan…". */
	sampleId = $state('');
	/** The name of the open plan when it was made with "New plan…", else null. */
	newPlanName = $state<string | null>(null);
	/** Counts the plans made with "New plan…", so a second one resets what a plan's key keeps. */
	newPlanSerial = $state(0);
	/**
	 * When an edit last deleted the plan's last task (ms), or 0. The empty state that appears then
	 * takes the focus, which the deleted row held (EmptyState.svelte); a later one does not.
	 */
	emptiedAt = $state(0);
	/** The New plan sheet (NewPlanSheet.svelte). */
	newPlanOpen = $state(false);
	phase = $state<Phase>('loading');
	loadError = $state<string | null>(null);
	workspace = $state.raw<Workspace | null>(null);
	run = $state.raw<RunnerState | null>(null);
	engine = $state<EngineState>('booting');
	activeFile = $state<WorkspacePath>('');
	phoneTab = $state<PhoneTab>('text');
	outlineOpen = $state(false);
	docsOpen = $state(false);
	/** The phone's History sheet (long-press on Undo, or the status card's History row). */
	historyOpen = $state(false);
	/**
	 * A phone shows messages that are not edits' toasts (a refused undo) in the compact strip; the
	 * shell sets it. Elsewhere they stay in the editor's note, as before.
	 */
	compactMessages = false;
	collapsed = $state.raw<ReadonlySet<string>>(new Set());
	/** What is selected, and where it came from (selection.svelte.ts). */
	readonly selection = new SelectionState((s) => this.#onSelection(s));
	/** The selection a visual made, as it is in the text; the editor panel shows it. */
	sourceMark = $state.raw<SourceMark | null>(null);
	/** Set by the shell; without one an editor is taken to be on screen. */
	shell: Shell | null = null;
	/** The newest format message, shown briefly. */
	note = $state<string | null>(null);
	reveal = $state.raw<Reveal | null>(null);
	/** True once the open plan has been edited, so replacing it needs a confirmation. */
	dirty = $state(false);
	/** What the docs sheet shows: the documentation at the cursor when it was opened. */
	docsContent = $state.raw<HoverContent | null>(null);
	/** The editor view, set by the editor panel. Not reactive. */
	editor: EditorView | null = null;
	/** The editor's Android key guard (EditorController.keyHeld), set by the editor panel. */
	editorKeys: { keyHeld(paths: readonly WorkspacePath[]): boolean } | null = null;
	/** The open plan's edit dispatcher (edits.svelte.ts); null while a plan loads. */
	edits = $state.raw<EditDispatcher | null>(null);
	/** What the inspector shows and where (inspector.svelte.ts); the Gantt publishes its view here. */
	readonly inspector = new InspectorState(this.selection);
	/** The Gantt's filter by person and flag (gantt-filter.svelte.ts); another plan resets it. */
	readonly ganttFilter = new GanttFilterState();
	/** Plan health: the report, its settings and whether the panel is open (health.svelte.ts). */
	readonly health = new HealthState();
	/** A request to show a person at a time in the heatmap (`PeopleGoto`); null when taken. */
	peopleGoto = $state.raw<PeopleGoto | null>(null);
	#gotoSerial = 0;
	/** Undo and redo for the top bar and the keys (module comment). */
	readonly history = new HistoryControls((o, quiet) => this.#onHistory(o, quiet));

	/** The plan's files, entry first then in include order; follows the include graph. */
	files = $state.raw<readonly WorkspacePath[]>([]);
	/** The index; its identity changes only when the runner derives a new one. */
	readonly index = $derived(this.run?.index ?? null);
	readonly diagnostics = $derived(this.run?.diagnostics ?? []);
	/** The revision of the newest engine result; the editor pushes engine marks when it changes. */
	readonly engineRevision = $derived(this.run?.latest?.revision ?? null);
	readonly engineDiagnostics = $derived(this.diagnostics.filter((d) => d.source === 'engine'));
	readonly localDiagnostics = $derived(this.diagnostics.filter((d) => d.source !== 'engine'));
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
	/** The engine's versions, once it has booted (the status strip shows them). */
	engineVersions = $state.raw<EngineVersions | null>(null);
	readonly status = $derived<StatusView | null>(
		this.run ? statusView(this.run, undefined, this.engineVersions) : null,
	);

	/** Intl-backed zone data for the index: zone names and zone-dependent value checks. */
	readonly #zones = createTimeZoneHost();
	/** The zone data, for a lazy view that reads dates in the plan's zone (it need not import its own). */
	get zones(): ReturnType<typeof createTimeZoneHost> {
		return this.#zones;
	}
	#runner: ScheduleRunner | null = null;
	#editorBundle: typeof import('./editor-bundle') | null = null;
	#editorLoading: Promise<void> | null = null;
	/** The keyword docs, from the editor bundle; null until `ensureEditor` has loaded it. */
	#docs: EngineDocsLoader | null = null;
	readonly #docsOption: EngineDocsLoader | null;
	readonly #idle: AppStateOptions['idle'];
	#history: WorkspaceHistory | null = null;
	readonly #offKeys: () => void;
	#unsubscribe: Array<() => void> = [];
	#current: { ws: Workspace; runner: ScheduleRunner } | null = null;
	#nonce = 0;
	#token = 0;
	/** The selection's mark has not been shown yet (its task is not in the index yet). */
	#scrollPending = false;
	#lastIndex: unknown = null;
	/** The selection the last `#onSelection` heard (to tell a move between one person's cells). */
	#selected: Selection = null;
	readonly #offEffects: () => void;
	#noteTimer: ReturnType<typeof setTimeout> | null = null;
	readonly #confirm: (message: string) => boolean;
	readonly #offClient: () => void;

	constructor(opts: AppStateOptions = {}) {
		this.client = opts.client ?? createEngineClient();
		this.samples = opts.samples ?? SAMPLES;
		this.#confirm = opts.confirm ?? ((m) => globalThis.confirm(m));
		this.#docsOption = opts.docs ?? null;
		this.#idle = opts.idle;
		this.engine = this.client.state;
		this.#offClient = this.client.onState((s) => (this.engine = s));
		// Only the strip's text depends on it: a boot that fails shows no version, and says so elsewhere.
		this.client.ready().then(
			(v) => (this.engineVersions = v),
			() => undefined,
		);
		// The one reactive link: a moveTask in flight renames the task that is selected (6.10).
		this.#offEffects = $effect.root(() => {
			$effect(() => {
				const renames = this.edits?.pending.renames;
				if (renames && renames.size > 0) untrack(() => this.selection.followRenames(renames));
			});
		});
		const keys = opts.keyTarget === undefined ? (globalThis.window ?? null) : opts.keyTarget;
		this.#offKeys = keys ? bindHistoryKeys(keys, this.history) : () => undefined;
		const first = this.samples.find((s) => s.id === opts.initial) ?? this.samples[0];
		if (first) void this.#load(first, null);
	}

	/** The open plan's name as the chooser and the phone's header show it. */
	get planLabel(): string {
		if (this.sampleId === NEW_PLAN_ID && this.newPlanName !== null) {
			return strings.newPlan.listed(this.newPlanName);
		}
		return this.samples.find((s) => s.id === this.sampleId)?.label ?? '';
	}

	/** Opens another sample; asks first when the open plan was edited. Returns whether it opened. */
	async openSample(id: string): Promise<boolean> {
		const sample = this.samples.find((s) => s.id === id) ?? null;
		if (!sample || id === this.sampleId) return false;
		if (this.dirty && !this.#confirm(strings.topBar.confirmSwitch)) return false;
		return this.#load(sample, null);
	}

	/**
	 * Opens a new plan (the header only; `newPlanText`) in this tab with an empty history; asks
	 * first when the open plan was edited. Returns whether it opened. Inputs the sheet has not
	 * checked (`newPlanProblem`) make it return false.
	 */
	async openNewPlan(spec: NewPlanSpec): Promise<boolean> {
		let seed: SampleWorkspace;
		try {
			seed = newPlanText(spec);
		} catch {
			return false;
		}
		if (this.dirty && !this.#confirm(strings.topBar.confirmSwitch)) return false;
		const name = cleanPlanName(spec.name);
		this.newPlanSerial++;
		return this.#load({ id: NEW_PLAN_ID, label: name, load: () => Promise.resolve(seed) }, name);
	}

	async #load(sample: Sample, newName: string | null): Promise<boolean> {
		const token = ++this.#token;
		this.phase = 'loading';
		this.loadError = null;
		this.sampleId = sample.id;
		this.newPlanName = newName;
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
		const idle = await this.#idle;
		if (token !== this.#token) return false;
		this.#teardown();
		const ws = createWorkspace(seed);
		const runner = createScheduleRunner({
			workspace: ws,
			client: this.client,
			zones: this.#zones,
			...(idle && { timers: idle }),
		});
		// First subscriber, so it sees every change in order (history.ts).
		this.#history = createHistory(ws);
		this.history.attach(this.#history);
		this.#runner = runner;
		this.edits = new EditDispatcher({
			workspace: ws,
			runner,
			history: this.#history,
			undo: () => this.history.undo(),
			keyHeld: (paths) => this.editorKeys?.keyHeld(paths) ?? false,
			reveal: (r) => this.#showPlace(r),
			storage: browserStorage(),
			zones: this.#zones,
			onEmptied: () => (this.emptiedAt = Date.now()),
		});
		this.#unsubscribe = [
			ws.subscribe(() => (this.dirty = true)),
			runner.subscribe((s) => {
				this.run = s;
				this.#syncFiles(ws);
				if (s.index !== this.#lastIndex) {
					this.#lastIndex = s.index;
					this.#onIndex();
				}
			}),
		];
		this.dirty = false;
		this.collapsed = new Set();
		this.ganttFilter.clear();
		this.selection.clear();
		this.sourceMark = null;
		this.inspector.reset();
		this.#current = { ws, runner };
		this.#attachEditor();
		this.workspace = ws;
		this.#syncFiles(ws);
		this.activeFile = seed.entry;
		this.reveal = null;
		this.phase = 'ready';
		return true;
	}

	/**
	 * Loads the editor packages (once) and gives the open workspace its editor support. The editor
	 * panel calls this before it creates a view; a workspace opened later gets the support at once.
	 * Once the support is attached it starts loading the keyword docs (once; module comment).
	 */
	ensureEditor(): Promise<void> {
		this.#editorLoading ??= import('./editor-bundle').then((bundle) => {
			const docs = this.#docsOption ?? bundle.engineDocsLoader();
			this.#docs = docs;
			this.#editorBundle = bundle;
			this.#attachEditor();
			void docs.load();
		});
		return this.#editorLoading;
	}

	/** Whether the editor chunk has loaded and the open workspace has its support. */
	get editorReady(): boolean {
		return this.#editorBundle !== null;
	}

	#attachEditor(): void {
		const bundle = this.#editorBundle;
		const current = this.#current;
		const docs = this.#docs;
		if (!bundle || !current || !docs) return;
		const { ws, runner } = current;
		ws.attachEditor(
			bundle.editorSupport({
				docs,
				history: this.history,
				workspace: () => ws,
				index: () => runner.state.index ?? null,
				onFormat: (o) => this.#onFormat(o),
			}),
		);
	}

	/** Updates `files` when the include graph changed (the list keeps its identity otherwise). */
	#syncFiles(ws: Workspace | null): void {
		const order = ws ? ws.snapshot().includes.order : [];
		const same = order.length === this.files.length && order.every((p, i) => p === this.files[i]);
		if (!same) this.files = [...order];
		if (this.files.length > 0 && !this.files.includes(this.activeFile) && this.activeFile !== '') {
			this.activeFile = this.files[0] ?? this.activeFile;
		}
	}

	#teardown(): void {
		this.#current = null;
		this.edits?.dispose();
		this.edits = null;
		for (const off of this.#unsubscribe) off();
		this.#unsubscribe = [];
		this.#runner?.dispose();
		this.#runner = null;
		this.history.attach(null);
		this.#history?.dispose();
		this.#history = null;
	}

	/** Shows another file of the plan in the editor. */
	openFile(path: WorkspacePath): void {
		if (this.files.includes(path)) this.activeFile = path;
	}

	/**
	 * Puts the cursor on a range of a file, opening the file and, unless `showText` is false, the
	 * Text panel on phones (module comment).
	 */
	revealRange(
		file: WorkspacePath,
		from: number,
		to: number,
		focus = true,
		showText = true,
		select = true,
	): void {
		this.openFile(file);
		if (showText) this.phoneTab = 'text';
		this.reveal = { file, from, to, nonce: ++this.#nonce, focus, select };
	}

	/** After an undo or redo: reveal what changed, and name it unless it was typing here. */
	#onHistory(o: HistoryOutcome, quiet = false): void {
		if (o.status === 'empty') return;
		if (o.status === 'diverged') {
			this.#showNote(strings.history.diverged);
			if (this.compactMessages) this.edits?.say(strings.history.diverged, true);
			return;
		}
		const files = Object.keys(o.entry.applied.edit.changes);
		// A move (or a rename that sets the id) renames the task and its descendants: the selection
		// follows it back on undo and forward again on redo (`pending.renames` covers the edit only).
		const renamed = renamedBy(o.entry.applied.edit.intent);
		if (renamed) {
			const [from, next] = o.direction === 'undo' ? [renamed[1], renamed[0]] : renamed;
			this.selection.followRenames(new Map([[from, next]]));
		}
		const here = o.entry.kind === 'typing' && files.length === 1 && files[0] === this.activeFile;
		const r = o.reveal;
		// The keyboard focus stays where it is; a phone stays on its tab.
		if (r) this.revealRange(r.file, r.from, r.to, false, false, o.entry.kind === 'intent');
		if (here || quiet) return;
		const say = o.direction === 'undo' ? strings.history.undone : strings.history.redone;
		this.#showNote(say(o.entry.label, files.join(', ')));
	}

	/**
	 * The History sheet's "back to here": undoes `steps` entries as that many undos, after the
	 * Android gate (no file the steps change is held by a key), and says what came of it. The
	 * entries are checked again when the gate opens: if typing changed the top of the history
	 * meanwhile, nothing is undone.
	 */
	rewindHistory(steps: number): void {
		const asked = this.history.items().slice(0, steps);
		if (steps < 1 || asked.length < steps) return;
		const paths = [...new Set(asked.flatMap((i) => i.files))];
		afterAndroidKey(
			() => this.editorKeys?.keyHeld(paths) ?? false,
			() => {
				const now = this.history.items().slice(0, steps);
				if (now.length < steps || now.some((i, k) => i.id !== asked[k]?.id)) {
					this.edits?.say(strings.history.rewindChanged, true);
					return;
				}
				const r = this.history.rewind(steps);
				if (r.stopped === null) this.edits?.say(strings.history.rewound(r.undone));
				else this.edits?.say(strings.history.rewindStopped(r.undone, steps), true);
			},
		);
	}

	/** A range of the index's text in the text now: the index may be older than the text. */
	#declaration(r: SourceRange): { file: WorkspacePath; from: number; to: number } {
		const ws = this.workspace;
		const version = this.run?.indexVersion;
		return ws ? currentRange(ws, version, r) : r;
	}

	/** Shows a range of the plan (from the index) in the text, as the editor's reveal does. */
	showRange(r: SourceRange, focus = !coarsePointer()): void {
		const d = this.#declaration(r);
		this.revealRange(d.file, d.from, d.to, focus);
	}

	/** Selects an outline node's declaration. */
	revealNode(node: OutlineNode): void {
		const d = this.#declaration(node.at);
		if (node.kind === 'task') this.selection.selectTask(node.key.slice('task:'.length), 'visual');
		// A touch keyboard would cover the editor: only a keyboard or mouse user gets the focus.
		this.revealRange(d.file, d.from, d.to, !coarsePointer());
		this.outlineOpen = false;
	}

	/**
	 * Selects a task from a visual, by its outline key (`task:app.code`): the Gantt, the outline or
	 * the inspector (the visual to text half of selection sync, phase-2.md 6.10). The editor then
	 * shows its source (`sourceMark`) without taking the keyboard focus, and a phone stays on its
	 * Gantt tab. A selected link goes away.
	 */
	selectTask(key: string): void {
		if (key.startsWith('task:')) this.selection.selectTask(key.slice('task:'.length), 'visual');
	}

	/**
	 * Shows `resource` at minute `at` in the Workload view: selects the person, switches the view and
	 * asks the heatmap to select the cell and open its details (`peopleGoto`).
	 */
	openInWorkload(resource: ResourceId, at: Minutes): void {
		this.selection.selectResource(resource, 'visual');
		this.shell?.showView?.('workload');
		this.peopleGoto = { resource, at, serial: ++this.#gotoSerial };
	}

	/**
	 * What "Show in Gantt" does for a person's task (the heatmap's and the lanes' details, a health
	 * finding about a person): filters the chart to the person (gantt-filter.svelte.ts) when the
	 * filter would show the task, else drops a filter that would hide it; selects the task and shows
	 * the Gantt. The filter line over the task table names the person. The filter's rule is
	 * `tasksOfPerson`, a lazy chunk the Gantt fetches for the filter anyway. With no person (a
	 * group's cell, a link to a task, a finding's task) an active filter is left alone only when it
	 * shows the task: a selected task the chart hides is a selection nobody can see.
	 */
	async showInGantt(task: TaskId, person: ResourceId | null): Promise<void> {
		if (person !== null) {
			let shows = false;
			try {
				const { tasksOfPerson } = await import('../gantt/filter');
				shows = tasksOfPerson(this.run?.lastGood?.result ?? null, person).has(task);
			} catch {
				// The chunk could not be fetched: the task is shown without a filter.
			}
			if (shows) this.ganttFilter.showPerson(person);
			else this.ganttFilter.clear();
		} else if (await this.#filterHides(task)) {
			this.ganttFilter.clear();
		}
		this.selection.selectTask(task, 'visual');
		this.shell?.showView?.('gantt');
	}

	/** Whether the Gantt's filter, as it is now, would not show `task` (false: no filter, or unknown). */
	async #filterHides(task: TaskId): Promise<boolean> {
		const f = this.ganttFilter;
		if (!f.active) return false;
		try {
			const lib = await import('../gantt/filter');
			const result = this.run?.lastGood?.result ?? null;
			const index = this.index;
			const ws = this.workspace;
			const flags =
				f.flag !== null && index && ws
					? lib.taskFlags(
							{
								tasks: index.tasks,
								references: index.references,
								includes: ws.snapshot().includes,
							},
							result,
						)
					: new Map<string, ReadonlySet<string>>();
			const view = lib.applyFilter(this.outline.tasks, f.value, {
				flags,
				ofPerson: f.person === null ? new Set<string>() : lib.tasksOfPerson(result, f.person),
			});
			return view !== null && !view.matched.has(`task:${task}`);
		} catch {
			return false;
		}
	}

	/** Selects `task`, opens its details and asks them to show its "Why here?" (T18). */
	showWhy(task: TaskId): void {
		this.selection.selectTask(task, 'visual');
		this.inspector.askWhy(task, this.selection.serial);
	}

	/**
	 * Selects `task`, opens its details and opens the picker for a predecessor or a successor
	 * there (polish item 11; the contract is in lib/inspector/depends-picker.ts). For the Health
	 * panel's "Add predecessor…" and "Add successor…" fixes (`{ kind: 'pick' }`). Returns false,
	 * changing nothing, for a task that is unknown or text-only (its details have no links
	 * section); it does not reveal a row a collapsed container or the filter hides.
	 */
	openDependencyPicker(task: TaskId, role: PickRole): boolean {
		const sym = this.index?.tasks.get(task);
		if (!sym || sym.textOnly || sym.expandedOnly) return false;
		this.selection.selectTask(task, 'visual');
		this.inspector.askPick(task, role, this.selection.serial);
		return true;
	}

	/**
	 * The views show the empty state, with its Add task button (EmptyState.svelte), when the status
	 * says the plan is empty (empty-plan.ts), or, before the first result, when the text as it is
	 * declares no task and has no error. A plan whose tasks come from a macro, one that fails for
	 * another reason and one with a syntax error keep what they show.
	 */
	get emptyPlan(): boolean {
		if (this.phase !== 'ready') return false;
		const kind = this.status?.kind ?? null;
		if (kind === 'empty') return true;
		const run = this.run;
		if (!run || run.latest !== null || run.failure !== null) return false;
		return (
			run.indexVersion === run.version &&
			this.outline.tasks.length === 0 &&
			!this.localDiagnostics.some((d) => d.severity === 'error')
		);
	}

	/** The outline key of the selected task, or null (a link or nothing is selected). */
	get selectedTask(): string | null {
		return this.selection.taskKey;
	}

	/** The key of the row the keyboard focus returns to after the details: a link's successor's. */
	get selectedRow(): string | null {
		return this.selection.rowKey;
	}

	/**
	 * The editor's cursor is at `pos` of `file` (the user moved it or typed): selects the task
	 * there, from the text (text to visual). A cursor outside every task keeps the selection.
	 */
	cursorMoved(file: WorkspacePath, pos: number): void {
		const run = this.run;
		const ws = this.workspace;
		if (!run || !ws) return;
		const id: TaskId | null = taskAtCursor(run, ws, file, pos);
		if (id === null) {
			// A cursor inside a resource block selects that person (phase-3.md 6.7).
			const person = resourceAtCursor(run, ws, file, pos);
			if (person !== null) this.selection.selectResource(person, 'text');
			return;
		}
		if (!this.selection.selectTask(id, 'text')) return;
		this.#expandAround(id);
	}

	/** Opens the collapsed containers above a task, so that its row exists to be shown (6.10). */
	#expandAround(id: TaskId): void {
		const next = new Set(this.collapsed);
		let key = this.outline.byKey.get(`task:${id}`)?.parent ?? null;
		for (let n = 0; key !== null && n < 1000; n++) {
			next.delete(key);
			key = this.outline.byKey.get(key)?.parent ?? null;
		}
		if (next.size !== this.collapsed.size) this.collapsed = next;
	}

	/** The selection changed: show it in the editor (a visual's) or let the text's be (module comment). */
	#onSelection(s: Selection): void {
		const prev = this.#selected;
		this.#selected = s;
		// Moving between cells of one person: that person's declaration is already shown.
		if (s?.kind === 'cell' && prev?.kind === 'cell' && prev.resource === s.resource) return;
		this.#scrollPending = s !== null && originOf(s) === 'visual';
		this.#remark();
	}

	/** The index changed: show a visual's selection again at its place now, and follow the cursor. */
	#onIndex(): void {
		this.#remark();
		const ed = this.editor;
		// The cursor is the truth only while the user is in the editor and no visual selection is
		// being shown there (it would take the selection back from the visual that made it).
		const cur = this.selection.current;
		if (ed?.hasFocus && (cur === null || originOf(cur) !== 'visual')) {
			this.cursorMoved(this.activeFile, ed.state.selection.main.head);
		}
	}

	/** Where a selection's source is in the text now. */
	#placeOf(s: NonNullable<Selection>): Place | null {
		const run = this.run;
		const ws = this.workspace;
		if (!run || !ws) return null;
		if (s.kind === 'link') return linkPlace(run, ws, s);
		// A person, and the person of a cell, show their declaration; days have no place in the text.
		if (s.kind === 'resource') return resourcePlace(run, ws, s.id);
		if (s.kind === 'cell') return resourcePlace(run, ws, s.resource);
		if (s.kind === 'days') return null;
		const place = placeOf(run, ws, s.id);
		if (place) return place;
		// A declaration the index could not name (text only): the outline has its place.
		const node = this.outline.byKey.get(`task:${s.id}`);
		if (!node) return null;
		const at = this.#declaration(node.at);
		return { block: this.#declaration(node.block), at };
	}

	/** Makes `sourceMark` from a visual's selection (null for the text's, or when nothing places it). */
	#remark(): void {
		const s = this.selection.current;
		const place = s !== null && originOf(s) === 'visual' ? this.#placeOf(s) : null;
		const prev = this.sourceMark;
		if (!place) {
			if (prev !== null) this.sourceMark = null;
			return;
		}
		const scroll = this.#scrollPending;
		this.#scrollPending = false;
		const { block, at } = place;
		const same =
			prev !== null && prev.file === block.file && prev.from === block.from && prev.to === block.to;
		if (!scroll && same) return;
		// Another file is shown only when the user is not typing in the editor.
		// A person's declaration is not worth switching the editor's file while no editor is on screen.
		const quiet =
			(s?.kind === 'resource' || s?.kind === 'cell') && this.shell?.editorShown() === false;
		if (scroll && !this.editor?.hasFocus && !quiet) this.openFile(block.file);
		this.sourceMark = {
			file: block.file,
			from: block.from,
			to: block.to,
			scroll,
			cursor: { from: at.from, to: at.to },
		};
	}

	/**
	 * A toast's "Show" (phase-2.md 11.2): the place in the text where the editor is on screen, else
	 * the source sheet of the task there (Visual mode), else the editor after all.
	 */
	#showPlace(r: SourceRange): void {
		if (this.shell?.editorShown() ?? true) {
			this.revealRange(r.file, r.from, r.to, !coarsePointer());
			return;
		}
		const run = this.run;
		const ws = this.workspace;
		const id = run && ws ? taskAtCursor(run, ws, r.file, r.from) : null;
		if (id !== null) this.inspector.source = id;
		else if (this.shell) this.shell.showInText(r);
		else this.revealRange(r.file, r.from, r.to, !coarsePointer());
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
		const bundle = this.#editorBundle;
		if (!this.editor || !bundle) return;
		this.docsContent = bundle.docsAtCursor(this.editor.state);
		this.docsOpen = true;
	}

	/** Runs the scheduler again after a failure. */
	retry(): void {
		this.#runner?.changed('now');
	}

	#onFormat(outcome: FormatOutcome): void {
		const f = editorStrings.format;
		this.#showNote(
			outcome.status === 'formatted'
				? f.formatted
				: outcome.status === 'unchanged'
					? f.unchanged
					: outcome.reason === 'stale'
						? f.stale
						: f.refused,
		);
	}

	#showNote(text: string): void {
		this.note = text;
		if (this.#noteTimer !== null) clearTimeout(this.#noteTimer);
		this.#noteTimer = setTimeout(() => (this.note = null), NOTE_MS);
	}

	dispose(): void {
		this.#token++;
		this.#teardown();
		this.health.dispose();
		this.#offKeys();
		this.#offEffects();
		this.#offClient();
		if (this.#noteTimer !== null) clearTimeout(this.#noteTimer);
		this.client.dispose();
	}
}

/** A touch screen: the editor does not take the focus (a touch keyboard would cover it). */
function coarsePointer(): boolean {
	return globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
}
