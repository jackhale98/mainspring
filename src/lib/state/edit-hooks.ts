// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A hook for end-to-end tests to dispatch a Gantt action through the real dispatcher before the
 * Gantt has gestures (T16): `/app?hooks=edits` installs `window.__mainspringEdits`. It only calls
 * the public dispatcher, as a gesture will, so it can do nothing the user cannot do with the text;
 * the rest only reads (the text, and a task's end in the shown schedule). Without the parameter
 * nothing is installed.
 */
import type { GanttAction } from '../gantt/intents';
import { finishScenario } from '../schedule/finish';
import type { Workspace } from '../workspace/workspace';
import type { DispatchOutcome, EditDispatcher, Settlement } from './edits.svelte';
import type { RunnerState } from '../workspace/run-types';

export const EDIT_HOOKS_PARAM = 'hooks';
export const EDIT_HOOKS_KEY = '__mainspringEdits';

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
}

interface Source {
	readonly edits: EditDispatcher | null;
	readonly run: RunnerState | null;
	readonly workspace: Workspace | null;
}

/** Installs the hook on `target` when `params` asks for it; returns the uninstall. */
export function installEditHooks(
	app: Source,
	params: URLSearchParams,
	target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): () => void {
	if (params.get(EDIT_HOOKS_PARAM) !== 'edits') return () => undefined;
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
	};
	target[EDIT_HOOKS_KEY] = hooks;
	return () => {
		if (target[EDIT_HOOKS_KEY] === hooks) delete target[EDIT_HOOKS_KEY];
	};
}
