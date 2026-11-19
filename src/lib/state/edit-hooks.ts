// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A hook for end-to-end tests: `/app?hooks=edits` installs `window.__mainspringEdits`, which reads
 * the text, a task's end in the shown schedule and the newest result's revision. Its `action` calls
 * the public dispatcher, as a gesture does, so it can do nothing the user cannot do with the text
 * (the gestures themselves are tested with real pointer input; this stays for what they cannot
 * reach, such as an action with no gesture yet). `hooks=edits,gantt` also installs the Gantt's
 * geometry hook (components/gantt/test-hook.ts). Without the parameter nothing is installed.
 */
import type { GanttAction } from '../gantt/intents';
import { finishScenario } from '../schedule/finish';
import type { Workspace } from '../workspace/workspace';
import type { DispatchOutcome, EditDispatcher, Settlement } from './edits.svelte';
import type { RunnerState, Timers } from '../workspace/run-types';

export const EDIT_HOOKS_PARAM = 'hooks';
export const EDIT_HOOKS_KEY = '__mainspringEdits';

export interface IndexGate {
	/** The runner's idle timers: they queue while held, else they are the platform's. */
	readonly timers: Pick<Timers, 'requestIdle' | 'cancelIdle'>;
	hold(): void;
	release(): void;
}

/**
 * For `?hooks=edits` only (this module is fetched only then, so production builds the runner with its own timers):
 * idle tasks (the index and its checks, run-types.ts) wait while held, so a test sees the index lag
 * the text for as long as it likes. `ensureIndex` does not use them and stays current.
 */
export function createIndexGate(): IndexGate {
	type Entry = { fn: () => void; ms: number; h?: unknown };
	const ric = typeof requestIdleCallback === 'function';
	const queue = new Set<Entry>();
	let held = false;
	const start = (e: Entry) => {
		e.h = ric ? requestIdleCallback(e.fn, { timeout: e.ms }) : setTimeout(e.fn, 0);
	};
	return {
		timers: {
			requestIdle(fn, ms) {
				const e: Entry = { fn, ms };
				if (held) queue.add(e);
				else start(e);
				return e;
			},
			cancelIdle(h) {
				const e = h as Entry;
				queue.delete(e);
				if (e.h !== undefined) (ric ? cancelIdleCallback : clearTimeout)(e.h as number);
			},
		},
		hold: () => void (held = true),
		release() {
			held = false;
			for (const e of queue) start(e);
			queue.clear();
		},
	};
}

/** The one gate of the page; the app builds its runner on it and the hook holds it. */
export const indexGate = createIndexGate();

/** What the hook gives back: the outcome without its promise, so a test page can return it. */
export type HookOutcome = Omit<DispatchOutcome, 'settled' | 'edit'> & { readonly status: string };

export interface EditHooks {
	/** Dispatches with the newest good result as the source (no driving analysis). */
	action(a: GanttAction): Promise<HookOutcome>;
	/** The settlement of the last applied edit, once it has settled. */
	settled: Settlement | null;
	/** A file's text now (default the entry). */
	text(path?: string): string | null;
	/** A task's end in the newest good result (minutes since the project start). */
	end(task: string): number | null;
	/** The newest good result's revision. */
	revision(): number | null;
	/** What the app has selected (selection.svelte.ts), or null. */
	selection(): unknown;
	/** The index stops following the text (the runner's idle tasks wait) until `releaseIndex`. */
	holdIndex(): void;
	releaseIndex(): void;
}

interface Source {
	readonly edits: EditDispatcher | null;
	readonly run: RunnerState | null;
	readonly workspace: Workspace | null;
	readonly selection?: { readonly current: unknown };
}

/** Installs the hook on `target` when `params` asks for it; returns the uninstall. */
export function installEditHooks(
	app: Source,
	params: URLSearchParams,
	target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
	gate: IndexGate | null = null,
): () => void {
	// `?hooks=edits`, or a list with it (`edits,gantt`: the Gantt's geometry hook is another).
	const asked = (params.get(EDIT_HOOKS_PARAM) ?? '').split(',').map((x) => x.trim());
	if (!asked.includes('edits')) return () => undefined;
	const hooks: EditHooks = {
		settled: null,
		async action(a) {
			const edits = app.edits;
			if (!edits) return { status: 'cancelled' };
			const result = app.run?.lastGood?.result ?? null;
			const o = await edits.dispatchAction(a, { result, analysis: null });
			if (o.status !== 'applied') return o;
			hooks.settled = null;
			void o.settled.then((s) => (hooks.settled = s));
			const { settled: _s, edit: _e, ...rest } = o;
			return rest;
		},
		text(path) {
			const snap = app.workspace?.snapshot();
			return snap?.files.get(path ?? snap.entry)?.text.toString() ?? null;
		},
		end(task) {
			const r = app.run?.lastGood?.result;
			const scenario = r ? finishScenario(r) : null;
			const t = r?.tasks.find((x) => x.id === task);
			return (scenario === null ? null : t?.scenarios[scenario]?.end) ?? null;
		},
		revision: () => app.run?.lastGood?.revision ?? null,
		selection: () => app.selection?.current ?? null,
		holdIndex: () => gate?.hold(),
		releaseIndex: () => gate?.release(),
	};
	target[EDIT_HOOKS_KEY] = hooks;
	return () => {
		if (target[EDIT_HOOKS_KEY] === hooks) delete target[EDIT_HOOKS_KEY];
	};
}
