<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A task's flags (phase-2.md 9.3): chips for the flags it writes, each removable, and the ones a
	parent task gives (not removable here). A flag has to be declared in the plan before a task can
	use it, so a picker offers the declared ones, and a field declares a new one and adds it
	(`declareFlag`, then `flags`: two edits, two undo steps). The edit API takes the whole list, so
	the inherited flags stay in what is sent (lib/inspector/edit.ts).
-->
<script lang="ts">
	import { declareFlagEdit, flagsEdit } from '../../lib/inspector/edit';
	import { declaredFlags, type TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Select from './Select.svelte';

	let { d }: { d: TaskDetails } = $props();
	const { app, actions, showInText } = getInspector();
	const uid = $props.id();

	const declared = $derived(app.index ? declaredFlags(app.index) : []);
	const free = $derived(
		declared.filter((f) => !d.flags.own.includes(f) && !d.flags.inherited.includes(f)),
	);
	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';

	const add = (flag: string) => ok(actions.edit(flagsEdit(d, [...d.flags.own, flag], flag)));
	const remove = (flag: string) =>
		ok(
			actions.edit(
				flagsEdit(
					d,
					d.flags.own.filter((f) => f !== flag),
					flag,
				),
			),
		);

	async function declareAndAdd(text: string): Promise<boolean> {
		const flag = text.trim();
		if (flag === '') return false;
		if (!(await ok(actions.edit(declareFlagEdit(flag))))) return false;
		return add(flag);
	}
</script>

<div class="flags">
	<span class="sr-only" id="{uid}-label">{S.field.flags}</span>
	{#if d.flags.textOnly}
		<p class="note">{S.textOnly['macro-call']}</p>
		<button
			type="button"
			class="link"
			onclick={() => d.flags.textOnly && showInText(d.flags.textOnly)}
		>
			{S.showInText}
		</button>
	{:else}
		<ul class="chips" aria-labelledby="{uid}-label">
			{#each d.flags.inherited as flag (flag)}
				<li class="chip inherited" title={S.personFromParent}>{flag}</li>
			{/each}
			{#each d.flags.own as flag (flag)}
				<li class="chip">
					<span>{flag}</span>
					<button
						type="button"
						class="x"
						aria-label={S.flagRemove(flag)}
						title={S.flagRemove(flag)}
						onclick={() => void remove(flag)}>×</button
					>
				</li>
			{/each}
			{#if d.flags.own.length + d.flags.inherited.length === 0}
				<li class="none">{S.flagsNone}</li>
			{/if}
		</ul>
		{#if free.length > 0}
			<Select
				id="{uid}-add"
				label={S.flagAdd}
				value=""
				options={[{ value: '', label: S.flagAdd }, ...free.map((f) => ({ value: f, label: f }))]}
				onchange={(v) => (v === '' ? false : add(v))}
			/>
		{/if}
		<div class="new">
			<CommitInput
				id="{uid}-new"
				value=""
				label={S.flagNew}
				placeholder={S.flagNew}
				mono
				describedby="{uid}-new-hint"
				oncommit={declareAndAdd}
			/>
			<p class="note" id="{uid}-new-hint">{S.flagNewHint}</p>
		</div>
	{/if}
</div>

<style>
	.flags {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-block-size: 28px;
		padding: 0 var(--space-1) 0 var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-sm);
	}
	.chip.inherited {
		padding-inline: var(--space-3);
		border: 1px dashed var(--color-border-strong);
		background: transparent;
	}
	.x {
		inline-size: 24px;
		block-size: 24px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}
	.x:hover {
		background: var(--color-row-hover);
	}
	.x:focus-visible,
	.link:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.none,
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.new {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.link {
		align-self: flex-start;
		min-block-size: 24px;
		padding: 0 2px;
		border: 0;
		background: transparent;
		color: var(--color-accent);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: underline;
		cursor: pointer;
	}
	@media (pointer: coarse) {
		.x {
			inline-size: var(--size-tap);
			block-size: var(--size-tap);
		}
		.chip {
			min-block-size: var(--size-tap);
		}
	}
</style>
