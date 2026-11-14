<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the engine popover lists (phase-2.md 9.4; ADR-0012): the last run's timings with the note
	that the round trip is not all scheduling, "This app" (the build, Check for updates, Reload),
	and the versions the bundle is made of. Desktop's EngineInfo and the phone's StatusButton
	both show exactly this, in their own popover. The buttons are 44 px tall where the pointer is
	coarse, and wherever the owner sets `--details-tap` (the phone's popover always does).
-->
<script lang="ts">
	import type { EngineInfo } from '../../lib/state/status';
	import type { AppUpdates } from '../../lib/state/updates.svelte';
	import { buildLabel } from '../../lib/app/build';
	import { strings } from '../../lib/strings';

	interface Props {
		info: EngineInfo | null;
		/** This app's build and whether a newer one is deployed (ADR-0012). */
		updates?: AppUpdates | undefined;
		onreload?: (() => void) | undefined;
	}
	let { info, updates, onreload }: Props = $props();

	const updateText = $derived(
		updates === undefined
			? ''
			: updates.checking
				? strings.update.checking
				: updates.status === 'available'
					? strings.update.available
					: updates.status === 'current'
						? strings.update.current
						: '',
	);
</script>

{#if info && info.timings.length > 0}
	<h3>{strings.status.timingTitle}</h3>
	<dl>
		{#each info.timings as line (line.label)}
			<dt>{line.label}</dt>
			<dd>{line.value}</dd>
		{/each}
	</dl>
	{#if info.note}<p class="note">{info.note}</p>{/if}
{/if}
{#if updates}
	<h3>{strings.update.title}</h3>
	<dl>
		<dt>{strings.update.build}</dt>
		<dd>{buildLabel(updates.build)}</dd>
	</dl>
	<div class="app-actions">
		<button type="button" onclick={() => void updates.checkNow()} disabled={updates.checking}>
			{strings.update.check}
		</button>
		<button type="button" class:primary={updates.status === 'available'} onclick={onreload}>
			{strings.update.reload}
		</button>
		<span class="update-state" role="status">{updateText}</span>
	</div>
{/if}
{#if info && info.versions.length > 0}
	<h3>{strings.status.versionsTitle}</h3>
	<dl>
		{#each info.versions as line (line.label)}
			<dt>{line.label}</dt>
			<dd>{line.value}</dd>
		{/each}
	</dl>
{/if}

<style>
	/* Section labels, as everywhere else in the app: small, uppercase, spaced. */
	h3 {
		margin: var(--space-3) 0 var(--space-1);
		color: var(--color-text-muted);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		font-size: var(--text-sm);
	}
	dt {
		color: var(--color-text-muted);
	}
	dd {
		margin: 0;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.note {
		margin: var(--space-2) 0 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.app-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-block-start: var(--space-2);
	}
	.app-actions button {
		min-block-size: var(--details-tap, 1.75rem);
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.app-actions button.primary {
		border-color: var(--color-mark-brass);
		font-weight: 600;
	}
	.app-actions button:hover {
		background: var(--color-row-hover);
	}
	.update-state {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	@media (pointer: coarse) {
		.app-actions button {
			min-block-size: var(--size-tap);
		}
	}
</style>
