<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Dev page only (/dev/primitives): a small grid built the way the heatmap, the outline and the
	calendar use lib/ui/roving-grid.ts, so that its contract spec (tests/e2e/primitives/grid-focus.spec.ts)
	can rebuild it, move its window and watch where the focus goes without the engine. "Rebuild" replaces
	every cell element, as a zoom or a new result does in the real grids.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { RovingGrid, tabStop } from '../../lib/ui/roving-grid';

	interface Key {
		row: number;
		col: number;
	}
	const ROWS = 4;
	const COLS = 5;
	let generation = $state(0);
	/** The window: the columns drawn, which the "Scroll" button moves by one. */
	let first = $state(0);
	let focus = $state<Key | null>(null);
	let root: HTMLDivElement | undefined = $state();

	const cols = $derived(Array.from({ length: COLS - 1 }, (_, i) => first + i));
	const rows = Array.from({ length: ROWS }, (_, i) => i);

	const roving = new RovingGrid<Key>({
		root: () => root,
		keyOf: (t) => {
			const c = t instanceof HTMLElement ? t.closest<HTMLElement>('[data-col]') : null;
			return c ? { row: Number(c.dataset['row']), col: Number(c.dataset['col']) } : null;
		},
		find: (r, k) => r.querySelector<HTMLElement>(`[data-row="${k.row}"][data-col="${k.col}"]`),
	});

	const stop = $derived(tabStop(focus, (k) => cols.includes(k.col), { row: 0, col: first }));

	// A rebuild (a new generation, a moved window): the focus goes back to its cell.
	$effect(() => {
		void generation;
		void first;
		const f = focus;
		if (f) void tick().then(() => roving.restore(f));
	});

	function onkey(e: KeyboardEvent): void {
		const k = focus;
		if (!k) return;
		const step: Record<string, [number, number]> = {
			ArrowRight: [0, 1],
			ArrowLeft: [0, -1],
			ArrowDown: [1, 0],
			ArrowUp: [-1, 0],
		};
		const d = step[e.key];
		if (!d) return;
		e.preventDefault();
		const next = {
			row: Math.max(0, Math.min(ROWS - 1, k.row + d[0])),
			col: Math.max(first, Math.min(first + COLS - 2, k.col + d[1])),
		};
		focus = next;
		void tick().then(() => roving.focusCell(next));
	}
</script>

<div class="bar">
	<button type="button" data-testid="roving-rebuild" onclick={() => generation++}>Rebuild</button>
	<button type="button" data-testid="roving-scroll" onclick={() => first++}>Scroll right</button>
	<button type="button" data-testid="roving-away">Elsewhere</button>
</div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	class="grid"
	role="grid"
	aria-label="Roving demo"
	data-testid="roving-grid"
	data-generation={generation}
	tabindex="-1"
	onkeydown={(e) => {
		if (focus) onkey(e);
	}}
	onfocusin={(e) => {
		const k = roving.focusin(e);
		if (k) focus = k;
	}}
	onfocusout={(e) => void roving.focusout(e)}
>
	{#key generation}
		{#each rows as r (r)}
			<div role="row">
				{#each cols as c (c)}
					<div
						role="gridcell"
						class="cell"
						tabindex={stop && stop.row === r && stop.col === c ? 0 : -1}
						data-row={r}
						data-col={c}
						data-testid="roving-cell"
					>
						{r},{c}
					</div>
				{/each}
			</div>
		{/each}
	{/key}
</div>

<style>
	.bar {
		display: flex;
		gap: var(--space-2);
		margin-block-end: var(--space-2);
	}
	.bar button {
		min-block-size: var(--size-tap);
		padding-inline: var(--space-3);
	}
	.grid {
		display: grid;
		inline-size: max-content;
		max-inline-size: 100%;
	}
	[role='row'] {
		display: flex;
	}
	.cell {
		display: grid;
		place-items: center;
		inline-size: 3.5rem;
		block-size: var(--size-tap);
		border: 1px solid var(--color-border);
	}
</style>
