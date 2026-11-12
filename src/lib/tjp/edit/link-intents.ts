// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plan's function names for the dependency and allocation intents (phase-1.md 6.5): thin
 * wrappers that build the `EditIntent` and call `applyIntent`. The rules are in deps.ts,
 * deps-gap.ts and allocation.ts.
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { ResourceId, SymbolIndex, TaskId } from '../index';
import { applyIntent } from './apply';
import type { EditOptions, EditResult, IntentOf } from './types';

/** `task` (the successor) depends on `target`. */
export function addDepends(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	target: TaskId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'addDepends', task, target }, opts);
}

export function removeDepends(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	target: TaskId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'removeDepends', task, target }, opts);
}

export function setDependsGap(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	target: TaskId,
	gap: IntentOf<'setDependsGap'>['gap'],
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'setDependsGap', task, target, gap }, opts);
}

export function allocate(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	resources: readonly ResourceId[],
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'allocate', task, resources }, opts);
}

export function addAllocation(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	resource: ResourceId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'addAllocation', task, resource }, opts);
}

export function removeAllocation(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	resource: ResourceId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'removeAllocation', task, resource }, opts);
}

export function replaceAllocation(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	from: ResourceId,
	to: ResourceId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'replaceAllocation', task, from, to }, opts);
}
