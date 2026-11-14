// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The undo and redo controls for the top bar (phase-2.md 6.7): reactive `canUndo`, `canRedo`
 * and tooltip labels ("Undo: set effort"), and `undo()` / `redo()`, which the keys call too.
 * `AppState.history` holds one; it follows the open workspace's `WorkspaceHistory` (`attach`).
 *
 * A top bar button is:
 *
 *   <button disabled={!app.history.canUndo} title={app.history.undoLabel}
 *     onclick={() => app.history.undo()}>
 *
 * Code outside Svelte can `subscribe` instead of reading the runes.
 */
import { historyStrings } from '../strings';
import type {
	HistoryItem,
	HistoryOutcome,
	RewindOutcome,
	WorkspaceHistory,
} from '../workspace/history';
import type { HistoryCommands } from './history-keys';

export class HistoryControls implements HistoryCommands {
	canUndo = $state(false);
	canRedo = $state(false);
	/** "Undo: set effort", or "Nothing to undo". */
	undoLabel = $state<string>(historyStrings.nothingToUndo);
	redoLabel = $state<string>(historyStrings.nothingToRedo);

	#history: WorkspaceHistory | null = null;
	#off: (() => void) | null = null;
	readonly #listeners = new Set<(c: HistoryControls) => void>();
	readonly #onOutcome: (o: HistoryOutcome, quiet?: boolean) => void;

	/**
	 * `onOutcome` hears every undo and redo (the app reveals the range and says what changed); it
	 * is `quiet` for the steps of a `rewind`, which the caller names as a whole.
	 */
	constructor(onOutcome: (o: HistoryOutcome, quiet?: boolean) => void = () => undefined) {
		this.#onOutcome = onOutcome;
	}

	/** Follows another workspace's history, or none. */
	attach(history: WorkspaceHistory | null): void {
		this.#off?.();
		this.#off = null;
		this.#history = history;
		if (history) this.#off = history.subscribe(() => this.#sync());
		this.#sync();
	}

	undo(): boolean {
		return this.#run((h) => h.undo());
	}

	redo(): boolean {
		return this.#run((h) => h.redo());
	}

	/** The undo stack for the History sheet, newest first (read when the sheet opens). */
	items(): readonly HistoryItem[] {
		return this.#history?.undoItems() ?? [];
	}

	/**
	 * Undoes `steps` entries (the History sheet's "back to here"), each through the history's own
	 * undo, so redo steps forward again. Every step that is done reveals and follows as an undo
	 * does, but quietly; the caller says what happened as a whole. A refusal stops it.
	 */
	rewind(steps: number): RewindOutcome {
		const h = this.#history;
		if (!h) return { requested: steps, undone: 0, done: [], stopped: 'empty' };
		const r = h.rewind(steps);
		for (const o of r.done) this.#onOutcome(o, true);
		return r;
	}

	/** Calls `l` whenever the state above changes; returns the unsubscribe. */
	subscribe(l: (c: HistoryControls) => void): () => void {
		this.#listeners.add(l);
		return () => {
			this.#listeners.delete(l);
		};
	}

	#run(f: (h: WorkspaceHistory) => HistoryOutcome): boolean {
		const h = this.#history;
		if (!h) return false;
		const outcome = f(h);
		this.#onOutcome(outcome);
		return outcome.status === 'done';
	}

	#sync(): void {
		const h = this.#history;
		const top = h?.top() ?? null;
		const next = h?.redoTop() ?? null;
		this.canUndo = top !== null;
		this.canRedo = next !== null;
		this.undoLabel = top ? historyStrings.undoWhat(top.label) : historyStrings.nothingToUndo;
		this.redoLabel = next ? historyStrings.redoWhat(next.label) : historyStrings.nothingToRedo;
		for (const l of [...this.#listeners]) l(this);
	}
}
