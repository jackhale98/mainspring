// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Add person and Add group in the resource table (phase-3.md 7.1 W7, 9.6): the person types the
 * name first, then one `addResource` edit writes the block, so the id follows the first name (the
 * edit API makes it from the name, `slugId`) and the whole action is one undo step. This is the
 * resource counterpart of ADR-0013's amendment (a new task's id follows its first name), reached
 * without a rename-id intent: resource ids are global and many statements name them (`allocate`,
 * `managers`, `limits`), and nothing renames those yet, so a person is never created under a
 * placeholder id that would have to change later. (The empty state's "Add person" still makes
 * "New person", as T13 built it; the details rename it, and the id stays.)
 *
 * The new resource is selected from the applied edit's header text, as `addPersonFlow` does.
 */
import type { DispatchOutcome } from '../state/edits.svelte';
import type { EditIntent, TjpEdit } from '../tjp/edit/types';
import type { ResourceId } from '../tjp/index';
import { newResourceIdFromHeader } from '../people/add-person';
import { addEdit } from './person-edit';
import type { AddSpot } from './rows';

/** What the flow reads and does; the component passes the app's. */
export interface AddResourceEnv {
	/** The open plan (its dispatcher): the flow gives up when this is no longer the same one. */
	plan(): unknown;
	dispatch(
		intent: EditIntent,
		o: { label: { text: string; approx: boolean } },
	): Promise<DispatchOutcome>;
	/** The text of the edit's new header, as the text is right after the edit. */
	headerOf(edit: TjpEdit): string | null;
	select(id: ResourceId): void;
}

/** A name that can be written: not empty after trimming. */
export const usableName = (typed: string): string | null => {
	const t = typed.trim();
	return t === '' ? null : t;
};

/** Adds a person or a group named `typed` at `spot`; the new id once selected, else null. */
export async function addResourceFlow(
	env: AddResourceEnv,
	spot: AddSpot,
	typed: string,
	kind: 'person' | 'group',
): Promise<ResourceId | null> {
	const name = usableName(typed);
	if (name === null) return null;
	const plan = env.plan();
	if (plan === null) return null;
	const e = addEdit(spot.parent, spot.index, name, kind);
	const o = await env.dispatch(e.intent, { label: e.label });
	if (o.status !== 'applied' || env.plan() !== plan) return null;
	const header = env.headerOf(o.edit);
	const id = header === null ? null : newResourceIdFromHeader(header);
	if (id === null) return null;
	env.select(id);
	return id;
}
