<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The notice under the top bar about where the open plan is kept (phase-4.md 7.1, 9.4), on every
	layout:
	- read-only, because another tab has the plan (`elsewhere`: it was open there first; `taken`: it
	  was taken over there), with "Open here instead", which takes it into this tab;
	- another tab took the plan before this one had stored its latest changes (`refused`, T4
	  re-check N1): they stay on screen, read-only; "Copy the text" puts the open file's text on the
	  clipboard (export is T5's), and "Open here instead" asks first, since it drops them;
	- the last plan could not be opened (the store or the keeper chunk failed, or the plan is
	  damaged): a sample is open meanwhile, and Try again opens the plan (T4 review H2, M2). A
	  browser remembers a failed import, so after a failed try the button reloads the page, which
	  opens the last plan again (the pointer was left alone);
	- the browser cleared the plans it kept (the eviction marker, 9.4), until dismissed;
	- on a phone, which has no footer line, changes that could not be kept (8.1 #8);
	- "which plan?" when a folder or the opened files hold several (18.22, T5; `app.planQuestion`),
	  a button per plan and Cancel, the focus on the first plan. T15's chooser takes it over.
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

	const k = $derived(app.keeping);
	const refused = $derived(k.keep.kind === 'failed' && k.keep.error.kind === 'not-owner');
	const kind = $derived(
		refused
			? 'refused'
			: app.readOnly
				? app.heldElsewhere !== null
					? 'elsewhere'
					: 'taken'
				: k.unopened !== null
					? 'unopened'
					: k.cleared
						? 'cleared'
						: phone && k.keep.kind === 'failed'
							? 'failed'
							: null,
	);
	let busy = $state(false);
	/** Try again failed: the next press reloads the page instead. */
	let tried = $state(false);
	/** The file whose text "Copy the text" copied (or failed to), and how that went. */
	let copied = $state<{ readonly path: string; readonly ok: boolean } | null>(null);

	/** The open file's text to the clipboard: what this tab could not keep (N1). */
	async function copy(): Promise<void> {
		const path = app.activeFile;
		const text = app.workspace?.texts()[path] ?? '';
		let ok = true;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			ok = false;
		}
		copied = { path, ok };
	}

	const q = $derived(app.planQuestion);
	let first: HTMLButtonElement | undefined = $state();
	// The question comes after a picker closed: the focus goes to its first answer.
	$effect(() => {
		if (q) first?.focus();
	});

	/** "Open here instead" takes the open plan; Try again opens the one that could not be opened. */
	async function open(id: string | null, steal: boolean): Promise<void> {
		if (id === null || busy) return;
		busy = true;
		try {
			await app.openStored(id, { steal });
		} finally {
			busy = false;
		}
	}
</script>

{#if q}
	<div
		class="notice"
		role="group"
		aria-labelledby="plan-question"
		data-testid="plan-question"
		data-kind="which"
	>
		<p id="plan-question">{S.which(q.where, q.plans.length)}</p>
		{#each q.plans as p, i (p)}
			{#if i === 0}
				<button type="button" class="primary" bind:this={first} onclick={() => q.answer(p)}
					>{p}</button
				>
			{:else}
				<button type="button" class="primary" onclick={() => q.answer(p)}>{p}</button>
			{/if}
		{/each}
		<button type="button" onclick={() => q.answer(null)}>{S.cancel}</button>
	</div>
{/if}
{#if kind}
	<div class="notice" role="status" data-testid="plan-notice" data-kind={kind}>
		<p>{S[kind]}</p>
		{#if kind === 'refused'}
			<button type="button" onclick={copy}
				>{copied?.path !== app.activeFile
					? S.copyText
					: copied.ok
						? S.copied
						: S.copyFailed}</button
			>
		{/if}
		{#if kind === 'elsewhere' || kind === 'taken' || kind === 'refused'}
			<button type="button" class="primary" disabled={busy} onclick={() => open(app.storedId, true)}
				>{S.openHere}</button
			>
		{:else if kind === 'unopened'}
			<button
				type="button"
				class="primary"
				disabled={busy}
				onclick={() => {
					if (tried) void app.reloadPage();
					else void open(k.unopened, false).then(() => (tried = k.unopened !== null));
				}}>{tried ? S.reload : S.retry}</button
			>
		{:else if kind === 'cleared'}
			<button type="button" onclick={() => (k.cleared = false)}>{S.dismiss}</button>
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
