<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The resource table (phase-3.md 9.6, 7.1 W6 and W7, 10): the people of the plan as a DOM
	`role="treegrid"`, one row per resource in plan order with its groups, showing the id (monospace),
	the name, the group, the efficiency, the hours booked in the frame and a "text only" badge. It
	sits beside the lanes on a desktop and a tablet, and is the phone's Team segment.

	A toolbar above it adds a person or a group (the name is typed first, so the id follows it), and
	has the row actions menu. The table itself only reads: every change of the plan is a command of
	ResourceTable (resource-table.svelte.ts), which goes through the edit dispatcher.

	Keys, on a row (the one in the tab order is the focused row, else the selected one, else the
	first): Up and Down, Home and End, Page Up and Down move; Right opens a group or moves into it,
	Left closes it or moves to the group; Enter selects and moves into the details; Space selects;
	F2 renames in place; Delete removes; Alt+Shift+Arrow moves the person (W6: up and down among
	siblings, Right into the group above, Left out of its group). The row menu has each of them as a
	button, and a pointer drags the grip at the end of the name (the shared row drag: a mouse after 3
	px, a finger after the 350 ms long-press). A narrow pane (a tablet, a phone) shows the name and
	hours; the other columns stay in the table for a screen reader.

	Over 400 lines on purpose: about half is the styles (the narrow and coarse-pointer rules
	included), and the rest is one invariant, which row holds the focus, which the template, the
	keys and the drag all read; the commands are in resource-table.svelte.ts.
-->
<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { dropRows, hoursText, tableWindow } from '../../lib/resources/rows';
	import type { AppState } from '../../lib/state/app.svelte';
	import { gestureStrings, strings } from '../../lib/strings';
	import { resourceStrings as R } from '../../lib/strings-resources';
	import Icon from '../Icon.svelte';
	import RowDropMarks from '../gantt/RowDropMarks.svelte';
	import { RowDrag } from '../gantt/row-drag.svelte';
	import ActionMenu, { type MenuAction } from './ActionMenu.svelte';
	import { ResourceTable } from './resource-table.svelte';

	interface Props {
		app: AppState;
		/** Fills the area of a phone (the Team segment); else it is a pane beside the lanes. */
		phone: boolean;
	}
	let { app, phone }: Props = $props();

	// The app is one object for the life of the shell; the commands read it live.
	// svelte-ignore state_referenced_locally
	const t = new ResourceTable(app);
	const uid = $props.id();
	let root: HTMLDivElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let body: HTMLDivElement | undefined = $state();
	let addInput: HTMLInputElement | undefined = $state();
	let scrollTop = $state(0);
	let viewport = $state(0);
	let rowHeight = $state(40);

	const rows = $derived(t.rows);
	const win = $derived(tableWindow(rows.length, scrollTop, viewport, rowHeight));
	const shown = $derived(rows.slice(win.start, win.end));
	const focused = $derived(
		t.focusKey !== null && rows.some((r) => r.node.key === t.focusKey)
			? t.focusKey
			: (t.selectedKey ?? rows[0]?.node.key ?? null),
	);
	const selected = $derived(t.selectedKey);
	// The tab stop is the focused row, but the table mounts only the rows in view above 100 rows: when
	// that one has scrolled out of the window the selected row, else the first mounted one, takes it,
	// so Tab always lands in the grid.
	const tabStop = $derived(
		shown.some((r) => r.node.key === focused)
			? focused
			: shown.some((r) => r.node.key === selected)
				? selected
				: (shown[0]?.node.key ?? null),
	);
	const selectedRow = $derived(rows.find((r) => r.node.key === selected) ?? null);
	const name = (key: string): string => t.tree.get(key)?.name ?? t.tree.get(key)?.localId ?? key;

	const drag = new RowDrag({
		rows: () => dropRows(t.rows, app.index),
		tree: () => t.tree,
		roots: () => t.roots,
		rowHeight: () => rowHeight,
		bodyTop: () => body?.getBoundingClientRect().top ?? 0,
		visible: () => {
			const r = scroller?.getBoundingClientRect();
			return { left: r?.left ?? 0, top: r?.top ?? 0, right: r?.right ?? 0, bottom: r?.bottom ?? 0 };
		},
		scroller: () => scroller,
		nameOf: name,
		open: (key) => t.open(key),
		// The drop names the parent by its id; the table's commands name outline keys.
		// The place was read from the tree shown now: the move is refused if the text moves on first.
		move: (key, parent, index) =>
			void t.regroup(key, parent === null ? null : `resource:${parent}`, index, app.index?.version),
		announce: (text) => (t.announcement = text),
	});

	onMount(() => {
		const measure = (): void => {
			if (!root) return;
			const h = parseFloat(getComputedStyle(root).getPropertyValue('--table-row'));
			if (Number.isFinite(h) && h > 0) rowHeight = h;
			viewport = scroller?.clientHeight ?? 0;
		};
		measure();
		const ro = new ResizeObserver(measure);
		if (scroller) ro.observe(scroller);
		const off = scroller ? drag.attach(scroller) : () => undefined;
		return () => {
			ro.disconnect();
			off();
		};
	});

	/** Moves the focus to a row, scrolling it into the mounted window first. */
	async function focusRow(key: string | null): Promise<void> {
		if (key === null) return;
		t.focusKey = key;
		const i = rows.findIndex((r) => r.node.key === key);
		if (i < 0 || !scroller) return;
		const top = i * rowHeight;
		if (top < scroller.scrollTop) scroller.scrollTop = top;
		else if (top + rowHeight > scroller.scrollTop + viewport - rowHeight)
			scroller.scrollTop = top + rowHeight * 2 - viewport;
		await tick();
		root?.querySelector<HTMLElement>(`[role="row"][data-key="${CSS.escape(key)}"]`)?.focus({
			preventScroll: true,
		});
	}

	// A new person or group has the focus on its row once the outline has it.
	let lastFocus: string | null = null;
	$effect(() => {
		const key = t.focusKey;
		if (key === lastFocus) return;
		lastFocus = key;
		if (
			key !== null &&
			rows.some((r) => r.node.key === key) &&
			root?.contains(document.activeElement)
		)
			untrack(() => void focusRow(key));
	});
	// After an add, the form is gone and the focus goes to the new row.
	$effect(() => {
		if (t.adding === null) return;
		void tick().then(() => addInput?.focus());
	});

	function onkeydown(e: KeyboardEvent, i: number): void {
		const row = rows[i];
		if (!row || e.target instanceof HTMLInputElement) return;
		const key = row.node.key;
		if (e.altKey && e.shiftKey && e.key.startsWith('Arrow')) {
			e.preventDefault();
			const step = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'indent', ArrowLeft: 'outdent' }[
				e.key
			];
			if (step === 'up' || step === 'down' || step === 'indent' || step === 'outdent')
				void t.step(key, step);
			return;
		}
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		const page = Math.max(1, Math.floor(viewport / rowHeight) - 1);
		const go = (n: number): void => {
			e.preventDefault();
			void focusRow(rows[Math.max(0, Math.min(rows.length - 1, n))]?.node.key ?? null);
		};
		switch (e.key) {
			case 'ArrowDown':
				return go(i + 1);
			case 'ArrowUp':
				return go(i - 1);
			case 'Home':
				return go(0);
			case 'End':
				return go(rows.length - 1);
			case 'PageDown':
				return go(i + page);
			case 'PageUp':
				return go(i - page);
			case 'ArrowRight':
				e.preventDefault();
				if (row.expandable && !row.expanded) t.toggle(key);
				else if (row.expandable) void focusRow(rows[i + 1]?.node.key ?? null);
				return;
			case 'ArrowLeft':
				e.preventDefault();
				if (row.expandable && row.expanded) t.toggle(key);
				else if (row.node.parent !== null) void focusRow(row.node.parent);
				return;
			case 'Enter':
				e.preventDefault();
				return t.openDetails(key);
			case ' ':
				e.preventDefault();
				return t.select(key);
			case 'F2':
				e.preventDefault();
				if (row.node.id !== null && row.node.textOnly === null) t.renaming = key;
				return;
			case 'Delete':
				e.preventDefault();
				if (row.node.id !== null) void t.remove(key);
				return;
		}
	}

	function act(id: string): void {
		const key = selected;
		if (key === null) return;
		if (id === 'rename') t.renaming = key;
		else if (id === 'delete') void t.remove(key);
		else if (id === 'up' || id === 'down' || id === 'indent' || id === 'outdent')
			void t.step(key, id);
	}
	const actions: readonly MenuAction[] = [
		{ id: 'rename', label: gestureStrings.row.rename, show: 'F2', aria: 'F2' },
		{ id: 'delete', label: gestureStrings.row.delete, show: 'Del', aria: 'Delete' },
		{ id: 'up', label: gestureStrings.row.up, show: 'Alt+Shift+↑', aria: 'Alt+Shift+ArrowUp' },
		{
			id: 'down',
			label: gestureStrings.row.down,
			show: 'Alt+Shift+↓',
			aria: 'Alt+Shift+ArrowDown',
		},
		{ id: 'indent', label: R.table.intoGroup, show: 'Alt+Shift+→', aria: 'Alt+Shift+ArrowRight' },
		{ id: 'outdent', label: R.table.outOfGroup, show: 'Alt+Shift+←', aria: 'Alt+Shift+ArrowLeft' },
	];

	/** What a row says as a whole to a screen reader (its cells follow). */
	const describe = (r: (typeof rows)[number]): string =>
		[
			r.node.name ?? r.node.localId,
			r.expandable ? R.table.group : null,
			r.groupName !== null ? R.table.in(r.groupName) : null,
			r.booked !== null ? R.table.bookedSpoken(hoursText(r.booked)) : null,
		]
			.filter((x) => x !== null)
			.join(', ');

	function startRename(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}
	async function submitAdd(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		await t.commitAdd(addInput?.value ?? '');
	}
</script>

<div
	class="table"
	class:phone
	bind:this={root}
	data-testid="resource-table"
	aria-label={R.table.region}
	role="region"
>
	<div class="toolbar" role="toolbar" aria-label={R.table.toolbar}>
		<button
			type="button"
			class="add"
			data-testid="add-person-row"
			onclick={() => t.startAdd('person')}
		>
			<Icon name="plus" size={16} stroke={2.2} />{R.table.addPerson}
		</button>
		<button type="button" class="add" data-testid="add-group" onclick={() => t.startAdd('group')}>
			<Icon name="plus" size={16} stroke={2.2} />{R.table.addGroup}
		</button>
		<ActionMenu {actions} disabled={selected === null} onaction={act} />
	</div>
	{#if t.adding !== null}
		<form class="adding" onsubmit={submitAdd} data-testid="add-form">
			<label for="{uid}-name">{t.adding === 'group' ? R.table.nameGroup : R.table.namePerson}</label
			>
			<div class="line">
				<input
					id="{uid}-name"
					bind:this={addInput}
					type="text"
					autocomplete="off"
					enterkeyhint="done"
					onkeydown={(e) => {
						if (e.key === 'Escape') {
							e.preventDefault();
							e.stopPropagation();
							t.cancelAdd();
						}
					}}
				/>
				<button type="submit" class="primary">{R.table.create}</button>
				<button type="button" onclick={() => t.cancelAdd()}>{R.table.cancel}</button>
			</div>
		</form>
	{/if}
	<div
		class="scroller"
		bind:this={scroller}
		onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)}
	>
		<div
			class="grid"
			role="treegrid"
			aria-label={R.table.label}
			aria-rowcount={rows.length + 1}
			aria-colcount={5}
			aria-describedby="{uid}-keys"
			data-testid="resource-grid"
		>
			<div class="head" role="row" aria-rowindex={1}>
				<div class="c name" role="columnheader">{R.table.col.name}</div>
				<div class="c id" role="columnheader">{R.table.col.id}</div>
				<div class="c group" role="columnheader">{R.table.col.group}</div>
				<div class="c eff" role="columnheader">{R.table.col.efficiency}</div>
				<div class="c booked" role="columnheader">{R.table.col.booked}</div>
			</div>
			<div
				class="body"
				bind:this={body}
				style:--before="{win.before}px"
				style:--after="{win.after}px"
			>
				{#each shown as r, n (r.node.key)}
					{@const i = win.start + n}
					<!-- A treegrid row: one tab stop (the focused row), the keys are above. -->
					<div
						class="row"
						class:selected={selected === r.node.key}
						class:dragged={drag.view?.dragged === r.node.key}
						role="row"
						tabindex={tabStop === r.node.key ? 0 : -1}
						data-key={r.node.key}
						data-testid="resource-row"
						aria-label={describe(r)}
						aria-level={r.node.level}
						aria-posinset={r.node.posinset}
						aria-setsize={r.node.setsize}
						aria-rowindex={i + 2}
						aria-expanded={r.expandable ? r.expanded : undefined}
						aria-selected={selected === r.node.key}
						onclick={() => t.select(r.node.key)}
						onfocus={() => (t.focusKey = r.node.key)}
						onkeydown={(e) => onkeydown(e, i)}
					>
						<div class="c name" role="rowheader" style:--level={r.node.level - 1}>
							<span
								class="twisty"
								class:leaf={!r.expandable}
								aria-hidden="true"
								onclick={(e) => {
									// A group's chevron opens and closes it; the space of a person selects the row.
									if (!r.expandable) return;
									e.stopPropagation();
									t.toggle(r.node.key);
								}}
							>
								{#if r.expandable}<span class="chevron" class:open={r.expanded}
										><Icon name="chevronRight" size={14} /></span
									>{/if}
							</span>
							{#if t.renaming === r.node.key}
								<input
									class="rename"
									type="text"
									value={r.node.name ?? ''}
									aria-label={gestureStrings.row.renameLabel(r.node.name ?? r.node.localId)}
									use:startRename
									onclick={(e) => e.stopPropagation()}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											void t.rename(r.node.key, e.currentTarget.value);
											void focusRow(r.node.key);
										} else if (e.key === 'Escape') {
											e.preventDefault();
											e.stopPropagation();
											t.renaming = null;
											void focusRow(r.node.key);
										}
									}}
									onblur={(e) => {
										if (t.renaming === r.node.key) void t.rename(r.node.key, e.currentTarget.value);
									}}
								/>
							{:else}
								<!-- A double click renames with a mouse; F2 and the row menu do it for everyone. -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="label"
									class:summary={r.expandable}
									ondblclick={() => {
										if (!phone && r.node.id !== null && r.node.textOnly === null)
											t.renaming = r.node.key;
									}}>{r.node.name ?? r.node.localId}</span
								>
							{/if}
							{#if r.node.textOnly}
								<span class="badge"
									>{strings.outline.textOnly}<span class="sr-only">
										. {strings.outline.reason[r.node.textOnly]}</span
									></span
								>
							{/if}
							{#if t.renaming !== r.node.key && r.node.id !== null}
								<span
									class="grip"
									aria-hidden="true"
									data-testid="resource-grip"
									onpointerdown={(e) => {
										if (e.button === 0) drag.down(e, r.node.key);
									}}
									onclick={(e) => e.stopPropagation()}
								>
									<Icon name="grip" size={14} />
								</span>
							{/if}
						</div>
						<div class="c id" role="gridcell"><code>{r.node.id ?? r.node.localId}</code></div>
						<div class="c group" role="gridcell">{r.groupName ?? R.table.none}</div>
						<div class="c eff" role="gridcell">{r.efficiency ?? R.table.none}</div>
						<div class="c booked" role="gridcell">
							{r.booked === null ? R.table.none : hoursText(r.booked)}
						</div>
					</div>
				{/each}
				<RowDropMarks view={drag.view} {rowHeight} />
			</div>
		</div>
	</div>
	<p class="sr-only" id="{uid}-keys">{R.table.keys}</p>
	<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{t.announcement}</div>
	{#if selectedRow === null && rows.length > 0}
		<p class="hint">{R.table.selectHint}</p>
	{/if}
</div>

<style>
	.table {
		--table-row: 40px;
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
		min-inline-size: 0;
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
	}
	.toolbar {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: 7px var(--space-3);
		border-block-end: 1px solid var(--color-gantt-border);
	}
	.add,
	.adding button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-block-size: var(--size-control);
		padding-inline: var(--space-3);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-pill);
		background: var(--color-gantt-chip);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.adding .primary {
		border-color: var(--color-gantt-accent);
		background: var(--color-gantt-accent);
		color: var(--color-gantt-accent-text);
	}
	.add:hover,
	.adding button:hover {
		background: var(--color-gantt-inset);
	}
	.add:focus-visible,
	.adding button:focus-visible,
	.adding input:focus-visible {
		outline: 3px solid var(--color-gantt-accent);
		outline-offset: 2px;
	}
	.adding {
		flex: none;
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-block-end: 1px solid var(--color-gantt-border);
		font-size: var(--text-sm);
	}
	.adding .line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.adding input {
		flex: 1 1 10rem;
		min-inline-size: 0;
		min-block-size: var(--size-control);
		box-sizing: border-box;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-gantt-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
		font: inherit;
		font-size: max(16px, var(--text-md));
	}
	.scroller {
		flex: 1 1 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}
	.grid {
		min-inline-size: 100%;
	}
	.head,
	.row {
		display: grid;
		grid-template-columns: minmax(9rem, 1fr) 6rem minmax(5rem, 8rem) 5.5rem 5.5rem;
		align-items: center;
		min-inline-size: 36rem;
	}
	.head {
		position: sticky;
		inset-block-start: 0;
		z-index: 2;
		block-size: 32px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
	}
	.body {
		position: relative;
		padding-block: var(--before) var(--after);
	}
	.row {
		block-size: var(--table-row);
		border-block-end: 1px solid var(--color-gantt-border);
		cursor: default;
	}
	.row:hover {
		background: var(--color-row-hover);
	}
	.row.selected {
		background: var(--color-gantt-row-selected);
		box-shadow: inset 3px 0 0 var(--color-gantt-accent);
	}
	.row.dragged {
		opacity: 0.55;
	}
	.row:focus-visible {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
	}
	.c {
		min-inline-size: 0;
		padding-inline: var(--space-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-sm);
	}
	.c.name {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding-inline-start: calc(var(--space-2) + var(--level, 0) * var(--space-4));
		block-size: 100%;
	}
	.c.id code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.c.eff,
	.c.booked {
		text-align: end;
		font-variant-numeric: tabular-nums;
	}
	.twisty {
		flex: none;
		inline-size: 1.5rem;
		block-size: 100%;
		display: grid;
		place-items: center;
		color: var(--color-gantt-text-muted);
	}
	.chevron {
		display: inline-grid;
		transition: transform var(--motion-fast);
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	.label {
		flex: 0 1 auto;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label.summary {
		font-weight: 600;
	}
	.rename {
		flex: 1 1 auto;
		min-inline-size: 0;
		block-size: calc(100% - 8px);
		box-sizing: border-box;
		padding: 0 var(--space-2);
		border: 2px solid var(--color-gantt-accent);
		border-radius: var(--radius-sm);
		background: var(--color-gantt-surface);
		color: var(--color-gantt-text);
		font: inherit;
	}
	.badge {
		flex: none;
		padding: 0 var(--space-1);
		border-radius: var(--radius-pill);
		background: var(--color-badge-bg);
		color: var(--color-badge-text);
		font-size: var(--text-xs);
		line-height: 1.3rem;
	}
	.grip {
		flex: none;
		display: none;
		place-items: center;
		inline-size: 24px;
		block-size: 100%;
		margin-inline-start: auto;
		color: var(--color-gantt-text-faint);
		cursor: grab;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.row:hover .grip,
	.row:focus-within .grip,
	.row.selected .grip {
		display: grid;
	}
	.grip:hover {
		color: var(--color-gantt-text);
	}
	.hint {
		flex: none;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	/* A narrow pane (a tablet, a phone): the name and the hours; the other cells stay for a screen reader. */
	@container (max-width: 34rem) {
		.head,
		.row {
			grid-template-columns: minmax(0, 1fr) 5.5rem;
			min-inline-size: 0;
		}
		.c.id,
		.c.group,
		.c.eff {
			position: absolute;
			inline-size: 1px;
			block-size: 1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
	@media (pointer: coarse) {
		.table {
			--table-row: 44px;
		}
		.twisty {
			inline-size: 2.75rem;
		}
		.row:hover:not(.selected) .grip,
		.row:focus-within:not(.selected) .grip {
			display: none;
		}
		.grip {
			inline-size: 44px;
		}
	}
</style>
