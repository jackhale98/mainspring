<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The read-only Gantt (phase-2.md 8.1, 9): a toolbar and one native scroll container holding a
	grid of four cells, which is what makes scrolling smooth and keeps the header and the task
	column in place with `position: sticky`: the corner and the time header on top, the task list on
	the left, the plot (three canvases) in the middle. Rows are virtualised: the task list mounts
	the rows near the viewport, the canvases hold a window of the content (layout.ts).

	The Gantt never changes the schedule or the text. It draws the model built from the newest
	good result (model.ts) and, on a tap or a click, asks the app to select a task, which puts the
	editor cursor on its declaration. Gestures and the inspector (T16, T17) come later; zoom is on
	the toolbar, Ctrl+wheel and Ctrl+plus/minus until the pinch gesture exists.
-->
<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { createTimeZoneHost } from '../../engine/timezone';
	import { finishScenario } from '../../lib/schedule/finish';
	import { describeRow } from '../../lib/gantt/describe';
	import { linksFromIndex, mergeEngineLinks } from '../../lib/gantt/links';
	import {
		OVERSCAN_ROWS,
		OVERSCAN_X,
		createLayout,
		metricsFor,
		paintWindow,
		type PaintWindow,
	} from '../../lib/gantt/layout';
	import { buildGanttModel } from '../../lib/gantt/model';
	import { clearTextCache, effectiveDpr } from '../../lib/gantt/paint/canvas';
	import { FALLBACK_THEME, themeOf, type Theme } from '../../lib/gantt/paint/theme';
	import {
		DEFAULT_ZOOM,
		ZOOM_PRESETS,
		clampZoom,
		createScale,
		nearestLevel,
		scrollAfterZoom,
		zoomIn,
		zoomOut,
	} from '../../lib/gantt/scale';
	import { ticksFor } from '../../lib/gantt/ticks';
	import type { AppState } from '../../lib/state/app.svelte';
	import { strings } from '../../lib/strings';
	import GanttToolbar from './GanttToolbar.svelte';
	import OutlineColumn from './OutlineColumn.svelte';
	import TimeHeader from './TimeHeader.svelte';
	import Timeline from './Timeline.svelte';

	let { app }: { app: AppState } = $props();

	const zones = createTimeZoneHost();
	let root: HTMLDivElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let pxPerDay = $state(ZOOM_PRESETS[DEFAULT_ZOOM]);
	let scrollLeft = $state(0);
	let scrollTop = $state(0);
	let scrollerW = $state(0);
	let scrollerH = $state(0);
	let namesW = $state(0);
	let coarse = $state(false);
	let dpr = $state(1);
	let theme = $state.raw<Theme>(FALLBACK_THEME);
	let nowMs = $state(Date.now());
	let hoverRow = $state<number | null>(null);

	// The model: rows from the outline joined with the newest good result (never computed here).
	const result = $derived(app.run?.lastGood?.result ?? null);
	const model = $derived.by(() => {
		const scenario = result ? finishScenario(result) : null;
		return buildGanttModel({
			nodes: app.outline.tasks,
			collapsed: app.collapsed,
			result,
			dimmed: app.run?.outdated ?? false,
			links: mergeEngineLinks(
				linksFromIndex(app.index?.dependencies ?? [], scenario),
				result,
				scenario,
			),
			analysis: null,
			nowMs,
			zones,
		});
	});

	const metrics = $derived(metricsFor(theme, coarse));
	const scale = $derived(createScale(pxPerDay, model.originMin));
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

	function onscroll(): void {
		if (!scroller) return;
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
	}

	/** Zooms around a point of the viewport (its centre by default), keeping its date in place. */
	async function zoomTo(next: number, anchorX = viewW / 2): Promise<void> {
		const target = clampZoom(next);
		if (target === pxPerDay || !scroller) return;
		const anchorMin = scale.m(scrollLeft + anchorX);
		pxPerDay = target;
		await tick();
		if (scroller) {
			scroller.scrollLeft = scrollAfterZoom(
				createScale(target, model.originMin),
				anchorMin,
				anchorX,
			);
		}
	}

	function goToday(): void {
		const at = model.todayMin ?? model.statusMin;
		if (at === null || !scroller) return;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		scroller.scrollTo({
			left: Math.max(0, scale.x(at) - viewW / 2),
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

	function onkeydown(event: KeyboardEvent): void {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
		if (event.key === '=' || event.key === '+') {
			event.preventDefault();
			void zoomTo(zoomIn(pxPerDay));
		} else if (event.key === '-') {
			event.preventDefault();
			void zoomTo(zoomOut(pxPerDay));
		}
	}

	onMount(() => {
		const read = (): void => {
			if (root) theme = themeOf(root);
		};
		const scheme = matchMedia('(prefers-color-scheme: dark)');
		const pointer = matchMedia('(pointer: coarse)');
		const onScheme = (): void => void requestAnimationFrame(read);
		const onPointer = (): void => {
			coarse = pointer.matches;
			// The coarse-pointer sizes are token overrides: resolve the theme again.
			requestAnimationFrame(read);
		};
		let resolution: MediaQueryList | null = null;
		const onResolution = (): void => {
			dpr = effectiveDpr(devicePixelRatio);
			watchResolution();
		};
		function watchResolution(): void {
			resolution?.removeEventListener('change', onResolution);
			resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
			resolution.addEventListener('change', onResolution);
		}
		read();
		onPointer();
		dpr = effectiveDpr(devicePixelRatio);
		watchResolution();
		scheme.addEventListener('change', onScheme);
		pointer.addEventListener('change', onPointer);
		void document.fonts?.ready.then(() => {
			clearTextCache();
			read();
		});
		const clock = setInterval(() => (nowMs = Date.now()), 60_000);
		const onWheel = (e: WheelEvent): void => {
			if (!(e.ctrlKey || e.metaKey) || !scroller) return;
			e.preventDefault();
			const x = e.clientX - scroller.getBoundingClientRect().left - namesW;
			void zoomTo(pxPerDay * Math.exp(-e.deltaY * 0.002), Math.max(0, x));
		};
		scroller?.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			scheme.removeEventListener('change', onScheme);
			pointer.removeEventListener('change', onPointer);
			resolution?.removeEventListener('change', onResolution);
			scroller?.removeEventListener('wheel', onWheel);
			clearInterval(clock);
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
		hasMarker={(model.todayMin ?? model.statusMin) !== null}
		lines={{
			today: model.todayMin !== null,
			status: model.statusMin !== null,
			merged:
				model.todayMin !== null &&
				model.statusMin !== null &&
				Math.abs(model.todayMin - model.statusMin) <= 60,
		}}
		dimmed={model.dimmed}
		onzoomin={() => zoomTo(zoomIn(pxPerDay))}
		onzoomout={() => zoomTo(zoomOut(pxPerDay))}
		ontoday={goToday}
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
		>
			<div
				class="space"
				style:grid-template-columns="var(--gantt-names) {layout.width}px"
				style:grid-template-rows="{metrics.headerHeight}px {layout.height}px"
			>
				<div class="corner">{strings.gantt.taskColumn}</div>
				<div class="head">
					<TimeHeader {model} {layout} win={paintWin} {ticks} {theme} {dpr} {scrollLeft} />
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
					{#if !model.scheduled}
						<p class="placeholder" role="status" style:width="{viewW}px">
							{strings.gantt.scheduling}
						</p>
					{/if}
					<Timeline
						{model}
						{layout}
						win={paintWin}
						{ticks}
						{theme}
						{dpr}
						{selectedRow}
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
		--gantt-names: var(--size-gantt-names);
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
	.scroller {
		position: relative;
		flex: 1 1 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}
	.space {
		display: grid;
		position: relative;
	}
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
		padding: var(--space-1) var(--space-2);
		border-inline-end: 1px solid var(--color-gantt-border);
		color: var(--color-gantt-text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.head {
		grid-area: 1 / 2;
		z-index: 3;
		overflow: hidden;
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
	.placeholder {
		position: sticky;
		inset-inline-start: var(--gantt-names);
		z-index: 1;
		box-sizing: border-box;
		block-size: 0;
		margin: 0;
		padding-block-start: var(--space-6);
		overflow: visible;
		text-align: center;
		color: var(--color-gantt-text-muted);
		pointer-events: none;
	}
	@media (max-width: 1023px) {
		.gantt {
			--gantt-names: 14rem;
		}
	}
	@media (max-width: 599px) {
		.gantt {
			--gantt-names: 7rem;
		}
	}
</style>
