<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The searchable list of the people picker (PeoplePicker.svelte; polish item 17): an ARIA
	combobox (the search box, which keeps the focus) with a listbox of the plan's people. Typing
	narrows it by name or id (`people-filter.ts`); Up and Down move the active option
	(`aria-activedescendant`), Enter picks it, Escape and Tab leave. An option can also be pressed
	and dragged out (`chip-drag.svelte.ts`): while it is in the air the list is hidden, so the bars
	are in view, and the picker closes it when the drop is done. A click that did not move picks
	the person. The list only reports; it changes nothing.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { gestureStrings } from '../../lib/strings';
	import Icon from '../Icon.svelte';
	import { avatarColour, initials } from './avatar';
	import type { ChipDrag } from './chip-drag.svelte';
	import { filterPeople } from './people-filter';
	import type { Person } from './types';

	interface Props {
		id: string;
		people: readonly Person[];
		/** The people booked on the selected task (own or inherited), by id. */
		booked: ReadonlySet<string>;
		hasTask: boolean;
		drag: ChipDrag;
		/** Open towards the left edge of the button, for a button near the right edge of the chart. */
		alignEnd: boolean;
		/** A person chosen: by a click, or by Enter (`byKey`). */
		onchoose: (person: Person, byKey: boolean) => void;
		/** Escape (`refocus`: the button takes the focus back) or Tab. */
		onclose: (refocus: boolean) => void;
	}
	let { id, people, booked, hasTask, drag, alignEnd, onchoose, onclose }: Props = $props();

	const S = gestureStrings.palette;
	let query = $state('');
	let active = $state(0);
	let input: HTMLInputElement | undefined = $state();
	let list: HTMLUListElement | undefined = $state();

	const matches = $derived(filterPeople(people, query));
	const current = $derived(matches[Math.min(active, matches.length - 1)]);
	const optionId = (person: string): string => `${id}-opt-${person}`;

	onMount(() => void tick().then(() => input?.focus()));

	function move(by: number): void {
		const n = matches.length;
		if (n === 0) return;
		active = (Math.min(active, n - 1) + by + n) % n;
		void tick().then(() =>
			list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }),
		);
	}
	function onkeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown') move(1);
		else if (e.key === 'ArrowUp') move(-1);
		else if (e.key === 'Enter') {
			if (current) onchoose(current.person, true);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			return onclose(true);
		} else if (e.key === 'Tab') return onclose(false);
		else return;
		e.preventDefault();
	}
	// A click that is the end of a drag has moved; a real click has not.
	let downAt = { x: 0, y: 0 };
	const pressed = (e: PointerEvent, index: number): void => {
		if (e.button !== 0) return;
		downAt = { x: e.clientX, y: e.clientY };
		drag.down(e, index);
	};
	const clicked = (e: MouseEvent, p: Person): void => {
		if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
		onchoose(p, false);
	};
</script>

<div class="panel" class:end={alignEnd} class:flying={drag.dragging} {id} data-testid="people-list">
	<input
		bind:this={input}
		bind:value={query}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		aria-expanded="true"
		aria-controls="{id}-list"
		aria-autocomplete="list"
		aria-activedescendant={current ? optionId(current.person.id) : undefined}
		aria-label={S.searchLabel}
		placeholder={S.searchPlaceholder}
		oninput={() => (active = 0)}
		{onkeydown}
	/>
	<ul id="{id}-list" role="listbox" aria-label={S.listLabel} bind:this={list}>
		{#each matches as m, i (m.person.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id={optionId(m.person.id)}
				role="option"
				aria-selected={current?.person.id === m.person.id}
				class:active={current?.person.id === m.person.id}
				data-person={m.person.id}
				style:--bg="var(--color-gantt-avatar-{avatarColour(m.person.index)}-bg)"
				style:--ink="var(--color-gantt-avatar-{avatarColour(m.person.index)}-ink)"
				onmousedown={(e) => e.preventDefault()}
				onpointerdown={(e) => pressed(e, m.index)}
				onpointermove={() => {
					if (!drag.dragging) active = i;
				}}
				onclick={(e) => clicked(e, m.person)}
			>
				<span class="avatar" aria-hidden="true">{initials(m.person.name)}</span>
				<span class="who">{m.person.name}</span>
				<small class="id">{m.person.id}</small>
				{#if hasTask && booked.has(m.person.id)}
					<span class="mark"
						><Icon name="check" size={12} stroke={2.4} /><span class="sr-only">
							{S.onSelected}</span
						></span
					>
				{/if}
			</li>
		{/each}
	</ul>
	<p class="status" role="status">
		{#if matches.length === 0}{S.noMatch(query.trim())}{:else}{S.count(matches.length)}{/if}
	</p>
</div>

<style>
	.panel {
		position: absolute;
		inset-block-start: calc(100% + 6px);
		inset-inline-start: 0;
		z-index: 30;
		display: grid;
		gap: var(--space-2);
		inline-size: min(20rem, calc(100cqw - 16px));
		padding: var(--space-2);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	.panel.end {
		inset-inline-start: auto;
		inset-inline-end: 0;
	}
	/* While a person is dragged out of it the list is out of the way (still there: it holds the
	   pointer capture of the drag). */
	.panel.flying {
		visibility: hidden;
	}
	input {
		box-sizing: border-box;
		inline-size: 100%;
		min-block-size: 32px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-gantt-surface);
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
	}
	input:focus-visible {
		outline: 2px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	[role='listbox'] {
		display: grid;
		max-block-size: min(16rem, 50vh);
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	[role='option'] {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-block-size: 32px;
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: var(--text-sm);
		cursor: grab;
		user-select: none;
		touch-action: none;
	}
	[role='option'].active {
		background: var(--color-gantt-inset);
		box-shadow: inset 3px 0 0 var(--color-gantt-accent);
	}
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		inline-size: 20px;
		block-size: 20px;
		border-radius: 50%;
		background: var(--bg);
		color: var(--ink);
		font-size: 9px;
		font-weight: 700;
	}
	.who {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.id {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
	.mark {
		display: inline-grid;
		color: var(--color-gantt-accent);
	}
	.status {
		margin: 0;
		padding-inline: var(--space-1);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
</style>
