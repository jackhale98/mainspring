// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Add task (+) control's whole action (phase-3.md 9.8; ADR-0013): one `addTask` edit through
 * the dispatcher (the Gantt's actor, or `app.edits.dispatch` on the phone's Plan tab, where no
 * Gantt is mounted; either way the toast and the undo step are the row menu's own), then,
 * once the result that includes it is in, select the new task and open the details with its name
 * focused and selected, ready to type. The name is committed by the inspector's `renameTask`: a
 * second undo step (18.11 e). A refusal or a no-op has already been shown by the dispatcher.
 * Nothing here changes the plan itself.
 */
import type { DispatchOutcome } from '../../lib/state/edits.svelte';
import { addSpot, newTaskKey, type AddMode } from '../../lib/gantt/add-task';
import { rootsOf } from '../../lib/gantt/reorder';
import type { OutlineNode } from '../../lib/state/outline';
import { gestureStrings } from '../../lib/strings';

/** What the flow reads from the app, live. */
export interface AddFlowApp {
	readonly outline: {
		readonly tasks: readonly OutlineNode[];
		readonly byKey: ReadonlyMap<string, OutlineNode>;
	};
	readonly selectedTask: string | null;
	selectTask(key: string): void;
	readonly inspector: { focusName(): void };
}

export interface AddFlowEnv {
	readonly app: AddFlowApp;
	/** Sends the `addTask` edit through the dispatcher. */
	add(at: { parent: string | null; index: number; name: string }): Promise<DispatchOutcome>;
	/** Scrolls the new task's row into view, once it has one. */
	reveal(key: string): void;
	/** Puts the details' host on screen for the new task (the Plan tab goes to the Gantt tab). */
	show?: (key: string) => Promise<void>;
	/** Waits before looking again for the new node (the index follows the text a moment later). */
	pause?: () => Promise<void>;
}

const LOOKS = 20;
const defaultPause = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

/** Adds a task as `mode` says; the key of the new task once it is selected, else null. */
export async function addTaskFlow(env: AddFlowEnv, mode: AddMode): Promise<string | null> {
	const app = env.app;
	const order = app.outline.tasks.map((n) => n.key);
	const spot = addSpot(
		app.outline.byKey,
		rootsOf(app.outline.byKey, order),
		app.selectedTask,
		mode,
	);
	if (!spot) return null;
	const before = new Set(order);
	const o = await env.add({
		parent: spot.parent,
		index: spot.index,
		name: gestureStrings.row.newTask,
	});
	if (o.status !== 'applied') return null;
	// The details need the task in the schedule's model: wait for the result that includes the edit.
	const s = await o.settled;
	if (s.status === 'undone' || s.status === 'dropped' || s.status === 'failed') return null;
	const pause = env.pause ?? defaultPause;
	for (let i = 0; i < LOOKS; i++) {
		const key = newTaskKey(before, app.outline.tasks, spot.parentKey);
		if (key !== null) {
			app.selectTask(key);
			env.reveal(key);
			await env.show?.(key);
			app.inspector.focusName();
			return key;
		}
		await pause();
	}
	return null;
}
