// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Add task (+) control's whole action (phase-3.md 9.8; ADR-0013): one `addTask` edit through
 * the dispatcher (the Gantt's actor, or `app.edits.dispatch` on the phone's Plan tab, where no
 * Gantt is mounted; either way the toast and the undo step are the row menu's own), then,
 * once the result that includes it is in, select the new task and open the details with its name
 * focused and selected, ready to type. The name is committed by the inspector's `renameTask`: a
 * second undo step (18.11 e). A refusal or a no-op has already been shown by the dispatcher.
 * Nothing here changes the plan itself.
 *
 * - The place is worked out by the dispatcher on the text now (`addTaskPlan`); the flow only
 *   names the anchor, from the selected key (`task:<id>`, also when the outline does not have the
 *   key yet: the dispatcher decides whether it is gone), and says no place for a row with no id.
 * - The new task is named from the applied edit (the header text its `select` range covers), never
 *   by comparing the outline with an earlier snapshot: the outline lags the text (a task typed a
 *   moment before, a drag still pending).
 * - One flow runs at a time (a second press meanwhile is ignored), and it gives up quietly when
 *   the open plan is no longer the one it started in.
 */
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import { addSpot, newTaskKeyFromHeader, type AddMode } from '../../lib/gantt/add-task';
import { rootsOf } from '../../lib/gantt/reorder';
import type { AppState } from '../../lib/state/app.svelte';
import type { OutlineNode } from '../../lib/state/outline';
import type { TaskId } from '../../lib/tjp/index';
import type { TjpEdit } from '../../lib/tjp/edit/types';
import { gestureStrings } from '../../lib/strings';

/** What the flow reads from the app, live. */
export interface AddFlowApp {
	readonly outline: {
		readonly byKey: ReadonlyMap<string, OutlineNode>;
		readonly tasks: readonly OutlineNode[];
	};
	readonly selectedTask: string | null;
	selectTask(key: string): void;
	readonly inspector: { focusName(): void };
}

export interface AddFlowEnv {
	readonly app: AddFlowApp;
	/** The open plan (its dispatcher): the flow gives up when this is no longer the same one. */
	plan(): unknown;
	/**
	 * Sends the add through the dispatcher as `addTaskPlan(anchor, mode, name)`: the place is worked
	 * out on the text now (ADR-0018), not on the outline the flow read.
	 */
	add(a: { anchor: TaskId | null; mode: AddMode; name: string }): Promise<DispatchOutcome>;
	/** The text of the edit's new task header, as the text is right after the edit. */
	headerOf(edit: TjpEdit): string | null;
	/** Scrolls the new task's row into view, once it has one. */
	reveal(key: string): void;
	/**
	 * Puts the details' host on screen for the new task (the Plan tab goes to the Gantt tab). False:
	 * the person went elsewhere meanwhile, so nothing more is done.
	 */
	show?: (key: string) => Promise<boolean>;
	/** Waits before looking again for the new node (the index follows the text a moment later). */
	pause?: () => Promise<void>;
}

/** The header text of an applied edit, from the workspace as it is right after the edit. */
export function headerAfter(app: Pick<AppState, 'workspace'>, edit: TjpEdit): string | null {
	const at = edit.select;
	if (!at) return null;
	return app.workspace?.snapshot().files.get(at.file)?.text.sliceString(at.from, at.to) ?? null;
}

const LOOKS = 20;
const defaultPause = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
let running = false;

/** Whether a flow is running now (the controls show it). */
export const addTaskRunning = (): boolean => running;

/** Adds a task as `mode` says; the key of the new task once it is selected, else null. */
export async function addTaskFlow(env: AddFlowEnv, mode: AddMode): Promise<string | null> {
	if (running) return null;
	running = true;
	try {
		return await run(env, mode);
	} finally {
		running = false;
	}
}

async function run(env: AddFlowEnv, mode: AddMode): Promise<string | null> {
	const app = env.app;
	const plan = env.plan();
	const sel = app.selectedTask;
	const node = sel === null ? undefined : app.outline.byKey.get(sel);
	// The anchor is the selected task, never a guess: a row with no id has no place, and a key the
	// outline lacks (renamed or typed while the index lags) is the dispatcher's to resolve.
	const id = node ? node.id : (sel?.match(/^task:(?!unresolved:)(.+)$/)?.[1] ?? null);
	if (sel !== null ? id === null : mode === 'subtask') return null;
	// The shown tree can say there is no place at all (a subtask of a task with no id).
	if (
		node &&
		!addSpot(
			app.outline.byKey,
			rootsOf(
				app.outline.byKey,
				app.outline.tasks.map((n) => n.key),
			),
			sel,
			mode,
		)
	) {
		return null;
	}
	const anchor = id;
	const o = await env.add({ anchor, mode, name: gestureStrings.row.newTask });
	if (o.status !== 'applied' || env.plan() !== plan) return null;
	const header = env.headerOf(o.edit);
	// The new task's key is named from the edit as it was made: its parent is the edit's, which
	// the dispatcher worked out on the text now (not `spot`, from the outline that can lag it).
	const made = o.edit.intent;
	const key =
		header === null || made.type !== 'addTask' ? null : newTaskKeyFromHeader(header, made.parent);
	if (key === null) return null;
	// The details need the task in the schedule's model: wait for the result that includes the edit.
	const s = await o.settled;
	if (s.status === 'undone' || s.status === 'dropped' || s.status === 'failed') return null;
	const pause = env.pause ?? defaultPause;
	for (let i = 0; i < LOOKS; i++) {
		if (env.plan() !== plan) return null;
		if (app.outline.byKey.has(key)) {
			if (env.show && !(await env.show(key))) return null;
			if (env.plan() !== plan) return null;
			app.selectTask(key);
			env.reveal(key);
			app.inspector.focusName();
			return key;
		}
		await pause();
	}
	return null;
}
