<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The status strip (phase-1.md 8.2): scheduler state, the finish date in the project's time zone
	with its change, problem counts that jump to the next problem, messages that have no place in
	the text (a popover), and a retry button after a failure. The last good finish stays visible
	and is labelled, not faded, when the newest run did not succeed.
-->
<script lang="ts">
	import type { AppState } from '../lib/state/app.svelte';
	import { strings } from '../lib/strings';

	interface Props {
		app: AppState;
		compact: boolean;
	}
	let { app, compact }: Props = $props();

	const s = $derived(app.status);
	const problems = $derived(s ? s.errors + s.warnings : 0);

	let popover: HTMLElement | undefined = $state();

	function jump(): void {
		if (!app.goToNextProblem()) popover?.showPopover();
	}
</script>

{#if s}
	<div class="strip" class:compact role="status" aria-label={strings.status.region}>
		<span
			class="state"
			data-kind={s.kind}
			aria-hidden={s.kind === 'scheduling' ? 'true' : undefined}
		>
			<span class="dot" aria-hidden="true"></span>{s.label}
		</span>
		<span class="finish" class:outdated={s.outdated}>
			<span class="key">{strings.status.finish}</span>
			{#if s.finish}
				<time datetime={app.run?.finish?.date}>{s.finish}</time>
				{#if !compact && s.zone}<span class="zone">{s.zone}</span>{/if}
				{#if s.delta}<span class="delta">{s.delta}</span>{/if}
				{#if s.outdated}<span class="badge">{strings.status.lastGood}</span>{/if}
			{:else}
				<span class="zone">{strings.status.noFinish}</span>
			{/if}
		</span>
		{#if problems > 0}
			<button type="button" class="counts" onclick={jump} title={strings.status.nextProblem}>
				{s.counts}
			</button>
		{:else}
			<span class="counts plain">{s.counts}</span>
		{/if}
		{#if s.unlocated.length > 0}
			<button type="button" class="counts" popovertarget="unlocated-popover">
				{strings.status.unlocated(s.unlocated.length)}
			</button>
		{/if}
		{#if s.failure}
			<span class="failure">{s.failure}</span>
			<button type="button" class="retry" onclick={() => app.retry()}>
				{strings.engine.retry}
			</button>
		{/if}
	</div>
	<div id="unlocated-popover" class="popover" popover="auto" bind:this={popover}>
		<h2>{strings.status.unlocatedTitle}</h2>
		<ul>
			{#each s.unlocated as d, i (i)}
				<li>
					<strong>{strings.status.severity[d.severity]}.</strong>
					{d.message}{d.hint ? ` ${d.hint}` : ''}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		padding: var(--space-2) var(--gutter);
		border-block-start: 1px solid var(--color-border);
		background: var(--color-surface);
		font-size: var(--text-sm);
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	.dot {
		inline-size: 0.625rem;
		block-size: 0.625rem;
		border-radius: 50%;
		background: var(--color-status-neutral);
	}
	.state[data-kind='ok'] .dot {
		background: var(--color-status-ok);
	}
	.state[data-kind='errors'] .dot,
	.state[data-kind='failed'] .dot {
		background: var(--color-diagnostic-error);
	}
	.state[data-kind='scheduling'] .dot,
	.state[data-kind='booting'] .dot {
		background: var(--color-accent);
	}
	.finish {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}
	.finish.outdated {
		color: var(--color-text-muted);
		font-style: italic;
	}
	.key,
	.zone,
	.delta {
		color: var(--color-text-muted);
	}
	.badge {
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-xs);
		font-style: normal;
	}
	.counts {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.counts.plain {
		padding: 0;
		border: 0;
		color: var(--color-text-muted);
		cursor: default;
	}
	.failure {
		color: var(--color-diagnostic-error);
		font-weight: 600;
	}
	.retry {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font: inherit;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.compact .state {
		font-weight: 500;
	}
	@media (pointer: coarse) {
		.counts,
		.retry {
			min-block-size: var(--size-tap);
		}
		.counts.plain {
			min-block-size: 0;
		}
	}
	.popover {
		inset: auto;
		margin: auto;
		inline-size: min(30rem, calc(100vw - 2rem));
		max-block-size: 70dvh;
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}
	.popover h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-md);
	}
	.popover ul {
		margin: 0;
		padding-inline-start: var(--space-4);
	}
	.popover li + li {
		margin-block-start: var(--space-2);
	}
</style>
