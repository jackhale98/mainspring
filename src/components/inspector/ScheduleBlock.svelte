<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	What the scheduler made of the task (phase-2.md 9.3 "Read-only"): the engine's start and end,
	the float, what sets the start, and whether it is critical. All of it is read from the schedule
	the Gantt shows. The float, the critical flag and the driver are display estimates derived from
	that result (ADR-0007), so they are labelled as such. Nothing here can be edited.
-->
<script lang="ts">
	import { floatAmount } from '../../lib/gantt/describe';
	import type { GanttModel } from '../../lib/gantt/model';
	import { formatMinutes } from '../../lib/gantt/ticks';
	import type { TaskDetails } from '../../lib/inspector/task';
	import { inspectorStrings as S } from '../../lib/strings';

	let { d, model }: { d: TaskDetails; model: GanttModel } = $props();

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
	const driver = $derived(
		e.driver === null
			? S.engine.driverNone
			: e.driver.kind === 'dependency'
				? S.engine.driverDependency(e.driverName ?? e.driver.pred)
				: e.driver.kind === 'frame'
					? S.engine.driverFrame
					: S.engine.driverUnexplained,
	);
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
			<dt>{S.engine.driver} {S.engine.estimate}</dt>
			<dd>{e.floatMin === null && e.driver === null ? S.engine.pending : driver}</dd>
		</div>
		<div>
			<dt>{S.engine.critical} {S.engine.estimate}</dt>
			<dd>{e.critical === null ? S.engine.pending : e.critical ? S.engine.yes : S.engine.no}</dd>
		</div>
	</dl>
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
</style>
