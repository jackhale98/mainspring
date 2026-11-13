<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The engine's version and the last run's timings in the status strip (phase-2.md 9.4, the Phase
	0 carry-over). The button reads "TaskJuggler 3.8.4 · Last run 182 ms" and opens a popover with
	every stage and the build's versions; on a phone the button is only a gauge icon, because the one-line strip has no room for words. The popover is
	the native kind (light dismiss, Escape, focus returns to the button), so it works by touch,
	where a tooltip would not.
-->
<script lang="ts">
	import type { EngineInfo } from '../../lib/state/status';
	import type { AppUpdates } from '../../lib/state/updates.svelte';
	import { buildLabel } from '../../lib/app/build';
	import Icon from '../Icon.svelte';
	import { strings } from '../../lib/strings';

	interface Props {
		info: EngineInfo;
		/** Phone strip: only the time is drawn; the words stay for assistive technology. */
		compact: boolean;
		/** This app's build and whether a newer one is deployed (ADR-0012). */
		updates?: AppUpdates | undefined;
		onreload?: () => void;
	}
	let { info, compact, updates, onreload }: Props = $props();
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
	const id = $props.id();
	const label = $derived(
		[info.version, info.last === null ? null : strings.status.lastRun(info.last)]
			.filter((p) => p !== null)
			.join(' · '),
	);
</script>

<button
	type="button"
	class="engine-info"
	class:compact
	popovertarget="engine-info-{id}"
	aria-label={`${strings.status.engineDetails}: ${label}`}
	title={strings.status.engineDetailsTitle}
	data-testid="engine-info"
>
	{#if compact}<Icon name="gauge" size={18} />{:else}<span aria-hidden="true">{label}</span>{/if}
</button>
<div id="engine-info-{id}" class="popover" popover="auto" data-testid="engine-info-details">
	<h2>{strings.status.engineDetailsTitle}</h2>
	{#if info.timings.length > 0}
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
	{#if info.versions.length > 0}
		<h3>{strings.status.versionsTitle}</h3>
		<dl>
			{#each info.versions as line (line.label)}
				<dt>{line.label}</dt>
				<dd>{line.value}</dd>
			{/each}
		</dl>
	{/if}
</div>

<style>
	.engine-info {
		flex: none;
		margin-inline-start: auto;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.engine-info.compact {
		display: grid;
		place-items: center;
		padding: 0;
		inline-size: 1.75rem;
	}
	.engine-info:hover {
		background: var(--color-row-hover);
	}
	@media (pointer: coarse) {
		.engine-info {
			min-block-size: var(--size-tap);
		}
		.engine-info.compact {
			inline-size: var(--size-tap);
		}
	}
	/* The browser centres a popover (fixed, inset 0, auto margins); keep that, set the size. */
	.popover {
		margin: auto;
		inline-size: min(26rem, calc(100vw - 2rem));
		max-block-size: 70dvh;
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
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
	.note {
		margin: var(--space-2) 0 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	dd {
		margin: 0;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.app-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-block-start: var(--space-2);
	}
	.app-actions button {
		min-block-size: 1.75rem;
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
