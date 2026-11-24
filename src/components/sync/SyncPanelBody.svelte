<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the Sync panel says (phase-4.md 11.1; T14), in the popover and in the phone's sheet: what the
	state means in one plain sentence, where the plan lives (the location line), when it was last
	kept, and the actions that exist today (`actionsOf`, lib/sync/panel.ts): "Copy the text" for
	changes the store refused, "Open here instead" for a tab that does not hold the plan (both T4's,
	lib/state/plan-actions.ts, the notice's own handlers).

	T14 part two (after T7) fills the marked slots below, from the same `app.sync` controller that
	`statusOf` already reads: Commit (GitHub: the Commit sheet) or Save (a folder), Sync, Reconnect and
	Export, with the queue list under them. Nothing else here changes: the control's status and this
	body's sentence and rows already cover every `SyncStatus`.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { copyOpenText, openHere, type Copied } from '../../lib/state/plan-actions';
	import { actionsOf, formatKept, keptOf, locationLine, sentenceOf } from '../../lib/sync/panel';
	import { locationOf, statusOf } from '../../lib/sync/shown';
	import { viewOf } from '../../lib/sync/status-view';
	import { storageStrings } from '../../lib/strings-storage';
	import { syncStrings as S } from '../../lib/strings-sync';

	interface Props {
		app: AppState;
	}
	let { app }: Props = $props();
	const N = storageStrings.notice;

	const s = $derived(statusOf(app));
	const v = $derived(viewOf(s));
	const kept = $derived(keptOf(s));
	const actions = $derived(actionsOf(s, app.readOnly));
	let copied = $state<Copied | null>(null);
	let busy = $state(false);

	async function take(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await openHere(app);
		} finally {
			busy = false;
		}
	}
</script>

<div class="body" data-testid="sync-panel-body" data-kind={s.kind} data-tone={v.tone}>
	<p class="state">{sentenceOf(s)}</p>
	<dl>
		<!-- A sample is not stored anywhere yet: the sentence says where its copy will be. -->
		{#if s.kind !== 'sample'}
			<dt>{S.where}</dt>
			<dd data-testid="sync-location">{locationLine(locationOf(app))}</dd>
		{/if}
		{#if kept}
			<dt>{S.lastKept}</dt>
			<dd>{kept.at === null ? S.notYet : formatKept(kept.at, Date.now())}</dd>
		{/if}
	</dl>
	{#if actions.length > 0}
		<div class="actions">
			{#if actions.includes('copy-text')}
				<button type="button" onclick={async () => (copied = await copyOpenText(app))}
					>{copied?.path !== app.activeFile
						? N.copyText
						: copied.ok
							? N.copied
							: N.copyFailed}</button
				>
			{/if}
			{#if actions.includes('open-here')}
				<button type="button" class="primary" disabled={busy} onclick={take}>{N.openHere}</button>
			{/if}
		</div>
	{/if}
	<!-- T14 part two, slots (after T7; see the module comment). Each is a button of `.actions`:
	     [slot: save]      a folder's Save (Ctrl/Cmd+S), `app.sync.save()`;
	     [slot: commit]    GitHub's Commit, which opens the Commit sheet (`app.sync.draft()`);
	     [slot: sync]      `app.sync.sync()`, and Reconnect when the status is `needs-access`;
	     [slot: queue]     `app.sync.queue`, with Discard (asks first) and Export;
	     [slot: settings]  the Settings dialog (T17), Save to… for a browser-only plan (T15). -->
</div>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}
	.state {
		margin: 0;
		line-height: var(--leading);
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-4);
		margin: 0;
	}
	dt {
		color: var(--color-text-muted);
	}
	dd {
		margin: 0;
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
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
</style>
