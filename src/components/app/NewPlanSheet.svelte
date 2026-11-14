<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The New plan sheet (ADR-0013 #2; phase-3.md 9.8): three labelled fields, Name (required),
	Start (today by default) and Time zone (the device's zone by default, "None (UTC)" allowed),
	and Create, which opens the plan in this tab (`app.openNewPlan`). It is the shared modal
	bottom sheet (Sheet.svelte, with its iPhone placement fix), on every layout.

	The form does not use the browser's own validation bubbles: a problem is written under its
	field, tied to it with aria-describedby and aria-invalid, and the focus goes to the first
	field with one. Enter in a field creates. When the open plan was edited, Create asks before
	replacing it (AppState); declining leaves this sheet open.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import { deviceZone, isoDate, zoneChoices } from '../../lib/tjp/new-plan-defaults';
	import { newPlanProblem, type NewPlanProblem } from '../../lib/tjp/new-plan';
	import Sheet from '../Sheet.svelte';

	interface Props {
		app: AppState;
	}
	let { app }: Props = $props();

	const N = strings.newPlan;
	const uid = $props.id();
	const ids = { name: `${uid}-name`, start: `${uid}-start`, zone: `${uid}-zone` };
	const zones = zoneChoices();

	let name = $state('');
	let start = $state('');
	/** The zone's name; '' is "None (UTC)". */
	let zone = $state('');
	let problem = $state<NewPlanProblem | null>(null);
	let busy = $state(false);
	let nameField: HTMLInputElement | undefined = $state();
	let startField: HTMLInputElement | undefined = $state();
	let zoneField: HTMLSelectElement | undefined = $state();

	// Each time the sheet opens, the form starts from the defaults.
	$effect(() => {
		if (!app.newPlanOpen) return;
		name = '';
		start = isoDate(new Date());
		zone = deviceZone() ?? '';
		problem = null;
		busy = false;
		queueMicrotask(() => nameField?.focus());
	});

	const nameProblem = $derived(
		problem === 'name-empty' || problem === 'name-unsafe' || problem === 'name-backslash'
			? problem
			: null,
	);
	const startProblem = $derived(problem === 'start' ? problem : null);
	const zoneProblem = $derived(problem === 'zone' ? problem : null);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		const found = newPlanProblem({ name, start, timezone: zone === '' ? null : zone });
		problem = found;
		if (found !== null) {
			const field = found.startsWith('name')
				? nameField
				: found === 'start'
					? startField
					: zoneField;
			field?.focus();
			return;
		}
		busy = true;
		const opened = await app.openNewPlan({ name, start, timezone: zone === '' ? null : zone });
		busy = false;
		// A declined confirmation keeps the sheet and the answers.
		if (opened) app.newPlanOpen = false;
	}
</script>

<Sheet
	open={app.newPlanOpen}
	side="bottom"
	title={N.title}
	onclose={() => (app.newPlanOpen = false)}
>
	<form class="form" novalidate onsubmit={submit} data-testid="new-plan-form">
		<p class="lead">{N.lead}</p>
		<div class="field">
			<label for={ids.name}>{N.name}</label>
			<input
				id={ids.name}
				bind:this={nameField}
				bind:value={name}
				type="text"
				class="input"
				required
				aria-required="true"
				aria-invalid={nameProblem !== null}
				aria-describedby={nameProblem ? `${ids.name}-error` : undefined}
				autocomplete="off"
				autocapitalize="sentences"
				placeholder={N.namePlaceholder}
				oninput={() => nameProblem && (problem = null)}
			/>
			{#if nameProblem}
				<p class="error" id="{ids.name}-error" role="alert">{N.errors[nameProblem]}</p>
			{/if}
		</div>
		<div class="pair">
			<div class="field">
				<label for={ids.start}>{N.start}</label>
				<input
					id={ids.start}
					bind:this={startField}
					bind:value={start}
					type="date"
					class="input"
					required
					aria-required="true"
					aria-invalid={startProblem !== null}
					aria-describedby={startProblem ? `${ids.start}-error` : undefined}
				/>
				{#if startProblem}
					<p class="error" id="{ids.start}-error" role="alert">{N.errors.start}</p>
				{/if}
			</div>
			<div class="field">
				<label for={ids.zone}>{N.zone}</label>
				<select
					id={ids.zone}
					bind:this={zoneField}
					bind:value={zone}
					class="input"
					aria-invalid={zoneProblem !== null}
					aria-describedby={zoneProblem ? `${ids.zone}-error` : undefined}
				>
					<option value="">{N.zoneNone}</option>
					{#each zones as z (z)}
						<option value={z}>{z}</option>
					{/each}
				</select>
				{#if zoneProblem}
					<p class="error" id="{ids.zone}-error" role="alert">{N.errors.zone}</p>
				{/if}
			</div>
		</div>
		<p class="note">{N.frameNote}</p>
		<div class="buttons">
			<button type="button" class="secondary" onclick={() => (app.newPlanOpen = false)}>
				{N.cancel}
			</button>
			<button type="submit" class="primary" disabled={busy}>{N.create}</button>
		</div>
	</form>
</Sheet>

<style>
	.form {
		display: grid;
		gap: var(--space-4);
	}
	.lead,
	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.note {
		font-size: var(--text-xs);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-inline-size: 0;
	}
	label {
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	/* Two columns where there is room, one on a phone. */
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-4);
	}
	.input {
		inline-size: 100%;
		min-inline-size: 0;
		min-block-size: var(--size-control);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		/* 16 px at least, so that iOS does not zoom when a field takes the focus. */
		font: inherit;
		font-size: max(16px, var(--text-md));
	}
	.input:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.input[aria-invalid='true'] {
		border-color: var(--color-ruby);
	}
	.error {
		margin: 0;
		color: var(--color-ruby-ink);
		font-size: var(--text-xs);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button {
		min-block-size: var(--size-tap);
		padding-inline: var(--space-6);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	button:hover {
		background: var(--color-row-hover);
	}
	button.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	button.primary:hover {
		background: var(--color-accent-hover);
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
