// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plan's function names for the project, working-hours and leave intents (phase-1.md 6.5,
 * 7.1): thin wrappers that build the `EditIntent` and call `applyIntent`. The rules are in
 * project.ts, calendar.ts and calendar-leaves.ts. Kept apart from the handlers, which apply.ts
 * imports.
 */
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { SymbolIndex } from '../index';
import { applyIntent } from './apply';
import type {
	AttrValue,
	EditOptions,
	EditResult,
	IntentOf,
	LeaveRef,
	LeaveSpec,
	ProjectAttr,
	Scope,
	Weekday,
} from './types';

export function setProjectHeader(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	header: Omit<IntentOf<'setProjectHeader'>, 'type'>,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'setProjectHeader', ...header }, opts);
}

export function setProjectAttr(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	attr: ProjectAttr,
	value: AttrValue,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'setProjectAttr', attr, value }, opts);
}

export function removeProjectAttr(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	attr: ProjectAttr,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'removeProjectAttr', attr }, opts);
}

export function setWorkingHours(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	scope: Scope,
	days: readonly Weekday[],
	hours: ReadonlyArray<readonly [string, string]> | 'off',
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'setWorkingHours', scope, days, hours }, opts);
}

export function addLeave(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	scope: IntentOf<'addLeave'>['scope'],
	leave: LeaveSpec,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'addLeave', scope, leave }, opts);
}

export function updateLeave(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	leave: LeaveRef,
	to: LeaveSpec,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'updateLeave', leave, to }, opts);
}

export function removeLeave(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	leave: LeaveRef,
	opts?: EditOptions,
): EditResult {
	return applyIntent(ws, index, { type: 'removeLeave', leave }, opts);
}
