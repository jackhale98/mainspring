<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The status strip (phase-1.md 8.2): scheduler state, the finish date in the project's time zone
	with its change, problem counts that jump to the next problem, messages that have no place in
	the text (a popover), and a retry button after a failure. The last good finish stays visible
	and is labelled, not faded, when the newest run did not succeed. At the end sit the engine's
	version and the last run's time, which open a popover with every stage (phase-2.md 9.4).

	On a phone (`phone`) nothing of this is drawn: the footer is gone, and the top bar's status
	button (app/StatusButton.svelte) holds the controls. What stays is the same "Plan status"
	group, visually hidden, with the state text and the live region, so a screen reader still
	hears every reschedule, problem and failure by the same rules. It has no focusable controls.
-->
<script lang="ts">
	import type { AppState } from '../lib/state/app.svelte';
	import type { AppUpdates } from '../lib/state/updates.svelte';
	import { announcesRun, type StatusKind } from '../lib/state/status';
	import { strings } from '../lib/strings';
	import EngineInfo from './app/EngineInfo.svelte';
	import Mark from './app/Mark.svelte';

	interface Props {
		app: AppState;
		/** Whether a newer build is deployed (ADR-0012); a reload button shows when it is. */
		updates?: AppUpdates;
		/** A phone: only the hidden group is drawn (module comment). */
		phone: boolean;
		/**
		 * The Gantt is on screen and says what a reschedule moved (its treegrid's live region), so
		 * a plain ok run after an ok run is not announced twice. Everything else is
		 * (`announcesRun`): problems, warnings, and an ok run after a problem.
		 */
		quiet?: boolean;
	}
	let { app, updates, phone, quiet = false }: Props = $props();

	function reload(): void {
		void updates?.reloadAsking(app.dirty);
	}

	const s = $derived(app.status);
	const problems = $derived(s ? s.errors + s.warnings : 0);

	let popover: HTMLElement | undefined = $state();

	/** The sentence a screen reader hears when a run settles; empty until the first one does. */
	let announcement = $state('');
	/** The kind of the run before this one (null at the start, and while another plan loads). */
	let previous: StatusKind | null = null;
	$effect(() => {
		const v = s;
		if (!v) return;
		if (v.kind === 'booting' || v.kind === 'idle') previous = null;
		if (v.kind === 'scheduling' || v.kind === 'booting' || v.kind === 'idle') return;
		const say = announcesRun(v, previous, quiet);
		previous = v.kind;
		// Skipping clears the region, so the next problem is a change in it and is always spoken.
		if (!say) {
			announcement = '';
			return;
		}
		const parts = [v.failure ?? v.label];
		if (v.finish)
			parts.push(`${strings.status.finish} ${v.finish}${v.delta ? `, ${v.delta}` : ''}`);
		parts.push(v.counts);
		announcement = parts.join('. ');
	});

	function jump(): void {
		if (app.goToNextProblem()) return;
		// Nothing to jump to: the messages without a place are the only ones left.
		if (s && s.unlocated.length > 0 && popover && !popover.matches(':popover-open')) {
			popover.showPopover();
		}
	}
</script>

<!--
	The visible strip is not a live region: it holds buttons and changes while the user types, and
	a polite region that is atomic would read it all out again each time. The hidden region below
	speaks once per settled run, and only when its text changes.
-->
{#if phone}
	<!-- No controls here: they are in the status button's popover (module comment). -->
	<div class="sr-only" role="group" aria-label={strings.status.region}>
		<div role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
		{#if s}
			<p class="state" data-kind={s.kind}>{s.label}</p>
			<p class="finish">
				<span class="key">{strings.status.finish}</span>
				{#if s.finish}
					<time datetime={app.run?.finish?.date}>{s.finish}</time>
					{#if s.delta}<span class="delta">{s.delta}</span>{/if}
					{#if s.outdated}<span class="badge">{strings.status.lastGood}</span>{/if}
				{:else}
					<span class="zone">{strings.status.noFinish}</span>
				{/if}
			</p>
			<p class="counts">{s.counts}</p>
			{#if s.unlocated.length > 0}<p>{strings.status.unlocated(s.unlocated.length)}</p>{/if}
			{#if s.failure}<p class="failure">{s.failure}</p>{/if}
		{/if}
	</div>
{:else}
	<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
	{#if s}
		<div class="strip" role="group" aria-label={strings.status.region}>
			<span class="state" data-kind={s.kind}>
				{#if s.kind === 'scheduling' || s.kind === 'booting'}<Mark size={14} busy />{:else}<span
						class="dot"
						aria-hidden="true"
					></span>{/if}{s.label}
			</span>
			<span class="finish" class:outdated={s.outdated}>
				<span class="key">{strings.status.finish}</span>
				{#if s.finish}
					<time datetime={app.run?.finish?.date}>{s.finish}</time>
					{#if s.zone}<span class="zone">{s.zone}</span>{/if}
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
			{#if updates?.status === 'available'}
				<button
					type="button"
					class="update"
					aria-label={strings.update.reloadLabel}
					title={strings.update.reloadLabel}
					onclick={reload}
					data-testid="update-reload"
				>
					<span class="pip" aria-hidden="true"></span>
					<span aria-hidden="true">{`${strings.update.available} · ${strings.update.reload}`}</span>
				</button>
			{/if}
			{#if s.engine}<EngineInfo info={s.engine} {updates} onreload={reload} />{/if}
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
{/if}

<style>
	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		min-block-size: 40px;
		padding: var(--space-1) var(--gutter);
		font-size: var(--text-sm);
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	/* The dot differs in shape as well as colour: a circle when fine, a diamond for errors, and while it
	   works the ticking brand mark instead (WCAG 1.4.1). */
	.dot {
		flex: none;
		inline-size: 8px;
		block-size: 8px;
		border-radius: 50%;
		background: var(--color-status-neutral);
	}
	.state[data-kind='ok'] .dot {
		background: var(--color-status-ok);
		box-shadow: 0 0 0 3px var(--color-status-ok-halo);
	}
	.state[data-kind='errors'] .dot,
	.state[data-kind='failed'] .dot {
		border-radius: 1px;
		transform: rotate(45deg);
		background: var(--color-diagnostic-error);
		box-shadow: 0 0 0 3px var(--color-ruby-wash);
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
	.counts {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.counts:hover {
		background: var(--color-row-hover);
	}
	.counts.plain {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: default;
	}
	.failure {
		color: var(--color-diagnostic-error);
		font-weight: 600;
	}
	.retry {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-pill);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.retry:hover {
		background: var(--color-accent-hover);
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
	/* The browser centres a popover (fixed, inset 0, auto margins); keep that, set the size. */
	.popover {
		margin: auto;
		inline-size: min(30rem, calc(100vw - 2rem));
		max-block-size: 70dvh;
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}
	.popover h2 {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	.popover ul {
		margin: 0;
		padding-inline-start: var(--space-4);
	}
	.popover li + li {
		margin-block-start: var(--space-2);
	}
	.update {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-inline-start: auto;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-mark-brass);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		min-block-size: 1.75rem;
	}
	.update:hover {
		background: var(--color-row-hover);
	}
	.update + :global(.engine-info) {
		margin-inline-start: 0;
	}
	.pip {
		flex: none;
		inline-size: 7px;
		block-size: 7px;
		border-radius: 50%;
		background: var(--color-mark-brass);
	}
	@media (pointer: coarse) {
		.update {
			min-block-size: var(--size-tap);
		}
	}
</style>
