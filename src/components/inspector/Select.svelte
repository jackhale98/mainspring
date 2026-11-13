<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A native <select> in the inspector's look: the best picker on a phone and fully accessible. It
	commits when the choice changes. `value` is what the plan says; after a change the shown choice
	follows the plan again (so a refused edit puts the old choice back).
-->
<script lang="ts">
	interface Option {
		readonly value: string;
		readonly label: string;
	}
	interface Props {
		id: string;
		value: string;
		options: readonly Option[];
		onchange: (value: string) => Promise<boolean> | boolean;
		disabled?: boolean;
		describedby?: string | undefined;
		label?: string | undefined;
	}
	let { id, value, options, onchange, disabled = false, describedby, label }: Props = $props();

	async function change(e: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
		const select = e.currentTarget;
		const applied = await onchange(select.value);
		if (!applied) select.value = value;
	}
</script>

<select
	{id}
	class="select"
	{disabled}
	{value}
	aria-label={label}
	aria-describedby={describedby}
	onchange={change}
>
	{#each options as o (o.value)}
		<option value={o.value} selected={o.value === value}>{o.label}</option>
	{/each}
</select>

<style>
	.select {
		inline-size: 100%;
		min-inline-size: 0;
		min-block-size: var(--size-control);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: max(16px, var(--text-md));
	}
	.select:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.select:disabled {
		background: var(--color-surface-sunken);
		color: var(--color-text-muted);
	}
</style>
