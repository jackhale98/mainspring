// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Add person (+) (phase-3.md 9.6, 9.8): one `addResource` edit through the dispatcher (so the
 * toast and the undo step are every other edit's), then the new person is selected. Nothing here
 * changes the plan itself; the edit API writes the `resource` block.
 *
 * - The person goes at the end of the top level (`parent` null, `index` the count of top-level
 *   resources the index resolved, as `addTask` counts). A group's members come with W6 (T17).
 * - The new person is named from the applied edit: the header text its `select` range covers
 *   (`resource <id> "<name>"`), never by comparing the outline with an earlier one. Resource ids are
 *   global, so the id is the whole key.
 * - There is no person details view yet (T17), so the new person is only selected. T17 makes the
 *   selection open the details (the right panel on desktop, the sheet on a phone).
 */
import type { DispatchOutcome } from '../state/edits.svelte';
import type { ResourceId } from '../tjp/index';
import type { EditIntent, TjpEdit } from '../tjp/edit/types';
import { strings } from '../strings';

/** The outline nodes the spot is counted from (a resolved resource at level 1 is top level). */
export interface ResourceNodeLike {
	readonly id: string | null;
	readonly level: number;
}

/** The place for a new person: the end of the top level. */
export function addPersonSpot(resources: readonly ResourceNodeLike[]): {
	parent: null;
	index: number;
} {
	return { parent: null, index: resources.filter((r) => r.level === 1 && r.id !== null).length };
}

/** The id an applied `addResource` gave the person, from the header it wrote; null if it is not one. */
export function newResourceIdFromHeader(header: string): ResourceId | null {
	return /^resource\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(header)?.[1] ?? null;
}

/** What the flow reads and does; the component passes the app's. */
export interface AddPersonEnv {
	/** The open plan (its dispatcher): the flow gives up when this is no longer the same one. */
	plan(): unknown;
	readonly resources: () => readonly ResourceNodeLike[];
	dispatch(
		intent: EditIntent,
		o: { label: { text: string; approx: boolean } },
	): Promise<DispatchOutcome>;
	/** The text of the edit's new header, as the text is right after the edit. */
	headerOf(edit: TjpEdit): string | null;
	select(id: ResourceId): void;
}

/** Adds a person; the new person's id once it is selected, else null (refused, or another plan). */
export async function addPersonFlow(env: AddPersonEnv): Promise<ResourceId | null> {
	const plan = env.plan();
	if (plan === null) return null;
	const name = strings.people.none.newPerson;
	const o = await env.dispatch(
		{ type: 'addResource', ...addPersonSpot(env.resources()), name },
		{ label: { text: strings.people.none.label(name), approx: false } },
	);
	if (o.status !== 'applied' || env.plan() !== plan) return null;
	const header = env.headerOf(o.edit);
	const id = header === null ? null : newResourceIdFromHeader(header);
	if (id === null) return null;
	env.select(id);
	return id;
}
