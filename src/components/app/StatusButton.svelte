<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The phone's status button, in the top bar (polish 8: use the phone's screen better). It
	replaces the footer's status strip and the engine dot: one 44 px button whose icon is the
	plan's combined state (StatusGlyph), with a small brass pip when a newer build is deployed
	(ADR-0012). Its name says the state, the problem counts and the update, and what it opens.
	Tapping it opens a popover with, in order: the plan's status (state, finish with its change,
	the problem counts as a button that goes to the next problem, messages without a place, and on
	a failure the reason with Try again); a prominent New version button when one is out; and the
	same engine details desktop's EngineInfo shows (EngineDetails). The StatusStrip's hidden
	"Plan status" group still speaks the runs; this is the visible half and holds the controls.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { statusGlyph } from '../../lib/state/status';
	import type { AppUpdates } from '../../lib/state/updates.svelte';
	import { engineLine, strings } from '../../lib/strings';
	import DetailsPopover from './DetailsPopover.svelte';
	import EngineDetails from './EngineDetails.svelte';
	import StatusGlyph from './StatusGlyph.svelte';

	interface Props {
		app: AppState;
		updates?: AppUpdates | undefined;
	}
	let { app, updates }: Props = $props();

	const id = $props.id();
	const s = $derived(app.status);
	const glyph = $derived(statusGlyph(s, app.engine));
	const problems = $derived(s ? s.errors + s.warnings : 0);
	const available = $derived(updates?.status === 'available');
	const name = $derived(
		strings.status.button.name(
			s?.label ?? strings.engine.status[app.engine],
			s && problems > 0 ? s.counts : null,
			available,
		),
	);

	let popover: HTMLElement | undefined = $state();
	let unlocated: HTMLDetailsElement | undefined = $state();

	function reload(): void {
		void updates?.reloadAsking(app.dirty);
	}

	/** Goes to the next problem (the Text tab on a phone) and closes this card. */
	function jump(): void {
		if (app.goToNextProblem()) {
			popover?.hidePopover();
			return;
		}
		// Nothing to jump to: the messages without a place are the only ones left.
		if (unlocated) unlocated.open = true;
	}
</script>

<button
	type="button"
	class="status-button"
	popovertarget="status-details-{id}"
	aria-label={name}
	title={strings.status.button.title}
	data-testid="status-button"
	data-glyph={glyph}
>
	<StatusGlyph kind={glyph} size={22} />
	{#if available}<span class="pip" aria-hidden="true" data-testid="update-pip"></span>{/if}
	<!-- The engine's own line, for tests and tools that wait on it; the name above already speaks. -->
	<span class="sr-only" aria-hidden="true" data-testid="engine-status" data-state={app.engine}>
		{engineLine(app.engine)}
	</span>
</button>
<DetailsPopover
	id="status-details-{id}"
	title={strings.status.button.popoverTitle}
	testid="engine-info-details"
	bind:popover
>
	<div class="phone-details">
		{#if s}
			<p class="state" data-kind={s.kind}>
				<StatusGlyph kind={glyph} size={16} />{s.label}
			</p>
			<p class="finish" class:outdated={s.outdated}>
				<span class="key">{strings.status.finish}</span>
				{#if s.finish}
					<time datetime={app.run?.finish?.date}>{s.finish}</time>
					{#if s.delta}<span class="muted">{s.delta}</span>{/if}
					{#if s.outdated}<span class="badge">{strings.status.lastGood}</span>{/if}
				{:else}
					<span class="muted">{strings.status.noFinish}</span>
				{/if}
			</p>
			{#if s.failure}
				<p class="failure">{s.failure}</p>
				<button type="button" class="primary" onclick={() => app.retry()}>
					{strings.engine.retry}
				</button>
			{/if}
			{#if problems > 0}
				<button type="button" class="row" onclick={jump} data-testid="next-problem">
					<span>{s.counts}</span><span class="hint">{strings.status.nextProblem}</span>
				</button>
			{:else if !s.failure}
				<p class="muted">{s.counts}</p>
			{/if}
			{#if s.unlocated.length > 0}
				<details class="unlocated" bind:this={unlocated}>
					<summary>{strings.status.unlocated(s.unlocated.length)}</summary>
					<ul>
						{#each s.unlocated as d, i (i)}
							<li>
								<strong>{strings.status.severity[d.severity]}.</strong>
								{d.message}{d.hint ? ` ${d.hint}` : ''}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		{:else}
			<p class="state"><StatusGlyph kind={glyph} size={16} />{strings.engine.status[app.engine]}</p>
		{/if}
		{#if available}
			<button type="button" class="primary update" onclick={reload} data-testid="update-reload">
				<span class="pip" aria-hidden="true"></span>
				{`${strings.update.available} · ${strings.update.reload}`}
			</button>
		{/if}
	</div>
	<EngineDetails info={s?.engine ?? null} {updates} onreload={reload} />
</DetailsPopover>

<style>
	.status-button {
		position: relative;
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: var(--size-tap);
		block-size: var(--size-tap);
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
		color: var(--color-text);
		cursor: pointer;
	}
	.status-button:hover {
		background: var(--color-row-hover);
	}
	.pip {
		flex: none;
		inline-size: 8px;
		block-size: 8px;
		border-radius: 50%;
		background: var(--color-mark-brass);
	}
	.status-button .pip {
		position: absolute;
		inset-block-start: 5px;
		inset-inline-end: 5px;
		box-shadow: 0 0 0 2px var(--color-surface);
	}
	.phone-details {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		/* Every button in this card is 44 px tall (the engine details below use it too). */
		--details-tap: var(--size-tap);
	}
	.phone-details p {
		margin: 0;
	}
	.state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	.finish {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}
	.finish.outdated {
		color: var(--color-text-muted);
		font-style: italic;
	}
	.key,
	.muted {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	time {
		font-family: var(--font-display);
		font-size: 1.15em;
	}
	.badge {
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-xs);
		font-style: normal;
	}
	.failure {
		color: var(--color-diagnostic-error);
		font-weight: 600;
	}
	.phone-details button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-block-size: var(--size-tap);
		padding: var(--space-1) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.phone-details button:hover {
		background: var(--color-row-hover);
	}
	.phone-details button.row {
		justify-content: space-between;
		font-weight: 600;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: 400;
	}
	.phone-details button.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font-weight: 600;
	}
	.phone-details button.primary:hover {
		background: var(--color-accent-hover);
	}
	/* A new build is out: brass, the update's colour everywhere else (ADR-0012). */
	.phone-details button.update {
		border-color: var(--color-mark-brass);
		background: var(--color-surface);
		color: var(--color-text);
	}
	.phone-details button.update:hover {
		background: var(--color-row-hover);
	}
	.unlocated summary {
		display: flex;
		align-items: center;
		min-block-size: var(--size-tap);
		padding-inline: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.unlocated ul {
		margin: var(--space-2) 0 0;
		padding-inline-start: var(--space-4);
		font-size: var(--text-sm);
	}
	.unlocated li + li {
		margin-block-start: var(--space-2);
	}
</style>
