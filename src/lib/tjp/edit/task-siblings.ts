// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The sibling id rules of the task intents that choose a local id (`addTask`, `moveTask`, and
 * `renameTask` with `id`, task-rename-id.ts), shared so that they cannot drift apart.
 *
 * - `taken`: a child `local` of `parent` exists (other than `except`), or an unresolved
 *   declaration there has that id.
 * - `unknownSibling`: `needs-schedule` when `parent` has a child whose id only the engine knows (a
 *   macro or automatic id without engine hints): a new id there could collide with it.
 */
import type { SymbolIndex } from '../index';
import { refused, type Refused, type TaskId } from './types';

interface WithIndex {
	readonly index: SymbolIndex;
}

export function taken(
	ctx: WithIndex,
	parent: TaskId | null,
	local: string,
	except?: TaskId,
): boolean {
	const full = parent === null ? local : `${parent}.${local}`;
	if (full !== except && ctx.index.tasks.has(full)) return true;
	return ctx.index.unresolved.some(
		(u) => u.kind === 'task' && u.parent === parent && u.localId === local,
	);
}

export function unknownSibling(ctx: WithIndex, parent: TaskId | null): Refused | null {
	const u = ctx.index.unresolved.find(
		(x) => x.kind === 'task' && x.parent === parent && x.localId === null,
	);
	return u ? refused('needs-schedule', [u.decl.header]) : null;
}
