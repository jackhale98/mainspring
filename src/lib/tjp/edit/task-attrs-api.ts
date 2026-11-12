// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plan's function names for the task attribute intents (phase-1.md 6.5): thin wrappers that
 * build the `EditIntent` and run `applyIntent`. Kept apart from task-attrs.ts, whose handlers
 * apply.ts imports, so the modules do not import each other.
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { SymbolIndex } from '../index';
import { applyIntent } from './apply';
import type { AttrValue, EditOptions, EditResult, TaskAttr, TaskId } from './types';

export function setAttr(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	attr: TaskAttr,
	value: AttrValue,
	opts: EditOptions = {},
): EditResult {
	return applyIntent(ws, index, { type: 'setAttr', task, attr, value }, opts);
}

export function removeAttr(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	attr: TaskAttr,
	opts: EditOptions = {},
): EditResult {
	return applyIntent(ws, index, { type: 'removeAttr', task, attr }, opts);
}

export function renameTask(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	name: string,
	opts: EditOptions = {},
): EditResult {
	return applyIntent(ws, index, { type: 'renameTask', task, name }, opts);
}

export function declareFlag(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	flag: string,
	opts: EditOptions = {},
): EditResult {
	return applyIntent(ws, index, { type: 'declareFlag', flag }, opts);
}
