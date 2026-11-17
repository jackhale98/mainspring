<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!--
	The workload heatmap (phase-3.md 9.3, 8.1, 10; T14): people (rows) by day, week or month
	(columns), hours or percent per cell, bands from the design tokens, group rows that sum their
	members. One native scroll container holds a grid of three cells, which keeps the header and the
	name column in place with `position: sticky` (as the Gantt does): the time header on top (DOM
	text), the name column on the left (DOM, the visible rows only), the plot in the middle (two
	canvases holding a window of the content, heat-paint.ts) with the ARIA mirror over it.

	The heatmap never changes the schedule or the text. It draws the load model of the newest good
	result (heat-state.svelte.ts builds it in an idle task) and sends intents: a tap or click
	selects a cell (a desktop click, and a phone's second tap or long-press, also open its details),
	and a rebalance drag, the details' menus and the Alt+arrow keys become `RebalanceAction`s for
	the planner through rebalance-adapter.ts. While a newer schedule runs the picture dims, with no
	rebuild (`withDimmed`).

	Zoom is the bucket (Day, Week, Month): the toolbar, Ctrl+wheel and a trackpad pinch over the plot,
	a pinch of two fingers, and + and - in the grid. The cell under the pointer, or the middle of the
	view, stays where it is. Keyboard: the grid pattern (heat-mirror.ts `moveFocus`), Enter or Space
	for the details, Escape to close them.

	Over 400 lines on purpose: this one component owns the scroll container, the zoom and the focus
	and selection, and they only work together (as Gantt.svelte does); the logic is in lib/workload.
-->
<script lang="ts">
	import { flushSync, onMount, untrack, type Snippet } from 'svelte';
	import { GanttEnv } from '../gantt/gantt-env.svelte';
	import { ctrlWheel } from '../gantt/ctrl-wheel';
	import { OVERSCAN_ROWS, OVERSCAN_X, paintWindow, type PaintWindow } from '../../lib/gantt/layout';
	import { readMovePreference } from '../../lib/gantt/prefs';
	import { todayOf } from '../../lib/gantt/model';
	import type { GanttCalendar } from '../../lib/gantt/ticks';
	import type { ActionContext, MoveKind } from '../../lib/gantt/intents';
	import { workingTimeOf } from '../../lib/schedule/working-time';
	import type { AppState } from '../../lib/state/app.svelte';
	import { browserStorage } from '../../lib/state/storage';
	import { workloadStrings as W } from '../../lib/strings';
	import { cellDetails, cellInfo, cellName, type DetailTask } from '../../lib/workload/heat-cell';
	import { shiftOf } from '../../lib/workload/heat-drag';
	import { axisLabels } from '../../lib/workload/heat-labels';
	import { heatLayout, type Box, type Cell } from '../../lib/workload/heat-layout';
	import { buildMirror, mirrorRange, moveFocus, type Mirror } from '../../lib/workload/heat-mirror';
	import type { HeatLine } from '../../lib/workload/heat-paint';
	import { ZOOMS } from '../../lib/workload/heat-prefs';
	import { FALLBACK_HEAT_THEME, colWidthOf, heatThemeOf } from '../../lib/workload/heat-theme';
	import type { RebalanceAction } from '../../lib/workload/rebalance';
	import { checkRebalance } from '../../lib/workload/rebalance-check';
	import { dropTask } from '../../lib/workload/rebalance-drop';
	import type { BucketKind } from '../../lib/workload/types';
	import LazyMount from '../app/LazyMount.svelte';
	import Mark from '../app/Mark.svelte';
	import CellDetails from './CellDetails.svelte';
	import HeatGrid from './HeatGrid.svelte';
	import HeatHeader from './HeatHeader.svelte';
	import HeatNames from './HeatNames.svelte';
	import HeatPlot from './HeatPlot.svelte';
	import { HeatGestures } from './heat-gestures.svelte';
	import { HeatState } from './heat-state.svelte';
	import { Nudges, PLANNER, Rebalancer } from './rebalance-adapter';
	import { installWorkloadHook } from './test-hook';
	import WhichTask from './WhichTask.svelte';
	import WorkloadBar from './WorkloadBar.svelte';

	interface Props {
		app: AppState;
		/** A phone: the toolbar is a row of the view itself; elsewhere it is the People bar's. */
		phone: boolean;
		/** This is the view on screen (it stays mounted while another People view shows). */
		active: boolean;
		/** Puts this view's toolbar in the People bar (a desktop and a tablet). */
		setBar: (bar: Snippet | null) => void;
		/** Goes to the Gantt (the details' "Show in Gantt"). */
		showGantt: () => void;
	}
	let { app, phone, active, setBar, showGantt }: Props = $props();

	const loads = new HeatState();
	const env = new GanttEnv();
	let root: HTMLDivElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let plotCell: HTMLDivElement | undefined = $state();
	let scrollLeft = $state(0);
	let scrollTop = $state(0);
	let scrollerW = $state(0);
	let scrollerH = $state(0);
	/** The name column's width (a probe of its token), and the details sheet's height. */
	let namesW = $state(0);
	let sheetH = $state(0);

	// The plan's preferences; the model from the newest good result, built in an idle task.
	$effect(() => {
		const id = app.sampleId;
		untrack(() => loads.use(id));
	});
	$effect(() => loads.offer(app.run?.lastGood?.result ?? null, app.index));
	onMount(() => () => loads.dispose());

	const dimmed = $derived(app.run?.outdated ?? false);
	const model = $derived(loads.shown(dimmed));
	const prefs = $derived(loads.prefs);
	const result = $derived(loads.built?.result ?? null);
	const project = $derived(result?.project ?? null);
	const heat = $derived.by(() => {
		void env.theme;
		return root ? heatThemeOf(root) : FALLBACK_HEAT_THEME;
	});
	const cal = $derived<GanttCalendar | null>(
		project
			? {
					startEpoch: Date.parse(project.start) / 1000,
					env: { zone: project.timezone, zones: loads.zones },
				}
			: null,
	);
	const labels = $derived(model && cal ? axisLabels(cal, model.axis) : null);
	const taskNames = $derived(new Map((result?.tasks ?? []).map((t) => [t.id, t.name])));

	const layout = $derived(
		heatLayout(model?.rows.length ?? 0, model?.axis.count ?? 0, {
			rowHeight: heat.rowHeight,
			colWidth: colWidthOf(heat, prefs.zoom),
		}),
	);
	const headerH = $derived(2 * heat.headerRow);
	const viewW = $derived(Math.max(0, scrollerW - namesW));
	const viewH = $derived(Math.max(0, scrollerH - headerH));

	let paintWin = $state.raw<PaintWindow>({ x: 0, y: 0, w: 0, h: 0 });
	$effect(() => {
		const prev = untrack(() => paintWin);
		const rows = env.coarse ? 3 : OVERSCAN_ROWS;
		const next = paintWindow(
			{ x: scrollLeft, y: scrollTop, w: viewW, h: viewH },
			{ w: layout.width, h: layout.height },
			{ overscanX: OVERSCAN_X, overscanY: rows * heat.rowHeight },
			prev,
		);
		if (next !== prev) paintWin = next;
	});
	const firstRow = $derived(Math.max(0, Math.floor(scrollTop / heat.rowHeight) - OVERSCAN_ROWS));
	const lastRow = $derived(
		Math.min(layout.rows, Math.ceil((scrollTop + viewH) / heat.rowHeight) + OVERSCAN_ROWS),
	);

	// Today and the status date, as the Gantt's lines are: today solid, the status date dashed, one
	// solid line when they are within an hour. The clock is not in the model.
	const todayMin = $derived(todayOf(project, env.nowMs));
	const statusMin = $derived(
		project ? Math.round((Date.parse(project.now) - Date.parse(project.start)) / 60_000) : null,
	);
	const marks = $derived.by(() => {
		const out: Array<{ at: number; kind: HeatLine['kind'] }> = [];
		const merged = todayMin !== null && statusMin !== null && Math.abs(todayMin - statusMin) <= 60;
		if (merged) out.push({ at: statusMin as number, kind: 'both' });
		else {
			if (statusMin !== null) out.push({ at: statusMin, kind: 'status' });
			if (todayMin !== null) out.push({ at: todayMin, kind: 'today' });
		}
		return { list: out, merged };
	});
	const lines = $derived.by<HeatLine[]>(() => {
		if (!model) return [];
		const out: HeatLine[] = [];
		for (const m of marks.list) {
			const x = layout.xOfMinute(model.axis, m.at);
			if (x !== null) out.push({ x, kind: m.kind });
		}
		return out;
	});
	const lineState = (at: number | null): 'on' | 'off' | null =>
		at === null || !model ? null : layout.xOfMinute(model.axis, at) === null ? 'off' : 'on';
	const todayCol = $derived(todayMin !== null && model ? model.axis.indexOf(todayMin) : -1);

	// --- Selection and focus, by person and column; the row follows the model (a collapse moves it).
	let sel = $state.raw<{ id: string; col: number } | null>(null);
	let focusRef = $state.raw<{ id: string; col: number } | null>(null);
	let focusVisible = $state(false);
	let focusNonce = $state(0);
	let detailsOpen = $state(false);
	const rowOf = $derived(new Map((model?.rows ?? []).map((r, i) => [r.id, i])));
	const cellOf = (r: { id: string; col: number } | null): Cell | null => {
		const row = r ? rowOf.get(r.id) : undefined;
		return r && row !== undefined && r.col < layout.cols ? { row, col: r.col } : null;
	};
	const selected = $derived(cellOf(sel));
	const focus = $derived(cellOf(focusRef));
	const refOf = (c: Cell): { id: string; col: number } => ({
		id: model?.rows[c.row]?.id ?? '',
		col: c.col,
	});

	const lineOf = (c: Cell | null): string =>
		c && model && labels
			? cellName(
					cellInfo(model, labels, c.row, c.col, prefs.thresholds),
					prefs.unit,
					prefs.thresholds,
				)
			: '';
	const selectedLine = $derived(lineOf(selected));

	const details = $derived(
		detailsOpen && selected && model && labels && loads.built
			? cellDetails({
					model,
					labels,
					availability: loads.built.availability,
					thresholds: prefs.thresholds,
					row: selected.row,
					col: selected.col,
					taskName: (id) => taskNames.get(id) ?? id,
				})
			: null,
	);
	const people = $derived(
		(model?.rows ?? []).flatMap((r, row) => (r.group ? [] : [{ row, name: r.name }])),
	);
	const periods = $derived.by(() => {
		if (!labels || !selected) return [];
		const out: Array<{ col: number; text: string }> = [];
		const lo = Math.max(0, selected.col - 26);
		const hi = Math.min(layout.cols, selected.col + 27);
		for (let c = lo; c < hi; c++) out.push({ col: c, text: labels.period[c] ?? '' });
		return out;
	});

	function select(c: Cell): void {
		sel = refOf(c);
		focusRef = sel;
	}

	// --- The ARIA mirror: rebuilt when the model changes and 150 ms after a scroll stops.
	let mirror = $state.raw<Mirror | null>(null);
	let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
	function rebuildMirror(): void {
		if (!model || !labels || viewW <= 0) {
			mirror = null;
			return;
		}
		const visible = layout.range({ x: scrollLeft, y: scrollTop, w: viewW, h: viewH }, 0, 0);
		mirror = buildMirror({
			model,
			labels,
			thresholds: prefs.thresholds,
			unit: prefs.unit,
			range: mirrorRange(visible, focus),
		});
	}
	$effect(() => {
		void [model, labels, prefs.thresholds, prefs.unit, layout, viewW, viewH];
		untrack(rebuildMirror);
	});
	onMount(() => () => mirrorTimer && clearTimeout(mirrorTimer));

	function onscroll(): void {
		if (!scroller) return;
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
		gestures.scrolled();
		if (mirrorTimer) clearTimeout(mirrorTimer);
		mirrorTimer = setTimeout(rebuildMirror, 150);
	}

	/** Scrolls a cell into the visible part of the plot, with a little room. */
	function reveal(c: Cell): void {
		if (!scroller) return;
		const b = layout.box(c);
		const pad = 4;
		let left = scroller.scrollLeft;
		let top = scroller.scrollTop;
		if (b.x < left) left = b.x - pad;
		else if (b.x + b.w > left + viewW) left = b.x + b.w - viewW + pad;
		if (b.y < top) top = b.y - pad;
		else if (b.y + b.h > top + viewH) top = b.y + b.h - viewH + pad;
		scroller.scrollLeft = Math.max(0, left);
		scroller.scrollTop = Math.max(0, top);
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
	}

	/** Scrolls so that a cell is the plot's top left (the end-to-end gate walks the grid this way). */
	function scrollToCell(c: Cell): void {
		if (!scroller) return;
		scroller.scrollLeft = layout.colLeft(c.col);
		scroller.scrollTop = layout.rowTop(c.row);
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
	}

	function goToday(): boolean {
		if (!scroller || !model || todayMin === null) return false;
		const x = layout.xOfMinute(model.axis, todayMin);
		if (x === null) return false;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		scroller.scrollTo({ left: Math.max(0, x - viewW / 2), behavior: reduce ? 'auto' : 'smooth' });
		return true;
	}

	// --- Zoom: day, week, month. The minute under the anchor stays under it.
	let liveText = $state('');
	let flip = false;
	function announce(text: string): void {
		if (text === '') return;
		flip = !flip;
		liveText = flip ? text : `${text}​`;
	}

	function zoomTo(kind: BucketKind, anchorX = viewW / 2): void {
		if (kind === prefs.zoom || !scroller || !model) return;
		const m = model;
		const anchorMin = layout.minuteAtX(m.axis, scrollLeft + anchorX);
		const selMin = selected ? (m.axis.bounds[selected.col] as number) : null;
		const selId = sel?.id;
		const focusId = focusRef?.id;
		const focusMin = focus ? (m.axis.bounds[focus.col] as number) : null;
		flushSync(() => loads.setZoom(kind));
		const next = loads.built?.model;
		if (!next) return;
		const col = (min: number | null): number => (min === null ? -1 : next.axis.indexOf(min));
		sel = selId !== undefined && col(selMin) >= 0 ? { id: selId, col: col(selMin) } : null;
		focusRef =
			focusId !== undefined && col(focusMin) >= 0 ? { id: focusId, col: col(focusMin) } : null;
		const x = layout.xOfMinute(next.axis, anchorMin);
		scroller.scrollLeft = Math.max(0, (x ?? 0) - anchorX);
		scrollLeft = scroller.scrollLeft;
		announce(`${W.zoom}: ${W.level[kind]}`);
	}

	function stepZoom(dir: 1 | -1, clientX: number): void {
		const at = ZOOMS.indexOf(prefs.zoom) - dir;
		const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at))];
		if (!next || !scroller) return;
		zoomTo(next, Math.max(0, clientX - scroller.getBoundingClientRect().left - namesW));
	}

	let wheelAcc = 0;
	let wheelAt = 0;
	function onZoomWheel(e: WheelEvent): void {
		const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
		if (e.timeStamp - wheelAt > 300) wheelAcc = 0;
		wheelAt = e.timeStamp;
		wheelAcc += e.deltaY * unit;
		if (Math.abs(wheelAcc) < 60) return;
		const dir = wheelAcc < 0 ? 1 : -1;
		wheelAcc = 0;
		stepZoom(dir, e.clientX);
	}

	// --- Details, taps and keys
	function openDetails(c: Cell): void {
		select(c);
		detailsOpen = true;
	}

	function tap(c: Cell | null, touch: boolean): void {
		if (!c) return;
		const again = selected?.row === c.row && selected.col === c.col;
		select(c);
		// A click selects and shows the details; a finger's first tap selects, the second opens them.
		if (!touch || again || detailsOpen) detailsOpen = true;
	}

	function closeDetails(): void {
		const inside = !!document.activeElement?.closest('[data-testid="cell-details"]');
		detailsOpen = false;
		nudges.end();
		if (inside) focusNonce++;
	}

	function moveTo(next: Cell): void {
		focusRef = refOf(next);
		reveal(next);
		focusNonce++;
		untrack(rebuildMirror);
		if (detailsOpen) sel = focusRef;
	}

	function onkey(e: KeyboardEvent, c: Cell): void {
		if (!model) return;
		const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
		if (plain && (e.key === '+' || e.key === '=' || e.key === '-')) {
			e.preventDefault();
			stepZoom(
				e.key === '-' ? -1 : 1,
				(scroller?.getBoundingClientRect().left ?? 0) + namesW + viewW / 2,
			);
			return;
		}
		if (plain && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			openDetails(c);
			return;
		}
		if (e.key === 'Escape' && detailsOpen) {
			e.stopPropagation();
			closeDetails();
			return;
		}
		const next = moveFocus(
			c,
			{ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey },
			{
				rows: layout.rows,
				cols: layout.cols,
				page: Math.max(1, Math.floor(viewH / heat.rowHeight) - 1),
				today: todayCol >= 0 ? todayCol : null,
			},
		);
		if (!next) return;
		e.preventDefault();
		moveTo(next);
	}

	// --- Rebalance: drops, the details' menus and the Alt+arrow keys (rebalance-adapter.ts)
	let note = $state('');
	let moveAsk = $state.raw<{ suggested: MoveKind } | null>(null);
	let answer: ((k: MoveKind | null) => void) | null = null;
	let which = $state.raw<{
		label: string;
		tasks: Array<{ task: string; name: string; minutes: number }>;
		plan: (t: { task: string } | null) => { action: RebalanceAction | null };
	} | null>(null);

	function context(): ActionContext | null {
		const built = loads.built;
		const index = app.index;
		if (!built?.result.project || !index) return null;
		return {
			index,
			result: built.result,
			analysis: null,
			wt: workingTimeOf(built.result.project, loads.zones),
			zones: loads.zones,
			move: readMovePreference(browserStorage()),
		};
	}
	const rebalancer = new Rebalancer({
		planner: PLANNER,
		edits: () => app.edits,
		context,
		source: () => ({ result: loads.built?.result ?? null, analysis: null }),
		askMove: (suggested) =>
			new Promise((resolve) => {
				answer = resolve;
				moveAsk = { suggested };
			}),
		confirm: (m) => globalThis.confirm(m),
	});
	const nudges = new Nudges(rebalancer);

	async function perform(action: RebalanceAction | null): Promise<void> {
		if (!action) return;
		const r = await rebalancer.run(action);
		note = r.status === 'refused' ? r.message : '';
		if (r.status !== 'sent') announce(r.message);
	}

	function moveTask(t: DetailTask, to: { row: number } | { col: number }): void {
		if (!model || !selected) return;
		const from = model.rows[selected.row];
		if ('row' in to) {
			const target = model.rows[to.row];
			if (from && target)
				void perform({ type: 'reassign', task: t.task, from: from.id, to: target.id });
			return;
		}
		void perform(shiftOf(model, t.task, selected.col, to.col));
	}

	async function nudge(t: DetailTask, axis: 'person' | 'period', step: -1 | 1): Promise<void> {
		if (!model || !selected) return;
		const r =
			axis === 'person'
				? await nudges.person(model, t.task, selected, step)
				: await nudges.period(model, t.task, selected, step);
		if (r && r.status === 'refused') note = r.message;
	}

	function showInGantt(t: DetailTask): void {
		app.selection.selectTask(t.task, 'visual');
		showGantt();
	}

	function visibleBox(): Box {
		const r = scroller?.getBoundingClientRect();
		if (!r) return { x: 0, y: 0, w: 0, h: 0 };
		const sheet = detailsOpen && sheetH > 0 ? sheetH : 0;
		return {
			x: r.left + namesW,
			y: r.top + headerH,
			w: Math.max(0, r.width - namesW),
			h: Math.max(0, r.height - headerH - sheet),
		};
	}

	const gestures = new HeatGestures({
		layout: () => layout,
		model: () => model,
		labels: () => labels,
		origin: () => plotCell?.getBoundingClientRect() ?? { left: 0, top: 0 },
		scroller: () => scroller,
		visible: visibleBox,
		tap,
		open: openDetails,
		check: (action) => {
			// Planned and dry-run on the snapshot the index was built from (null while the text is ahead).
			const snap = app.workspace?.snapshot();
			const ctx = context();
			if (!snap || !ctx || ctx.index.version !== snap.version) return null;
			const o = checkRebalance(action, ctx, snap);
			return o.status === 'refused'
				? { ok: false, message: o.message }
				: { ok: true, message: null };
		},
		drop: (d) => {
			const pick = dropTask(d.tasks);
			if (pick.kind === 'none') return;
			if (pick.kind === 'one') {
				void perform(d.plan(d.tasks.find((t) => t.task === pick.task) ?? null).action);
				return;
			}
			which = {
				label: d.plan(null).label,
				tasks: d.tasks.map((t) => ({
					task: t.task,
					name: taskNames.get(t.task) ?? t.task,
					minutes: t.minutes,
				})),
				plan: (t) => d.plan(d.tasks.find((x) => x.task === t?.task) ?? null),
			};
		},
		zoomStep: stepZoom,
		announce,
	});

	const hoverLine = $derived(lineOf(gestures.hover));

	onMount(() => {
		const stop = root ? env.attach(root) : () => undefined;
		const hook = installWorkloadHook(new URLSearchParams(location.search), () => ({
			model,
			layout,
			result,
			origin: plotCell?.getBoundingClientRect() ?? { left: 0, top: 0 },
			scroller,
			zoom: prefs.zoom,
			reveal,
			scrollToCell,
			rebuildMirror,
		}));
		return () => {
			stop();
			hook();
			gestures.dispose();
		};
	});

	// The toolbar is the People bar's on a desktop and a tablet, and a row of this view on a phone.
	$effect(() => {
		if (!active || phone) return;
		setBar(toolbar);
		return () => setBar(null);
	});
	// A new plan or a changed frame: forget what is selected.
	$effect(() => {
		void app.sampleId;
		untrack(() => {
			sel = focusRef = null;
			detailsOpen = false;
		});
	});
</script>

{#snippet toolbar()}
	<WorkloadBar
		zoom={prefs.zoom}
		unit={prefs.unit}
		thresholds={prefs.thresholds}
		onzoom={(z) => zoomTo(z)}
		onunit={(u) => loads.setUnit(u)}
		onthresholds={(t) => loads.setThresholds(t)}
		ontoday={goToday}
		hasToday={todayCol >= 0}
		dimmed={model?.dimmed ?? false}
		hover={hoverLine}
		selected={selectedLine}
		lines={{ today: lineState(todayMin), status: lineState(statusMin), merged: marks.merged }}
		scope={phone ? 'phone' : 'bar'}
	/>
{/snippet}

<div
	class="workload"
	bind:this={root}
	role="region"
	tabindex="-1"
	aria-label={W.region}
	data-testid="workload"
	data-zoom={prefs.zoom}
	data-unit={prefs.unit}
	hidden={!active}
>
	<span class="probes" aria-hidden="true"><i bind:clientWidth={namesW}></i></span>
	{#if phone}{@render toolbar()}{/if}
	<div class="main" style:--sheet-h="{sheetH}px">
		<div
			class="scroller"
			bind:this={scroller}
			bind:clientWidth={scrollerW}
			bind:clientHeight={scrollerH}
			{onscroll}
			use:ctrlWheel={{ handler: onZoomWheel }}
		>
			{#if model}
				<div
					class="space"
					style:grid-template-columns="{namesW}px {layout.width}px"
					style:grid-template-rows="{headerH}px {layout.height}px"
					style:--load-names-w="{namesW}px"
					style:--load-header-row="{heat.headerRow}px"
				>
					<div class="head">
						<HeatHeader
							{labels}
							colWidth={layout.colWidth}
							winX={paintWin.x}
							winW={paintWin.w}
							width={layout.width}
							{lines}
						/>
					</div>
					<div class="names">
						<HeatNames
							rows={model.rows}
							first={firstRow}
							last={lastRow}
							rowHeight={heat.rowHeight}
							headerHeight={headerH}
							selectedRow={selected?.row ?? null}
							ontoggle={(id) => loads.toggleGroup(id)}
						/>
					</div>
					<div class="plot" class:dimmed={model.dimmed} bind:this={plotCell}>
						<HeatPlot
							{model}
							{layout}
							win={paintWin}
							thresholds={prefs.thresholds}
							unit={prefs.unit}
							{heat}
							theme={env.theme}
							dpr={env.dpr}
							{lines}
							{selected}
							focus={focusVisible ? focus : null}
							{gestures}
						/>
						{#if mirror}
							<HeatGrid
								{mirror}
								{layout}
								{focus}
								{focusNonce}
								{onkey}
								onfocuschange={(inside, c) => {
									focusVisible =
										inside && (document.activeElement?.matches(':focus-visible') ?? true);
									if (c && model) focusRef = refOf(c);
								}}
							/>
						{/if}
					</div>
				</div>
			{:else}
				<p class="scheduling" role="status" data-testid="heat-scheduling">
					<Mark size={44} busy />{W.scheduling}
				</p>
			{/if}
			<div class="inset" aria-hidden="true"></div>
		</div>
		{#if details}
			<div class="sheet" bind:clientHeight={sheetH}>
				<CellDetails
					{details}
					unit={prefs.unit}
					{people}
					{periods}
					{note}
					onclose={closeDetails}
					onmove={moveTask}
					onnudge={nudge}
					onnudgeend={() => nudges.end()}
					onshow={showInGantt}
				/>
			</div>
		{/if}
		{#if which}
			<WhichTask
				ask={which.label}
				tasks={which.tasks}
				onchoose={(task) => {
					const p = which?.plan({ task });
					which = null;
					void perform(p?.action ?? null);
				}}
				oncancel={() => {
					which = null;
					announce(W.rebalance.cancelled);
				}}
			/>
		{/if}
	</div>
	<p class="sr-only" role="status" aria-live="polite" data-testid="heat-live">{liveText}</p>
	<LazyMount
		when={moveAsk !== null}
		load={() => import('../gantt/MovePreferenceDialog.svelte')}
		props={{
			ask: moveAsk,
			onanswer: (k: MoveKind | null) => {
				moveAsk = null;
				answer?.(k);
				answer = null;
			},
		}}
		onfail={() => {
			moveAsk = null;
			answer?.(null);
		}}
	/>
</div>

<style>
	.workload {
		container: workload / inline-size;
		--load-names: 12rem;
		position: relative;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-block-size: 0;
		background: var(--color-gantt-surface);
	}
	.workload[hidden] {
		display: none;
	}
	.main {
		position: relative;
		flex: 1 1 0;
		min-block-size: 0;
		display: flex;
	}
	/* The one scroll container: pan on the plot, never chaining to the page. */
	.scroller {
		position: relative;
		flex: 1 1 0;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: none;
		-webkit-overflow-scrolling: touch;
	}
	/* As wide as its tracks: a sticky cell only stays in view inside its containing block. */
	.space {
		display: grid;
		position: relative;
		inline-size: max-content;
		min-inline-size: 100%;
	}
	.head {
		grid-area: 1 / 2;
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
		overflow: clip;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-surface-header);
	}
	.names {
		grid-area: 1 / 1 / 3 / 2;
		position: sticky;
		inset-inline-start: 0;
		z-index: 4;
		background: var(--color-gantt-surface);
	}
	.plot {
		grid-area: 2 / 2;
		position: relative;
		transition: opacity var(--motion-base);
	}
	/* A newer schedule is running: the picture dims, with no rebuild (withDimmed). */
	.plot.dimmed {
		opacity: var(--gantt-dim-opacity);
	}
	.scheduling {
		position: sticky;
		inset-inline-start: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-8) var(--gutter);
		color: var(--color-gantt-text-muted);
	}
	.probes {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}
	.probes i {
		display: block;
		block-size: 0;
		inline-size: var(--load-names);
	}
	.inset {
		display: none;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}
	.sheet :global(.details) {
		flex: 1 1 auto;
	}
	/* Wide: the details are a column beside the plot. Narrower: a bottom sheet over its foot. */
	@container workload (min-width: 760px) {
		.sheet {
			flex: none;
			inline-size: 22rem;
		}
	}
	@container workload (max-width: 759px) {
		.sheet {
			position: absolute;
			z-index: 12;
			inset-inline: 0;
			inset-block-end: 0;
			max-block-size: 55%;
			border-start-start-radius: var(--radius-sheet);
			border-start-end-radius: var(--radius-sheet);
			box-shadow: var(--shadow-raised);
			background: var(--color-surface);
			overflow: hidden;
		}
		.sheet :global(.details) {
			border-inline-start: 0;
			max-block-size: 100%;
		}
		/* Room to scroll the last rows above the sheet (WCAG 2.4.11). */
		.inset {
			display: block;
			block-size: var(--sheet-h);
		}
	}
	@media (max-width: 1023px) {
		.workload {
			--load-names: 10rem;
		}
	}
	@media (max-width: 599px) {
		.workload {
			--load-names: 6rem;
		}
	}
	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
