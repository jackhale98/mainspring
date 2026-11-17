<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The thresholds control of the Workload toolbar (phase-3.md 9.3, 18.3): two number fields with
	steppers, "Spare below" (default 80) and "Over above" (default 100), in percent of available
	time. They are stored per plan (heat-state.svelte.ts). A value that would make the pair invalid
	(spare above over, or outside 1 to 500) is refused with a sentence and the fields keep what they
	had. It is a disclosure: the chip is a button with `aria-expanded`, the panel opens under it on
	a desktop and as a sheet at the foot on a phone, Escape closes it and returns the focus to the
	chip, and so does a click outside.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { THRESHOLD_MAX, THRESHOLD_MIN, validThresholds } from '../../lib/workload/heat-prefs';
	import { DEFAULT_THRESHOLDS, type Thresholds } from '../../lib/workload/types';
	import { workloadStrings as W } from '../../lib/strings';
	import BandLegend from './BandLegend.svelte';
	import Icon from '../Icon.svelte';

	interface Props {
		thresholds: Thresholds;
		/** Returns false when the pair is not valid. */
		onchange: (t: Thresholds) => boolean;
	}
	let { thresholds, onchange }: Props = $props();

	let open = $state(false);
	let error = $state(false);
	let chip: HTMLButtonElement | undefined = $state();
	let panel: HTMLDivElement | undefined = $state();
	let spare = $state('');
	let over = $state('');

	$effect(() => {
		spare = String(thresholds.spareBelow);
		over = String(thresholds.overAbove);
	});

	async function toggle(): Promise<void> {
		open = !open;
		error = false;
		if (open) {
			await tick();
			panel?.querySelector<HTMLInputElement>('input')?.focus();
		}
	}

	function close(): void {
		open = false;
		error = false;
		chip?.focus();
	}

	function commit(): void {
		const next: Thresholds = { spareBelow: Number(spare), overAbove: Number(over) };
		if (spare.trim() === '' || over.trim() === '' || !validThresholds(next) || !onchange(next)) {
			error = true;
			return;
		}
		error = false;
	}

	/** Steps a field by 5 (the arrows of a number input do 1; Page keys are not wired). */
	function step(which: 'spare' | 'over', by: number): void {
		const cur = Number(which === 'spare' ? spare : over);
		const next = String(
			Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, (Number.isNaN(cur) ? 0 : cur) + by)),
		);
		if (which === 'spare') spare = next;
		else over = next;
		commit();
	}

	function reset(): void {
		spare = String(DEFAULT_THRESHOLDS.spareBelow);
		over = String(DEFAULT_THRESHOLDS.overAbove);
		commit();
	}
</script>

<svelte:window
	onpointerdown={(e) => {
		if (
			open &&
			e.target instanceof Node &&
			!panel?.contains(e.target) &&
			!chip?.contains(e.target)
		) {
			open = false;
		}
	}}
/>

<span class="host">
	<button
		type="button"
		class="chip"
		bind:this={chip}
		aria-expanded={open}
		aria-controls="heat-thresholds"
		aria-haspopup="true"
		data-testid="heat-thresholds-chip"
		onclick={toggle}
	>
		<Icon name="sliders" size={14} /><span class="lbl">{W.thresholds}</span>
	</button>
	{#if open}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			id="heat-thresholds"
			class="panel"
			role="group"
			aria-label={W.thresholdsTitle}
			bind:this={panel}
			data-testid="heat-thresholds"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					close();
				}
			}}
		>
			<p class="title">{W.thresholdsTitle}</p>
			{@render field('spare', W.spareBelow, spare)}
			{@render field('over', W.overAbove, over)}
			{#if error}
				<p id="heat-thresholds-error" class="error" role="alert">{W.thresholdsError}</p>
			{:else}
				<p id="heat-thresholds-note" class="note">{W.thresholdsNote}</p>
			{/if}
			<BandLegend rules={thresholds} />
			<button type="button" class="reset" onclick={reset}>{W.thresholdsReset}</button>
		</div>
	{/if}
</span>

{#snippet field(id: 'spare' | 'over', label: string, value: string)}
	<div class="field">
		<label for="heat-{id}">{label}</label>
		<span class="stepper">
			<button type="button" aria-label="{label}: -5" onclick={() => step(id, -5)}>−</button>
			<input
				id="heat-{id}"
				type="number"
				inputmode="numeric"
				min={THRESHOLD_MIN}
				max={THRESHOLD_MAX}
				step="5"
				{value}
				aria-invalid={error}
				aria-describedby={error ? 'heat-thresholds-error' : 'heat-thresholds-note'}
				oninput={(e) => {
					if (id === 'spare') spare = e.currentTarget.value;
					else over = e.currentTarget.value;
				}}
				onchange={commit}
				onkeydown={(e) => {
					if (e.key === 'Enter') commit();
				}}
			/>
			<button type="button" aria-label="{label}: +5" onclick={() => step(id, 5)}>+</button>
			<span class="pct" aria-hidden="true">%</span>
		</span>
	</div>
{/snippet}

<style>
	.host {
		position: relative;
		display: inline-flex;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		block-size: var(--gantt-chip-height);
		padding-inline: 12px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.chip[aria-expanded='true'] {
		background: var(--color-gantt-inset);
	}
	.chip:focus-visible,
	.reset:focus-visible,
	input:focus-visible,
	.stepper button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.panel {
		position: absolute;
		z-index: 30;
		inset-block-start: calc(100% + 6px);
		inset-inline-start: 0;
		box-sizing: border-box;
		inline-size: 17rem;
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
	.field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.stepper button {
		display: grid;
		place-items: center;
		inline-size: 28px;
		block-size: 28px;
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	input {
		inline-size: 3.5rem;
		block-size: 28px;
		box-sizing: border-box;
		padding-inline: 6px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	input[aria-invalid='true'] {
		border-color: var(--color-ruby);
	}
	.pct {
		margin-inline-start: 4px;
		color: var(--color-text-muted);
	}
	.note,
	.error {
		margin: 0;
		font-size: var(--text-xs);
	}
	.note {
		color: var(--color-text-muted);
	}
	.error {
		color: var(--color-ruby-ink);
	}
	.reset {
		align-self: flex-start;
		padding: 4px 10px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
		}
		.stepper button {
			inline-size: var(--size-tap);
			block-size: var(--size-tap);
		}
		input {
			block-size: var(--size-tap);
		}
		.reset {
			min-block-size: var(--size-tap);
		}
	}
	/* A phone: the panel is a sheet at the foot of the screen, above the tab bar. */
	@media (max-width: 599px) {
		.chip {
			padding-inline: 0;
			justify-content: center;
			min-inline-size: var(--size-tap);
		}
		.lbl {
			display: none;
		}
		.panel {
			position: fixed;
			inset-inline: var(--space-2);
			inset-block-start: auto;
			inset-block-end: var(--tabbar-clearance);
			inline-size: auto;
		}
	}
</style>
