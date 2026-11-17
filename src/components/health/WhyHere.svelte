<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	"Why here?" (phase-3.md 9.7; T18): why a task starts (or, for an ALAP task, ends) where the
	schedule put it, from the explainer (lib/schedule/explain.ts), and then what its bar waits for
	inside ("Inside the bar"). Each cause is a sentence with its links: to the task it waits for,
	to the person's cell in the heatmap, or to the text. It says what the schedule shows and says
	less when unsure: where the explainer cannot tell, it says "The schedule does not show why."
	and claims nothing else. Display only: nothing here edits the plan.

	It is the lazy half of the task details' Schedule block and of the heatmap's cell details
	(each mounts it when it is first asked for), and it is given the result it explains, so it
	agrees with the dates the view beside it shows.
-->
<script lang="ts">
	import type { ScheduleResult } from '../../engine/protocol';
	import { placementOf } from '../../lib/health/compute';
	import { whyText, type WhyLink } from '../../lib/health/why-text';
	import type { AppState } from '../../lib/state/app.svelte';
	import { whyStrings as W } from '../../lib/strings-health';
	import type { SymbolIndex, TaskId } from '../../lib/tjp/index';

	interface Props {
		app: AppState;
		task: TaskId;
		result: ScheduleResult | null;
		index: SymbolIndex | null;
		/** What a link to a task does; by default the task is selected. */
		ontask?: ((task: TaskId) => void) | undefined;
	}
	let { app, task, result, index, ontask }: Props = $props();

	const found = $derived(result && index ? placementOf(result, index, task) : null);
	const why = $derived(found ? whyText(found.placement, found.ctx) : null);

	function follow(l: WhyLink): void {
		if (l.kind === 'task') {
			if (ontask) ontask(l.task);
			else app.selection.selectTask(l.task, 'visual');
		} else if (l.kind === 'person') app.openInWorkload(l.resource, l.at);
		else if (app.shell) app.shell.showInText(l.at);
		else app.showRange(l.at);
	}
</script>

{#snippet lines(list: NonNullable<typeof why>['causes'])}
	<ul>
		{#each list as line, i (i)}
			<li data-kind={line.kind}>
				<span>{line.text}</span>
				{#each line.links as l, j (j)}
					<button type="button" class="link" data-link={l.kind} onclick={() => follow(l)}
						>{l.label}</button
					>
				{/each}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="why" data-testid="why-here">
	{#if why === null}
		<p class="muted">{W.failed}</p>
	{:else}
		{#if why.causes.length === 0}
			<ul>
				<li data-kind="unknown"><span>{W.cause.unknown}</span></li>
			</ul>
		{:else}
			{@render lines(why.causes)}
		{/if}
		{#if why.inside.length > 0}
			<h5>{W.inside}</h5>
			{@render lines(why.inside)}
		{/if}
	{/if}
</div>

<style>
	.why {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-2);
		overflow-wrap: anywhere;
	}
	h5 {
		margin: var(--space-1) 0 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.muted {
		margin: 0;
		color: var(--color-text-muted);
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-accent);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.link:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: 2px;
	}
	@media (pointer: coarse) {
		.link {
			display: inline-flex;
			align-items: center;
			min-block-size: var(--size-tap);
		}
	}
</style>
