<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Where the details live (phase-2.md 9.2, 9.3; polish item 8). On a desktop they are a side panel,
	320 px, collapsible, docked next to the Gantt in Split and Visual while the chart keeps room
	(`dock`, decided by App from the width the chart would have). When it would not (a Split that
	is narrow, or a divider dragged far), the panel is a 44 px rail with the Details toggle, and a
	click on a task opens the details as a non-modal drawer over the chart's right edge, taking
	no width from the editor; Escape or the toggle closes it. On a tablet or a phone they are a
	bottom sheet over the Gantt at half height, which can be dragged to full height; on a phone it
	ends above the tab bar and carries a small status chip, since it hides the status strip. The
	sheet is not modal: the chart behind stays usable, and the selected row is scrolled above it
	(WCAG 2.4.11). A tap on a task opens the details without taking the focus; Enter on a row
	opens them and moves the focus into the first field, and Escape returns it to the row.

	The project sheet and the show-source sheet are modal bottom sheets, opened from the top bar,
	the details and the toasts. Nothing here changes the plan: the fields go through the edit
	dispatcher (lib/inspector/actions.ts).
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { InspectorActions } from '../../lib/inspector/actions';
	import { focusRow, keepRowClear } from '../../lib/inspector/focus';
	import type { AppState } from '../../lib/state/app.svelte';
	import type { LayoutKind } from '../../lib/state/layout.svelte';
	import { inspectorStrings as S } from '../../lib/strings';
	import type { SourceRange } from '../../lib/tjp/index';
	import Icon from '../Icon.svelte';
	import Sheet from '../Sheet.svelte';
	import { setInspector } from './context';
	import InspectorBody from './InspectorBody.svelte';
	import ProjectSheet from './ProjectSheet.svelte';
	import SheetStatus from './SheetStatus.svelte';
	import SourceSheet from './SourceSheet.svelte';

	interface Props {
		app: AppState;
		layout: LayoutKind;
		/** Whether a desktop has the room to dock the panel (otherwise a rail and a drawer). */
		dock: boolean;
		/** The Gantt is on screen (not the Text mode, not the phone's Text tab). */
		active: boolean;
		/** Shows a range in the text: the shell switches the mode, then reveals it. */
		onshowtext: (at: SourceRange) => void;
	}
	let { app, layout, dock, active, onshowtext }: Props = $props();

	// The app is one object for the life of the shell; the closures read it live.
	// svelte-ignore state_referenced_locally
	const actions = new InspectorActions({
		edits: () => app.edits,
		view: () => app.inspector.view,
	});
	// svelte-ignore state_referenced_locally
	setInspector({
		app,
		actions,
		showInText: (at) => onshowtext(at),
		openTask: (id) => app.selectTask(`task:${id}`),
		openLink: (pred, succ) => app.inspector.showLink(pred, succ),
	});

	const desktop = $derived(layout === 'desktop');
	/** Docked: the panel takes its 320 px. Otherwise a rail, and a drawer when asked for. */
	const docked = $derived(desktop && dock && !app.inspector.collapsed);
	/** The drawer over the chart: asked for by a click or Enter, while there is no room to dock. */
	const drawer = $derived(desktop && !dock && app.inspector.sheet);
	const inspector = $derived(app.inspector);
	const title = $derived(inspector.link ? S.linkTitle : S.taskTitle);
	let body: HTMLElement | undefined = $state();

	// Enter on a row: the focus goes to the first field once the details are on screen.
	let seen = untrack(() => app.inspector.focusNonce);
	$effect(() => {
		const n = inspector.focusNonce;
		if (n === seen) return;
		seen = n;
		void tick().then(() =>
			requestAnimationFrame(() =>
				body
					?.querySelector<HTMLElement>(
						'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
					)
					?.focus(),
			),
		);
	});

	// The selected row stays above the sheet (WCAG 2.4.11), as the sheet opens, grows or the
	// selection changes.
	$effect(() => {
		const key = app.selectedRow;
		const h = inspector.sheetHeight;
		if (!desktop && h > 0) void tick().then(() => keepRowClear(key, h));
	});

	/** Escape in the panel or the drawer gives the focus back to the row (the sheet does it itself). */
	function onkeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		e.preventDefault();
		if (drawer) inspector.hide();
		focusRow(app.selectedRow);
	}

	/** The rail's toggle: dock the panel again, or open and close the drawer. */
	function toggleRail(): void {
		if (dock) inspector.collapsed = false;
		else if (inspector.sheet) inspector.hide();
		else inspector.show();
	}
</script>

{#snippet content()}
	<div class="body" bind:this={body}>
		<InspectorBody />
	</div>
{/snippet}

{#snippet panel()}
	<header>
		<h2>{title}</h2>
		<button
			type="button"
			class="toggle"
			aria-expanded="true"
			title={S.hidePanel}
			onclick={() => (dock ? (inspector.collapsed = true) : inspector.hide())}
		>
			<Icon name="close" size={16} />
			<span class="sr-only">{S.hidePanel}</span>
		</button>
	</header>
	<div class="scroll">
		{@render content()}
	</div>
{/snippet}

{#if desktop && active}
	{#if docked}
		<!-- Escape in the panel returns the focus to the row; the aside is not itself interactive. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<aside class="panel" aria-label={S.panel} data-testid="inspector" {onkeydown}>
			{@render panel()}
		</aside>
	{:else}
		<div class="rail">
			<button
				type="button"
				class="toggle"
				aria-expanded={drawer}
				title={drawer ? S.hidePanel : S.showPanel}
				onclick={toggleRail}
			>
				<Icon name="panel" size={17} />
				<span class="sr-only">{drawer ? S.hidePanel : S.showPanel}</span>
			</button>
		</div>
		{#if drawer}
			<!-- Escape in the drawer closes it; the aside is not itself interactive. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<aside
				class="panel drawer"
				aria-label={S.panel}
				data-testid="inspector"
				data-drawer
				{onkeydown}
			>
				{@render panel()}
			</aside>
		{/if}
	{/if}
{:else if !desktop}
	<Sheet
		open={active && inspector.sheet}
		side="bottom"
		modal={false}
		{title}
		closeLabel={S.close}
		detent={inspector.detent}
		focusOnOpen={false}
		ondetent={(d) => (inspector.detent = d)}
		onheight={(h) => (inspector.sheetHeight = h)}
		onreturn={() => focusRow(app.selectedRow)}
		onclose={() => inspector.hide()}
	>
		{#snippet actions()}
			{#if layout === 'phone'}<SheetStatus {app} />{/if}
		{/snippet}
		{@render content()}
	</Sheet>
{/if}
<ProjectSheet />
<SourceSheet />

<style>
	.panel {
		display: flex;
		flex-direction: column;
		inline-size: var(--size-inspector);
		min-block-size: 0;
		overflow: hidden;
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	/* Over the chart's right edge, beside the rail: the editor keeps its width. */
	.panel.drawer {
		position: absolute;
		inset-block: 0;
		inset-inline-end: calc(var(--size-rail) + var(--gap-panel));
		z-index: 10;
		box-shadow: var(--shadow-dock);
	}
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: none;
		inline-size: var(--size-rail);
		padding: var(--space-2) 0;
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
		align-self: start;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
		border-block-end: 1px solid var(--color-border);
	}
	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 400;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: var(--size-control);
		block-size: var(--size-control);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.toggle:hover {
		background: var(--color-row-hover);
	}
	.toggle:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 1px;
	}
	.scroll {
		flex: 1 1 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: contain;
		padding: var(--space-3) var(--space-4) var(--space-6);
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
