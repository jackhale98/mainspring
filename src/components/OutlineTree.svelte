<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	One outline tree (tasks or resources) as an ARIA tree (phase-1.md 8.2). The rows are a flat
	list with aria-level, aria-posinset and aria-setsize, so a list above 200 rows can render only
	the rows in view without changing what a screen reader is told. One row is in the tab order
	(roving tabindex); arrows move, expand and collapse; Enter or Space selects the declaration in
	the editor.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { strings } from '../lib/strings';
	import Icon from './Icon.svelte';
	import {
		visibleRows,
		windowRows,
		type OutlineNode,
		type OutlineRow,
		type OutlineView,
	} from '../lib/state/outline';

	interface Props {
		label: string;
		nodes: readonly OutlineNode[];
		collapsed: ReadonlySet<string>;
		errors: ReadonlyMap<string, number>;
		emptyText: string;
		ontoggle: (key: string) => void;
		onselect: (node: OutlineNode) => void;
		/**
		 * Where the person was, kept by the owner across an unmount (a phone drops the Plan tab's
		 * tree while another tab shows): written as they scroll and select, read when mounted.
		 */
		view?: OutlineView | undefined;
	}
	let { label, nodes, collapsed, errors, emptyText, ontoggle, onselect, view }: Props = $props();

	const rows = $derived(visibleRows(nodes, collapsed));

	let scroller: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let viewport = $state(0);
	let rowHeight = $state(36);
	/** Whether a rendered row has been measured: `rowHeight` is then the real one. */
	let measured = $state(false);
	let focusKey = $state<string | null>(untrack(() => view?.focus ?? null));
	let selectedKey = $state<string | null>(untrack(() => view?.selected ?? null));

	// Put back where the person was when the tree is mounted again, once the row height is known
	// (the spacers are sized by it, so an earlier offset would land on other rows).
	let restored = false;
	$effect(() => {
		if (!scroller || restored || !measured) return;
		restored = true;
		const top = untrack(() => view?.top ?? 0);
		if (top > 0) scroller.scrollTop = top;
		scrollTop = scroller.scrollTop;
	});

	const win = $derived(windowRows(rows.length, scrollTop, viewport, rowHeight));
	const shown = $derived(rows.slice(win.start, win.end));
	/**
	 * The row that is in the tab order: the focused one while it is rendered, else the first
	 * rendered row, so the tree always has a tab stop even when the focused row scrolled away.
	 */
	const tabKey = $derived(
		focusKey !== null && shown.some((r) => r.node.key === focusKey)
			? focusKey
			: (shown[0]?.node.key ?? null),
	);

	// Measure a row once there is one, since the height follows the pointer type and font size.
	$effect(() => {
		void shown.length;
		const first = scroller?.querySelector<HTMLElement>('[role="treeitem"]');
		if (first && first.offsetHeight > 0) {
			untrack(() => {
				rowHeight = first.offsetHeight;
				measured = true;
			});
		}
	});

	function indexOfKey(key: string): number {
		return rows.findIndex((r) => r.node.key === key);
	}

	/** Moves the roving focus to a row, scrolling it into view first when it is not rendered. */
	async function focusRow(index: number): Promise<void> {
		const row = rows[index];
		if (!row || !scroller) return;
		focusKey = row.node.key;
		const top = index * rowHeight;
		if (top < scroller.scrollTop) scroller.scrollTop = top;
		else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) {
			scroller.scrollTop = top + rowHeight - scroller.clientHeight;
		}
		scrollTop = scroller.scrollTop;
		await tick();
		const el = scroller.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.node.key)}"]`);
		el?.focus({ preventScroll: true });
	}

	function select(row: OutlineRow): void {
		selectedKey = row.node.key;
		focusKey = row.node.key;
		if (view) {
			view.selected = selectedKey;
			view.focus = focusKey;
		}
		onselect(row.node);
	}

	function onkeydown(event: KeyboardEvent, row: OutlineRow, index: number): void {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		let handled = true;
		switch (event.key) {
			case 'ArrowDown':
				void focusRow(Math.min(rows.length - 1, index + 1));
				break;
			case 'ArrowUp':
				void focusRow(Math.max(0, index - 1));
				break;
			case 'Home':
				void focusRow(0);
				break;
			case 'End':
				void focusRow(rows.length - 1);
				break;
			case 'ArrowRight':
				if (row.expandable && !row.expanded) ontoggle(row.node.key);
				else if (row.expanded) void focusRow(index + 1);
				break;
			case 'ArrowLeft':
				if (row.expanded) ontoggle(row.node.key);
				else if (row.node.parent !== null) void focusRow(indexOfKey(row.node.parent));
				break;
			case 'Enter':
			case ' ':
				select(row);
				break;
			default:
				handled = false;
		}
		if (handled) event.preventDefault();
	}

	function onclick(event: MouseEvent, row: OutlineRow): void {
		const twisty = (event.target as Element).closest('.twisty');
		focusKey = row.node.key;
		if (twisty && row.expandable) ontoggle(row.node.key);
		else select(row);
	}
</script>

{#if nodes.length === 0}
	<p class="empty">{emptyText}</p>
{:else}
	<div
		class="scroller"
		bind:this={scroller}
		bind:clientHeight={viewport}
		onscroll={() => {
			scrollTop = scroller?.scrollTop ?? 0;
			if (view) view.top = scrollTop;
		}}
	>
		<div role="tree" aria-label={label} class="tree">
			{#if win.before > 0}<div aria-hidden="true" style:height="{win.before}px"></div>{/if}
			{#each shown as row, i (row.node.key)}
				{@const n = row.node}
				{@const errorCount = errors.get(n.key) ?? 0}
				<div
					role="treeitem"
					class="row"
					class:selected={selectedKey === n.key}
					data-key={n.key}
					aria-level={n.level}
					aria-posinset={n.posinset}
					aria-setsize={n.setsize}
					aria-expanded={row.expandable ? row.expanded : undefined}
					aria-selected={selectedKey === n.key}
					tabindex={tabKey === n.key ? 0 : -1}
					style:padding-inline-start="calc(var(--space-2) + {n.level - 1} * var(--space-4))"
					onclick={(e) => onclick(e, row)}
					onkeydown={(e) => onkeydown(e, row, win.start + i)}
				>
					<span class="twisty" aria-hidden="true">
						{#if row.expandable}<span class="chevron" class:open={row.expanded}
								><Icon name="chevronRight" size={14} /></span
							>{/if}
					</span>
					<span class="text">
						{#if n.id === null}
							<span class="id written">{n.localId}</span>
							{#if n.name}<span class="name">{n.name}</span>{/if}
						{:else}
							<span class="name">{n.name ?? n.localId}</span>
							{#if n.name && n.name !== n.localId}<span class="id">{n.localId}</span>{/if}
						{/if}
					</span>
					{#if n.textOnly}
						<span class="badge">
							{strings.outline.textOnly}<span class="sr-only">
								. {strings.outline.reason[n.textOnly]}</span
							>
						</span>
					{/if}
					{#if errorCount > 0}
						<span class="badge error">{strings.outline.errors(errorCount)}</span>
					{/if}
				</div>
			{/each}
			{#if win.after > 0}<div aria-hidden="true" style:height="{win.after}px"></div>{/if}
		</div>
	</div>
{/if}

<style>
	.scroller {
		/* The rows above are spacers that change height as the window moves: anchoring to a row
		   would move the scroll with them. */
		overflow-anchor: none;
		overflow: auto;
		min-block-size: 0;
		flex: 1 1 auto;
	}
	.tree {
		padding-block: var(--space-1);
	}
	.empty {
		margin: 0;
		padding: var(--space-2) var(--space-4);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		block-size: var(--size-row);
		padding-inline-end: var(--space-2);
		cursor: pointer;
		white-space: nowrap;
		border-inline-start: 3px solid transparent;
	}
	.row:hover {
		background: var(--color-row-hover);
	}
	/* Selection: a brass wash and a thin blued-steel edge (ADR-0009). */
	.row.selected {
		background: var(--color-row-selected);
		border-inline-start-color: var(--color-steel);
	}
	.chevron {
		display: inline-grid;
		transition: transform var(--motion-fast);
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	.row:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
	}
	.twisty {
		flex: none;
		inline-size: 1.5rem;
		text-align: center;
		color: var(--color-text-muted);
	}
	.text {
		flex: 1 1 auto;
		min-inline-size: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		overflow: hidden;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--text-sm);
	}
	.id {
		flex: none;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.id.written {
		color: var(--color-text);
	}
	.badge {
		flex: none;
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-xs);
		line-height: 1.4rem;
	}
	.badge.error {
		background: transparent;
		border: 1px solid var(--color-diagnostic-error);
		color: var(--color-diagnostic-error);
	}
	@media (prefers-reduced-motion: no-preference) {
		.row {
			transition: background-color var(--motion-fast);
		}
	}
</style>
