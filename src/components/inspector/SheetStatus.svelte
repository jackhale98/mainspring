<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	A compact status chip for the phone's details sheet header. The sheet covers the status strip,
	so it carries the run's state itself: "Scheduled" or "Scheduling…", and, when the plan has
	problems or does not schedule, their count. With problems it is a button that goes to the next
	one in the text (as the strip's counts do); otherwise it is plain text. The label and the
	counts are the strip's own (lib/state/status.ts), never a second reading of the run.
-->
<script lang="ts">
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';

	let { app }: { app: AppState } = $props();

	const s = $derived(app.status);
	const problems = $derived(s ? s.errors + s.warnings : 0);
	/** What the chip says: the failure, the count of problems, or the run's state. */
	const text = $derived(
		!s
			? ''
			: s.kind === 'failed'
				? strings.status.failed
				: s.kind === 'errors' || problems > 0
					? s.counts
					: s.label,
	);

	function jump(): void {
		app.goToNextProblem();
	}
</script>

{#if s}
	{#if problems > 0}
		<button
			type="button"
			class="chip problem"
			data-kind={s.kind}
			title={strings.status.nextProblem}
			onclick={jump}
		>
			<span class="dot" aria-hidden="true"></span>{text}
		</button>
	{:else}
		<span class="chip" data-kind={s.kind}>
			<span class="dot" aria-hidden="true"></span>{text}
		</span>
	{/if}
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-block-size: 28px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-surface-sunken);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	button.chip {
		min-block-size: var(--size-tap);
		border-color: var(--color-ruby);
		background: var(--color-ruby-wash);
		color: var(--color-ruby-ink);
		font-weight: 600;
		cursor: pointer;
	}
	button.chip:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.dot {
		inline-size: 8px;
		block-size: 8px;
		border-radius: 50%;
		background: var(--color-status-ok);
	}
	.chip[data-kind='errors'] .dot,
	.chip[data-kind='failed'] .dot,
	.problem .dot {
		background: var(--color-ruby);
	}
	.chip[data-kind='scheduling'] .dot,
	.chip[data-kind='booting'] .dot,
	.chip[data-kind='idle'] .dot {
		background: var(--color-status-neutral);
	}
</style>
