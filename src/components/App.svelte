<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The app shell (phase-1.md 8; phase-2.md 9; ADR-0009 "Mainspring refined"). A recessed canvas
	with floating rounded panels on it, and a top bar on the canvas itself. It is as tall as the
	viewport and never scrolls as a page: only the panels inside scroll (see layouts/Base.astro).

	Modes (Text, Split, Visual) are per sample and remembered (src/lib/state/mode.svelte.ts);
	Cmd or Ctrl and 1, 2, 3 switch from anywhere. Text on a desktop shows the outline beside the
	editor; tablets put the outline in a drawer. Split shows the editor and the Gantt side by side
	with a draggable divider, stacked on a tablet (the Gantt above); Visual shows the Gantt alone.
	In Split and Visual the outline is the same drawer on every width. Phones show one panel at a
	time under a floating pill tab bar (Plan, Gantt, Text).

	The editor packages are a separate chunk: the editor panel is imported when a mode first shows
	it and then kept mounted, so a Visual-first load never fetches CodeMirror, and a switch keeps
	the editor's state. The Gantt is mounted when first shown and then kept, so zoom and scroll
	survive a switch. Nothing here changes the schedule: the editor commits text to the workspace
	and the runner schedules what it sees; visual edits go through the edit dispatcher
	(`app.edits`), whose toasts sit above the status strip (above the tab bar on phones).
-->
<script lang="ts">
	import { onDestroy, untrack, type Component } from 'svelte';
	import { AppState } from '../lib/state/app.svelte';
	import { installEditHooks } from '../lib/state/edit-hooks';
	import { LayoutState } from '../lib/state/layout.svelte';
	import { ModeState } from '../lib/state/mode.svelte';
	import { modeForKey } from '../lib/state/shortcuts';
	import { ThemeState } from '../lib/state/theme.svelte';
	import { effectiveMode, modeFromParam, phoneTabFor } from '../lib/state/view-mode';
	import { strings } from '../lib/strings';
	import DocsSheet from './DocsSheet.svelte';
	import Gantt from './gantt/Gantt.svelte';
	import InspectorHost from './inspector/InspectorHost.svelte';
	import OutlinePanel from './OutlinePanel.svelte';
	import Sheet from './Sheet.svelte';
	import StatusStrip from './StatusStrip.svelte';
	import SplitDivider from './app/SplitDivider.svelte';
	import TabBar from './app/TabBar.svelte';
	import Toasts from './app/Toasts.svelte';
	import TopBar from './app/TopBar.svelte';
	import { AppUpdates } from '../lib/state/updates.svelte';
	import { sitePath } from '../lib/site-path';
	import type { SourceRange } from '../lib/tjp/index';

	const params = new URLSearchParams(location.search);
	const app = new AppState({ initial: params.get('sample') });
	const theme = new ThemeState();
	const linked = modeFromParam(params.get('mode'));
	const modes = new ModeState({ linked });
	app.phoneTab = phoneTabFor(linked);
	const layout = new LayoutState();
	// A newer deployed build offers a reload (ADR-0012).
	const updates = new AppUpdates({ url: sitePath('version.json'), visibility: document });
	updates.start();
	// End-to-end tests only, with ?hooks=edits (edit-hooks.ts).
	const offHooks = installEditHooks(app, params);
	onDestroy(() => {
		updates.stop();
		offHooks();
		layout.dispose();
		theme.dispose();
		app.dispose();
	});

	// The preferences of the open sample: its mode and its divider.
	$effect(() => {
		const id = app.sampleId;
		if (id === '') return;
		untrack(() => {
			modes.use(id);
			// A phone starts on the tab of the remembered mode.
			if (modes.choice !== null) app.phoneTab = phoneTabFor(modes.choice);
		});
	});

	const kind = $derived(layout.kind);
	const phone = $derived(kind === 'phone');
	const mode = $derived(effectiveMode(modes.choice, kind));
	const showGantt = $derived(phone ? app.phoneTab === 'gantt' : mode !== 'text');
	const showEditor = $derived(phone ? app.phoneTab === 'text' : mode !== 'visual');
	const split = $derived(!phone && mode === 'split');
	/** The Gantt is mounted when first shown and then kept, so zoom and scroll survive a switch. */
	let ganttSeen = $state(false);
	$effect(() => {
		if (showGantt) ganttSeen = true;
	});
	/** The editor panel is imported (with CodeMirror) when first shown, and then kept mounted. */
	let EditorPanel = $state.raw<Component<{
		app: AppState;
		ws: NonNullable<AppState['workspace']>;
		layout: typeof kind;
	}> | null>(null);
	$effect(() => {
		if (showEditor && EditorPanel === null) {
			void import('./EditorPanel.svelte').then((m) => (EditorPanel = m.default));
		}
	});

	/**
	 * The outline is a drawer on tablets, and on a desktop in Split and Visual, where the Gantt's
	 * task column is the outline. Text on a desktop has it beside the editor; phones have a tab.
	 */
	const drawer = $derived(kind === 'tablet' || (kind === 'desktop' && mode !== 'text'));
	$effect(() => {
		if (!drawer) untrack(() => (app.outlineOpen = false));
	});
	/** The notice sits in the outline panel; where that is not on screen, it sits in the footer. */
	const showNotice = $derived(!phone && !(kind === 'desktop' && mode === 'text'));

	let body: HTMLElement | undefined = $state();
	const axis = $derived(kind === 'desktop' ? 'col' : 'row');
	const ratio = $derived(axis === 'col' ? modes.ratios.col : modes.ratios.row);
	/** The editor (side by side) or the Gantt (stacked, above) takes `ratio`; the divider is the gap. */
	const splitTracks = $derived(`minmax(0, ${ratio}fr) var(--gap-panel) minmax(0, ${1 - ratio}fr)`);

	/**
	 * The toasts sit just above the footer (the notice and the status strip), on every layout, so
	 * they never cover the status or its reload button: its distance from the viewport's bottom,
	 * measured whenever the footer or the viewport changes size.
	 */
	let footer: HTMLElement | undefined = $state();
	let toastBottom = $state<number | null>(null);
	$effect(() => {
		const el = footer;
		if (!el) return;
		const measure = (): void => {
			toastBottom = Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top));
		};
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		ro.observe(document.documentElement);
		window.addEventListener('resize', measure);
		measure();
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
		};
	});

	function onkeydown(event: KeyboardEvent): void {
		const next = phone ? null : modeForKey(event);
		if (next === null) return;
		event.preventDefault();
		modes.set(next);
	}

	/**
	 * The inspector's "Show in text": the editor has to be on screen first (Split, or Text on a
	 * phone), then the range is revealed in it.
	 */
	function showInText(at: SourceRange): void {
		if (phone) modes.set('text');
		else if (mode === 'visual') modes.set('split');
		app.showRange(at);
	}

	function pickTab(tab: 'plan' | 'gantt' | 'text'): void {
		if (tab === 'text') modes.set('text');
		else if (tab === 'gantt') modes.set('visual');
	}
</script>

<svelte:window {onkeydown} />

<div class="app" data-layout={kind}>
	<TopBar {app} {theme} layout={kind} {mode} {drawer} onmode={(m) => modes.set(m)} />
	<div class="work">
		<main
			id="main"
			class="body"
			data-mode={mode}
			data-axis={split ? axis : undefined}
			tabindex="-1"
			bind:this={body}
			style:grid-template-columns={split && axis === 'col' ? splitTracks : undefined}
			style:grid-template-rows={split && axis === 'row' ? splitTracks : undefined}
		>
			{#if kind === 'desktop' && mode === 'text'}
				<aside class="panel outline" aria-label={strings.outline.title}>
					<OutlinePanel {app} />
				</aside>
			{/if}
			{#if phone}
				<div
					id="panel-plan"
					class="panel plan"
					role="tabpanel"
					aria-labelledby="tab-plan"
					hidden={app.phoneTab !== 'plan'}
				>
					<div class="grow"><OutlinePanel {app} showTitle={false} showNotice={false} /></div>
				</div>
			{/if}
			<div
				id="panel-text"
				class="panel text"
				role={phone ? 'tabpanel' : undefined}
				aria-labelledby={phone ? 'tab-text' : undefined}
				hidden={!showEditor}
			>
				{#if app.phase === 'failed'}
					<p class="message error" role="alert">{app.loadError}</p>
				{:else if app.workspace && EditorPanel}
					{#key app.workspace}
						<EditorPanel {app} ws={app.workspace} layout={kind} />
					{/key}
				{:else}
					<p class="message">{strings.topBar.loading}</p>
				{/if}
			</div>
			{#if split}
				<SplitDivider
					{axis}
					value={ratio}
					container={body}
					onchange={(v) => modes.setRatio(axis, v)}
					oncommit={() => modes.saveRatios()}
				/>
			{/if}
			{#if ganttSeen}
				<div
					id="panel-gantt"
					class="panel gantt"
					role={phone ? 'tabpanel' : undefined}
					aria-labelledby={phone ? 'tab-gantt' : undefined}
					hidden={!showGantt}
				>
					<Gantt {app} />
				</div>
			{/if}
		</main>
		<InspectorHost {app} layout={kind} {mode} active={showGantt} onshowtext={showInText} />
	</div>
	<div class="footer" bind:this={footer}>
		{#if showNotice}<p class="notice">{strings.notice}</p>{/if}
		{#if phone}<p class="notice compact">{strings.noticeShort}</p>{/if}
		<StatusStrip {app} {updates} compact={phone} quiet={showGantt} />
	</div>
	{#if phone}<TabBar {app} onchange={pickTab} />{/if}
	<Toasts
		{app}
		{phone}
		bottom={app.inspector.sheetHeight > 0
			? Math.max(toastBottom ?? 0, app.inspector.sheetHeight)
			: toastBottom}
	/>
	{#if drawer}
		<Sheet
			open={app.outlineOpen}
			side="start"
			title={strings.outline.title}
			closeLabel={strings.panels.outlineClose}
			onclose={() => (app.outlineOpen = false)}
		>
			<OutlinePanel {app} showTitle={false} />
		</Sheet>
	{/if}
	<DocsSheet {app} />
</div>

<style>
	.app {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		block-size: 100%;
		max-block-size: 100dvh;
		padding-inline: max(var(--gap-panel), env(safe-area-inset-left))
			max(var(--gap-panel), env(safe-area-inset-right));
		background: var(--color-bg);
	}
	.app[data-layout='phone'] {
		padding-inline: max(10px, env(safe-area-inset-left)) max(10px, env(safe-area-inset-right));
	}
	/* The Gantt and its inspector side by side on a desktop; the body is what the Split divider
	   measures, so the inspector sits outside it. */
	.work {
		display: flex;
		gap: var(--gap-panel);
		min-block-size: 0;
		min-inline-size: 0;
	}
	.body {
		flex: 1 1 0;
		min-inline-size: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		min-block-size: 0;
		outline: none;
	}
	.app[data-layout='desktop'] .body:not([data-axis]) {
		gap: var(--gap-panel);
	}
	.app[data-layout='desktop'] .body[data-mode='text'] {
		grid-template-columns: var(--size-outline) minmax(0, 1fr);
	}
	/* A tablet stacks the two in Split, the Gantt above the editor (the divider is the gap). */
	.app[data-layout='tablet'] .body[data-axis='row'] .gantt {
		order: -1;
	}
	.app[data-layout='tablet'] .body[data-axis='row'] .text {
		order: 1;
	}
	.app[data-layout='tablet'] .body[data-axis='row'] {
		grid-template-columns: minmax(0, 1fr);
	}
	/* Floating panels: a card on the canvas (ADR-0009: radius 16, layered soft shadow). */
	.panel {
		min-block-size: 0;
		min-inline-size: 0;
		overflow: hidden;
		border-radius: var(--radius-panel);
		background: var(--color-surface);
		box-shadow: var(--shadow-panel);
	}
	.panel[hidden] {
		display: none;
	}
	.app[data-layout='phone'] .panel {
		border-radius: 18px;
	}
	.plan {
		display: flex;
		flex-direction: column;
	}
	.grow {
		flex: 1 1 0;
		min-block-size: 0;
	}
	/* The footer: the notice and the status strip on one floating bar, off the phone's panels. */
	.footer {
		min-inline-size: 0;
		margin-block-start: var(--gap-panel);
		margin-block-end: var(--gap-panel);
		overflow: hidden;
		border-radius: 14px;
		background: var(--color-surface);
		box-shadow: var(--shadow-chip);
	}
	.app[data-layout='phone'] .footer {
		margin-block-end: 0;
		background: transparent;
		box-shadow: none;
		border-radius: 0;
	}
	.notice {
		margin: 0;
		padding: 5px var(--gutter) 0;
		color: var(--color-text-muted);
		font-size: 11.5px;
	}
	.notice.compact {
		padding: 2px 6px 0;
		text-align: center;
	}
	.message {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-text-muted);
	}
	.message.error {
		color: var(--color-diagnostic-error);
	}
</style>
