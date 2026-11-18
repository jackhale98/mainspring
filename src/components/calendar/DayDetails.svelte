<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The details of the selected days (phase-3.md 9.5, 7.1 W3 to W5, 10): what is on them and the
	non-drag ways to change it (WCAG 2.5.7). The holidays for everyone and the person's leaves are
	listed once each, however many of the days they cover. A leave a text item names has its fields
	(LeaveCard: type, name, first and last day, Remove: W5); one no text item names (a shift or a
	macro) says "From a shift or macro. Edit as text."; one a parent group gives is listed as that
	group's. Milestones list with "Show in Gantt". At the foot, "Add leave" (a type, an optional
	name) and "Clear leave on these days" do what a paint or erase stroke does over exactly these
	days, through the same planner.

	On a desktop it is a column beside the months with its own header. Narrower (`sheet`) it is the
	content of the shared bottom Sheet (Sheet.svelte, as the task details are): the Sheet supplies the
	title (the days), the close button, the grabber and Escape, so there is no header here, and the
	Sheet's content area is the one thing that scrolls. With no leave on the days the add form comes
	first, so that it is in reach at half height without scrolling. Escape or Close returns the focus
	to the day it came from (the Calendar's job).

	Over 400 lines on purpose: the column and the Sheet's content are one tree of sections (the leave
	lists, the milestones, the add form and the clear button) with two frames around it, and the
	styles of every section are one cascade; splitting them would copy the sections.
-->
<script lang="ts">
	import type { SelectionDetails } from '../../lib/calendar/details';
	import { leavePhrase } from '../../lib/calendar/describe';
	import type { LeaveEntry } from '../../lib/calendar/facts';
	import { typesOfItem, type LeaveFields } from '../../lib/calendar/leave-edit';
	import type { PaintItem } from '../../lib/calendar/paint-items';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings-calendar';
	import type { LeaveType } from '../../lib/tjp/edit/types';
	import Icon from '../Icon.svelte';
	import Select from '../ui/Select.svelte';
	import type { CommitResult } from '../../lib/calendar/leave-edit';
	import LeaveCard from './LeaveCard.svelte';

	interface Props {
		details: SelectionDetails;
		/** "Mon 2 Mar 2026 to Fri 6 Mar 2026". */
		rangeText: string;
		/** "Everyone" or the person's name. */
		who: string;
		global: boolean;
		/** The types the scope offers, and the one chosen to add. */
		types: readonly LeaveType[];
		leaveType: LeaveType;
		ontype: (t: LeaveType) => void;
		fieldsOf: (item: PaintItem) => LeaveFields | null;
		oncommit: (item: PaintItem, f: LeaveFields) => Promise<CommitResult>;
		onremove: (item: PaintItem) => void;
		onadd: (name: string) => void;
		onclear: () => void;
		onmilestone: (task: string) => void;
		onclose: () => void;
		/** The last sentence a refusal gave. */
		note: string;
		/** The content of the Calendar's bottom Sheet: no header (the Sheet has it) and no scroll of its own. */
		sheet?: boolean;
	}
	let {
		details,
		rangeText,
		who,
		global,
		types,
		leaveType,
		ontype,
		fieldsOf,
		oncommit,
		onremove,
		onadd,
		onclear,
		onmilestone,
		onclose,
		note,
		sheet = false,
	}: Props = $props();

	const D = C.details;
	let heading: HTMLHeadingElement | undefined = $state();
	let root: HTMLElement | undefined = $state();
	let name = $state('');
	const editable = $derived(global ? details.holidays : details.own);
	const inheritedGlobal = $derived(global ? [] : details.holidays);
	const nothing = $derived(
		editable.length === 0 &&
			inheritedGlobal.length === 0 &&
			details.groups.length === 0 &&
			details.textOnly.length === 0,
	);

	/** A key that tells entries apart: the item's place, or the engine-only leave's type. */
	const keyOf = (e: LeaveEntry): string =>
		e.item ? `${e.item.range.file}:${e.item.range.from}` : `~${e.from}:${e.type}`;

	export function focus(): void {
		(sheet ? root : heading)?.focus();
	}

	/** With no leave of the person's to edit, the add form is the first thing in a sheet. */
	const addFirst = $derived(sheet && editable.length === 0);

	function add(): void {
		onadd(name.trim());
		name = '';
	}
</script>

{#snippet addForm()}
	<!-- First in a sheet, the form is named by its group and the button: the heading's line is room it needs at half height. -->
	{#if !addFirst}<h3>{D.add}</h3>{/if}
	<div class="add" role="group" aria-label={D.add}>
		<label>
			<span>{D.typeLabel}</span>
			<Select
				size="sm"
				value={leaveType}
				onchange={(v) => ontype(v as LeaveType)}
				data-testid="cal-add-type"
				options={types.map((t) => ({ value: t, label: L.type[t] }))}
			/>
		</label>
		<label>
			<span>{D.name}</span>
			<input
				type="text"
				bind:value={name}
				placeholder={D.namePlaceholder}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						add();
					}
				}}
				data-testid="cal-add-name"
			/>
		</label>
		<button type="button" class="primary" onclick={add} data-testid="cal-add">
			{D.addFor(L.type[leaveType], who)}
		</button>
	</div>
{/snippet}

{#snippet noteLine()}
	{#if note !== ''}<p class="note" role="status">{note}</p>{/if}
{/snippet}

{#snippet body()}
	<p class="facts" data-testid="cal-facts">{D.facts(details.days, details.working)}</p>

	{#if addFirst}
		{#if nothing}<p class="empty">{D.nothing}</p>{/if}
		{@render noteLine()}{@render addForm()}
	{/if}

	{#if editable.length > 0}
		<h3>{global ? D.holidays : D.leaves(who)}</h3>
		<ul class="list">
			{#each editable as e (keyOf(e))}
				{#if e.item}
					<LeaveCard
						item={e.item}
						fields={fieldsOf(e.item)}
						types={typesOfItem(e.item)}
						{oncommit}
						{onremove}
					/>
				{/if}
			{/each}
		</ul>
	{/if}
	{#if inheritedGlobal.length > 0}
		<h3>{D.holidays}</h3>
		<ul class="plain">
			{#each inheritedGlobal as e (keyOf(e))}<li>{leavePhrase(e)}</li>{/each}
		</ul>
	{/if}
	{#if details.groups.length > 0}
		<h3>{D.inheritedHeading}</h3>
		<ul class="plain">
			{#each details.groups as e (keyOf(e))}
				<li>{leavePhrase(e)} <span class="muted">({D.inherited(e.who ?? '')})</span></li>
			{/each}
		</ul>
	{/if}
	{#if details.textOnly.length > 0}
		<h3>{D.textOnlyHeading}</h3>
		<ul class="plain" data-testid="cal-textonly">
			{#each details.textOnly as e (keyOf(e))}
				<li>{leavePhrase(e)}<br /><span class="muted">{C.textOnly}</span></li>
			{/each}
		</ul>
	{/if}
	{#if nothing && !addFirst}<p class="empty">{D.nothing}</p>{/if}

	{#if details.milestones.length > 0}
		<h3>{D.milestones}</h3>
		<ul class="plain">
			{#each details.milestones as m (m.task)}
				<li class="ms">
					<span><i class="diamond" aria-hidden="true"></i>{m.name}</span>
					<button type="button" class="show" onclick={() => onmilestone(m.task)}>
						{D.showInGantt}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if !addFirst}{@render noteLine()}{@render addForm()}{/if}
	<!-- In a sheet, with no leave there is nothing to clear: the room is the add form's at half height. -->
	{#if !(sheet && nothing)}
		<button type="button" class="clear" onclick={onclear} data-testid="cal-clear">{D.clear}</button>
	{/if}
{/snippet}

{#if sheet}
	<div
		class="details in-sheet"
		role="group"
		aria-label={D.region}
		tabindex="-1"
		data-testid="cal-details"
		bind:this={root}
	>
		{@render body()}
	</div>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		class="details"
		aria-label={D.region}
		data-testid="cal-details"
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onclose();
			}
		}}
	>
		<header>
			<h2 tabindex="-1" bind:this={heading}>{rangeText}</h2>
			<button type="button" class="close" onclick={onclose} aria-label={D.close}>
				<Icon name="close" size={16} />
			</button>
		</header>
		{@render body()}
	</aside>
{/if}

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
	/* In the Sheet: its content area pads and scrolls, so nothing here does. */
	.details.in-sheet {
		overflow: visible;
		padding: 0;
		border: 0;
		background: transparent;
	}
	.details.in-sheet:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 4px;
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
	.facts,
	.empty,
	.note {
		margin: 0;
	}
	.facts,
	.empty,
	.muted {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.note {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-brass-wash);
		color: var(--color-brass-ink);
	}
	.list,
	.plain {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.plain li {
		overflow-wrap: anywhere;
	}
	.ms {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.diamond {
		display: inline-block;
		inline-size: 8px;
		block-size: 8px;
		margin-inline-end: 8px;
		transform: rotate(45deg);
		background: var(--color-gantt-milestone);
		outline: 1px solid var(--color-gantt-bar-outline);
	}
	.close,
	.show,
	.clear,
	.primary {
		min-block-size: 32px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.close {
		flex: none;
		display: grid;
		place-items: center;
		inline-size: 32px;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
	}
	.close:hover {
		background: var(--color-row-hover);
	}
	.show,
	.clear,
	.primary {
		padding-inline: var(--space-3);
	}
	.primary {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-text);
		font-weight: 600;
	}
	.clear {
		align-self: flex-start;
	}
	.close:focus-visible,
	.show:focus-visible,
	.clear:focus-visible,
	.primary:focus-visible,
	input:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
	}
	.add {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.add .primary {
		grid-column: 1 / -1;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-inline-size: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	input {
		box-sizing: border-box;
		inline-size: 100%;
		min-block-size: var(--size-control);
		padding-inline: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
	}
	@media (pointer: coarse) {
		.close,
		.show,
		.clear,
		.primary {
			min-block-size: var(--size-tap);
		}
		.close {
			inline-size: var(--size-tap);
		}
	}
</style>
