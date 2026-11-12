<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!-- The status summary at the top of the phone's Plan panel: the same facts as the strip, larger. -->
<script lang="ts">
	import type { AppState } from '../lib/state/app.svelte';
	import { strings } from '../lib/strings';

	let { app }: { app: AppState } = $props();
	const s = $derived(app.status);
</script>

{#if s}
	<section class="summary" aria-labelledby="summary-title">
		<h2 id="summary-title">{strings.status.region}</h2>
		<p class="state" data-kind={s.kind}>{s.label}</p>
		<p class="finish" class:outdated={s.outdated}>
			<span class="key">{strings.status.finish}</span>
			{#if s.finish}
				<time class="date" datetime={app.run?.finish?.date}>{s.finish}</time>
				<span class="meta">
					{s.zone}{s.delta ? `, ${s.delta}` : ''}{s.outdated ? `, ${strings.status.lastGood}` : ''}
				</span>
			{:else}
				<span class="meta">{strings.status.noFinish}</span>
			{/if}
		</p>
		<p class="counts">{s.counts}</p>
		{#if s.failure}
			<p class="failure">
				{s.failure}
				<button type="button" onclick={() => app.retry()}>{strings.engine.retry}</button>
			</p>
		{/if}
		{#if s.unlocated.length > 0}
			<ul class="unlocated" aria-label={strings.status.unlocatedTitle}>
				{#each s.unlocated as d, i (i)}
					<li><strong>{strings.status.severity[d.severity]}.</strong> {d.message}</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.summary {
		padding: var(--space-3) var(--gutter);
		border-block-end: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	h2 {
		margin: 0 0 var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	p {
		margin: 0;
	}
	.state {
		font-weight: 600;
	}
	.finish {
		display: flex;
		flex-direction: column;
		margin-block: var(--space-2);
	}
	.finish.outdated {
		color: var(--color-text-muted);
		font-style: italic;
	}
	.key,
	.meta,
	.counts {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.date {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.failure {
		margin-block-start: var(--space-2);
		color: var(--color-diagnostic-error);
		font-weight: 600;
	}
	button {
		min-block-size: var(--size-tap);
		margin-inline-start: var(--space-2);
		padding-inline: var(--space-4);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font: inherit;
	}
	.unlocated {
		margin: var(--space-2) 0 0;
		padding-inline-start: var(--space-4);
		font-size: var(--text-sm);
	}
</style>
