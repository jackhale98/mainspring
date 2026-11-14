<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The Gantt's task list: a DOM `role="treegrid"`, the accessible mirror of the canvas timeline
	(phase-2.md 10.1, 10.2). One row per Gantt row, at the same height, so it scrolls with the bars.
	Its header row is the frozen corner above the time header.

	Columns: the task name, then start, end, effort or length, people, float (estimate), critical
	(estimate) and status. All of them are always in the grid and all are drawn at their natural
	widths; when the table's pane (the divider decides how wide, Gantt.svelte) is narrower than
	they are, the rows scroll sideways inside it, behind the frozen name column, and a focused
	cell is scrolled into view. The header row sits outside that scroller, so that it can stick to
	the top of the Gantt's one vertical scroll, and follows its scroll position. A phone draws the
	name column alone: the other cells are visually hidden, not removed, so a screen reader reads
	the same table, and keyboard focus skips them (lib/gantt/columns.ts). The texts come from
	lib/gantt/grid.ts and are asserted against the model in the e2e spec.

	Rows carry aria-level, aria-posinset, aria-setsize and aria-expanded, and aria-rowindex with
	aria-rowcount, because only the rows near the viewport (and the focused one) are mounted.
	Exactly one element is in the tab order (roving tabindex): the focused row or cell, else the
	selected row, else the first. The keys are lib/gantt/grid-nav.ts. Moving focus never selects.

	The grid only reads: it emits intents (toggle, select, open, rename) and the Gantt decides.
	Critical is never colour alone: the Critical column says Yes or No in words (WCAG 1.4.1).

	The interactions of phase-2.md 7.1 (T16) sit on it: every key goes first to `onkeycmd` (the
	Gantt's keyboard model: nudges, link mode, row moves; it leaves the treegrid's own keys alone),
	a double click or F2 renames the task in place, and a grip at the end of the name starts a row
	drag (row-drag.svelte.ts), which draws its drop line and label here. The rows stay one DOM
	grid: the focused row reports itself (`onfocusrow`) so the chart can ring its bar.

	Over 400 lines on purpose: about a third is the styles (phone and coarse-pointer rules included),
	and the rest is one invariant, which row or cell holds the focus. The mounted rows, the tab stop,
	the key handler and the focus calls all read it, so splitting them would spread it over two files.
	The logic that can stand alone is already in lib/gantt (columns, grid, grid-nav).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { COLUMN_ORDER, widthOf, type ColumnId } from '../../lib/gantt/columns';
	import { describeRow } from '../../lib/gantt/describe';
	import { gridCells, spokenText, type GridRowInput } from '../../lib/gantt/grid';
	import { gridMove, type GridFocus, type GridShape } from '../../lib/gantt/grid-nav';
	import type { GanttRow } from '../../lib/gantt/model';
	import type { OutlineNode } from '../../lib/state/outline';
	import { ALL_KEYS, SHORTCUTS } from '../../lib/gantt/keys';
	import { gestureStrings, strings } from '../../lib/strings';
	import NameCell from './NameCell.svelte';
	import RowDropMarks from './RowDropMarks.svelte';
	import type { RowDrag } from './row-drag.svelte';

	interface Props extends Omit<GridRowInput, 'pending'> {
		pending?: ReadonlySet<string>;
		/** The columns drawn, in cell order, the name first. */
		shown: readonly ColumnId[];
		/** The width of the shown columns together, in px: the rows' width, the pane scrolls over it. */
		naturalWidth: number;
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
		/** F2 on a row, or a double click on its name; without it the key is left alone. */
		onrename?: (key: string) => void;
		/** The row being renamed in place, by key, and what ends it. */
		renaming?: string | null;
		onrenamed?: (key: string, name: string) => void;
		oncancelrename?: () => void;
		/** Every key first: true when the Gantt's keyboard model took it (not an input's). */
		onkeycmd?: (event: KeyboardEvent, key: string) => boolean;
		/** The row the keyboard focus is on (null: it left the grid), and whether it shows a ring. */
		onfocusrow?: (key: string | null) => void;
		/** Dragging a row by its grip (R5). */
		rowDrag?: RowDrag;
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
		naturalWidth,
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
		renaming = null,
		onrenamed,
		oncancelrename,
		onkeycmd,
		onfocusrow,
		rowDrag,
		onreveal,
		outline,
	}: Props = $props();

	const rows = $derived(model.rows);
	const uid = $props.id();
	/** What the treegrid says about its keys when the focus enters it (WCAG 2.1.1, 4.1.2). */
	const keysHint = gestureStrings.keys.gridHint(
		SHORTCUTS.map((k) => `${gestureStrings.keys.label[k.id]}: ${k.show}`).join('; '),
	);
	let focusKey = $state<string | null>(null);
	let grid: HTMLDivElement | undefined = $state();
	let headClip: HTMLDivElement | undefined = $state();
	let bodyScroll: HTMLDivElement | undefined = $state();
	/** The pane's width, and how far the rows are scrolled sideways inside it. */
	let paneW = $state(0);
	let scrolled = $state(0);
	// A pixel or two of border or rounding is not columns to scroll to.
	const overflow = $derived(naturalWidth - paneW > 2 ? naturalWidth - paneW : 0);

	function onbody(): void {
		if (!bodyScroll) return;
		scrolled = bodyScroll.scrollLeft;
		if (headClip) headClip.scrollLeft = scrolled;
	}
	// The header follows the rows when the pane or the columns change under a scroll position.
	$effect(() => {
		void [paneW, naturalWidth, shown];
		untrack(onbody);
	});

	/**
	 * Scrolls the rows sideways so that a cell is wholly in view, past the frozen name column:
	 * a focused cell is never off screen or behind the name. The vertical scroll is the Gantt's.
	 */
	function revealCell(cell: HTMLElement): void {
		const sc = bodyScroll;
		if (!sc || cell.dataset['col'] === 'name') return;
		const frozen =
			cell.parentElement?.querySelector<HTMLElement>('[data-col="name"]')?.offsetWidth ?? 0;
		const left = cell.offsetLeft;
		const right = left + cell.offsetWidth;
		if (left < sc.scrollLeft + frozen) sc.scrollLeft = Math.max(0, left - frozen);
		else if (right > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = right - sc.clientWidth;
	}

	// The scrollbar of the pane: the Gantt scrolls vertically in one container, so the rows'
	// own horizontal bar would sit at the foot of the whole plan; this one stays in view. Only its
	// thumb takes the pointer: the strip it sits in is not in the way of the rows beneath it.
	const MIN_THUMB = 28;
	const thumbW = $derived(
		overflow > 0 ? Math.max(MIN_THUMB, (paneW * paneW) / Math.max(naturalWidth, 1)) : 0,
	);
	const thumbX = $derived(overflow > 0 ? (scrolled / overflow) * (paneW - thumbW) : 0);
	let drag: { id: number; from: number; at: number } | null = null;
	function onthumbdown(e: PointerEvent): void {
		if (e.button !== 0) return;
		drag = { id: e.pointerId, from: e.clientX, at: scrolled };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}
	function onthumbmove(e: PointerEvent): void {
		if (!drag || drag.id !== e.pointerId || !bodyScroll) return;
		const room = Math.max(1, paneW - thumbW);
		bodyScroll.scrollLeft = Math.max(
			0,
			Math.min(overflow, drag.at + ((e.clientX - drag.from) / room) * overflow),
		);
	}
	function onthumbup(): void {
		drag = null;
	}

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
		const cell = t.closest<HTMLElement>('[data-col]');
		const col = cell?.getAttribute('data-col') ?? null;
		focusCol = col as ColumnId | null;
		if (cell && cell.getAttribute('tabindex') !== null) revealCell(cell);
		const index = model.rowOf.get(key) ?? -1;
		const row = rows[index];
		lastFocus = row ? { el: t, row, index } : null;
		onfocusrow?.(key);
	}

	/** Focus that leaves the grid lets go of the pinned row. */
	function onfocusout(event: FocusEvent): void {
		const to = event.relatedTarget;
		if (!(to instanceof Node) || !grid?.contains(to)) {
			focusKey = null;
			focusCol = null;
			onfocusrow?.(null);
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
		// Focusing the cell scrolls it into view (`onfocusin`): once, whoever moved the focus.
		el?.focus({ preventScroll: true });
	}

	const indexOf = (key: string): number => model.rowOf.get(key) ?? -1;

	/** Focuses a row by key once it is mounted (a moved row has a new key). */
	export function focusRowByKey(key: string): boolean {
		const at = indexOf(key);
		if (at < 0) return false;
		void focusAt({ row: at, col: null });
		return true;
	}

	// A lifted row is dragged with the finger: the list cancels the native scroll for it (8.2).
	$effect(() => {
		if (!grid || !rowDrag) return undefined;
		return rowDrag.attach(grid);
	});
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
		// The rename field is a text field: its keys are its own.
		if (target.closest('input, textarea, select')) return;
		const key = target.closest('[data-key]')?.getAttribute('data-key');
		const at = key ? indexOf(key) : -1;
		if (at < 0 || !key) return;
		if (onkeycmd?.(event, key)) {
			event.preventDefault();
			return;
		}
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
	aria-describedby="{uid}-keys"
	aria-keyshortcuts={ALL_KEYS}
	aria-rowcount={rows.length + 1}
	aria-colcount={COLUMN_ORDER.length}
	data-testid="gantt-treegrid"
	class="grid"
	class:scrolled={scrolled > 0}
	style:--natural-width="{naturalWidth}px"
	{onfocusin}
	{onfocusout}
	{onkeydown}
>
	<!-- Outside the rows' scroller, so that it can stick to the top of the Gantt's scroll. -->
	<div class="head-clip" role="presentation" bind:this={headClip}>
		<div
			class="corner"
			role="row"
			aria-rowindex={1}
			style:height="{headerHeight}px"
			style:width="{naturalWidth}px"
		>
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
	</div>
	<div
		class="body-scroll"
		class:overflowing={overflow > 0}
		role="presentation"
		bind:this={bodyScroll}
		bind:clientWidth={paneW}
		onscroll={onbody}
	>
		<div role="rowgroup" class="body" style:height="{rows.length * rowHeight}px">
			{#each items as { row, index } (row.key)}
				{@const n = row.node}
				{@const cells = gridCells(row, input)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="row"
					class="row"
					class:selected={selectedKey === row.key}
					class:dragging={rowDrag?.view?.dragged === row.key}
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
							ondblclick={col === 'name' ? () => onrename?.(row.key) : undefined}
						>
							{#if col === 'name'}
								<NameCell
									{row}
									text={cell.text}
									renaming={renaming === row.key}
									{rowDrag}
									onrenamed={(name) => onrenamed?.(row.key, name)}
									oncancel={() => oncancelrename?.()}
								/>
							{:else}
								{cell.text}
							{/if}
						</div>
					{/each}
				</div>
			{/each}
			<RowDropMarks view={rowDrag?.view ?? null} {rowHeight} />
		</div>
	</div>
	{#if overflow > 0}<div class="hbar-room" aria-hidden="true"></div>{/if}
	<!--
		The pane's scrollbar, drawn only when the columns are wider than the pane, and kept at the
		foot of the view (a zero-height sticky anchor). Pointer only: the cells are reachable by
		keyboard, which scrolls a focused cell into view, so it is hidden from assistive technology.
	-->
	<div class="hbar-anchor" aria-hidden="true">
		{#if overflow > 0}
			<div class="hbar" data-testid="gantt-table-scrollbar">
				<div
					class="thumb-hit"
					style:width="{thumbW}px"
					style:transform="translateX({thumbX}px)"
					onpointerdown={onthumbdown}
					onpointermove={onthumbmove}
					onpointerup={onthumbup}
					onpointercancel={onthumbup}
				>
					<div class="thumb"></div>
				</div>
			</div>
		{/if}
	</div>
</div>
<p class="sr-only" id="{uid}-keys">{keysHint}</p>
<!-- Not inside the grid: a live region among rows is not read reliably. -->
<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

<style>
	.grid {
		--hbar-h: 12px;
		position: relative;
	}
	.body {
		position: relative;
	}
	/* The rows scroll sideways in the pane and never vertically: that is the Gantt's scroll, so a
	   vertical wheel or swipe passes through. The bar is drawn by hand (below). */
	.body-scroll {
		overflow: clip;
	}
	/* Only a pane that has columns to scroll is a scroll container, and it keeps the swipe to itself.
	   One that fits (a phone's, a wide pane's) is not: a sideways swipe on it scrolls the chart,
	   as it always did, and the browser's own history swipe stays shut out by the Gantt's scroller. */
	.body-scroll.overflowing {
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}
	.body-scroll.overflowing::-webkit-scrollbar {
		display: none;
	}
	/* The header row: frozen at the top of the scroller (sticky, as a child of the pane) and moved
	   sideways with the rows by script, so it is a scroll container itself, with no bar. */
	.head-clip {
		position: sticky;
		inset-block-start: 0;
		z-index: 2;
		overflow: hidden;
		background: var(--color-gantt-surface-header);
	}
	.corner {
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
		inset-inline-start: 0;
		inline-size: var(--natural-width);
		background: var(--color-gantt-surface);
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
	.row.dragging {
		opacity: 0.45;
	}
	/* Selection: a brass wash and a thin blued-steel edge (ADR-0009). */
	.row.selected {
		background: var(--color-gantt-row-selected);
	}
	.row.selected .cell.name {
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
	/* The name stays at the pane's left while the other columns scroll under it. */
	.cell.name {
		position: sticky;
		inset-inline-start: 0;
		z-index: 1;
		background: inherit;
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
		background: var(--color-gantt-surface-header);
	}
	/* The edge of the frozen column shows once the others have scrolled under it. */
	.grid.scrolled .cell.name {
		box-shadow: 1px 0 0 var(--color-gantt-border);
	}
	.grid.scrolled .row.selected .cell.name {
		box-shadow:
			inset 3px 0 0 var(--color-gantt-accent),
			1px 0 0 var(--color-gantt-border);
	}
	.hbar-anchor {
		position: sticky;
		inset-block-end: 0;
		z-index: 2;
		block-size: 0;
	}
	.hbar {
		position: absolute;
		inset-inline: 0;
		inset-block-end: 0;
		block-size: var(--hbar-h);
		pointer-events: none;
	}
	/* Its height is also reserved below the rows while it shows, so that the last row is clear of it. */
	.hbar-room {
		block-size: var(--hbar-h);
	}
	.thumb-hit {
		block-size: 100%;
		padding-block: 3px;
		box-sizing: border-box;
		pointer-events: auto;
		touch-action: none;
		cursor: default;
	}
	.thumb {
		block-size: 100%;
		border-radius: 3px;
		background: var(--color-gantt-text-faint);
		opacity: 0.55;
	}
	.thumb-hit:hover .thumb {
		opacity: 0.85;
	}
	@media (pointer: coarse) {
		.grid {
			--hbar-h: 16px;
		}
		.thumb-hit {
			padding-block: 5px;
		}
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
	/* The name cell's parts (twisty, label, rename field, grip, badge) are NameCell.svelte's; on a
	   phone the cell itself has a narrower indent and no gap. */
	@media (max-width: 599px) {
		.cell.name {
			padding-inline-start: calc(var(--space-1) + var(--depth, 0) * var(--space-2));
			gap: 0;
		}
	}
</style>
