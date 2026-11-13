<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The read-only Gantt (phase-2.md 8.1, 9): a toolbar and one native scroll container holding a
	grid of four cells, which is what makes scrolling smooth and keeps the header and the task
	column in place with `position: sticky`: the corner and the time header on top, the task list on
	the left, the plot (three canvases) in the middle. Rows are virtualised: the task list mounts
	the rows near the viewport, the canvases hold a window of the content (layout.ts).

	The Gantt never changes the schedule or the text. It draws the model built from the newest
	good result (model.ts) and, on a tap or a click, asks the app to select a task, which puts the
	editor cursor on its declaration. Gestures and the inspector (T16, T17) come later. Zoom is on
	the toolbar, with Ctrl+wheel and a trackpad pinch over the chart, and with + and - while the
	task list has the focus (never Ctrl+plus: that is the browser's own page zoom).

	Frozen like a native app (phase-2.md 9.2): one scroll container, so names and bars share one
	vertical scroll. The corner is fixed, the header moves only sideways, the task column only up
	and down, all by `position: sticky` on the compositor; nothing repaints per scroll event, only
	when the window leaves its overscan (layout.ts). No scroll chains to the page.

	Zoom is one step: the scale and the scroll offset are set together, so a single paint follows.
	A continuous Ctrl+wheel zoom first stretches the canvases with a CSS transform about the point
	under the pointer, and paints once when the wheel has been still for a moment.
-->
<script lang="ts">
	import { flushSync, onMount, tick, untrack } from 'svelte';
	import { createTimeZoneHost } from '../../engine/timezone';
	import { finishScenario } from '../../lib/schedule/finish';
	import { describeRow } from '../../lib/gantt/describe';
	import { resolveLinks } from '../../lib/gantt/links';
	import {
		OVERSCAN_ROWS,
		OVERSCAN_X,
		createLayout,
		metricsFor,
		paintWindow,
		scaleFor,
		type PaintWindow,
	} from '../../lib/gantt/layout';
	import { markerState } from '../../lib/gantt/markers';
	import { buildGanttModel, todayOf } from '../../lib/gantt/model';
	import {
		DEFAULT_ZOOM,
		ZOOM_PRESETS,
		clampZoom,
		nearestLevel,
		zoomIn,
		zoomOut,
		type ZoomLevel,
	} from '../../lib/gantt/scale';
	import { ticksFor } from '../../lib/gantt/ticks';
	import { memoZones } from '../../lib/gantt/zones';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import { ctrlWheel } from './ctrl-wheel';
	import { ZoomPreview } from './zoom-preview';
	import { GanttEnv } from './gantt-env.svelte';
	import GanttToolbar from './GanttToolbar.svelte';
	import OutlineColumn from './OutlineColumn.svelte';
	import TimeHeader from './TimeHeader.svelte';
	import Timeline from './Timeline.svelte';

	let { app }: { app: AppState } = $props();

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
	let namesW = $state(0);
	let hoverRow = $state<number | null>(null);
	/** The critical path is shown when there is an analysis (task T5) and the chip is on. */
	let criticalOn = $state(true);
	const analysisAvailable = false;

	// The model: rows from the outline joined with the newest good result (never computed here).
	// The links come from the engine's result while it describes the text, and from the text,
	// marked pending, while the text is newer (typing, or an edit that broke the schedule).
	const result = $derived(app.run?.lastGood?.result ?? null);
	const current = $derived(
		!!app.run?.lastGood &&
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
			// Task T5 supplies the driving-path analysis here (when `criticalOn`).
			analysis: null,
			zones,
		});
	});

	const metrics = $derived(metricsFor(env.theme, env.coarse));
	const scale = $derived(scaleFor(model, pxPerDay, metrics));
	const viewW = $derived(Math.max(0, scrollerW - namesW));
	const viewH = $derived(Math.max(0, scrollerH - metrics.headerHeight));
	const layout = $derived(createLayout(model, scale, metrics, viewW));

	let paintWin = $state.raw<PaintWindow>({ x: 0, y: 0, w: 0, h: 0 });
	$effect(() => {
		const prev = untrack(() => paintWin);
		const next = paintWindow(
			{ x: scrollLeft, y: scrollTop, w: viewW, h: viewH },
			{ w: layout.width, h: layout.height },
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
	const selectedText = $derived(describeRow(model, selectedRow));
	const hoverText = $derived(
		hoverRow !== null && hoverRow !== selectedRow ? describeRow(model, hoverRow) : '',
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
		const x = Math.max(0, e.clientX - scroller.getBoundingClientRect().left - namesW);
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
		const top = index * metrics.rowHeight;
		if (top < scroller.scrollTop) scroller.scrollTop = top;
		else if (top + metrics.rowHeight > scroller.scrollTop + viewH) {
			scroller.scrollTop = top + metrics.rowHeight - viewH;
		}
		scrollTop = scroller.scrollTop;
		await tick();
	}

	function selectRow(index: number): void {
		const row = model.rows[index];
		if (row) app.selectTask(row.key);
	}

	/** + and - zoom while the task list has the focus; Ctrl+plus is the browser's, left alone. */
	function onkeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (!(event.target instanceof Element) || !event.target.closest('[role="tree"]')) return;
		if (event.key === '=' || event.key === '+') {
			event.preventDefault();
			zoomBy(zoomIn(zoomPreview.target ?? pxPerDay));
		} else if (event.key === '-') {
			event.preventDefault();
			zoomBy(zoomOut(zoomPreview.target ?? pxPerDay));
		}
	}

	onMount(() => {
		const stop = root ? env.attach(root) : () => undefined;
		return () => {
			stop();
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
	{onkeydown}
>
	<GanttToolbar
		{pxPerDay}
		{selectedText}
		{hoverText}
		hasMarker={markers.target !== null}
		lines={markers}
		dimmed={model.dimmed}
		critical={{ available: analysisAvailable, pressed: criticalOn }}
		onlevel={(level: ZoomLevel) => zoomBy(ZOOM_PRESETS[level])}
		ontoday={goToday}
		oncritical={() => (criticalOn = !criticalOn)}
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
				style:grid-template-columns="var(--gantt-names) {layout.width}px"
				style:grid-template-rows="{metrics.headerHeight}px {layout.height}px"
			>
				<div class="corner">{strings.gantt.taskColumn}</div>
				<div class="head">
					<TimeHeader
						{model}
						{layout}
						win={paintWin}
						{ticks}
						theme={env.theme}
						dpr={env.dpr}
						todayMin={today}
					/>
				</div>
				<div class="names" bind:clientWidth={namesW}>
					<OutlineColumn
						rows={model.rows}
						first={firstRow}
						last={lastRow}
						rowHeight={metrics.rowHeight}
						selectedKey={app.selectedTask}
						ontoggle={(k) => app.toggleNode(k)}
						onselect={(k) => app.selectTask(k)}
						onreveal={revealRow}
					/>
				</div>
				<div class="plot">
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
						onselect={selectRow}
						onhover={(r) => (hoverRow = r)}
					/>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.gantt {
		/* The toolbar's floating pills answer to the chart's own width (Split makes it narrow). */
		container: gantt / inline-size;
		--gantt-names: var(--size-gantt-names);
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
	.space {
		display: grid;
		position: relative;
	}
	/* The corner is frozen both ways, the header only moves sideways (sticky at the top). */
	.corner,
	.head {
		position: sticky;
		inset-block-start: 0;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
	}
	.corner {
		grid-area: 1 / 1;
		inset-inline-start: 0;
		z-index: 4;
		display: flex;
		align-items: flex-end;
		padding: var(--space-1) var(--space-3);
		border-inline-end: 1px solid var(--color-gantt-border);
		color: var(--color-gantt-text-faint);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	/* `clip`, not `hidden`: the month labels inside are sticky against the scroller, and a
	   hidden overflow would make this box their scroll container. */
	.head {
		grid-area: 1 / 2;
		z-index: 3;
		overflow: clip;
	}
	.names {
		grid-area: 2 / 1;
		position: sticky;
		inset-inline-start: 0;
		z-index: 2;
		border-inline-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface);
	}
	.plot {
		grid-area: 2 / 2;
		position: relative;
	}
	@media (max-width: 1023px) {
		.gantt {
			--gantt-names: 14rem;
		}
	}
	@media (max-width: 599px) {
		.gantt {
			--gantt-names: 7.75rem;
		}
	}
</style>
