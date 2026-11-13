// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The schedule runner's derived state (run-view.ts) and the steps that bring it up to date
 * (phase-2.md 6.9). The runner (schedule-runner.ts) decides when steps run: in idle tasks, a few
 * at a time; this module decides which step is next and keeps each one small.
 *
 * Steps, in this order of priority:
 * 1. **Show a result** (the oldest waiting one): its engine diagnostics placed in the snapshot it
 *    was sent from, refined by ids with an index of that snapshot, then mapped to the text now.
 *    It waits for that index when the messages need one and none is at hand: the index step
 *    builds it when the text is unchanged since the run, else a step of its own does.
 * 2. **Scan one file** whose per-file facts (the index's expensive part, cached by file version)
 *    are not yet known, then **link the index** of the text now with the newest hints.
 * 3. **Check values and attributes** with that index.
 * Steps 2 and 3 follow the text; the runner holds them back while typing goes on (`follow`).
 *
 * A step that changes the view returns it; the runner publishes after each such step, so the
 * listeners' own work (the outline, the Gantt model, the editor's marks) lands in separate tasks.
 *
 * Errors: a step that throws reports the error (report.ts) and keeps the previous view; the step
 * is not tried again for the same input (version and hint base), so a broken derive cannot spin.
 * A result is shown even when its diagnostics could not be derived.
 */
import type { Revision, ScheduleResult } from '../../engine/protocol';
import { report } from '../report';
import { engineDiagnostics, type TjpDiagnostic } from '../tjp/diagnostics';
import type { TjpFile } from '../tjp/document';
import { buildIndex, NO_HINTS, type EngineHints, type SymbolIndex } from '../tjp/index';
import { factsOf } from '../tjp/index/build';
import type { ZoneOffsets } from '../tjp/values';
import {
	checksOf,
	checksOfView,
	composeView,
	fullView,
	isHintSource,
	prepareIndex,
	quickView,
	sameHints,
	sentHints,
	type DiagnosticBase,
	type HintBase,
	type Prepared,
	type View,
} from './run-view';
import type { Workspace, WorkspaceSnapshot } from './workspace';

/** A run as it was sent. */
export interface Sent {
	readonly revision: Revision;
	readonly snapshot: WorkspaceSnapshot;
	/** `Timers.now()` when it was sent. */
	readonly at: number;
}

/** A result that arrived and waits to be shown. */
export interface Arrival {
	readonly sent: Sent;
	readonly result: ScheduleResult;
	readonly latest: boolean;
	/** `Timers.now()` when it arrived. */
	readonly at: number;
}

/** What showing a result produced, for the runner's record of it. */
export interface Shown {
	readonly arrival: Arrival;
	/** Engine diagnostics in the texts that were sent. */
	readonly diagnostics: readonly TjpDiagnostic[];
	/** Engine hints in the lines that were sent. */
	readonly hints: EngineHints;
	/** Main-thread time spent on derive steps while it waited. */
	readonly processMs: number;
	/** The longest task among them (steps of one task added up). */
	readonly longestTaskMs: number;
}

export type StepOutcome =
	/** Work that changed nothing shown (a file scan, an index of the sent text). */
	| { readonly kind: 'work' }
	/** The view changed: an index linked, or checks computed. */
	| { readonly kind: 'view' }
	| { readonly kind: 'shown'; readonly shown: Shown };

interface Waiting {
	readonly arrival: Arrival;
	/** undefined until the result's hints were read; null when it names no ids. */
	hints: EngineHints | null | undefined;
	/** Whether its engine messages need an index of the sent text to be refined by id. */
	refines: boolean;
	sentIndex: Prepared | null;
	sentIndexFailed: boolean;
	spentMs: number;
	longestTaskMs: number;
}

export class Deriver {
	readonly #ws: Workspace;
	readonly #zones: ZoneOffsets | undefined;
	readonly #now: () => number;
	#view: View;
	#hintBase: HintBase | null = null;
	#diagnosticBase: DiagnosticBase | null = null;
	/** The hint base the view's index part was linked with. */
	#indexBase: HintBase | null = null;
	/** An index of the text now that `ensureIndex` built and the view does not have yet. */
	#prepared: { part: Prepared; base: HintBase | null } | null = null;
	readonly #scanned = new WeakSet<TjpFile>();
	readonly #waiting: Waiting[] = [];
	#indexFailed: { version: number; base: HintBase | null } | null = null;
	/** The index the view's checks were computed with. */
	#checksIndex: SymbolIndex;
	#checksFailed: SymbolIndex | null = null;
	#taskStart = 0;
	#stepStart = 0;

	constructor(ws: Workspace, zones: ZoneOffsets | undefined, now: () => number) {
		this.#ws = ws;
		this.#zones = zones;
		this.#now = now;
		const snap = ws.snapshot();
		this.#view = fullView(ws, snap, null, null, undefined, zones);
		this.#checksIndex = this.#view.index;
		this.#scannedAll(snap);
	}

	get view(): View {
		return this.#view;
	}

	/** Whether the view's index is of the text now, with the newest hints. */
	get indexCurrent(): boolean {
		return (
			this.#view.indexVersion === this.#ws.snapshot().version && this.#indexBase === this.#hintBase
		);
	}

	/** Results that arrived and are not shown yet. */
	get waiting(): number {
		return this.#waiting.length;
	}

	/** A keystroke: diagnostics follow the text now; the index part and checks wait. */
	typed(): void {
		this.#guard(() => {
			this.#view = quickView(this.#ws, this.#ws.snapshot(), this.#view, this.#diagnosticBase);
		});
	}

	accept(arrival: Arrival): void {
		this.#waiting.push({
			arrival,
			hints: undefined,
			refines: false,
			sentIndex: null,
			sentIndexFailed: false,
			spentMs: 0,
			longestTaskMs: 0,
		});
	}

	/** Whether `step(follow)` has anything to do. */
	due(follow: boolean): boolean {
		if (this.#waiting.length > 0) return true;
		if (!follow) return false;
		return this.#indexBehind(this.#ws.snapshot()) || this.#checksBehind();
	}

	/** The index of the text now (run-types.ts, `ScheduleRunner.ensureIndex`). */
	ensureIndex(): SymbolIndex {
		for (const w of this.#waiting) this.#readHints(w);
		const now = this.#ws.snapshot();
		if (this.#view.indexVersion === now.version && this.#indexBase === this.#hintBase) {
			return this.#view.index;
		}
		const p = this.#prepared;
		if (p && p.part.indexVersion === now.version && p.base === this.#hintBase) return p.part.index;
		const part = prepareIndex(this.#ws, now, this.#hintBase, this.#view, this.#zones);
		this.#prepared = { part, base: this.#hintBase };
		this.#scannedAll(now);
		return part.index;
	}

	/** Marks the start of a runner task, for the task lengths in the timings. */
	beginTask(): void {
		this.#taskStart = this.#now();
	}

	/** Marks its end. */
	endTask(): void {
		const ms = this.#now() - this.#taskStart;
		for (const w of this.#waiting) w.longestTaskMs = Math.max(w.longestTaskMs, ms);
	}

	/** Takes the next step (module comment); null when nothing is due. */
	step(follow: boolean): StepOutcome | null {
		this.#stepStart = this.#now();
		let out: StepOutcome | null;
		try {
			out = this.#next(follow);
		} catch (error) {
			report(error);
			out = this.#recover();
		}
		const ms = this.#now() - this.#stepStart;
		for (const w of this.#waiting) w.spentMs += ms;
		return out;
	}

	/** After an unexpected exception: show the waiting result as it is, or stop following. */
	#recover(): StepOutcome | null {
		const now = this.#ws.snapshot();
		const w = this.#waiting[0];
		if (w) {
			w.refines = false;
			return this.#show(w, now);
		}
		this.#indexFailed = { version: now.version, base: this.#hintBase };
		this.#checksFailed = this.#view.index;
		return null;
	}

	#next(follow: boolean): StepOutcome | null {
		const now = this.#ws.snapshot();
		const w = this.#waiting[0];
		if (w) {
			this.#readHints(w);
			if (this.#placeable(w)) return this.#show(w, now);
			if (w.arrival.sent.snapshot.version === now.version && this.#indexBehind(now)) {
				return this.#indexStep(now);
			}
			this.#buildSentIndex(w);
			return { kind: 'work' };
		}
		if (!follow) return null;
		if (this.#indexBehind(now)) return this.#indexStep(now);
		if (this.#checksBehind()) return this.#checksStep(now);
		return null;
	}

	#indexBehind(now: WorkspaceSnapshot): boolean {
		const v = this.#view;
		if (v.indexVersion === now.version && this.#indexBase === this.#hintBase) return false;
		const f = this.#indexFailed;
		return !f || f.version !== now.version || f.base !== this.#hintBase;
	}

	#checksBehind(): boolean {
		const index = this.#view.index;
		return index !== this.#checksIndex && index !== this.#checksFailed;
	}

	/** Scans one file the index of `now` needs, or links the index when all are scanned. */
	#indexStep(now: WorkspaceSnapshot): StepOutcome {
		const prepared = this.#prepared;
		const ready =
			prepared && prepared.part.indexVersion === now.version && prepared.base === this.#hintBase;
		if (!ready) {
			for (const path of now.includes.order) {
				const file = now.files.get(path);
				if (!file || this.#scanned.has(file)) continue;
				this.#scanned.add(file);
				this.#guard(() => factsOf(file));
				return { kind: 'work' };
			}
		}
		const base = this.#hintBase;
		let changed = false;
		const ok = this.#guard(() => {
			const v = this.#view;
			const part = ready ? prepared.part : prepareIndex(this.#ws, now, base, v, this.#zones);
			// An index equal to the view's (same version, same hints) changes nothing shown.
			if (part === v) return;
			this.#view = composeView(this.#ws, now, part, checksOfView(v), this.#diagnosticBase);
			changed = true;
		});
		this.#prepared = null;
		if (ok) {
			this.#indexBase = base;
			this.#scannedAll(now);
		} else {
			this.#indexFailed = { version: now.version, base };
		}
		return { kind: changed ? 'view' : 'work' };
	}

	#checksStep(now: WorkspaceSnapshot): StepOutcome {
		const v = this.#view;
		const ok = this.#guard(() => {
			this.#view = composeView(this.#ws, now, v, checksOf(v), this.#diagnosticBase);
		});
		if (ok) this.#checksIndex = v.index;
		else this.#checksFailed = v.index;
		return { kind: ok ? 'view' : 'work' };
	}

	/** Reads a result's hints once; a result that names ids becomes the hint base. */
	#readHints(w: Waiting): void {
		if (w.hints !== undefined) return;
		const { result, sent } = w.arrival;
		w.hints = null;
		this.#guard(() => {
			if (!isHintSource(result)) return;
			const hints = sentHints(result, sent.snapshot);
			w.hints = hints;
			this.#hintBase = { snapshot: sent.snapshot, result, hints };
		});
		this.#guard(() => {
			w.refines = result.messages.some((m) => m.level !== 'debug');
		});
	}

	/** An index of the sent snapshot with the result's hints (any, for a result without). */
	#sentIndex(w: Waiting): SymbolIndex | null {
		const version = w.arrival.sent.snapshot.version;
		const p = this.#prepared?.part;
		for (const c of [this.#view, p, w.sentIndex]) {
			if (!c || c.indexVersion !== version) continue;
			if (!w.hints || sameHints(c.hints, w.hints)) return c.index;
		}
		return null;
	}

	#placeable(w: Waiting): boolean {
		return !w.refines || w.sentIndexFailed || this.#sentIndex(w) !== null;
	}

	#buildSentIndex(w: Waiting): void {
		const snapshot = w.arrival.sent.snapshot;
		const hints = w.hints ?? NO_HINTS;
		const ok = this.#guard(() => {
			const options = this.#zones === undefined ? {} : { zones: this.#zones };
			const index = buildIndex(snapshot, hints, options);
			w.sentIndex = { indexVersion: snapshot.version, snapshot, hints, index };
		});
		if (!ok) w.sentIndexFailed = true;
	}

	#show(w: Waiting, now: WorkspaceSnapshot): StepOutcome {
		this.#waiting.shift();
		const { result, sent } = w.arrival;
		let diagnostics: readonly TjpDiagnostic[] = [];
		this.#guard(() => {
			const index = w.refines ? this.#sentIndex(w) : null;
			diagnostics = engineDiagnostics(result, sent.snapshot, index);
			this.#diagnosticBase = { snapshot: sent.snapshot, diagnostics };
			const v = this.#view;
			this.#view = composeView(this.#ws, now, v, checksOfView(v), this.#diagnosticBase);
		});
		const t = this.#now();
		return {
			kind: 'shown',
			shown: {
				arrival: w.arrival,
				diagnostics,
				hints: w.hints ?? NO_HINTS,
				processMs: w.spentMs + (t - this.#stepStart),
				longestTaskMs: Math.max(w.longestTaskMs, t - this.#taskStart),
			},
		};
	}

	/** Every file of `now` has known facts (an index of it was just built). */
	#scannedAll(now: WorkspaceSnapshot): void {
		for (const file of now.files.values()) this.#scanned.add(file);
	}

	/** Runs `fn`; on an exception reports it and returns false (module comment). */
	#guard(fn: () => void): boolean {
		try {
			fn();
			return true;
		} catch (error) {
			report(error);
			return false;
		}
	}
}
