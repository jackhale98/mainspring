// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plan's function names for the resource intents (phase-1.md 6.5, 7.1): thin wrappers that
 * build the `EditIntent` and call `applyIntent`. The rules are in resource-tree.ts (add, delete,
 * move, rename) and resource-attrs.ts (attributes); the project, working-hours and leave
 * wrappers are in settings.ts. Kept apart from the handlers, which apply.ts imports.
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { ResourceId, SymbolIndex } from '../index';
import { applyIntent } from './apply';
import type { AttrValue, EditOptions, EditResult, IntentOf, ResourceAttr } from './types';

export function addResource(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	parent: ResourceId | null,
	at: number,
	id: string | undefined,
	name: string,
	attrs?: ReadonlyArray<readonly [ResourceAttr, AttrValue]>,
	opts?: EditOptions,
): EditResult {
	const intent: IntentOf<'addResource'> = {
		type: 'addResource',
		parent,
		index: at,
		name,
		...(id === undefined ? {} : { id }),
		...(attrs === undefined ? {} : { attrs }),
	};
	return applyIntent(ws, index, intent, opts);
}

export function deleteResource(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	resource: ResourceId,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'deleteResource', resource }, opts);
}

export function moveResource(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	resource: ResourceId,
	parent: ResourceId | null,
	at: number,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'moveResource', resource, parent, index: at }, opts);
}

export function renameResource(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	resource: ResourceId,
	name: string,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'renameResource', resource, name }, opts);
}

export function setResourceAttr(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	resource: ResourceId,
	attr: ResourceAttr,
	value: AttrValue,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'setResourceAttr', resource, attr, value }, opts);
}

export function removeResourceAttr(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	resource: ResourceId,
	attr: ResourceAttr,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'removeResourceAttr', resource, attr }, opts);
}
