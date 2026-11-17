<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the scheduler made of the task (phase-2.md 9.3 "Read-only"; phase-3.md 9.7): the engine's
	start and end, the float, and whether it is critical, then "Why here?", which replaces Phase 2's
	"Held by resources or calendars" line: the causes the explainer reads from the schedule, and
	what its bar waits for inside. All of it is read from the schedule the Gantt shows. The float and
	the critical flag are display estimates derived from that result (ADR-0007), so they are
	labelled as such. Nothing here can be edited.

	"Why here?" is a lazy chunk (health/WhyHere.svelte, with the explainer): a first load fetches
	nothing of it, and it is fetched when a task's details first show it. A health finding's "Why
	here?" fix asks for it (`inspector.why`): the section scrolls into view and takes the focus.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { floatAmount } from '../../lib/gantt/describe';
	import type { GanttModel } from '../../lib/gantt/model';
	import { formatMinutes } from '../../lib/gantt/ticks';
	import type { TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';
	import LazyMount from '../app/LazyMount.svelte';
	import { getInspector } from './context';

	let { d, model }: { d: TaskDetails; model: GanttModel } = $props();
	const { app } = getInspector();

	const e = $derived(d.engine);
	const cal = $derived(model.calendar);
	const start = $derived(e.start !== null && cal ? formatMinutes(cal, e.start) : null);
	// The end is the instant the work stops: the last day worked is the minute before it.
	const end = $derived(
		e.start !== null && e.end !== null && cal
			? formatMinutes(cal, Math.max(e.start, e.end - 1))
			: null,
	);
	const float = $derived(
		e.floatMin === null
			? null
			: e.floatMin <= 0
				? S.engine.floatNone
				: floatAmount(e.floatMin, model),
	);

	// What the Gantt shows is what is explained: its result, and the index of the text.
	const view = $derived(app.inspector.view);
	let heading: HTMLElement | undefined = $state();
	let failed = $state(false);

	// A "Why here?" asked for by a finding (and not yet taken): scroll to the section, focus it.
	$effect(() => {
		const ask = app.inspector.why;
		if (!ask || ask.task !== d.id || ask.serial !== app.selection.serial || !heading) return;
		app.inspector.why = null;
		void tick().then(() => {
			heading?.scrollIntoView({ block: 'nearest' });
			heading?.focus();
		});
	});
</script>

{#if !e.scheduled}
	<p class="none">{S.engine.notScheduled}</p>
{:else}
	<dl>
		<div>
			<dt>{S.engine.start}</dt>
			<dd>{start}</dd>
		</div>
		<div>
			<dt>{S.engine.end}</dt>
			<dd>{end}</dd>
		</div>
		<div>
			<dt>{S.engine.float} {S.engine.estimate}</dt>
			<dd>{float ?? S.engine.pending}</dd>
		</div>
		<div>
			<dt>{S.engine.critical} {S.engine.estimate}</dt>
			<dd>{e.critical === null ? S.engine.pending : e.critical ? S.engine.yes : S.engine.no}</dd>
		</div>
	</dl>
	<div class="why" data-testid="why-section">
		<h4 tabindex="-1" bind:this={heading}>{S.engine.why}</h4>
		{#if failed}
			<p class="none">{S.engine.whyFailed}</p>
		{:else}
			<LazyMount
				when
				load={() => import('../health/WhyHere.svelte')}
				props={{ app, task: d.id, result: view?.result ?? null, index: app.index }}
				onfail={() => (failed = true)}
			/>
		{/if}
	</div>
{/if}

<style>
	dl {
		display: grid;
		grid-template-columns: minmax(0, auto) minmax(0, 1fr);
		gap: var(--space-1) var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}
	dl > div {
		display: contents;
	}
	dt {
		color: var(--color-text-muted);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.none {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.why {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-block-start: var(--space-3);
	}
	h4 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
	}
	h4:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
