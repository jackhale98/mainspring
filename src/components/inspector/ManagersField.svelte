<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A person's managers as chips (phase-3.md 9.6, 7.1 W8): each manager the person's own statement
	names has a remove button, the ones a parent group gives are shown with where they come from and
	cannot be removed here (the edit API keeps them in the list), and a picker adds another. Every
	change sends the whole list (`setResourceAttr managers`, or `removeResourceAttr` for the last
	own one), one undo step. Managers written with a macro are text only: the field is off, with its
	reason and "Show in text". The chips' buttons are 44 px on a touch screen.
-->
<script lang="ts">
	import { managersEdit } from '../../lib/resources/person-edit';
	import { managerChoices, type PersonDetails } from '../../lib/resources/person';
	import { inspectorStrings as S } from '../../lib/strings';
	import { resourceStrings as R } from '../../lib/strings-resources';
	import { getInspector } from './context';
	import Select from '../ui/Select.svelte';

	let { d }: { d: PersonDetails } = $props();
	const { app, actions, showInText } = getInspector();
	const M = R.details.managers;
	const uid = $props.id();

	const index = $derived(app.index);
	const nameOf = (id: string): string => index?.resources.get(id)?.name ?? id;
	const choices = $derived(
		index
			? managerChoices(index, d.id).filter(
					(c) => !d.managers.own.includes(c.id) && !d.managers.inherited.includes(c.id),
				)
			: [],
	);
	const off = $derived(d.managers.textOnly !== null);

	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';

	const remove = (id: string): Promise<boolean> =>
		ok(
			actions.edit(
				managersEdit(
					d,
					d.managers.own.filter((m) => m !== id),
					{ id, name: nameOf(id), added: false },
				),
			),
		);
	const add = (id: string): Promise<boolean> =>
		id === ''
			? Promise.resolve(false)
			: ok(
					actions.edit(
						managersEdit(d, [...d.managers.own, id], { id, name: nameOf(id), added: true }),
					),
				);
</script>

<div class="managers" data-testid="managers">
	{#if d.managers.own.length + d.managers.inherited.length === 0}
		<p class="none">{M.none}</p>
	{:else}
		<ul aria-label={R.details.field.managers}>
			{#each d.managers.inherited as id (id)}
				<li class="chip inherited">
					<span>{nameOf(id)}</span>
					<span class="from">{S.inheritedList(d.group?.name ?? '')}</span>
				</li>
			{/each}
			{#each d.managers.own as id (id)}
				<li class="chip">
					<span>{nameOf(id)}</span>
					<button
						type="button"
						aria-label={M.remove(nameOf(id))}
						disabled={off}
						onclick={() => remove(id)}>×</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	{#if off && d.managers.textOnly}
		<p class="note">{S.textOnly['macro-call']}</p>
		<button
			type="button"
			class="link"
			onclick={() => d.managers.textOnly && showInText(d.managers.textOnly)}>{S.showInText}</button
		>
	{:else if choices.length > 0}
		<label class="add" for="{uid}-add">{M.add}</label>
		<Select
			id="{uid}-add"
			value=""
			options={[
				{ value: '', label: M.choose },
				...choices.map((c) => ({ value: c.id, label: c.name })),
			]}
			onchange={add}
		/>
	{/if}
</div>

<style>
	.managers {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-block-size: var(--size-control);
		padding: 0 var(--space-1) 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface-sunken);
		font-size: var(--text-sm);
	}
	.chip.inherited {
		padding-inline-end: var(--space-3);
	}
	.from {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.chip button {
		display: grid;
		place-items: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--color-text);
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}
	.chip button:hover:not(:disabled) {
		background: var(--color-row-hover);
	}
	.chip button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
	}
	.none,
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.add {
		font-size: var(--text-label);
		font-weight: 600;
		color: var(--color-text-muted);
	}
	.link {
		align-self: start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-link, var(--color-focus));
		font: inherit;
		font-size: var(--text-sm);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
