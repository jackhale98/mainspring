<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	Where the details live (phase-2.md 9.2, 9.3; polish item 8). On a desktop they are a side panel,
	320 px, collapsible, next to the Gantt in Split and Visual. On a tablet or a phone they are a
	bottom sheet over the Gantt at half height, which can be dragged to full height. The sheet is
	not modal: the chart behind stays usable, and the selected row is scrolled above the sheet
	(WCAG 2.4.11). A tap on a task opens the sheet without taking the focus; Enter on a row opens
	the details and moves the focus into the first field, and Escape returns it to the row.

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
	import type { ViewMode } from '../../lib/state/view-mode';
	import type { SourceRange } from '../../lib/tjp/index';
	import Icon from '../Icon.svelte';
	import Sheet from '../Sheet.svelte';
	import { setInspector } from './context';
	import InspectorBody from './InspectorBody.svelte';
	import ProjectSheet from './ProjectSheet.svelte';
	import SourceSheet from './SourceSheet.svelte';

	interface Props {
		app: AppState;
		layout: LayoutKind;
		/** Split shares the width with the editor: below `WIDE_MIN` the details are a sheet. */
		mode: ViewMode;
		/** The Gantt is on screen (not the Text mode, not the phone's Text tab). */
		active: boolean;
		/** Shows a range in the text: the shell switches the mode, then reveals it. */
		onshowtext: (at: SourceRange) => void;
	}
	let { app, layout, mode, active, onshowtext }: Props = $props();

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

	/** Editor, chart and a 320 px panel need this much width; narrower, Split uses the sheet. */
	const WIDE_MIN = 1440;
	let wide = $state(false);
	$effect(() => {
		const q = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
		const set = (): void => void (wide = q.matches);
		set();
		q.addEventListener('change', set);
		return () => q.removeEventListener('change', set);
	});
	/** The side panel: a desktop in Visual, or wide enough in Split. Otherwise the bottom sheet. */
	const desktop = $derived(layout === 'desktop' && (mode !== 'split' || wide));
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
		const key = app.selectedTask;
		const h = inspector.sheetHeight;
		if (!desktop && h > 0) void tick().then(() => keepRowClear(key, h));
	});

	/** Escape in the side panel gives the focus back to the row (the sheet does it itself). */
	function onkeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		if (focusRow(app.selectedTask)) e.preventDefault();
	}
</script>

{#snippet content()}
	<div class="body" bind:this={body}>
		<InspectorBody />
	</div>
{/snippet}

{#if desktop && active}
	<!-- Escape in the panel returns the focus to the row; the aside is not itself interactive. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		class="panel"
		class:collapsed={inspector.collapsed}
		aria-label={S.panel}
		data-testid="inspector"
		{onkeydown}
	>
		{#if inspector.collapsed}
			<button
				type="button"
				class="toggle"
				aria-expanded="false"
				title={S.showPanel}
				onclick={() => (inspector.collapsed = false)}
			>
				<Icon name="panel" size={17} />
				<span class="sr-only">{S.showPanel}</span>
			</button>
		{:else}
			<header>
				<h2>{title}</h2>
				<button
					type="button"
					class="toggle"
					aria-expanded="true"
					title={S.hidePanel}
					onclick={() => (inspector.collapsed = true)}
				>
					<Icon name="close" size={16} />
					<span class="sr-only">{S.hidePanel}</span>
				</button>
			</header>
			<div class="scroll">
				{@render content()}
			</div>
		{/if}
	</aside>
{:else if !desktop}
	<Sheet
		open={active && inspector.sheet && (layout !== 'desktop' || inspector.explicit)}
		side="bottom"
		modal={false}
		{title}
		closeLabel={S.close}
		detent={inspector.detent}
		focusOnOpen={false}
		ondetent={(d) => (inspector.detent = d)}
		onheight={(h) => (inspector.sheetHeight = h)}
		onclose={() => inspector.hide()}
	>
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
	.panel.collapsed {
		inline-size: auto;
		align-items: center;
		padding: var(--space-2);
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
