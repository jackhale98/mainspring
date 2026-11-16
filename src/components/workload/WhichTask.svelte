<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	"Move which task?" (phase-3.md 7.1 W1 and W2, 18.9): a cell with several tasks a drag may start
	from asks on the drop which one is meant, once, with what the drop would do in the title. One
	button per task, with its booked hours; Escape or Cancel drops the move. It takes the focus when
	it opens and gives it back to the plot when it closes.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { workloadStrings as W } from '../../lib/strings';
	import { hoursNumber } from '../../lib/workload/heat-cell';

	interface Props {
		/** What the drop asks for ("To Dev 3"). */
		ask: string;
		tasks: ReadonlyArray<{
			readonly task: string;
			readonly name: string;
			readonly minutes: number;
		}>;
		onchoose: (task: string) => void;
		oncancel: () => void;
	}
	let { ask, tasks, onchoose, oncancel }: Props = $props();

	let root: HTMLDivElement | undefined = $state();
	onMount(() => root?.querySelector('button')?.focus());
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	class="which"
	role="dialog"
	tabindex="-1"
	aria-label={W.rebalance.which}
	data-testid="which-task"
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			oncancel();
		}
	}}
>
	<p class="title">{W.rebalance.which} <span class="ask">{ask}</span></p>
	<p class="lead">{W.rebalance.whichLead}</p>
	<ul>
		{#each tasks as t (t.task)}
			<li>
				<button type="button" onclick={() => onchoose(t.task)} data-task={t.task}>
					<span class="name">{t.name}</span>
					<span class="hours">{W.details.hoursValue(hoursNumber(t.minutes))}</span>
				</button>
			</li>
		{/each}
	</ul>
	<button type="button" class="cancel" onclick={oncancel}>{W.rebalance.cancel}</button>
</div>

<style>
	.which {
		position: absolute;
		z-index: 20;
		inset-block-start: 20%;
		inset-inline-start: 50%;
		transform: translateX(-50%);
		box-sizing: border-box;
		inline-size: min(22rem, calc(100% - 2 * var(--space-2)));
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-raised);
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	.title {
		margin: 0;
		font-weight: 600;
	}
	.ask {
		margin-inline-start: 0.25em;
		color: var(--color-text-muted);
		font-weight: 400;
	}
	.lead {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	button {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		inline-size: 100%;
		min-block-size: 36px;
		align-items: center;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.hours {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.cancel {
		justify-content: center;
		background: transparent;
	}
	@media (pointer: coarse) {
		button {
			min-block-size: var(--size-tap);
		}
	}
</style>
