<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The link inspector (phase-2.md 9.3 "Link"): the task that waits and the task it waits for, the
	gap (working time or calendar time, `setDependsGap`) and Remove (R4). The type (`onstart` or
	`onend`) is read-only in v1. A link written with a macro is shown and left to the text.
-->
<script lang="ts">
	import { gapEdit } from '../../lib/inspector/edit';
	import type { GapKind, LinkFact } from '../../lib/inspector/links';
	import { inspectorStrings as S } from '../../lib/strings';
	import CommitInput from './CommitInput.svelte';
	import { getInspector } from './context';
	import Field from './Field.svelte';
	import Select from './Select.svelte';

	let { link }: { link: LinkFact } = $props();
	const { app, actions, showInText, openTask } = getInspector();

	/** The kind a new gap is written as, while the link has none. */
	let picked = $state<GapKind>('gaplength');
	const kind = $derived<GapKind>(link.gap?.kind ?? picked);
	const kinds = [
		{ value: 'gaplength', label: S.dependency.working },
		{ value: 'gapduration', label: S.dependency.calendar },
	];
	const ok = async (p: Promise<{ status: string }>): Promise<boolean> =>
		(await p).status === 'applied';
	const at = $derived(link.ref.sites[0]?.statement ?? null);

	async function remove(): Promise<void> {
		const o = await actions.action({ type: 'unlink', link: link.ref });
		// The link is gone: back to the task that waited.
		if (o.status === 'applied') app.inspector.clearLink();
	}
</script>

<div class="link">
	<p class="between">{S.link.between(link.predName, link.succName)}</p>
	<div class="ends">
		<button type="button" class="end" onclick={() => openTask(link.pred)}>
			<span class="k">{S.field.predecessor}</span>
			{link.predName}
		</button>
		<button type="button" class="end" onclick={() => openTask(link.succ)}>
			<span class="k">{S.field.successor}</span>
			{link.succName}
		</button>
	</div>
	<p class="type"><span class="k">{S.field.type}</span> {S.dependency.type[link.type]}</p>
	<p class="note">{S.dependency.typeNote}</p>

	{#if !link.editable}
		<p class="note">{S.dependency.engineOnly}</p>
		{#if at}<button type="button" class="text" onclick={() => showInText(at)}>{S.showInText}</button
			>{/if}
	{:else}
		<div class="pair">
			<Field
				label={S.field.gap}
				hint={link.gap?.both ? S.dependency.gapBoth : S.dependency.gapHint}
			>
				{#snippet children({ id, describedby })}
					<CommitInput
						{id}
						value={link.gap?.text ?? ''}
						{describedby}
						mono
						placeholder={S.dependency.gapPlaceholder}
						oncommit={(t) => ok(actions.edit(gapEdit(link, kind, t)))}
					/>
				{/snippet}
			</Field>
			<Field label={S.field.gapKind}>
				{#snippet children({ id })}
					<Select
						{id}
						value={kind}
						options={kinds}
						onchange={(v) => {
							if (link.gap === null) {
								picked = v as GapKind;
								return true;
							}
							return ok(actions.edit(gapEdit(link, v as GapKind, link.gap.text)));
						}}
					/>
				{/snippet}
			</Field>
		</div>
		<div class="buttons">
			<button type="button" class="button" onclick={() => void remove()}>
				{S.dependency.removeLink}
			</button>
			{#if at}<button type="button" class="button" onclick={() => showInText(at)}
					>{S.showInText}</button
				>{/if}
		</div>
	{/if}
</div>

<style>
	.link {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.between {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
	}
	.ends {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.end {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-block-size: var(--size-control);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-weight: 600;
		text-align: start;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	.end:hover {
		background: var(--color-row-hover);
	}
	.k {
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
	}
	.type,
	.note {
		margin: 0;
		font-size: var(--text-sm);
	}
	.note {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		align-items: start;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.button,
	.text {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.button:hover,
	.text:hover {
		background: var(--color-row-hover);
	}
	.end:focus-visible,
	.button:focus-visible,
	.text:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	@media (max-width: 22rem) {
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
