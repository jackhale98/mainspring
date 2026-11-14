<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's floating chips (ADR-0009): the zoom (a dropdown), Today and the critical-path
	toggle as pills with a glass background over the top left of the chart, and, at its foot, a
	pill with the selected (or hovered) task and one with the legend of the today and status-date
	lines. On a desktop and a tablet they are one slim band above the chart, so they never cover a
	row; on a phone the chips are one compact row above the chart and the task line floats. Only DOM and tokens:
	it holds no state; the Gantt owns the zoom. The chips are a plain group: each is a normal tab
	stop (a toolbar role would promise arrow-key navigation that three chips do not need). The
	critical-path chip is not `disabled` while the analysis does not exist (a disabled control
	drops out of the tab order and hides its reason): it is `aria-disabled`, stays reachable and
	says why in text a screen reader reads, and it is ruby when on (the critical path's colour). The selected task's line is a polite live region
	with the people on it; the hovered one is shown but not announced. The task line is a pill that
	floats over the chart and exists only while there is a task, so it never moves the chart.
	Over 400 lines on purpose: about two thirds are the styles of the chips, pills and the phone
	layout; the script is small.
	Critical path and float are estimates (phase-2.md 6.2.1): the chip describes itself so, a
	task's estimate note sits apart at the end of its line and stays visible when the line is cut
	(a phone), and with nothing selected the pill says when the whole path is before the status
	date, so an empty highlight is never unexplained.
-->
<script lang="ts">
	import { ZOOM_ORDER, ZOOM_PRESETS, nearestLevel, type ZoomLevel } from '../../lib/gantt/scale';
	import type { RowLine } from '../../lib/gantt/describe';
	import type { LineState } from '../../lib/gantt/model';
	import type { CriticalChip } from '../../lib/gantt/analysis';
	import { gestureStrings, strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import type { AddMode } from '../../lib/gantt/add-task';
	import AddTaskMenu from './AddTaskMenu.svelte';
	import RowMenu from './RowMenu.svelte';
	import type { RowAction } from './types';

	interface Props {
		pxPerDay: number;
		selected: RowLine;
		hover: RowLine;
		/** Whether Today has a line on the chart to go to. */
		hasMarker: boolean;
		lines: { today: LineState; status: LineState; merged: boolean };
		dimmed: boolean;
		/** The critical-path toggle: available once the analysis exists. */
		critical: CriticalChip;
		onlevel: (level: ZoomLevel) => void;
		ontoday: () => void;
		oncritical: () => void;
		/** The people palette's toggle (R6): shown for a mouse when the plan has people. */
		people?: { open: boolean; count: number; ontoggle: () => void } | undefined;
		/** The Add task (+) control (ADR-0013): first, on every layout. */
		add?:
			| {
					hasSelection: boolean;
					canSubtask: boolean;
					onadd: (mode: AddMode) => Promise<unknown> | void;
			  }
			| undefined;
		/** The selected task's row actions (R5), as buttons. */
		rowActions?:
			| { actions: readonly RowAction[]; disabled: boolean; onaction: (id: string) => void }
			| undefined;
		/**
		 * The height of the task pill while it shows, else 0: on a phone it floats over the foot of
		 * the chart, which reserves that much room at the bottom of the scroller.
		 */
		onpill?: (height: number) => void;
	}
	let {
		pxPerDay,
		selected,
		hover,
		hasMarker,
		lines,
		dimmed,
		critical,
		onlevel,
		ontoday,
		oncritical,
		people,
		add,
		rowActions,
		onpill,
	}: Props = $props();

	const L = strings.gantt.lines;
	const label = (text: string, state: LineState): string => (state === 'off' ? L.off(text) : text);
	const level = $derived(nearestLevel(pxPerDay));
	/** Whether the zoom is exactly a preset; between two (after a pinch) the select says "custom". */
	const zoomExact = $derived(ZOOM_ORDER.some((z) => ZOOM_PRESETS[z] === pxPerDay));
	/** The pill's line: the selected task, else the note on an empty highlight (note only). */
	const line = $derived(
		selected.text === '' && critical.note !== null ? { text: '', note: critical.note } : selected,
	);
	const empty = (l: RowLine): boolean => l.text === '' && l.note === null;

	let taskH = $state(0);
	let hoverH = $state(0);
	// The pill that shows: the hovered one over the selected one, none for an empty line.
	const pillH = $derived(!empty(hover) ? hoverH : empty(line) ? 0 : taskH);
	$effect(() => onpill?.(pillH));
</script>

<div class="bar">
	<div class="chips" role="group" aria-label={strings.gantt.toolbar}>
		{#if add}<AddTaskMenu {...add} />{/if}
		<label class="chip select">
			<span class="sr-only">{strings.gantt.zoom}</span>
			<!-- Between two presets the select shows "Week (custom)", so that choosing Week still changes it. -->
			<select
				value={zoomExact ? level : 'custom'}
				onchange={(e) => {
					if (e.currentTarget.value !== 'custom') onlevel(e.currentTarget.value as ZoomLevel);
				}}
				aria-label={strings.gantt.zoom}
			>
				{#if !zoomExact}
					<option value="custom" disabled
						>{strings.gantt.levelCustom(strings.gantt.level[level])}</option
					>
				{/if}
				{#each ZOOM_ORDER as z (z)}
					<option value={z}>{strings.gantt.level[z]}</option>
				{/each}
			</select>
			<span class="caret"><Icon name="chevronDown" size={12} /></span>
		</label>
		<button
			type="button"
			class="chip today"
			onclick={ontoday}
			disabled={!hasMarker}
			aria-label={hasMarker ? strings.gantt.today : strings.gantt.todayOff}
		>
			<Icon name="today" size={14} /><span class="lbl">{strings.gantt.today}</span>
		</button>
		<button
			type="button"
			class="chip critical"
			aria-label={strings.gantt.criticalPath}
			aria-pressed={critical.available ? critical.pressed : undefined}
			aria-disabled={critical.available ? undefined : 'true'}
			aria-describedby="critical-why"
			title={critical.why}
			onclick={() => {
				if (critical.available) oncritical();
			}}
		>
			<Icon name="route" size={14} /><span class="lbl">{strings.gantt.criticalPath}</span>
		</button>
		<span id="critical-why" class="sr-only">{critical.why}</span>
		{#if people && people.count > 0}
			<button
				type="button"
				class="chip people"
				aria-pressed={people.open}
				aria-label={gestureStrings.palette.region}
				onclick={people.ontoggle}
				title={people.open ? gestureStrings.palette.hide : gestureStrings.palette.show}
			>
				<Icon name="users" size={14} /><span class="lbl">{gestureStrings.palette.region}</span>
			</button>
		{/if}
		{#if rowActions}
			<RowMenu {...rowActions} />
		{/if}
	</div>

	<!-- The task line is a live region that always exists; its pill shows only with text. -->
	<p
		class="task"
		role="status"
		bind:clientHeight={taskH}
		class:sr-only={empty(line) || !empty(hover)}
		class:wrap={line.text === ''}
	>
		{@render parts(line)}
	</p>
	{#if !empty(hover)}<p class="task hover" aria-hidden="true" bind:clientHeight={hoverH}>
			{@render parts(hover)}
		</p>{/if}
	<ul class="legend" aria-label={strings.gantt.legend}>
		{#if lines.merged}
			<li class:off={lines.today === 'off'}>
				<i class="line today"></i>{label(L.both, lines.today)}
			</li>
		{:else}
			{#if lines.today}
				<li class:off={lines.today === 'off'}>
					<i class="line today"></i>{label(L.today, lines.today)}
				</li>
			{/if}
			{#if lines.status}
				<li class:off={lines.status === 'off'}>
					<i class="line status"></i>{label(L.status, lines.status)}
				</li>
			{/if}
		{/if}
		{#if dimmed}<li class="stale">{strings.gantt.lastGood}</li>{/if}
	</ul>
</div>

{#snippet parts(l: RowLine)}
	{#if l.text !== ''}<span class="text">{l.text}</span>{/if}{#if l.note}<span class="note"
			>{#if l.text !== ''}<span class="sr-only">{'. '}</span>{/if}{l.note}</span
		>{/if}
{/snippet}

<style>
	/* A slim band above the chart (not over it): chips, then the selected task, then the legend.
	   A phone has no band: its chips are the row, its task line floats (below). */
	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
		padding: 7px 14px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
	.chips {
		flex: none;
		display: flex;
		gap: var(--space-2);
	}
	.chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		block-size: var(--gantt-chip-height);
		padding-inline: 12px;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		box-shadow: var(--gantt-chip-shadow);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		white-space: nowrap;
		backdrop-filter: blur(6px);
		cursor: pointer;
	}
	.chip:hover:not(:disabled) {
		background: var(--color-gantt-inset);
	}
	.chip:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.chip:focus-visible,
	.chip:has(select:focus-visible) {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.select {
		padding-inline-end: 26px;
	}
	select {
		appearance: none;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		outline: none;
		padding: 0;
	}
	.caret {
		position: absolute;
		inset-inline-end: 10px;
		display: grid;
		color: var(--color-gantt-text-muted);
		pointer-events: none;
	}
	/* The critical path is ruby: a ruby wash and ink when on, and a ruby icon either way. */
	.critical :global(.icon) {
		color: var(--color-critical);
	}
	.critical[aria-pressed='true'] {
		border-color: var(--color-gantt-crit-border);
		background: var(--color-gantt-crit-wash);
		color: var(--color-gantt-crit-ink);
		font-weight: 600;
	}
	/* Not available yet: dimmed, but still readable and reachable (aria-disabled, not disabled). */
	.critical[aria-disabled='true'] {
		cursor: default;
		opacity: 0.7;
	}
	.task {
		flex: 1 1 0;
		min-inline-size: 0;
		box-sizing: border-box;
		display: flex;
		gap: 0.6em;
		margin: 0;
		padding: 6px 14px;
		overflow: hidden;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}
	/* The line is cut, never the estimate note after it (a phone has room for little else). */
	.task .text {
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.task .note {
		flex: none;
		font-weight: 600;
	}
	/* A note alone (nothing selected) wraps rather than being cut. */
	.task.wrap {
		border-radius: 14px;
		white-space: normal;
	}
	.task.wrap .note {
		flex: 1 1 auto;
		min-inline-size: 0;
	}
	.legend {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0 0 0 auto;
		padding: 6px 12px;
		list-style: none;
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
		pointer-events: none;
	}
	.legend:not(:has(li)) {
		display: none;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.legend li.off {
		font-style: italic;
	}
	.legend li.off .line {
		opacity: 0.4;
	}
	.line {
		display: inline-block;
		inline-size: var(--gantt-marker-width);
		block-size: 0.9rem;
	}
	.line.today {
		background: var(--color-today);
	}
	.line.status {
		background: repeating-linear-gradient(
			to bottom,
			var(--color-status-date) 0 calc(var(--gantt-dash) * 1.5),
			transparent calc(var(--gantt-dash) * 1.5) calc(var(--gantt-dash) * 2.5)
		);
	}
	/* 4.5:1 at least on the glass chip, light and dark (tests/ci/palette.test.ts). */
	.stale {
		color: var(--color-pending);
		font-weight: 600;
	}
	/* A narrow chart (Split) has no room for the word: the icon is the chip. */
	@container gantt (max-width: 899px) {
		.people .lbl {
			display: none;
		}
		.people {
			padding-inline: 9px;
		}
	}
	/* The palette is for a mouse and a pen; a finger books people in the details sheet. */
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
		}
		.people {
			display: none;
		}
	}
	/* A narrow chart (Split) has no room for the legend lines: only the "last good schedule"
	   notice stays, since that one is a state the user must see. */
	@container gantt (max-width: 899px) {
		.legend li:not(.stale) {
			display: none;
		}
		.legend:not(:has(.stale)) {
			display: none;
		}
	}
	/* A phone: the chips are one compact row above the chart; nothing floats over it but the
	   task line, which has no room to spare and shows only with a task. */
	@media (max-width: 399px) {
		/* 360 px: the critical path is its icon (its aria-label is the name) so that Zoom, Today,
		   Add task, the critical path and the row menu fit 44 px apiece without a clip. */
		.critical .lbl {
			display: none;
		}
		.critical {
			padding-inline: 0;
			justify-content: center;
			min-inline-size: var(--size-tap);
		}
	}
	@media (max-width: 599px) {
		.bar {
			display: contents;
		}
		.chips {
			padding: var(--space-2) var(--space-2);
			background: var(--color-gantt-surface);
			border-block-end: 1px solid var(--color-gantt-border);
			flex-wrap: nowrap;
		}
		.legend {
			display: none;
		}
		/* The Add task button took 44 px of the row: Today is its icon alone (its aria-label is
		   the name), so that nothing wraps or is cut off at 360 px. */
		.today .lbl {
			display: none;
		}
		/* The select shrinks (a custom zoom reads "Week (custom)") rather than push a chip off. */
		select {
			max-inline-size: 5.5rem;
			text-overflow: ellipsis;
		}
		.today {
			padding-inline: 0;
			justify-content: center;
			min-inline-size: var(--size-tap);
		}
		.task {
			position: absolute;
			z-index: 6;
			inset-inline-start: var(--space-2);
			max-inline-size: calc(100% - 2 * var(--space-2));
			box-shadow: var(--gantt-chip-shadow);
			backdrop-filter: blur(6px);
		}
		.task:not(.sr-only) {
			inset-block-end: var(--space-2);
		}
		.task.hover {
			z-index: 7;
		}
	}
</style>
