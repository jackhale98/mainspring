<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's task list: a DOM `role="treegrid"`, the accessible mirror of the canvas timeline
	(phase-2.md 10.1, 10.2). One row per Gantt row, at the same height, so it scrolls with the bars.
	Its header row is the frozen corner above the time header.

	Columns: the task name, then start, end, effort or length, people, float (estimate), critical
	(estimate) and status. All of them are always in the grid; the wider the Gantt, the more are
	drawn (lib/gantt/columns.ts). The others are visually hidden, not removed, so a screen reader
	reads the same table on a phone, and keyboard focus skips them. The texts come from
	lib/gantt/grid.ts and are asserted against the model in the e2e spec.

	Rows carry aria-level, aria-posinset, aria-setsize and aria-expanded, and aria-rowindex with
	aria-rowcount, because only the rows near the viewport (and the focused one) are mounted.
	Exactly one element is in the tab order (roving tabindex): the focused row or cell, else the
	selected row, else the first. The keys are lib/gantt/grid-nav.ts. Moving focus never selects.

	The grid only reads: it emits intents (toggle, select, open, rename) and the Gantt decides.
	Critical is never colour alone: the Critical column says Yes or No in words (WCAG 1.4.1).

	Over 400 lines on purpose: about a third is the styles (phone and coarse-pointer rules included),
	and the rest is one invariant, which row or cell holds the focus. The mounted rows, the tab stop,
	the key handler and the focus calls all read it, so splitting them would spread it over two files.
	The logic that can stand alone is already in lib/gantt (columns, grid, grid-nav).
-->
<script lang="ts">
	import Icon from '../Icon.svelte';
	import { COLUMN_ORDER, widthOf, type ColumnId } from '../../lib/gantt/columns';
	import { describeRow } from '../../lib/gantt/describe';
	import { gridCells, spokenText, type GridRowInput } from '../../lib/gantt/grid';
	import { gridMove, type GridFocus, type GridShape } from '../../lib/gantt/grid-nav';
	import type { GanttRow } from '../../lib/gantt/model';
	import type { OutlineNode } from '../../lib/state/outline';
	import { strings } from '../../lib/strings';

	interface Props extends Omit<GridRowInput, 'pending'> {
		pending?: ReadonlySet<string>;
		/** The columns drawn, in cell order, the name first. */
		shown: readonly ColumnId[];
		/** The mounted range of rows; `last` is exclusive. */
		first: number;
		last: number;
		rowHeight: number;
		headerHeight: number;
		/** Whole rows in the viewport, for Page Up and Page Down. */
		page: number;
		selectedKey: string | null;
		/** What the live region says; a new sentence is spoken once. */
		announcement: string;
		ontoggle: (key: string) => void;
		onselect: (key: string) => void;
		/** Enter on a row: select it and (with the inspector, T17) move focus into it. */
		onopen?: (key: string) => void;
		/** F2 on a row; without it the key is left alone. */
		onrename?: (key: string) => void;
		/** Scrolls a row into view (the rows near the viewport are the only ones mounted). */
		onreveal: (index: number) => Promise<void>;
		/**
		 * Every task of the outline by key, so that when the focused row goes away the focus can
		 * move to its nearest ancestor that is still a row, even if a collapsed ancestor hides
		 * its direct parent. Without it the focus moves to the nearest row.
		 */
		outline?: ReadonlyMap<string, Pick<OutlineNode, 'parent'>>;
	}
	let {
		model,
		analysis,
		sizing,
		pending,
		shown,
		first,
		last,
		rowHeight,
		headerHeight,
		page,
		selectedKey,
		announcement,
		ontoggle,
		onselect,
		onopen,
		onrename,
		onreveal,
		outline,
	}: Props = $props();

	const rows = $derived(model.rows);
	let focusKey = $state<string | null>(null);
	let grid: HTMLDivElement | undefined = $state();

	/**
	 * The rows to mount: those near the viewport, and the focused one wherever it is, so that
	 * scrolling it out of view does not drop the keyboard focus. They stay in row order: a keyed
	 * each moves a node whose place in the list changes, and a focused node that is moved
	 * loses the focus, so the pinned row goes before the window when it is above it.
	 */
	const items = $derived.by(() => {
		const list = rows.slice(first, last).map((row, i) => ({ row, index: first + i }));
		const at = focusKey === null ? -1 : (model.rowOf.get(focusKey) ?? -1);
		const pinned =
			at >= 0 && (at < first || at >= last) ? { row: rows[at] as GanttRow, index: at } : null;
		if (pinned !== null) {
			if (at < first) list.unshift(pinned);
			else list.push(pinned);
		}
		return list;
	});
	const tabKey = $derived(
		focusKey !== null && items.some((x) => x.row.key === focusKey)
			? focusKey
			: (items.find((x) => x.row.key === selectedKey)?.row.key ?? items[0]?.row.key ?? null),
	);
	/** The column of the focused cell (an id), or null when the row has the focus. */
	let focusCol = $state<ColumnId | null>(null);
	const input = $derived<GridRowInput>({
		model,
		analysis,
		sizing,
		...(pending ? { pending } : {}),
	});
	const isShown = (c: ColumnId): boolean => shown.includes(c);
	const nameRem = (c: ColumnId): string | undefined => {
		const w = widthOf(c);
		return w === null ? undefined : `${w}rem`;
	};

	/** Where the focus last was inside the grid, to find it a place if its row goes away. */
	let lastFocus: { el: Element; row: GanttRow; index: number } | null = null;

	/** Whichever row or cell gets the focus, by any means, is the one kept mounted. */
	function onfocusin(event: FocusEvent): void {
		const t = event.target;
		if (!(t instanceof Element)) return;
		const key = t.closest('[data-key]')?.getAttribute('data-key');
		if (!key) return;
		focusKey = key;
		const col = t.closest('[data-col]')?.getAttribute('data-col') ?? null;
		focusCol = col as ColumnId | null;
		const index = model.rowOf.get(key) ?? -1;
		const row = rows[index];
		lastFocus = row ? { el: t, row, index } : null;
	}

	/** Focus that leaves the grid lets go of the pinned row. */
	function onfocusout(event: FocusEvent): void {
		const to = event.relatedTarget;
		if (!(to instanceof Node) || !grid?.contains(to)) {
			focusKey = null;
			focusCol = null;
			// Focus that went nowhere is either a click on empty space, which is not ours to undo,
			// or the focused row being removed, which the effect below answers. A removed node is
			// no longer connected once this microtask runs.
			const gone = lastFocus;
			if (to instanceof Node) lastFocus = null;
			else
				queueMicrotask(() => (lastFocus === gone && gone?.el.isConnected ? (lastFocus = null) : 0));
		}
	}

	// The focused row went away (collapsed under another row, deleted, renamed): the focus would
	// fall to the page. Move it to the nearest ancestor that is still a row, else the nearest row.
	$effect(() => {
		const rowOf = model.rowOf;
		const gone = lastFocus;
		if (gone === null || rowOf.has(gone.row.key) || gone.el.isConnected) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		lastFocus = null;
		let target = -1;
		for (let p = gone.row.node.parent; p !== null && target < 0;) {
			const at = rowOf.get(p);
			if (at !== undefined) target = at;
			else p = outline?.get(p)?.parent ?? null;
		}
		if (target < 0) target = Math.min(gone.index, rows.length - 1);
		if (target >= 0) void focusAt({ row: target, col: null });
	});

	async function focusAt(to: GridFocus): Promise<void> {
		const row = rows[to.row];
		if (!row) return;
		const col = to.col === null ? null : (shown[to.col] ?? null);
		focusKey = row.key;
		focusCol = col;
		await onreveal(to.row);
		const sel = `[data-key="${CSS.escape(row.key)}"]`;
		const el = grid?.querySelector<HTMLElement>(col === null ? sel : `${sel} [data-col="${col}"]`);
		el?.focus({ preventScroll: true });
	}

	const indexOf = (key: string): number => model.rowOf.get(key) ?? -1;
	const shape = $derived<GridShape>({
		rows: rows.length,
		cols: shown.length,
		page,
		expanded: (r) => rows[r]?.expanded ?? null,
		parent: (r) => {
			const p = rows[r]?.node.parent;
			return p === null || p === undefined ? -1 : indexOf(p);
		},
	});

	function onkeydown(event: KeyboardEvent): void {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const key = target.closest('[data-key]')?.getAttribute('data-key');
		const at = key ? indexOf(key) : -1;
		if (at < 0) return;
		const colId = target.closest('[data-col]')?.getAttribute('data-col') ?? null;
		const col = colId === null ? null : shown.indexOf(colId as ColumnId);
		const move = gridMove({ row: at, col: col === null || col < 0 ? null : col }, event, shape);
		const row = rows[at];
		if (!row || move.kind === 'ignore') return;
		if (move.kind === 'rename' && !onrename) return;
		event.preventDefault();
		switch (move.kind) {
			case 'focus':
				void focusAt(move.to);
				break;
			case 'toggle':
				ontoggle(row.key);
				break;
			case 'open':
				onselect(row.key);
				onopen?.(row.key);
				break;
			case 'select':
				onselect(row.key);
				break;
			case 'rename':
				onrename?.(row.key);
				break;
		}
	}

	function onclick(event: MouseEvent, row: GanttRow): void {
		focusKey = row.key;
		if ((event.target as Element).closest('.twisty') && row.expanded !== null) ontoggle(row.key);
		else onselect(row.key);
	}

	/** A column that is no longer drawn (the Gantt was resized) cannot hold the focus. */
	const heldCol = $derived(focusCol !== null && isShown(focusCol) ? focusCol : null);
	const tabIndexOf = (row: GanttRow, col: ColumnId | null): 0 | -1 =>
		tabKey === row.key && (focusKey === row.key ? heldCol === col : col === null) ? 0 : -1;
</script>

<!--
	The treegrid has no tab stop of its own: the roving tabindex is on its rows and cells (the
	ARIA pattern), and keys are handled here once, for whichever of them has the focus.
-->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	bind:this={grid}
	role="treegrid"
	aria-label={strings.grid.label}
	aria-rowcount={rows.length + 1}
	aria-colcount={COLUMN_ORDER.length}
	data-testid="gantt-treegrid"
	class="grid"
	{onfocusin}
	{onfocusout}
	{onkeydown}
>
	<div class="corner" role="row" aria-rowindex={1} style:height="{headerHeight}px">
		{#each COLUMN_ORDER as col, c (col)}
			<div
				role="columnheader"
				class="cell head"
				class:hidden={!isShown(col)}
				class:name={col === 'name'}
				data-col-head={col}
				aria-colindex={c + 1}
				style:width={isShown(col) ? nameRem(col) : undefined}
			>
				{strings.grid.columns[col]}
			</div>
		{/each}
	</div>
	<div role="rowgroup" class="body" style:height="{rows.length * rowHeight}px">
		{#each items as { row, index } (row.key)}
			{@const n = row.node}
			{@const cells = gridCells(row, input)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				role="row"
				class="row"
				class:selected={selectedKey === row.key}
				data-key={row.key}
				aria-rowindex={index + 2}
				aria-level={n.level}
				aria-posinset={n.posinset}
				aria-setsize={n.setsize}
				aria-expanded={row.expanded === null ? undefined : row.expanded}
				aria-selected={selectedKey === row.key}
				aria-label={describeRow(model, index)}
				tabindex={tabIndexOf(row, null)}
				style:top="{index * rowHeight}px"
				style:height="{rowHeight}px"
				style:--depth={row.depth}
				onclick={(e) => onclick(e, row)}
			>
				{#each cells as cell, c (cell.column)}
					{@const col = cell.column}
					{@const on = isShown(col)}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						role={col === 'name' ? 'rowheader' : 'gridcell'}
						class="cell"
						class:hidden={!on}
						class:name={col === 'name'}
						class:blank={cell.blank}
						class:yes={col === 'critical' && cell.text === strings.grid.yes}
						data-col={col}
						aria-colindex={c + 1}
						aria-label={cell.blank ? spokenText(cell) : undefined}
						tabindex={on ? tabIndexOf(row, col) : undefined}
						style:width={on ? nameRem(col) : undefined}
					>
						{#if col === 'name'}
							<span class="twisty" class:leaf={row.expanded === null} aria-hidden="true">
								{#if row.expanded !== null}<span class="chevron" class:open={row.expanded}
										><Icon name="chevronRight" size={14} /></span
									>{/if}
							</span>
							<span class="label" class:summary={row.kind === 'container'}>{cell.text}</span>
							{#if row.textOnly}
								<span class="badge">
									{strings.outline.textOnly}<span class="sr-only">
										. {strings.outline.reason[row.textOnly]}</span
									>
								</span>
							{/if}
						{:else}
							{cell.text}
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>
<!-- Not inside the grid: a live region among rows is not read reliably. -->
<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

<style>
	.grid {
		position: relative;
	}
	.body {
		position: relative;
	}
	/* The corner: the header row, frozen at the top of the scroller and at the left. */
	.corner {
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		display: flex;
		align-items: flex-end;
		box-sizing: border-box;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
		color: var(--color-gantt-text-faint);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.row {
		position: absolute;
		inset-inline: 0;
		/* A name of two lines at a large default font must not run into the next row. */
		overflow: clip;
		display: flex;
		align-items: center;
		border-block-end: var(--gantt-row-line-width) solid var(--color-gantt-row-line);
		cursor: pointer;
		white-space: nowrap;
		box-sizing: border-box;
		scroll-margin-block-start: calc(var(--gantt-header-row-height) * 2);
	}
	.row:hover {
		background: var(--color-gantt-row-hover);
	}
	/* Selection: a brass wash and a thin blued-steel edge (ADR-0009). */
	.row.selected {
		background: var(--color-gantt-row-selected);
		box-shadow: inset 3px 0 0 var(--color-gantt-accent);
	}
	.row:focus-visible,
	.cell:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: -3px;
	}
	/* Every cell: a fixed width but the name, which fills the token's width. */
	.cell {
		flex: none;
		box-sizing: border-box;
		min-inline-size: 0;
		padding-inline: var(--space-2);
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.cell.name {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		inline-size: var(--gantt-name-col);
		padding-inline-end: var(--space-2);
		padding-inline-start: calc(var(--space-1) + var(--depth, 0) * var(--space-4));
		color: var(--color-gantt-text);
		font-size: var(--text-sm);
		font-variant-numeric: normal;
	}
	/* The header cells take the corner's small caps, whatever the body cells use. */
	.head,
	.head.name {
		padding-block: var(--space-1);
		color: inherit;
		font-size: inherit;
		font-variant-numeric: normal;
	}
	.head.name {
		padding-inline-start: var(--space-3);
	}
	.cell.blank {
		color: var(--color-gantt-text-faint);
	}
	/* Critical is said in words, not only drawn (WCAG 1.4.1): bold, in the critical ink. */
	.cell.yes {
		color: var(--color-ruby-ink);
		font-weight: 700;
	}
	/* Not drawn at this width, but still in the table for a screen reader. */
	.cell.hidden {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.chevron {
		display: inline-grid;
		transition: transform var(--motion-fast);
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	/* A target of 24 px for a fine pointer, 44 px for a coarse one (WCAG 2.5.8). */
	.twisty {
		flex: none;
		inline-size: 1.5rem;
		block-size: 100%;
		display: grid;
		place-items: center;
		color: var(--color-gantt-text-muted);
	}
	.label {
		flex: 1 1 auto;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label.summary {
		font-weight: 600;
	}
	.badge {
		flex: none;
		padding: 0 var(--space-1);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		line-height: 1.3rem;
	}
	@media (max-width: 599px) {
		/* A phone has little room: a slot for the chevron only on rows that have one, about 8 px
		   of indent per level, and smaller text. */
		.cell.name {
			padding-inline-start: calc(var(--space-1) + var(--depth, 0) * var(--space-2));
			gap: 0;
		}
		.twisty.leaf {
			display: none;
		}
		/* Names may take two lines at 12.5 px, as in the phone design. */
		.label {
			font-size: 0.78rem;
			line-height: 1.2;
			white-space: normal;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
		}
		/* The badge is not drawn on a phone, but its words ("text only" and the reason) stay for
		   screen readers: hidden visually, not display: none (WCAG 1.3.1). */
		.badge {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
	@media (pointer: coarse) {
		.twisty {
			inline-size: 2.75rem;
		}
	}
	/* On a phone 44 px would take a third of the column: 32 px is still over WCAG 2.5.8's 24 px,
	   and the whole row is a larger target for selecting. */
	@media (pointer: coarse) and (max-width: 599px) {
		.twisty {
			inline-size: 2rem;
		}
	}
</style>
