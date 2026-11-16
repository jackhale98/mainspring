<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The "No people" state (phase-3.md 9.3, 9.6, 9.8): what Workload, Resources, Lanes and Team show
	for a plan that declares no resource: one short sentence and the Add person (+) button. The
	button is the `addResource` edit through the dispatcher (lib/people/add-person.ts), like every
	other edit: one toast, one undo step. The new person is selected; there is no person details
	view yet (T17), which will open them. `ondone` hears the new person's id so that the owner can
	put the keyboard focus where the empty state was (this button goes away with the state).
-->
<script lang="ts">
	import { addPersonFlow, headerOfEdit } from '../../lib/people/add-person';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';

	interface Props {
		app: AppState;
		/** The new person's id, once the edit applied and they are selected. */
		ondone?: ((id: string) => void) | undefined;
	}
	let { app, ondone }: Props = $props();

	const S = strings.people.none;
	/** An add is on its way (the edit, then the result): another press would add a second person. */
	let busy = $state(false);

	async function add(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			const id = await addPersonFlow({
				plan: () => app.edits,
				resources: () => app.outline.resources,
				dispatch: (intent, o) =>
					app.edits ? app.edits.dispatch(intent, o) : Promise.resolve({ status: 'cancelled' }),
				headerOf: (edit) => headerOfEdit(app, edit),
				select: (rid) => app.selection.selectResource(rid, 'visual'),
			});
			if (id !== null) ondone?.(id);
		} finally {
			busy = false;
		}
	}
</script>

<div class="empty" data-testid="no-people">
	<p class="title">{S.title}</p>
	<p class="lead">{S.lead}</p>
	<button
		type="button"
		class="add"
		data-testid="add-person"
		aria-disabled={busy ? 'true' : undefined}
		onclick={add}
	>
		<Icon name="plus" size={16} stroke={2.2} />{S.add}
	</button>
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-block-size: 12rem;
		padding: var(--space-8) var(--gutter);
		text-align: center;
	}
	.title {
		margin: 0;
		color: var(--color-text-muted);
		font-family: var(--font-display);
		font-size: var(--text-lg);
	}
	.lead {
		margin: 0;
		max-inline-size: 28rem;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: var(--size-control);
		padding-inline: var(--space-6);
		border: 1px solid var(--color-gantt-accent);
		border-radius: var(--radius-pill);
		background: var(--color-gantt-accent);
		color: var(--color-gantt-accent-text);
		font: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.add:hover {
		filter: brightness(1.08);
	}
	.add[aria-disabled='true'] {
		opacity: 0.6;
		cursor: default;
	}
	.add:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
