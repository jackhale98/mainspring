// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Task tree intents (phase-1.md 6.5, 7.1): `addTask`, `deleteTask` and `moveTask` with reference
 * fixing. The plans live in task-tree-plan.ts (registered in apply.ts `HANDLERS`); these are the
 * spec's thin wrappers that build the intent and call `applyIntent`.
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { SymbolIndex } from '../index';
import { applyIntent } from './apply';
import type { AttrValue, EditOptions, EditResult, IntentOf, TaskAttr, TaskId } from './types';

export { TASK_TREE_HANDLERS } from './task-tree-plan';

export function addTask(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	parent: TaskId | null,
	at: number,
	id: string | undefined,
	name: string,
	attrs?: ReadonlyArray<readonly [TaskAttr, AttrValue]>,
	opts?: EditOptions,
): EditResult {
	const intent: IntentOf<'addTask'> = {
		type: 'addTask',
		parent,
		index: at,
		name,
		...(id === undefined ? {} : { id }),
		...(attrs === undefined ? {} : { attrs }),
	};
	return applyIntent(ws, index, intent, opts);
}

export function deleteTask(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'deleteTask', task }, opts);
}

export function moveTask(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	parent: TaskId | null,
	at: number,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'moveTask', task, parent, index: at }, opts);
}
