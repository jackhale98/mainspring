// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only setup for the edit dispatcher: a real workspace, history and schedule runner over the
 * fake engine client (outcomes settle only when the test says), idle tasks the test runs, an
 * in-memory preference store and a switchable Android key. Not imported by application code.
 */
import type { ScheduleResult } from '../../engine/protocol';
import { createHistory, type WorkspaceHistory } from '../workspace/history';
import { createScheduleRunner, type ScheduleRunner } from '../workspace/schedule-runner';
import { FakeEngineClient, flush } from '../workspace/testing/fake-engine-client';
import { IdleQueue } from '../workspace/testing/idle-queue';
import { createWorkspace, type Workspace, type WorkspaceSeed } from '../workspace/workspace';
import type { SourceRange } from '../tjp/edit/types';
import { FIXTURE, goldenResult, manipulation } from '../gantt/intents-testing';
import { EditDispatcher, type ActionSource, type EditDispatcherDeps } from './edits.svelte';
import type { PrefStorage } from './storage';

export const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'macro tid [t1]',
	'task ${tid} "Macro task" {',
	'  effort 1d',
	'}',
	'task b "B" {',
	'  effort 2d',
	'}',
	'task c "C" {',
	'  effort 1d',
	'}',
	'task g "G"',
	'',
].join('\n');

export function memoryStorage(): PrefStorage & { readonly map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
	};
}

export interface Harness {
	readonly ws: Workspace;
	readonly history: WorkspaceHistory;
	readonly client: FakeEngineClient;
	readonly idle: IdleQueue;
	readonly runner: ScheduleRunner;
	readonly edits: EditDispatcher;
	readonly storage: ReturnType<typeof memoryStorage>;
	readonly reveals: SourceRange[];
	/** Whether the editor holds an Android key (in every file). */
	held: boolean;
	/** The text of a file now. */
	text(path?: string): string;
	/** Types into a file, as the editor commits it. */
	type(insert: string, at?: number, path?: string): void;
	/** Delivers settled outcomes, then runs the idle tasks that show them. */
	shown(): Promise<void>;
	/** Delivers the newest open run's result (ok unless `over` says otherwise) and shows it. */
	finish(over?: Partial<ScheduleResult>): Promise<void>;
	dispose(): void;
}

export function harness(
	seed: WorkspaceSeed = { entry: 'plan.tjp', files: { 'plan.tjp': PLAN } },
	over: Partial<EditDispatcherDeps> = {},
): Harness {
	const ws = createWorkspace(seed);
	const history = createHistory(ws);
	const client = new FakeEngineClient();
	const idle = new IdleQueue();
	const runner = createScheduleRunner({
		workspace: ws,
		client,
		timers: { ...idle.timers, now: () => 0 },
	});
	const storage = memoryStorage();
	const reveals: SourceRange[] = [];
	const h: Harness = {
		ws,
		history,
		client,
		idle,
		runner,
		storage,
		reveals,
		held: false,
		edits: null as unknown as EditDispatcher,
		text: (path = seed.entry) => ws.snapshot().files.get(path)?.text.toString() ?? '',
		type: (insert, at = 0, path = seed.entry) => {
			const state = ws.state(path);
			ws.commit(path, state.update({ changes: { from: at, insert } }), 'typing');
		},
		shown: async () => {
			await flush();
			idle.run();
		},
		finish: async (o = {}) => {
			const r = client.open.at(-1);
			if (r === undefined) throw new Error('no open run');
			client.done(r, o);
			await h.shown();
		},
		dispose: () => {
			h.edits.dispose();
			runner.dispose();
			history.dispose();
		},
	};
	(h as { edits: EditDispatcher }).edits = new EditDispatcher({
		workspace: ws,
		runner,
		history,
		undo: () => history.undo(),
		keyHeld: () => h.held,
		reveal: (r) => reveals.push(r),
		storage,
		...over,
	});
	return h;
}

/**
 * A harness on the gantt-manipulation fixture, scheduled with its golden result, and the action
 * source the Gantt would pass (that result and its driving analysis).
 */
export async function manipulationHarness(): Promise<{ h: Harness; source: ActionSource }> {
	const fx = manipulation();
	const files: Record<string, string> = {};
	for (const [p, f] of fx.snap.files) files[p] = f.text.toString();
	const h = harness({ entry: fx.snap.entry, files });
	const golden = goldenResult(FIXTURE);
	const { revision: _r, ...rest } = golden;
	await h.finish(rest);
	return { h, source: { result: golden, analysis: fx.ctx().analysis } };
}
