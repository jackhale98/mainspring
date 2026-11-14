<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The read-only Gantt (phase-2.md 8.1, 9): a toolbar and one native scroll container holding a
	grid of four cells, which is what makes scrolling smooth and keeps the header and the task
	column in place with `position: sticky`: the corner and the time header on top, the task list on
	the left (the treegrid, whose header row is the corner), the plot (three canvases) in the
	middle. Rows are virtualised: the task list mounts the rows near the viewport, the canvases
	hold a window of the content (layout.ts).

	The Gantt never changes the schedule or the text. It draws the model built from the newest
	good result (model.ts) and, on a tap or a click, asks the app to select a task, which puts the
	editor cursor on its declaration. Critical path and float: gantt-analysis.svelte.ts (ADR-0007).
	Gestures and the inspector (T16, T17) come later. Zoom is on
	the toolbar, with Ctrl+wheel and a trackpad pinch over the chart, and with + and - while the
	task list has the focus (never Ctrl+plus: that is the browser's own page zoom).

	The task list is the treegrid (OutlineGrid.svelte, phase-2.md 10.1). It sits in a pane of its
	own beside the chart, and a divider (the text Split view's, SplitDivider.svelte) between them
	sets how wide the pane is (lib/gantt/table.ts; ADR-0008, amendment 2026-11-13). Every column is
	drawn at its natural width and a pane narrower than them scrolls its rows sideways, behind the
	frozen name column, without touching the chart; both panes are cells of the one grid in the one
	scroll container, so they share the vertical scroll and a row is always level with its bar.
	A phone has the name column alone and no divider. The treegrid says aloud what a reschedule
	moved (lib/gantt/announce.ts).

	Frozen like a native app (phase-2.md 9.2): one scroll container, so names and bars share one
	vertical scroll. The corner is fixed, the header moves only sideways, the task column only up
	and down, all by `position: sticky` on the compositor; nothing repaints per scroll event, only
	when the window leaves its overscan (layout.ts). No scroll chains to the page.

	Text to visual (phase-2.md 6.10): when the cursor in the text moves into another task, the app
	asks the chart to follow (`app.selection.follow`) and it scrolls that row and bar into view
	(lib/gantt/follow.ts), without taking the focus.

	Over 400 lines on purpose: this one component owns the scroll container, the zoom and the sticky
	grid, and they only work together; splitting them would spread one invariant over two files.

	Zoom is one step: the scale and the scroll offset are set together, so a single paint follows.
	A continuous Ctrl+wheel zoom first stretches the canvases with a CSS transform about the point
	under the pointer, and paints once when the wheel has been still for a moment.
-->
<script lang="ts">
	import { flushSync, onMount, tick, untrack } from 'svelte';
	import { createTimeZoneHost } from '../../engine/timezone';
	import { finishScenario } from '../../lib/schedule/finish';
	import { RescheduleAnnouncer } from '../../lib/gantt/announce';
	import { DEFAULT_COLUMNS, extrasRem, shownColumns } from '../../lib/gantt/columns';
	import { scenarioChain, sizingOf } from '../../lib/gantt/grid';
	import { NO_LINE, describeRowParts } from '../../lib/gantt/describe';
	import { resolveLinks } from '../../lib/gantt/links';
	import {
		OVERSCAN_ROWS,
		OVERSCAN_X,
		createLayout,
		metricsFor,
		paintWindow,
		revealTop,
		scaleFor,
		type PaintWindow,
	} from '../../lib/gantt/layout';
	import { followOffsets } from '../../lib/gantt/follow';
	import { markerState } from '../../lib/gantt/markers';
	import { buildGanttModel, todayOf } from '../../lib/gantt/model';
	import { measureFor } from '../../lib/gantt/paint/canvas';
	import {
		DEFAULT_ZOOM,
		ZOOM_PRESETS,
		clampZoom,
		nearestLevel,
		zoomForKey,
		type ZoomLevel,
	} from '../../lib/gantt/scale';
	import {
		defaultTableRatio,
		leastTableWidth,
		tableLimits,
		tableWidth,
	} from '../../lib/gantt/table';
	import { ticksFor } from '../../lib/gantt/ticks';
	import { memoZones } from '../../lib/gantt/zones';
	import type { AppState } from '../../lib/state/app.svelte';
	import { clampRatio } from '../../lib/state/split';
	import { strings } from '../../lib/strings';
	import { ctrlWheel } from './ctrl-wheel';
	import { ZoomPreview } from './zoom-preview';
	import { GanttAnalysis } from './gantt-analysis.svelte';
	import { GanttEnv } from './gantt-env.svelte';
	import SplitDivider from '../app/SplitDivider.svelte';
	import GanttToolbar from './GanttToolbar.svelte';
	import OutlineGrid from './OutlineGrid.svelte';
	import TimeHeader from './TimeHeader.svelte';
	import Timeline from './Timeline.svelte';

	interface Props {
		app: AppState;
		/** A phone: the name column alone, and no divider. */
		phone?: boolean;
		/** The divider's stored position (the table's share of the width); null follows the default. */
		tableRatio?: number | null;
		ontable?: (ratio: number) => void;
		/** A drag or a key press on the divider ended: the place to remember it. */
		ontablecommit?: () => void;
	}
	let { app, phone = false, tableRatio = null, ontable, ontablecommit }: Props = $props();

	const zones = memoZones(createTimeZoneHost());
	const env = new GanttEnv();
	let root: HTMLDivElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let space: HTMLDivElement | undefined = $state();
	let pxPerDay = $state(ZOOM_PRESETS[DEFAULT_ZOOM]);
	let scrollLeft = $state(0);
	let scrollTop = $state(0);
	let scrollerW = $state(0);
	let scrollerH = $state(0);
	/** Probes: the name column's own width, the divider's, and a rem, in px. */
	let nameColW = $state(0);
	let dividerW = $state(0);
	let remPx = $state(16);
	let hoverRow = $state<number | null>(null);
	/** The task pill's height while it shows (a phone floats it over the chart's foot). */
	let pillH = $state(0);
	const critical = new GanttAnalysis();

	// Rows from the outline joined with a good result (gantt-analysis picks which; never computed
	// here). Links come from the engine's result while it describes the text, else from the text.
	critical.watch(() => app.run?.lastGood?.result ?? null);
	const result = $derived(critical.result);
	const current = $derived(
		!!app.run?.lastGood &&
			app.run.lastGood.result === result &&
			app.run.lastGood.workspaceVersion === app.run.indexVersion &&
			!app.run.outdated,
	);
	const model = $derived.by(() => {
		const scenario = result ? finishScenario(result) : null;
		return buildGanttModel({
			nodes: app.outline.tasks,
			collapsed: app.collapsed,
			result,
			dimmed: app.run?.outdated ?? false,
			links: resolveLinks({
				sites: app.index?.dependencies ?? [],
				result,
				scenario,
				current,
			}),
			analysis: critical.drawn,
			zones,
		});
	});

	// The inspector reads what is drawn: the model, the result and its analysis as one pair.
	$effect(() => {
		app.inspector.view = { model, result, analysis: critical.shown.analysis, current };
	});

	/** The shown scenario and its parents: which of a task's `effort` statements applies. */
	const chain = $derived(scenarioChain(model.project, model.scenario));
	// The columns drawn and their natural width together; the divider decides how much of it shows.
	const columnsShown = $derived(shownColumns(phone));
	const naturalW = $derived(nameColW + extrasRem(columnsShown) * remPx);
	const tableSpace = $derived({
		ganttPx: scrollerW,
		dividerPx: dividerW,
		leastPx: leastTableWidth(nameColW, remPx),
	});
	/** What the divider can reach: the pane is never narrower than the name and the widest column. */
	const limits = $derived(tableLimits(tableSpace));
	const defaultRatio = $derived(
		defaultTableRatio(scrollerW, nameColW + extrasRem(DEFAULT_COLUMNS) * remPx, dividerW),
	);
	const ratio = $derived(clampRatio(tableRatio ?? defaultRatio, limits));
	/** The table pane's width, and where the chart starts (past the divider). */
	const tableW = $derived(phone ? nameColW : tableWidth({ ...tableSpace, ratio }));
	const chartLeft = $derived(tableW + (phone ? 0 : dividerW));

	// The divider is dragged at the pointer's rate: one update per frame is all that is drawn.
	let tableNext: number | null = null;
	let tableFrame = 0;
	function flushTable(): void {
		tableFrame = 0;
		if (tableNext === null) return;
		const next = tableNext;
		tableNext = null;
		ontable?.(next);
	}
	function moveTable(next: number): void {
		tableNext = next;
		if (tableFrame === 0) tableFrame = requestAnimationFrame(flushTable);
	}
	function commitTable(): void {
		if (tableFrame !== 0) cancelAnimationFrame(tableFrame);
		flushTable();
		ontablecommit?.();
	}

	// What a reschedule moved, for the treegrid's live region (announce.ts forgets the last result
	// when there is none, so a new plan is not compared with the old one).
	let announcement = $state('');
	const announcer = new RescheduleAnnouncer();
	$effect(() => {
		const next = result;
		untrack(() => {
			const text = announcer.next(next);
			if (text !== null) announcement = text;
		});
	});

	const metrics = $derived(metricsFor(env.theme, env.coarse));
	const scale = $derived(scaleFor(model, pxPerDay, metrics));
	const viewW = $derived(Math.max(0, scrollerW - chartLeft));
	const viewH = $derived(Math.max(0, scrollerH - metrics.headerHeight));
	// The layout reserves where the names are (labels.ts) with a scratch canvas set in the theme's
	// fonts. It does not depend on the width of the view, so that dragging the divider never builds
	// it again: the content is at least as wide as the view where that is applied (`contentW`).
	const measure = $derived(measureFor(env.theme));
	const layout = $derived(createLayout(model, scale, metrics, 0, measure));
	const contentW = $derived(Math.max(viewW, layout.width));
	// The canvases are painted for the widest the chart can be (the pane at its least), so that
	// dragging the divider moves the table over and off a painted chart and repaints nothing.
	const paintViewW = $derived(
		phone ? viewW : Math.max(viewW, scrollerW - tableWidth({ ...tableSpace, ratio: 0 }) - dividerW),
	);

	let paintWin = $state.raw<PaintWindow>({ x: 0, y: 0, w: 0, h: 0 });
	$effect(() => {
		const prev = untrack(() => paintWin);
		const next = paintWindow(
			{ x: scrollLeft, y: scrollTop, w: paintViewW, h: viewH },
			{ w: contentW, h: layout.height },
			{ overscanX: OVERSCAN_X, overscanY: OVERSCAN_ROWS * metrics.rowHeight },
			prev,
		);
		if (next !== prev) paintWin = next;
	});

	// Rows the task list mounts: primitives, so it updates only when a row boundary is crossed.
	const firstRow = $derived(Math.max(0, Math.floor(scrollTop / metrics.rowHeight) - OVERSCAN_ROWS));
	const lastRow = $derived(
		Math.min(model.rows.length, Math.ceil((scrollTop + viewH) / metrics.rowHeight) + OVERSCAN_ROWS),
	);

	const ticks = $derived(
		model.calendar
			? ticksFor(model.calendar, scale.m(paintWin.x), scale.m(paintWin.x + paintWin.w), pxPerDay)
			: null,
	);
	const selectedRow = $derived(model.rowOf.get(app.selectedTask ?? '') ?? null);
	const selected = $derived(describeRowParts(model, selectedRow));
	const hover = $derived(
		hoverRow !== null && hoverRow !== selectedRow ? describeRowParts(model, hoverRow) : NO_LINE,
	);

	/** The clock stays out of the model: a tick of it must not rebuild the rows (model.ts). */
	const today = $derived(todayOf(model.project, env.nowMs));
	const markers = $derived(markerState(model, scale.m(0), today));

	function onscroll(): void {
		if (!scroller) return;
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
	}

	/**
	 * Sets the zoom so that `anchorMin` stays `anchorX` pixels from the left of the view. The scale
	 * and the scroll offset change in one flush, then the scroller is told: one render and one
	 * paint, not a paint at the new scale with the old offset and another after the scroll.
	 */
	function applyZoom(target: number, anchorMin: number, anchorX: number): void {
		const next = clampZoom(target);
		if (!scroller) return;
		const to = scaleFor(model, next, metrics);
		const width = Math.max(viewW, Math.ceil(to.x(model.endMin)));
		const left = Math.max(0, Math.min(width - viewW, Math.round(to.x(anchorMin) - anchorX)));
		flushSync(() => {
			pxPerDay = next;
			scrollLeft = left;
		});
		scroller.scrollLeft = left;
		zoomPreview.settled();
	}

	// Zoom shows at once and paints later (zoom-preview.ts).
	const zoomPreview = new ZoomPreview({
		space: () => space,
		zoom: () => pxPerDay,
		minuteAt: (x) => scale.m(scrollLeft + x),
		contentX: (x) => scrollLeft + x,
		clamp: clampZoom,
		commit: (target, anchorMin, anchorX) => applyZoom(target, anchorMin, anchorX),
	});

	function zoomBy(next: number): void {
		const target = clampZoom(next);
		if (target === (zoomPreview.target ?? pxPerDay)) return;
		zoomPreview.step(target, viewW / 2);
	}

	function onZoomWheel(e: WheelEvent): void {
		if (!scroller) return;
		const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
		const x = Math.max(0, e.clientX - scroller.getBoundingClientRect().left - chartLeft);
		zoomPreview.wheel(e.deltaY * unit, x);
	}

	function goToday(): void {
		if (markers.target === null || !scroller) return;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		scroller.scrollTo({
			left: Math.max(0, scale.x(markers.target) - viewW / 2),
			behavior: reduce ? 'auto' : 'smooth',
		});
	}

	/** Scrolls a row into view below the sticky header. */
	async function revealRow(index: number): Promise<void> {
		if (!scroller) return;
		scroller.scrollTop = revealTop(index, metrics.rowHeight, scroller.scrollTop, viewH);
		scrollTop = scroller.scrollTop;
		await tick();
	}

	// Text to visual (phase-2.md 6.10): the cursor moved into another task in the text. Its row and
	// bar scroll into view, without taking the focus. The request is read once, when the chart is
	// on screen (a hidden chart has no height) and its row exists; a selection from a visual or a
	// newer one replaces it (selection.svelte.ts).
	let followed = 0;
	$effect(() => {
		const f = app.selection.follow;
		if (!f || f.nonce === followed || !scroller || viewH <= 0) return;
		// A row that is not there yet (a task just added, its index not in) keeps the request.
		const i = model.rowOf.get(f.key);
		if (i === undefined) return;
		followed = f.nonce;
		untrack(() => followRow(i));
	});
	function followRow(index: number): void {
		const row = model.rows[index];
		if (!scroller || !row) return;
		const bar =
			row.start !== null && row.end !== null
				? { x0: scale.x(row.start), x1: scale.x(row.end) }
				: null;
		const to = followOffsets({
			row: index,
			rowHeight: metrics.rowHeight,
			top: scroller.scrollTop,
			left: scroller.scrollLeft,
			viewW,
			viewH,
			bar,
		});
		scroller.scrollTop = to.top;
		scroller.scrollLeft = to.left;
		scrollTop = scroller.scrollTop;
		scrollLeft = scroller.scrollLeft;
	}

	function selectRow(index: number): void {
		const row = model.rows[index];
		if (!row) return;
		app.selectTask(row.key);
		app.inspector.show();
	}

	/** + and - zoom while the task list has the focus; Ctrl+plus is the browser's (zoomForKey). */
	function onkeydown(event: KeyboardEvent): void {
		if (!(event.target instanceof Element) || !event.target.closest('[role="treegrid"]')) return;
		const target = zoomForKey(event, zoomPreview.target ?? pxPerDay);
		if (target === null) return;
		event.preventDefault();
		zoomBy(target);
	}

	onMount(() => {
		const stop = root ? env.attach(root) : () => undefined;
		return () => {
			stop();
			if (tableFrame !== 0) cancelAnimationFrame(tableFrame);
			zoomPreview.dispose();
		};
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="gantt"
	bind:this={root}
	role="region"
	aria-label={strings.gantt.region}
	data-testid="gantt"
	data-zoom={nearestLevel(pxPerDay)}
	style:--gantt-pill-h={pillH > 0 ? `${pillH}px` : undefined}
	{onkeydown}
>
	<span class="probes" aria-hidden="true">
		<i bind:clientWidth={nameColW}></i><u bind:clientWidth={dividerW}></u><b
			bind:clientWidth={remPx}
		></b>
	</span>
	<GanttToolbar
		{pxPerDay}
		{selected}
		{hover}
		hasMarker={markers.target !== null}
		lines={markers}
		dimmed={model.dimmed}
		critical={critical.chip}
		onlevel={(level: ZoomLevel) => zoomBy(ZOOM_PRESETS[level])}
		ontoday={goToday}
		oncritical={() => critical.toggle()}
		onpill={(h) => (pillH = h)}
	/>

	{#if model.rows.length === 0}
		<p class="empty">{app.phase === 'ready' ? strings.gantt.noTasks : strings.topBar.loading}</p>
	{:else}
		<div
			class="scroller"
			bind:this={scroller}
			bind:clientWidth={scrollerW}
			bind:clientHeight={scrollerH}
			{onscroll}
			use:ctrlWheel={{ handler: onZoomWheel }}
		>
			<div
				class="space"
				bind:this={space}
				style:grid-template-columns="{tableW}px {phone ? 0 : dividerW}px {contentW}px"
				style:grid-template-rows="{metrics.headerHeight}px {layout.height}px"
			>
				<div class="head" style:--gantt-names="{chartLeft}px">
					<TimeHeader
						{model}
						{layout}
						win={paintWin}
						{ticks}
						theme={env.theme}
						dpr={env.dpr}
						todayMin={today}
						{scrollLeft}
					/>
				</div>
				<div class="names" class:alone={phone}>
					<OutlineGrid
						{model}
						outline={app.outline.byKey}
						analysis={critical.shown.analysis}
						sizing={(id) => sizingOf(app.index?.tasks.get(id), chain)}
						shown={columnsShown}
						naturalWidth={naturalW}
						first={firstRow}
						last={lastRow}
						rowHeight={metrics.rowHeight}
						headerHeight={metrics.headerHeight}
						page={Math.max(1, Math.floor(viewH / metrics.rowHeight) - 1)}
						selectedKey={app.selectedTask}
						{announcement}
						ontoggle={(k) => app.toggleNode(k)}
						onselect={(k) => {
							app.selectTask(k);
							app.inspector.show();
						}}
						onopen={() => app.inspector.focus()}
						onreveal={revealRow}
					/>
				</div>
				{#if !phone}
					<!-- The divider spans both rows; its handle stays at the middle of the view. -->
					<div class="divide" style:inset-inline-start="{tableW}px">
						<div class="stick" style:block-size="{scrollerH}px">
							<SplitDivider
								axis="col"
								value={ratio}
								container={scroller}
								onchange={moveTable}
								oncommit={commitTable}
								{limits}
								label={strings.panels.tableDivider}
								firstName={strings.panels.dividerTable}
							/>
						</div>
					</div>
				{/if}
				<div class="plot" style:--gantt-names="{chartLeft}px">
					<Timeline
						{model}
						{layout}
						win={paintWin}
						{ticks}
						theme={env.theme}
						dpr={env.dpr}
						{selectedRow}
						todayMin={today}
						{viewW}
						{contentW}
						onselect={selectRow}
						onhover={(r) => (hoverRow = r)}
					/>
				</div>
			</div>
			<!-- Room to scroll the last rows above the details sheet (inspector, WCAG 2.4.11). -->
			<div class="inset" aria-hidden="true" style:block-size="{app.inspector.sheetHeight}px"></div>
		</div>
	{/if}
</div>

<style>
	.gantt {
		/* The toolbar's floating pills answer to the chart's own width (Split makes it narrow). */
		container: gantt / inline-size;
		/* The name column's own width, the divider's, and the frozen region: the table's pane and
		   the divider, set by the script from the divider's position. */
		--gantt-name-col: var(--size-gantt-names);
		--gantt-divider-w: var(--gap-panel);
		--gantt-names: calc(var(--gantt-name-col) + var(--gantt-divider-w));
		position: relative;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		block-size: 100%;
		background: var(--color-gantt-surface);
	}
	.empty {
		margin: 0;
		padding: var(--space-6) var(--gutter);
		color: var(--color-gantt-text-muted);
	}
	/* The one scroll container: pan on the chart, never chaining to the page. */
	.scroller {
		position: relative;
		flex: 1 1 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: none;
		-webkit-overflow-scrolling: touch;
	}
	/* As wide as its tracks, not as the scroller: a sticky cell (task column, corner) only stays in
	   view inside its containing block, and a grid narrower than its tracks ended that block at
	   the first screenful, pushing the names off at the far right. */
	.space {
		display: grid;
		position: relative;
		inline-size: max-content;
		min-inline-size: 100%;
	}
	/* The header sticks to the top and moves only sideways; the corner (the task list's header
	   row) is frozen both ways, inside the treegrid. `clip`, not `hidden`: the month labels inside
	   are sticky against the scroller, and a hidden overflow would make this box their scroll
	   container. */
	.head {
		grid-area: 1 / 3;
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
		overflow: clip;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
	}
	/* The treegrid: its header row sticks to the top inside it, so it spans both grid rows. */
	.names {
		grid-area: 1 / 1 / 3 / 2;
		position: sticky;
		inset-inline-start: 0;
		z-index: 4;
		background: var(--color-gantt-surface);
	}
	/* Without a divider (a phone), the pane has its own edge. */
	.names.alone {
		border-inline-end: 1px solid var(--color-gantt-border);
	}
	/* The divider: a column of its own between the panes, frozen like the table's pane. */
	.divide {
		grid-area: 1 / 2 / 3 / 3;
		position: sticky;
		z-index: 5;
		border-inline: 1px solid var(--color-gantt-border);
		box-sizing: border-box;
		background: var(--color-gantt-surface);
	}
	.stick {
		position: sticky;
		inset-block-start: 0;
		display: grid;
	}
	.plot {
		grid-area: 2 / 3;
		position: relative;
	}
	/* Three sizeless probes: the script reads the name column, the divider and a rem, in px. */
	.probes {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}
	.probes i,
	.probes u,
	.probes b {
		display: block;
		block-size: 0;
	}
	.probes i {
		inline-size: var(--gantt-name-col);
	}
	.probes u {
		inline-size: var(--gantt-divider-w);
		text-decoration: none;
	}
	.probes b {
		inline-size: 1rem;
	}
	@media (max-width: 1023px) {
		.gantt {
			--gantt-name-col: 14rem;
		}
	}
	@media (max-width: 599px) {
		.gantt {
			--gantt-name-col: 7.75rem;
			--gantt-divider-w: 0px;
			/* The floating task pill and its gap, while it shows (invalid without it: no room kept). */
			--gantt-pill-reserve: calc(var(--gantt-pill-h) + 2 * var(--space-2));
		}
		/* So that the last row can be scrolled up out from under the pill. */
		.scroller {
			padding-block-end: var(--gantt-pill-reserve, 0px);
		}
	}
</style>
