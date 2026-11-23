<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The notice under the top bar about where the open plan is kept (phase-4.md 7.1, 9.4), on every
	layout:
	- read-only, because another tab has the plan (`elsewhere`: it was open there first; `taken`: it
	  was taken over there), with "Open here instead", which takes it into this tab;
	- the browser cleared the plans it kept (the eviction marker, 9.4), until dismissed;
	- on a phone, which has no footer line, changes that could not be kept (8.1 #8).
	A lazy chunk: App.svelte mounts it the first time one of them applies. T14's sync status takes
	the failure over.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { storageStrings } from '../../lib/strings-storage';

	interface Props {
		app: AppState;
		phone: boolean;
	}
	let { app, phone }: Props = $props();
	const S = storageStrings.notice;

	const kind = $derived(
		app.readOnly
			? app.heldElsewhere !== null
				? 'elsewhere'
				: 'taken'
			: app.cleared
				? 'cleared'
				: phone && app.keep.kind === 'failed'
					? 'failed'
					: null,
	);
	let busy = $state(false);

	async function openHere(): Promise<void> {
		const id = app.storedId;
		if (id === null || busy) return;
		busy = true;
		try {
			await app.openStored(id, { steal: true });
		} finally {
			busy = false;
		}
	}
</script>

{#if kind}
	<div class="notice" role="status" data-testid="plan-notice" data-kind={kind}>
		<p>{S[kind]}</p>
		{#if kind === 'elsewhere' || kind === 'taken'}
			<button type="button" class="primary" disabled={busy} onclick={openHere}>{S.openHere}</button>
		{:else if kind === 'cleared'}
			<button type="button" onclick={() => (app.cleared = false)}>{S.dismiss}</button>
		{/if}
	</div>
{/if}

<style>
	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		margin-block-end: var(--gap-panel);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		border-radius: 14px;
		background: var(--color-brass-wash);
		box-shadow: var(--shadow-chip);
		color: var(--color-brass-ink);
		font-size: var(--text-sm);
	}
	p {
		flex: 1 1 16rem;
		margin: 0;
	}
	button {
		min-block-size: var(--size-control);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	button.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}
	button:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	button:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		button {
			min-block-size: var(--size-tap);
		}
	}
</style>
