<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The heatmap's ARIA mirror (phase-3.md 8.1, 10): a real `role="grid"` over the canvas, holding the
	visible window only (heat-mirror.ts: at most 30 rows by 20 columns), with `aria-rowcount` and
	`aria-colcount` for the whole model and an index on every row and column. Row headers are the
	people, each saying its place in the hierarchy in words ("Dev 1, in Team", "Team, group,
	expanded": a grid row has no `aria-level` or `aria-expanded`, those are a tree grid's, and a tree
	grid would promise expand and collapse keys this grid does not have); column headers are the
	periods in words; each
	cell's name is its sentence ("Dev 1, week of 9 March: 38 of 40 hours, full"). The cells sit
	exactly over their pixels and are transparent, so a screen magnifier, a touch screen reader and
	the focus all agree with the picture; they take no pointer events (the canvas has those).

	The lanes (T15) use it too, with their own label and test ids (`kind="lane"`): both views can be
	mounted at once.

	Roving focus (lib/ui/roving-grid.ts, shared with the outline and the calendar): one cell has
	tabindex 0 (the focus cell, or the first of the window), and the focus survives a rebuild of the
	mirror; the arrow
	keys, Home, End, PageUp, PageDown and T move it (the parent decides where, heat-mirror.ts
	`moveFocus`); Enter and Space open the cell's details. The 3 px focus ring is drawn on the
	canvas, by the parent, while the grid has the focus.

	`contain: strict` keeps the mirror's layout out of the page. It is rebuilt 150 ms after a scroll
	stops, never in a scroll frame (the parent), so there is no DOM work while scrolling.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { lanesStrings } from '../../lib/strings-lanes';
	import { workloadStrings as W } from '../../lib/strings-workload';
	import type { Cell, HeatLayout } from '../../lib/workload/heat-layout';
	import type { Mirror } from '../../lib/workload/heat-mirror';
	import { RovingGrid, tabStop } from '../../lib/ui/roving-grid';

	interface Props {
		mirror: Mirror;
		layout: HeatLayout;
		/** The roving focus cell. */
		focus: Cell | null;
		/** A new value moves the DOM focus to the focus cell (a key moved it). */
		focusNonce: number;
		onkey: (e: KeyboardEvent, cell: Cell) => void;
		/** The grid took or lost the keyboard focus. */
		onfocuschange: (inside: boolean, cell: Cell | null) => void;
		/** Which view this mirrors: its label and the prefix of its test ids. */
		kind?: 'heat' | 'lane';
	}
	let { mirror, layout, focus, focusNonce, onkey, onfocuschange, kind = 'heat' }: Props = $props();

	let root: HTMLDivElement | undefined = $state();

	/** The cell with tabindex 0: the focus cell when it is in the window, else the window's first. */
	const active = $derived.by<Cell | null>(() => {
		const r = mirror.range;
		return tabStop(
			focus,
			(c) => c.row >= r.r0 && c.row < r.r1 && c.col >= r.c0 && c.col < r.c1,
			mirror.rows[0]?.cells[0] ? { row: r.r0, col: r.c0 } : null,
		);
	});

	function cellOf(el: EventTarget | null): Cell | null {
		if (!(el instanceof HTMLElement)) return null;
		const c = el.closest<HTMLElement>('[data-col]');
		if (!c) return null;
		return { row: Number(c.dataset['row']), col: Number(c.dataset['col']) };
	}

	// The focus stays in the grid when a rebuild of the mirror (a zoom, the demand arriving, a resize)
	// replaces the focused cell's element, unless the person moved it elsewhere (roving-grid.ts).
	const roving = new RovingGrid<Cell>({
		root: () => root,
		keyOf: cellOf,
		find: (r, c) => r.querySelector<HTMLElement>(`[data-row="${c.row}"][data-col="${c.col}"]`),
	});
	$effect(() => {
		void mirror;
		const f = focus;
		if (!f) return;
		void tick().then(() => roving.restore(f));
	});

	// svelte-ignore state_referenced_locally
	let seen = focusNonce;
	$effect(() => {
		const n = focusNonce;
		const f = focus;
		if (n === seen || !f) return;
		seen = n;
		void tick().then(() => {
			roving.focusCell(f);
		});
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_interactive_supports_focus -->
<div
	bind:this={root}
	class="grid"
	role="grid"
	aria-label={kind === 'heat' ? W.grid : lanesStrings.grid}
	aria-rowcount={mirror.ariaRowCount}
	aria-colcount={mirror.ariaColCount}
	aria-readonly="true"
	data-testid="{kind}-grid"
	onkeydown={(e) => {
		const c = cellOf(e.target);
		if (c) onkey(e, c);
	}}
	onfocusin={(e) => onfocuschange(true, roving.focusin(e))}
	onfocusout={(e) => {
		if (roving.focusout(e)) onfocuschange(false, null);
	}}
>
	<div role="row" aria-rowindex="1" class="hrow">
		<div role="columnheader" aria-colindex="1">{W.people}</div>
		{#each mirror.columns as c (c.col)}
			<div role="columnheader" aria-colindex={c.ariaColIndex}>{c.text}</div>
		{/each}
	</div>
	{#each mirror.rows as r (r.id)}
		<div
			role="row"
			class="mrow"
			aria-rowindex={r.ariaRowIndex}
			style:top="{layout.rowTop(r.row)}px"
			style:height="{layout.rowHeight}px"
		>
			<div role="rowheader" aria-colindex="1" class="rhead">
				{r.group
					? W.rowHeader.group(r.name, r.expanded === true)
					: r.parent === null
						? r.name
						: W.rowHeader.member(r.name, r.parent)}
			</div>
			{#each r.cells as c (c.col)}
				<div
					role="gridcell"
					class="cell"
					aria-colindex={c.ariaColIndex}
					tabindex={active && active.row === c.row && active.col === c.col ? 0 : -1}
					data-testid="{kind}-cell"
					data-row={c.row}
					data-col={c.col}
					data-person={r.id}
					data-band={c.band}
					data-booked={c.booked}
					data-available={c.available}
					style:left="{layout.colLeft(c.col)}px"
					style:width="{layout.colWidth}px"
				>
					{c.name}
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.grid {
		position: absolute;
		inset: 0;
		contain: strict;
		pointer-events: none;
		/* Transparent, over the pixels: found by assistive technology and by focus, never seen. */
		opacity: 0;
		overflow: hidden;
	}
	.hrow,
	.rhead {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		white-space: nowrap;
	}
	.mrow {
		position: absolute;
		inset-inline-start: 0;
		inline-size: 100%;
	}
	.cell {
		position: absolute;
		inset-block: 0;
		overflow: hidden;
		font-size: 1px;
		line-height: 1;
		white-space: nowrap;
		outline: none;
	}
</style>
