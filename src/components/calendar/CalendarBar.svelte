<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Calendar's toolbar (phase-3.md 9.2, 9.5, 18.6): whose leave is shown (Everyone, or a person),
	the mode (Select, Paint, Erase), the leave type to paint, and the way between months (previous,
	next, today). A desktop and a tablet have it in a row above the months; a phone has it in a bar
	of two rows above the tab bar, with the months' own title row on top ("Paint bar above the tab
	bar", 9.2). It holds no state: the Calendar owns the choices.

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
		{ id: 'select' as const, label: C.modes.select },
		{ id: 'paint' as const, label: C.modes.paint },
		{ id: 'erase' as const, label: C.modes.erase },
	];
	const types = $derived(typesFor(scope.kind === 'global'));
	const scopeValue = $derived(scope.kind === 'global' ? '' : scope.resource);

	function pickScope(e: Event): void {
		const v = (e.currentTarget as HTMLSelectElement).value;
		onscope(v === '' ? { kind: 'global' } : { kind: 'resource', resource: v });
	}
</script>

<div class="bar {placement}" role="group" aria-label={C.toolbar} data-testid="cal-bar-{placement}">
	<div class="months" role="group" aria-label={C.months}>
		<button
			type="button"
			class="chip icon"
			onclick={onprev}
			aria-label={C.prev}
			data-testid="cal-prev"
		>
			<Icon name="chevronLeft" size={14} />
		</button>
		<span class="title" aria-hidden="true">{title}</span>
		<button
			type="button"
			class="chip icon"
			onclick={onnext}
			aria-label={C.next}
			data-testid="cal-next"
		>
			<Icon name="chevronRight" size={14} />
		</button>
		<button
			type="button"
			class="chip today"
			onclick={ontoday}
			disabled={!hasToday}
			aria-label={hasToday ? C.today : C.todayOff}
		>
			<Icon name="today" size={14} /><span class="lbl">{C.today}</span>
		</button>
	</div>
	<label class="chip select scope">
		<span class="cap">{C.scope}</span>
		<select value={scopeValue} onchange={pickScope} aria-label={C.scope} data-testid="cal-scope">
			<option value="">{L.everyone}</option>
			{#each people as p (p.id)}
				<option value={p.id}>{'  '.repeat(p.level - 1)}{p.name}</option>
			{/each}
		</select>
		<span class="caret"><Icon name="chevronDown" size={12} /></span>
	</label>
	<div class="modes" role="radiogroup" aria-label={C.mode}>
		{#each MODES as m (m.id)}
			<label class:on={mode === m.id}>
				<input
					type="radio"
					name="cal-mode-{placement}"
					value={m.id}
					checked={mode === m.id}
					onchange={() => onmode(m.id)}
					data-testid="cal-mode-{m.id}"
				/>
				<span>{m.label}</span>
			</label>
		{/each}
	</div>
	<label class="chip select type">
		<span class="cap">{C.type}</span>
		<select
			value={leaveType}
			aria-label={C.type}
			onchange={(e) => ontype(e.currentTarget.value as LeaveType)}
			data-testid="cal-type"
		>
			{#each types as t (t)}
				<option value={t}>{L.type[t]}</option>
			{/each}
		</select>
		<span class="caret"><Icon name="chevronDown" size={12} /></span>
	</label>
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
	.chip:has(select:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	/* The select fills the chip, so the whole chip is the target (44 px on a finger). */
	.select {
		padding-inline: 12px 0;
	}
	.select select {
		/* Over the chip's own 1 px edge too, so a finger's target is the whole 44 px. */
		align-self: stretch;
		margin-block: -1px;
		padding-inline-end: 26px;
	}
	.cap {
		color: var(--color-gantt-text-muted);
	}
	select {
		appearance: none;
		max-inline-size: 11rem;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 600;
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
	/* A phone: two rows above the tab bar: the months and the mode, then whose and what. */
	@container calendar (max-width: 599px) {
		.bar {
			gap: var(--space-2);
		}
		.bar .months {
			order: 1;
			flex: 1 1 100%;
			justify-content: space-between;
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
		.bar select {
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
</style>
