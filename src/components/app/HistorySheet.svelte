<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The phone's History sheet: the undo stack, newest first (what Mod-Z would undo, then what it
	would undo next). It opens on a press and hold of the top bar's Undo, its context menu, or the
	status card's History row (UndoRedo.svelte, StatusButton.svelte). Choosing a line asks "Undo the
	last N changes, back to here?" in a modal of its own; Undo N then rewinds N steps through the
	history's own undo (`app.rewindHistory`), so redo steps forward again, the version checks and
	the Android key guard apply, and a refused step stops it with a message in the compact strip.
	The list is read when the sheet opens: nothing else can change the history while it is modal.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { lineLabel, relativeTime } from '../../lib/state/history-lines';
	import { historyStrings } from '../../lib/strings';
	import Sheet from '../Sheet.svelte';

	let { app }: { app: AppState } = $props();

	const S = historyStrings.sheet;
	const uid = $props.id();
	/** Read when the sheet opens (its first read after `open` turns true), with the time then. */
	const list = $derived(
		app.historyOpen ? { items: app.history.items(), now: Date.now() } : { items: [], now: 0 },
	);
	/** The line asked about: it and every newer one are undone if the person confirms. */
	let chosen = $state<number | null>(null);
	let confirm: HTMLDialogElement | undefined = $state();

	const asked = $derived(chosen === null ? null : (list.items[chosen] ?? null));

	$effect(() => {
		if (!confirm) return;
		if (chosen !== null && !confirm.open) confirm.showModal();
		else if (chosen === null && confirm.open) confirm.close();
	});

	function accept(): void {
		const n = chosen === null ? 0 : chosen + 1;
		chosen = null;
		app.historyOpen = false;
		app.rewindHistory(n);
	}
</script>

<Sheet
	open={app.historyOpen}
	side="bottom"
	title={S.title}
	closeLabel={S.close}
	onclose={() => {
		app.historyOpen = false;
		chosen = null;
	}}
>
	{#if list.items.length === 0}
		<p class="intro" data-testid="history-empty">{S.empty}</p>
	{:else}
		<p class="intro">{S.intro}</p>
		<ol class="entries" data-testid="history-list">
			{#each list.items as item, i (item.id)}
				<li>
					<button
						type="button"
						class="entry"
						data-testid="history-entry"
						onclick={() => (chosen = i)}
					>
						<span class="what">{lineLabel(item)}</span>
						<span class="when">
							{#if i === 0}<span class="tag">{S.latest}</span>{/if}
							{relativeTime(item.time, list.now)}
						</span>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
	<dialog
		bind:this={confirm}
		class="confirm"
		data-testid="history-confirm"
		aria-labelledby="{uid}-confirm"
		aria-describedby="{uid}-body"
		onclose={() => (chosen = null)}
	>
		{#if asked !== null && chosen !== null}
			<h3 id="{uid}-confirm">{S.confirmTitle(chosen + 1)}</h3>
			<p id="{uid}-body">{S.confirmBody(lineLabel(asked))}</p>
			<div class="buttons">
				<button type="button" class="secondary" onclick={() => (chosen = null)}>{S.cancel}</button>
				<button type="button" class="primary" data-testid="history-confirm-undo" onclick={accept}>
					{S.confirm(chosen + 1)}
				</button>
			</div>
		{/if}
	</dialog>
</Sheet>

<style>
	.intro {
		margin: 0 0 var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.entries {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.entry {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		inline-size: 100%;
		min-block-size: var(--size-tap);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.entry:hover {
		background: var(--color-row-hover);
	}
	.what {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.when {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.tag {
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-weight: 600;
	}
	.confirm {
		inline-size: min(22rem, calc(100vw - 2rem));
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}
	.confirm::backdrop {
		background: var(--color-overlay);
	}
	.confirm h3 {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	.confirm p {
		margin: 0 0 var(--space-4);
		overflow-wrap: anywhere;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.buttons button {
		min-block-size: var(--size-tap);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}
	.buttons .primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font-weight: 600;
	}
	.buttons .primary:hover {
		background: var(--color-accent-hover);
	}
</style>
