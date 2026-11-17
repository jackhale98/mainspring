<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The leave type picker the L key opens (phase-3.md 7.1 W3, 10): a small listbox over the foot of
	the calendar. The arrow keys choose, Enter adds that leave to the selected days, Escape cancels
	and the focus goes back to the day it came from (the Calendar's job). It is a keyboard path to
	painting, and a touch or mouse user can press an option as well. It says what it would do
	("Annual leave for Dev 1, 2 Mar to 6 Mar") so the choice is made with the days in mind.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { calendarStrings as C, leavePaintStrings as L } from '../../lib/strings';
	import type { LeaveType } from '../../lib/tjp/edit/types';

	interface Props {
		types: readonly LeaveType[];
		current: LeaveType;
		/** What it would be added to: "Dev 1, 2 Mar to 6 Mar". */
		target: string;
		onpick: (type: LeaveType) => void;
		oncancel: () => void;
	}
	let { types, current, target, onpick, oncancel }: Props = $props();

	let active = $state(untrack(() => Math.max(0, types.indexOf(current))));
	let list: HTMLUListElement | undefined = $state();
	onMount(() => list?.focus());

	function onkeydown(e: KeyboardEvent): void {
		const last = types.length - 1;
		if (e.key === 'ArrowDown') active = active >= last ? 0 : active + 1;
		else if (e.key === 'ArrowUp') active = active <= 0 ? last : active - 1;
		else if (e.key === 'Home') active = 0;
		else if (e.key === 'End') active = last;
		else if (e.key === 'Enter' || e.key === ' ') {
			const t = types[active];
			if (t) onpick(t);
		} else if (e.key === 'Escape') oncancel();
		else return;
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<div class="picker" role="dialog" aria-label={C.picker.title} data-testid="cal-picker">
	<p class="target">{target}</p>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<ul
		class="list"
		role="listbox"
		tabindex="0"
		aria-label={C.picker.title}
		aria-activedescendant="cal-pick-{types[active]}"
		bind:this={list}
		{onkeydown}
	>
		{#each types as t, i (t)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id="cal-pick-{t}"
				role="option"
				aria-selected={i === active}
				class:on={i === active}
				onclick={() => onpick(t)}
				data-testid="cal-pick-{t}"
			>
				{L.type[t]}
			</li>
		{/each}
	</ul>
	<p class="hint">{C.picker.hint}</p>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		inline-size: min(20rem, calc(100% - 2 * var(--gutter)));
		padding: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		box-shadow: var(--shadow-raised);
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	.target {
		margin: 0;
		font-weight: 600;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.list:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: 2px;
		border-radius: var(--radius-md);
	}
	li {
		display: flex;
		align-items: center;
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	li:hover {
		background: var(--color-row-hover);
	}
	li.on {
		background: var(--color-pill-on);
		color: var(--color-pill-on-ink);
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
</style>
