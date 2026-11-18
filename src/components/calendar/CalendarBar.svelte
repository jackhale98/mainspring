<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Calendar's toolbar (phase-3.md 9.2, 9.5, 18.6): whose leave is shown (Everyone, or a person),
	the mode (Select, Paint, Erase), the leave type to paint, and the way between months (previous,
	next, today). A wide desktop has it in one row above the months (from about 1024 px); a narrower
	view wraps it to two rows. A phone (up to 599 px) has it in a bar of two rows above the tab bar
	("Paint bar above the tab bar", 9.2; compact, user 2026-11-18): the months (previous, a short
	title, next) and the mode as three icons; then Today as an icon, whose and what. The five groups
	cannot share 360 px in one row, so the toolbar contract spec (tests/e2e/primitives/toolbar.spec.ts)
	allows two rows there. The icons and the short title are the toolbar's narrow forms
	(`icon-phone`, `.ico-stand`, `.lbl-short`: src/styles/toolbar.css), not rules of this file. It holds
	no state: the Calendar owns the choices.

	The type picker offers `annual`, `special`, `sick`, `unpaid` and `unemployed` for a person, and
	`holiday` for Everyone (`typesFor`). The mode and the type are announced when they change (the
	Calendar's live region).
-->
<script lang="ts">
	import { typesFor } from '../../lib/calendar/leave-edit';
	import type { PaintScope } from '../../lib/calendar/paint';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings-calendar';
	import type { LeaveType } from '../../lib/tjp/edit/types';
	import Icon from '../Icon.svelte';
	import Select from '../ui/Select.svelte';
	import type { CalendarMode } from './calendar-state.svelte';

	interface Person {
		readonly id: string;
		readonly name: string;
		readonly level: number;
	}
	interface Props {
		scope: PaintScope;
		people: readonly Person[];
		mode: CalendarMode;
		leaveType: LeaveType;
		/** The month in view, for the buttons' names. */
		title: string;
		/** The title where there is little room (a phone): "Nov 2026". */
		shortTitle?: string;
		hasToday: boolean;
		onscope: (scope: PaintScope) => void;
		onmode: (mode: CalendarMode) => void;
		ontype: (type: LeaveType) => void;
		onprev: () => void;
		onnext: () => void;
		ontoday: () => void;
		/** Which copy this is (ids differ between the row above and the bar below). */
		placement: 'top' | 'bottom';
		/** The type picker the L key opens is shown: the type select stands for it. */
		hint: string;
	}
	let {
		scope,
		people,
		mode,
		leaveType,
		title,
		shortTitle,
		hasToday,
		onscope,
		onmode,
		ontype,
		onprev,
		onnext,
		ontoday,
		placement,
		hint,
	}: Props = $props();

	const MODES = [
		{ id: 'select' as const, label: C.modes.select, icon: 'pointer' as const },
		{ id: 'paint' as const, label: C.modes.paint, icon: 'brush' as const },
		{ id: 'erase' as const, label: C.modes.erase, icon: 'eraser' as const },
	];
	const types = $derived(typesFor(scope.kind === 'global'));
	const scopeValue = $derived(scope.kind === 'global' ? '' : scope.resource);

	function pickScope(v: string): void {
		onscope(v === '' ? { kind: 'global' } : { kind: 'resource', resource: v });
	}
</script>

<div
	class="bar {placement}"
	role="group"
	aria-label={C.toolbar}
	data-toolbar="calendar"
	data-testid="cal-bar-{placement}"
>
	<div class="months" role="group" aria-label={C.months} data-narrow="fixed">
		<button
			type="button"
			class="chip icon"
			onclick={onprev}
			aria-label={C.prev}
			data-testid="cal-prev"
		>
			<Icon name="chevronLeft" size={14} />
		</button>
		<span class="title" aria-hidden="true"
			><span class="lbl-long">{title}</span><span class="lbl-short">{shortTitle ?? title}</span
			></span
		>
		<button
			type="button"
			class="chip icon"
			onclick={onnext}
			aria-label={C.next}
			data-testid="cal-next"
		>
			<Icon name="chevronRight" size={14} />
		</button>
	</div>
	<button
		type="button"
		class="chip today"
		data-narrow="icon-phone"
		onclick={ontoday}
		disabled={!hasToday}
		aria-label={hasToday ? C.today : C.todayOff}
		title={hasToday ? C.today : C.todayOff}
	>
		<Icon name="today" size={14} /><span class="lbl">{C.today}</span>
	</button>
	<label class="chip select scope" data-narrow="own">
		<span class="cap">{C.scope}</span>
		<Select
			variant="inline"
			value={scopeValue}
			onchange={pickScope}
			aria-label={C.scope}
			data-testid="cal-scope"
		>
			<option value="">{L.everyone}</option>
			{#each people as p (p.id)}
				<option value={p.id}>{'  '.repeat(p.level - 1)}{p.name}</option>
			{/each}
		</Select>
	</label>
	<div class="modes" role="radiogroup" aria-label={C.mode} data-narrow="own">
		{#each MODES as m (m.id)}
			<label class:on={mode === m.id} data-narrow="icon-phone">
				<input
					type="radio"
					name="cal-mode-{placement}"
					value={m.id}
					checked={mode === m.id}
					aria-label={m.label}
					onchange={() => onmode(m.id)}
					data-testid="cal-mode-{m.id}"
				/>
				<span class="ico-stand"><Icon name={m.icon} size={18} /></span>
				<span class="lbl">{m.label}</span>
			</label>
		{/each}
	</div>
	<label class="chip select type" data-narrow="own">
		<span class="cap">{C.type}</span>
		<Select
			variant="inline"
			value={leaveType}
			aria-label={C.type}
			onchange={(v) => ontype(v as LeaveType)}
			data-testid="cal-type"
			options={types.map((t) => ({ value: t, label: L.type[t] }))}
		/>
	</label>
	<span class="rowbreak" aria-hidden="true"></span>
	<p class="hint" data-testid="cal-hint">{hint}</p>
</div>

<style>
	.bar {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--gutter);
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
	.bar.bottom {
		border-block-end: 0;
		border-block-start: 1px solid var(--color-gantt-border);
	}
	.months {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.title {
		min-inline-size: 8.5rem;
		text-align: center;
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: 600;
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
		cursor: pointer;
	}
	/* Beside the months group, at the 4 px gap that Today had inside it (it is a sibling now, so
	   that a phone can put it in the second row). */
	.today {
		margin-inline-start: calc(var(--space-1) - var(--space-2));
	}
	.rowbreak {
		display: none;
	}
	.chip.icon {
		justify-content: center;
		inline-size: var(--gantt-chip-height);
		padding-inline: 0;
	}
	.chip:hover:not(:disabled) {
		background: var(--color-gantt-inset);
	}
	.chip:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.chip:focus-visible,
	.chip:has(:global(select:focus-visible)) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	/* The select fills the chip, so the whole chip is the target (44 px on a finger). */
	.select {
		padding-inline: 12px 0;
	}
	.select :global(select) {
		/* Over the chip's own 1 px edge too, so a finger's target is the whole 44 px. */
		align-self: stretch;
		margin-block: -1px;
		padding-inline-end: 26px;
		max-inline-size: 11rem;
		font-weight: 600;
	}
	.cap {
		color: var(--color-gantt-text-muted);
	}
	/* The mode switch: the look of the toolbar's pills (SegmentTabs), as native radios. */
	.modes {
		display: inline-flex;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
	}
	.modes label {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-block-size: 30px;
		padding-inline: 14px;
		border-radius: var(--radius-pill);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
	}
	.modes label:hover:not(.on) {
		background: var(--color-row-hover);
		color: var(--color-text);
	}
	.modes label.on {
		background: var(--color-pill-on);
		color: var(--color-pill-on-ink);
		font-weight: 600;
	}
	.modes label:has(input:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.modes input {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		margin: 0;
		opacity: 0;
	}
	.hint {
		flex: 1 1 14rem;
		margin: 0;
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
	}
	@media (pointer: coarse) {
		.chip {
			min-block-size: var(--size-tap);
		}
		.chip.icon {
			min-inline-size: var(--size-tap);
		}
		.modes label {
			min-block-size: var(--size-tap);
			min-inline-size: var(--size-tap);
		}
	}
	/* A pane narrower than 600 px on a wide screen (Split mode beside the editor): three rows, the
	   months and Today, the mode, then whose and what. A phone's two rows are the block below. */
	@container calendar (max-width: 599px) {
		.bar {
			gap: var(--space-2);
		}
		.bar .months {
			order: 1;
			flex: 1 1 0;
			min-inline-size: 0;
			justify-content: space-between;
		}
		.bar .today {
			order: 1;
		}
		.bar .modes {
			order: 2;
			flex: 1 1 100%;
		}
		.bar .modes {
			display: flex;
		}
		.bar .modes label {
			flex: 1 1 0;
		}
		.bar .scope,
		.bar .type {
			order: 3;
			flex: 1 1 0;
			min-inline-size: 0;
		}
		.bar :global(select) {
			min-inline-size: 0;
			max-inline-size: 100%;
			text-overflow: ellipsis;
		}
		.bar .cap {
			display: none;
		}
		/* Read out when the mode changes (the Calendar's live region); no room for it on screen. */
		.hint {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
	/*
	   A phone (the viewport, as the other toolbars' narrow forms): two rows above the tab bar, so that
	   the month keeps the screen (user, 2026-11-18). Row one: the months (previous, short title, next)
	   and the mode as three icons. Row two: Today as an icon, whose leave and what type. The icons and
	   the short title come from toolbar.css (data-narrow="icon-phone", .ico-stand, .lbl-short). This
	   follows the container block above, which still serves a narrow pane on a wide screen.
	*/
	@media (max-width: 599px) {
		.bar {
			column-gap: var(--space-2);
			/* The row break is a line of its own, so the second row's own top margin is the gap. */
			row-gap: 0;
			padding-block: var(--space-1);
		}
		.bar .months {
			order: 1;
			flex: 1 1 0;
			min-inline-size: 0;
			justify-content: space-between;
		}
		.bar .modes {
			order: 2;
			display: inline-flex;
			flex: none;
			gap: 0;
			padding: 1px;
		}
		.bar .modes label {
			flex: none;
		}
		.bar .rowbreak {
			display: block;
			order: 3;
			flex: 1 0 100%;
			block-size: 0;
		}
		.bar .today {
			order: 4;
			margin-inline-start: 0;
		}
		.bar .scope,
		.bar .type {
			order: 5;
		}
		.bar .today,
		.bar .scope,
		.bar .type {
			margin-block-start: var(--space-1);
		}
		.bar .title {
			flex: 1 1 0;
			min-inline-size: 0;
		}
	}
</style>
