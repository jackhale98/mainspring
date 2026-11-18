<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The plan chip (ADR-0009): the open plan's name on a pill with a file icon and a chevron. It is a
	real <select> underneath, so it opens the native picker (the best on a phone) and keeps its
	accessible name "Sample plan". Replacing a plan that was edited asks first (AppState). The
	list is "New plan…" first (it opens the New plan sheet, which App.svelte mounts once, so that
	a layout change that remounts this chip does not lose what was typed), then the
	plan made here as "Name (new)" while it is open, then the "Samples" group (ADR-0013 #2).
	`title` style puts the name in the serif display face for the phone header.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import { NEW_PLAN_ID } from '../../lib/workspace/samples';
	import Icon from '../Icon.svelte';

	interface Props {
		app: AppState;
		/** The phone's form: the name as a serif title, with a subtitle under it. */
		title?: boolean;
		subtitle?: string;
	}
	let { app, title = false, subtitle = '' }: Props = $props();

	/** The "New plan…" entry's value: not a plan's key. */
	const CREATE = '__new-plan__';

	async function pick(event: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
		const select = event.currentTarget;
		if (select.value === CREATE) {
			select.value = app.sampleId;
			app.newPlanOpen = true;
			return;
		}
		if (select.value === NEW_PLAN_ID) return;
		const opened = await app.openSample(select.value);
		// A cancelled switch leaves the old plan open: show it in the picker again.
		if (!opened) select.value = app.sampleId;
	}
</script>

<label class="chip" class:title>
	{#if !title}<Icon name="file" size={15} />{/if}
	<span class="text" aria-hidden="true">
		<span class="name">{app.planLabel}</span>
		{#if title && subtitle !== ''}<span class="sub">{subtitle}</span>{/if}
	</span>
	<Icon name="chevronDown" size={title ? 16 : 13} />
	<select data-own-caret value={app.sampleId} onchange={pick} aria-label={strings.topBar.sample}>
		<option value={CREATE}>{strings.newPlan.chooser}</option>
		{#if app.newPlanName !== null}
			<option value={NEW_PLAN_ID}>{app.planLabel}</option>
		{/if}
		<optgroup label={strings.newPlan.samplesGroup}>
			{#each app.samples as sample (sample.id)}
				<option value={sample.id}>{sample.label}</option>
			{/each}
		</optgroup>
	</select>
</label>

<style>
	.chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-inline-size: 0;
		max-inline-size: 100%;
		min-block-size: var(--size-control);
		padding-inline: 12px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}
	.chip :global(.icon) {
		color: var(--color-text-muted);
	}
	.text {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The real control covers the chip: a tap anywhere opens the picker. */
	select {
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		margin: 0;
		border: 0;
		border-radius: inherit;
		opacity: 0;
		cursor: pointer;
		font-size: max(16px, var(--text-sm));
	}
	.chip:has(select:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.chip:hover {
		background: var(--color-row-hover);
	}
	/* The phone's header: the plan's name is the title, in the serif face, on the canvas. */
	.chip.title {
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		gap: 4px;
	}
	.chip.title:hover {
		background: transparent;
	}
	.chip.title .name {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 400;
		line-height: 1.1;
	}
	.chip.title .sub {
		color: var(--color-text-muted);
		font-size: 12px;
		font-weight: 400;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
