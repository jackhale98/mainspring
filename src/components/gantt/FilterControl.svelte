<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt toolbar's filter control (phase-3.md "Amendments from T19"): a pill that opens the filter's panel
	(FilterPanel.svelte, fetched on first use). With a filter on, the pill names it ("Dev 1, flag
	key") in the accent colour and a small button beside it clears it, so the way out is one press
	away on every layout; a polite status says how many tasks are shown after each change. It holds
	no state of the filter: the app owns it (gantt-filter.svelte.ts). It is for every pointer: a
	finger has no other way to filter, so the pill is a 44 px target on a coarse pointer.
-->
<script lang="ts">
	import type { FlagChoice } from '../../lib/gantt/filter';
	import { strings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import LazyMount from '../app/LazyMount.svelte';
	import type { Person } from './types';

	interface Props {
		people: readonly Person[];
		flags: readonly FlagChoice[];
		person: string | null;
		flag: string | null;
		/** The tasks the filter shows (leaves that match), or null without a filter. */
		matches: number | null;
		onperson: (id: string | null) => void;
		onflag: (flag: string | null) => void;
		onclear: () => void;
		/** The panel opened or closed: the Gantt reads the flags to choose from only while it is open. */
		onopen?: ((open: boolean) => void) | undefined;
	}
	let { people, flags, person, flag, matches, onperson, onflag, onclear, onopen }: Props = $props();

	const F = strings.gantt.filter;
	const uid = $props.id();
	let open = $state(false);
	let alignEnd = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let button: HTMLButtonElement | undefined = $state();

	const on = $derived(person !== null || flag !== null);
	const summary = $derived(
		F.summary(person === null ? null : (people.find((p) => p.id === person)?.name ?? person), flag),
	);
	/** Said after each change: how many tasks the filter shows. */
	const live = $derived(matches === null ? '' : matches === 0 ? F.none : F.shown(matches));

	$effect(() => onopen?.(open));

	function show(): void {
		// Open towards the side that has the room: a button near the right edge of a narrow chart.
		const chart = root?.closest('[data-testid="gantt"]')?.getBoundingClientRect();
		const at = button?.getBoundingClientRect();
		alignEnd = !!chart && !!at && at.left + 340 > chart.right;
		open = true;
	}
	function close(refocus: boolean): void {
		open = false;
		if (refocus) button?.focus();
	}
	function onwindowdown(e: PointerEvent): void {
		if (open && e.target instanceof Node && !root?.contains(e.target)) close(false);
	}
</script>

<svelte:window onpointerdown={onwindowdown} />

<div class="filter" class:on bind:this={root} data-testid="gantt-filter">
	<button
		bind:this={button}
		type="button"
		class="chip btn"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={open ? `${uid}-panel` : undefined}
		aria-label={on ? F.on(summary) : F.label}
		title={F.title}
		data-testid="filter-button"
		onclick={() => (open ? close(false) : show())}
	>
		<Icon name="filter" size={14} />
		{#if on}<span class="lbl">{summary}</span>{/if}
	</button>
	{#if on}
		<button
			type="button"
			class="clear"
			aria-label={F.clear}
			title={F.clear}
			data-testid="filter-clear"
			onclick={onclear}
		>
			<Icon name="close" size={12} stroke={2.4} />
		</button>
	{/if}
	<LazyMount
		when={open}
		load={() => import('./FilterPanel.svelte')}
		props={{
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
			onclose: close,
		}}
		onfail={() => (open = false)}
	/>
</div>
<span class="sr-only" role="status" data-testid="filter-live">{live}</span>

<style>
	.filter {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		block-size: var(--gantt-chip-height);
		padding-inline: 9px;
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
	.chip:hover {
		background: var(--color-gantt-inset);
	}
	.chip[aria-expanded='true'] {
		border-color: var(--color-gantt-accent);
		box-shadow: inset 0 0 0 1px var(--color-gantt-accent);
	}
	button:focus-visible {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	/* On: the accent, as assign mode's pill is, so that a hidden-rows state is never missed. */
	.on .chip {
		border-color: var(--color-gantt-accent);
		box-shadow: inset 0 0 0 1px var(--color-gantt-accent);
		font-weight: 600;
	}
	/* Idle, the pill is its icon (the toolbar has little room: see the people picker's tiers);
	   with a filter on it says which, in a chart wide enough for it. */
	.on .chip {
		padding-inline: 12px;
	}
	.lbl {
		max-inline-size: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* With the clear button beside it the two read as one pill. */
	.on .chip {
		border-start-end-radius: 0;
		border-end-end-radius: 0;
		border-inline-end: 0;
	}
	.clear {
		display: inline-grid;
		place-items: center;
		box-sizing: border-box;
		block-size: var(--gantt-chip-height);
		inline-size: 28px;
		border: 1px solid var(--color-gantt-accent);
		border-start-end-radius: 999px;
		border-end-end-radius: 999px;
		border-inline-start: 0;
		background: var(--color-gantt-chip);
		box-shadow: inset 0 0 0 1px var(--color-gantt-accent);
		color: var(--color-gantt-text);
		cursor: pointer;
	}
	.clear:hover {
		background: var(--color-gantt-inset);
	}
	/* The pill's words give way to its icon in a narrow chart, as the Assign button's do; the
	   accent border and the clear button still say that a filter is on. */
	@container gantt (max-width: 1049px) {
		.lbl {
			display: none;
		}
		.on .chip {
			padding-inline: 9px;
		}
	}
	@media (pointer: coarse) {
		.chip,
		.clear {
			min-block-size: var(--size-tap);
		}
		.clear {
			min-inline-size: var(--size-tap);
		}
	}
	/* A phone: the sheet is placed against the chart, so this box is not the one it hangs from. */
	@media (max-width: 599px) {
		.filter {
			position: static;
		}
		.chip {
			min-inline-size: var(--size-tap);
			justify-content: center;
			padding-inline: 0;
		}
		.lbl {
			display: none;
		}
	}
	/* Under 480 px the row has no room for a seventh 44 px target: the pill alone says that a
	   filter is on, filled in the accent colour, and its panel (and the empty chart) have Clear
	   filter. */
	@media (max-width: 479px) {
		.clear {
			display: none;
		}
		.on .chip {
			border-radius: 999px;
			border-inline-end: 1px solid var(--color-gantt-accent);
			background: var(--color-gantt-accent);
			color: var(--color-gantt-accent-text);
		}
		.on .chip:hover {
			background: var(--color-gantt-accent);
			filter: brightness(1.08);
		}
	}
</style>
