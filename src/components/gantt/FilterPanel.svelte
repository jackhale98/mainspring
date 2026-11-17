<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt filter's panel (phase-3.md "Amendments from T19"; opened by FilterControl.svelte, fetched when it
	is first opened so that it stays out of the first-load JS). Two choices and a way out:
	- a person: the people picker's own searchable list (PeopleList.svelte, embedded, without its
	  drag). Choosing the person the chart is filtered to takes the filter off;
	- a flag: one of the flags some task carries, as radio buttons (arrow keys move, Any flag clears);
	- Clear filter, and Done.
	It only reports: the filter state is the app's (gantt-filter.svelte.ts), and the text is never
	touched. On a desktop and a tablet it is a popover under its button; under 600 px it is a sheet
	at the foot of the chart, and the search box does not take the focus (a finger would raise the
	keyboard over the list).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { FlagChoice } from '../../lib/gantt/filter';
	import { strings } from '../../lib/strings';
	import { filterPanelStrings as P } from '../../lib/strings-filter';
	import PeopleList from './PeopleList.svelte';
	import type { Person } from './types';

	interface Props {
		open: boolean;
		people: readonly Person[];
		flags: readonly FlagChoice[];
		person: string | null;
		flag: string | null;
		/** The tasks the filter shows now (leaves that match), or null without a filter. */
		matches: number | null;
		/** Open towards the left edge of the button (it is near the right edge of the chart). */
		alignEnd: boolean;
		onperson: (id: string | null) => void;
		onflag: (flag: string | null) => void;
		onclear: () => void;
		/** Escape, Done or focus leaving (`refocus`: the button takes the focus back). */
		onclose: (refocus: boolean) => void;
	}
	let {
		open,
		people,
		flags,
		person,
		flag,
		matches,
		alignEnd,
		onperson,
		onflag,
		onclear,
		onclose,
	}: Props = $props();

	const F = strings.gantt.filter;
	const uid = $props.id();
	let root: HTMLDivElement | undefined = $state();
	/** A finger: the search box does not take the focus. */
	let coarse = $state(false);

	onMount(() => {
		coarse = matchMedia('(pointer: coarse)').matches;
	});
	// The panel itself takes the focus when the search box does not (the dialog is read, Escape works).
	$effect(() => {
		if (open && coarse) root?.focus();
	});

	const marked = $derived(new Set(person === null ? [] : [person]));
	const goneFlag = $derived(flag !== null && !flags.some((f) => f.flag === flag));
	const choices = $derived(
		goneFlag && flag !== null ? [...flags, { flag, count: 0 }].sort(byName) : flags,
	);
	function byName(a: FlagChoice, b: FlagChoice): number {
		return a.flag.localeCompare(b.flag);
	}
	const count = $derived(matches === null ? '' : matches === 0 ? F.none : F.shown(matches));

	function onfocusout(e: FocusEvent): void {
		const to = e.relatedTarget;
		// Focus left the panel (Tab past its last control): it closes, the button is not asked to refocus.
		if (to instanceof Node && root && !root.contains(to) && !root.parentElement?.contains(to)) {
			onclose(false);
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={root}
		id="{uid}-panel"
		class="panel"
		class:end={alignEnd}
		role="dialog"
		aria-label={P.panel}
		tabindex="-1"
		data-testid="filter-panel"
		{onfocusout}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onclose(true);
			}
		}}
	>
		<div class="part" role="group" aria-labelledby="{uid}-person">
			<p class="cap" id="{uid}-person">{P.person}</p>
			<PeopleList
				id="{uid}-people"
				{people}
				booked={marked}
				hasTask={true}
				markLabel={P.personOn}
				searchLabel={P.personSearch}
				embedded={true}
				focusSearch={!coarse}
				initial={person}
				onchoose={(p) => onperson(person === p.id ? null : p.id)}
				{onclose}
			/>
			{#if person !== null && !people.some((p) => p.id === person)}
				<p class="none">{P.gone(person)}</p>
			{/if}
		</div>
		<fieldset class="part flags">
			<legend class="cap">{P.flag}</legend>
			{#if choices.length === 0}
				<p class="none">{P.noFlags}</p>
			{:else}
				<div class="radios">
					<label class="radio">
						<input
							type="radio"
							name="{uid}-flag"
							checked={flag === null}
							onchange={() => onflag(null)}
						/>
						<span>{P.anyFlag}</span>
					</label>
					{#each choices as c (c.flag)}
						<label class="radio">
							<input
								type="radio"
								name="{uid}-flag"
								value={c.flag}
								checked={flag === c.flag}
								onchange={() => onflag(c.flag)}
							/>
							<span>{c.flag}</span>
							<small
								><span aria-hidden="true">{c.count}</span><span class="sr-only"
									>, {P.taskCount(c.count)}</span
								></small
							>
						</label>
					{/each}
				</div>
			{/if}
		</fieldset>
		<div class="foot">
			<p class="count" data-testid="filter-count">{count}</p>
			<button type="button" class="btn" disabled={matches === null} onclick={onclear}>
				{F.clear}
			</button>
			<button type="button" class="btn primary" onclick={() => onclose(true)}>{P.done}</button>
		</div>
	</div>
{/if}

<style>
	.panel {
		position: absolute;
		inset-block-start: calc(100% + 6px);
		inset-inline-start: 0;
		z-index: 30;
		display: grid;
		gap: var(--space-3);
		box-sizing: border-box;
		inline-size: min(21rem, calc(100cqw - 16px));
		/* Room for the two lists and the foot in a short window; the panel scrolls past that. */
		--people-list-max: 9.5rem;
		max-block-size: calc(100vh - 11rem);
		overflow-y: auto;
		padding: var(--space-3);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
		color: var(--color-text);
		font-size: var(--text-sm);
		white-space: normal;
	}
	.panel:focus {
		outline: none;
	}
	.panel.end {
		inset-inline-start: auto;
		inset-inline-end: 0;
	}
	.part {
		display: grid;
		gap: var(--space-1);
		min-inline-size: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.cap {
		margin: 0;
		padding: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.radios {
		display: grid;
		max-block-size: 8.5rem;
		overflow-y: auto;
	}
	.radio {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 32px;
		padding-inline: var(--space-1);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.radio:hover {
		background: var(--color-gantt-inset);
	}
	.radio input {
		flex: none;
		inline-size: 16px;
		block-size: 16px;
		margin: 0;
		accent-color: var(--color-gantt-accent);
	}
	.radio input:focus-visible {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.radio span {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.radio small {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.none {
		margin: 0;
		color: var(--color-text-muted);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.count {
		flex: 1;
		min-inline-size: 0;
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.btn {
		min-block-size: 32px;
		padding-inline: var(--space-3);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: 999px;
		background: var(--color-gantt-chip);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.primary {
		border-color: var(--color-gantt-accent);
		background: var(--color-gantt-accent);
		color: var(--color-gantt-accent-text);
		font-weight: 600;
	}
	.btn:focus-visible {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.radio,
		.btn {
			min-block-size: var(--size-tap);
		}
		.radio input {
			inline-size: 22px;
			block-size: 22px;
		}
	}
	/* A phone: a sheet at the foot of the chart (the control is not positioned there, so this is
	   placed against the chart). The lists get less height to leave the chart in view. */
	@media (max-width: 599px) {
		.panel,
		.panel.end {
			position: absolute;
			inset-block: auto 0;
			inset-inline: 0;
			inline-size: auto;
			max-block-size: 75%;
			overflow-y: auto;
			border-inline: 0;
			border-block-end: 0;
			border-radius: var(--radius-md) var(--radius-md) 0 0;
		}
		.radios {
			max-block-size: 7rem;
		}
	}
</style>
