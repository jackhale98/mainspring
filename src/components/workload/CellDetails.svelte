<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The cell details (phase-3.md 9.3, 7.1, 10): what the heatmap cell is made of. The person and the
	period; booked, available and effective effort (booked time times efficiency, 18.2) and leave;
	the band and why it is what it is (an over cell lists every clause of `overCauses`); then the
	cell's tasks: the booked ones with hours, then the held and unmet ones. Held and unmet work is
	read from the schedule and says so.

	Each task has the non-drag ways to rebalance (WCAG 2.5.7): "Move to person…" and "Move to
	week…" (native selects, which a finger and a screen reader both know), offered for every task
	of a person's cell (`movable` governs the drag only), and Alt with the arrow keys on the task's
	row (up and down by person, left and right by week), which the parent sends cumulatively
	(rebalance-adapter.ts). "Show in Gantt" selects the task and goes to the Gantt. A group's cell
	lists its members' tasks without the move controls: the person's own cell is where a task moves.

	On a desktop it is a column beside the plot; narrower it is a bottom sheet over the plot's foot
	(CSS, by the container), as the Gantt's details are. Escape or Close returns the focus to the
	cell it came from.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { workloadStrings as W } from '../../lib/strings';
	import { hoursNumber, type CellDetails, type DetailTask } from '../../lib/workload/heat-cell';
	import type { HeatUnit } from '../../lib/workload/heat-prefs';
	import Icon from '../Icon.svelte';

	interface Props {
		details: CellDetails;
		unit: HeatUnit;
		/** The people a task can move to (leaf rows), and the periods around the cell's column. */
		people: ReadonlyArray<{ readonly row: number; readonly name: string }>;
		periods: ReadonlyArray<{ readonly col: number; readonly text: string }>;
		onclose: () => void;
		/** Moves a task to a person's row or to a column (the menus). */
		onmove: (task: DetailTask, to: { row: number } | { col: number }) => void;
		/** Alt+arrows on a task: person (-1 up, +1 down) or period (-1 left, +1 right). */
		onnudge: (task: DetailTask, axis: 'person' | 'period', step: -1 | 1) => void;
		onnudgeend: () => void;
		onshow: (task: DetailTask) => void;
		/** The last message the rebalance adapter gave (a refusal, "coming"), or ''. */
		note: string;
	}
	let {
		details,
		unit,
		people,
		periods,
		onclose,
		onmove,
		onnudge,
		onnudgeend,
		onshow,
		note,
	}: Props = $props();

	const i = $derived(details.info);
	const D = W.details;
	let heading: HTMLHeadingElement | undefined = $state();

	onMount(() => {
		// The details take the focus when they open from the keyboard; a click leaves it on the plot.
		if (document.activeElement?.closest('[data-testid="heat-grid"]')) {
			void tick().then(() => heading?.focus());
		}
	});

	const groups = $derived([
		{
			kind: 'booked' as const,
			title: D.kind.booked,
			tasks: details.tasks.filter((t) => t.kind === 'booked'),
		},
		{
			kind: 'held' as const,
			title: D.kind.held(i.who),
			tasks: details.tasks.filter((t) => t.kind === 'held'),
		},
		{
			kind: 'unmet' as const,
			title: D.kind.unmet(i.who),
			tasks: details.tasks.filter((t) => t.kind === 'unmet'),
		},
	]);

	function taskKey(e: KeyboardEvent, t: DetailTask): void {
		if (e.key === 'Enter') {
			onnudgeend();
			return;
		}
		if (!e.altKey || e.ctrlKey || e.metaKey) return;
		const axis = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 'person' : 'period';
		if (!e.key.startsWith('Arrow')) return;
		e.preventDefault();
		const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
		onnudge(t, axis, step);
	}

	function choose(e: Event, t: DetailTask, axis: 'person' | 'period'): void {
		const select = e.currentTarget as HTMLSelectElement;
		const n = Number(select.value);
		select.value = '';
		if (Number.isNaN(n)) return;
		onmove(t, axis === 'person' ? { row: n } : { col: n });
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
	class="details"
	aria-label={D.region}
	data-testid="cell-details"
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
		}
	}}
>
	<header>
		<h2 tabindex="-1" bind:this={heading}>{i.who}, {i.period}</h2>
		<button type="button" class="close" onclick={onclose} aria-label={D.close}>
			<Icon name="close" size={16} />
		</button>
	</header>
	<p class="band {i.band}" data-testid="cell-band">
		<span class="swatch" aria-hidden="true"></span><strong>{W.band[i.band]}</strong>
	</p>
	{#each details.why as sentence (sentence)}<p class="why">{sentence}</p>{/each}
	<dl class="facts">
		<div>
			<dt>{D.booked}</dt>
			<dd>{D.hoursValue(hoursNumber(i.booked))}</dd>
		</div>
		<div>
			<dt>{D.available}</dt>
			<dd>{D.hoursValue(hoursNumber(i.available))}</dd>
		</div>
		<div>
			<dt>{D.effective}</dt>
			<dd>{D.hoursValue(hoursNumber(details.effective))}</dd>
		</div>
		{#if i.leave > 0}<div>
				<dt>{D.leave}</dt>
				<dd>{D.hoursValue(hoursNumber(i.leave))}</dd>
			</div>{/if}
		{#if unit === 'percent' && i.percent !== null}
			<div>
				<dt>{W.unitPercent}</dt>
				<dd>{W.percent(Math.round(i.percent))}</dd>
			</div>
		{/if}
	</dl>
	{#if note !== ''}<p class="note" role="status">{note}</p>{/if}

	{#if details.tasks.length === 0}
		<p class="empty">{D.noTasks}</p>
	{:else}
		{#each groups as g (g.kind)}
			{#if g.tasks.length > 0}
				<h3>{g.title}</h3>
				<ul class="tasks">
					{#each g.tasks as t (t.task)}
						<li>
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class="task"
								role="group"
								aria-label={t.name}
								tabindex="0"
								aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
								data-testid="detail-task"
								data-task={t.task}
								onkeydown={(e) => taskKey(e, t)}
								onblur={onnudgeend}
							>
								<span class="top">
									<span class="name">{t.name}</span>
									<span class="hours"
										>{D.hoursValue(hoursNumber(t.minutes))}{#if t.effective !== null}<span
												class="eff">, {D.taskEffective(hoursNumber(Math.round(t.effective)))}</span
											>{/if}</span
									>
								</span>
								<span class="actions">
									{#if !details.group}
										<label class="pick">
											<span class="sr-only">{D.movePerson} {t.name}</span>
											<select value="" onchange={(e) => choose(e, t, 'person')}>
												<option value="" disabled>{D.movePerson}</option>
												{#each people as p (p.row)}
													<option value={p.row} disabled={p.row === i.row}>{p.name}</option>
												{/each}
											</select>
										</label>
										<label class="pick">
											<span class="sr-only">{D.moveWeek} {t.name}</span>
											<select value="" onchange={(e) => choose(e, t, 'period')}>
												<option value="" disabled>{D.moveWeek}</option>
												{#each periods as p (p.col)}
													<option value={p.col} disabled={p.col === i.col}>{p.text}</option>
												{/each}
											</select>
										</label>
									{/if}
									<button type="button" class="show" onclick={() => onshow(t)}
										>{D.showInGantt}</button
									>
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/each}
		{#if details.tasks.some((t) => t.kind !== 'booked')}<p class="hint">{D.kindNote}</p>{/if}
		{#if details.group}<p class="hint">{D.group}</p>{:else}<p class="hint">{D.moveHint}</p>{/if}
	{/if}
</aside>

<style>
	.details {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		overflow: auto;
		padding: var(--space-3) var(--space-4);
		border-inline-start: 1px solid var(--color-gantt-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 400;
		line-height: 1.2;
	}
	h2:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	h3 {
		margin: var(--space-2) 0 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.close {
		flex: none;
		display: grid;
		place-items: center;
		inline-size: 32px;
		block-size: 32px;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.close:hover {
		background: var(--color-row-hover);
	}
	.close:focus-visible,
	.show:focus-visible,
	.task:focus-visible,
	select:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.band {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}
	.swatch {
		inline-size: 14px;
		block-size: 14px;
		border-radius: 3px;
		border: 1px solid var(--color-border-strong);
		background: var(--load-off);
	}
	.band.spare .swatch {
		background: var(--load-spare);
	}
	.band.full .swatch {
		background: var(--load-full);
	}
	/* Over: the same hatch as the cell, so the swatch is not colour alone either. */
	.band.over .swatch {
		background: repeating-linear-gradient(
			135deg,
			var(--load-over) 0 3px,
			color-mix(in srgb, var(--load-over), white 35%) 3px 5px
		);
		border-color: var(--load-over);
	}
	.why,
	.hint,
	.empty,
	.note {
		margin: 0;
	}
	.hint,
	.empty {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.note {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-brass-wash);
		color: var(--color-brass-ink);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-1) var(--space-4);
		margin: 0;
	}
	.facts div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}
	dt {
		color: var(--color-text-muted);
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.tasks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.task {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.name {
		min-inline-size: 0;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.hours {
		flex: none;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.pick select,
	.show {
		min-block-size: 32px;
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.pick select {
		max-inline-size: 11rem;
	}
	@media (pointer: coarse) {
		.pick select,
		.show,
		.close {
			min-block-size: var(--size-tap);
		}
		.close {
			inline-size: var(--size-tap);
		}
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
