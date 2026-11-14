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
	Zoom is on the toolbar, with Ctrl+wheel and a trackpad pinch over the chart, and with + and -
	while the task list has the focus (never Ctrl+plus: that is the browser's own page zoom).

	The direct manipulation of phase-2.md 7.1 (T16) is wired here and lives beside it: the pointer
	events on the chart are `gestures.svelte.ts`, the keys, the link and progress modes and the
	row commands are `interactions.svelte.ts`, a row dragged by its grip is `row-drag.svelte.ts`,
	a person dragged from the palette is `chip-drag.svelte.ts`. Each ends in one action sent to the
	edit dispatcher (`app.edits`); the chart only draws previews and the pending bars it holds.

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

	Over 400 lines on purpose: this one component owns the scroll container, the zoom and the sticky
	grid, and they only work together; splitting them would spread one invariant over two files.
	The manipulation wiring (the block after `markers`) is derived state of the same model, layout
	and selection, so it stays beside them; the logic is in the classes named above and lib/gantt.

	Zoom is one step: the scale and the scroll offset are set together, so a single paint follows.
	A continuous Ctrl+wheel zoom first stretches the canvases with a CSS transform about the point
	under the pointer, and paints once when the wheel has been still for a moment.
-->
<script lang="ts">
	import { flushSync, onMount, tick, untrack } from 'svelte';
	import { createTimeZoneHost } from '../../engine/timezone';
	import { finishScenario } from '../../lib/schedule/finish';
	import { whenIdle } from '../../lib/gantt/analysis';
	import { RescheduleAnnouncer } from '../../lib/gantt/announce';
	import { previewContext, workingTimeFor } from '../../lib/gantt/context';
	import { handlesOf, type HandleSet } from '../../lib/gantt/handles';
	import { hitTest } from '../../lib/gantt/hit';
	import { resizeEdge } from '../../lib/gantt/intents';
	import type { Ghost } from '../../lib/gantt/preview';
	import { rootsOf, stepTarget, type Step } from '../../lib/gantt/reorder';
	import { sheetTopOf, visibleChart, type Box } from '../../lib/gantt/viewport';
	import { assignable } from '../../lib/inspector/task';
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
	import type { OutlineNode } from '../../lib/state/outline';
	import { clampRatio } from '../../lib/state/split';
	import { gestureStrings, strings } from '../../lib/strings';
	import { ChipDrag } from './chip-drag.svelte';
	import { ctrlWheel } from './ctrl-wheel';
	import { GanttGestures } from './gestures.svelte';
	import { GanttInteractions, resourceOrder } from './interactions.svelte';
	import { installGanttHook } from './test-hook';
	import MovePreferenceDialog from './MovePreferenceDialog.svelte';
	import PeoplePalette, { type Person } from './PeoplePalette.svelte';
	import { RowDrag } from './row-drag.svelte';
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
	/** The plot's grid cell: content x = client x minus its left (the gestures' origin). */
	let plotCell: HTMLDivElement | undefined = $state();
	let grid: OutlineGrid | undefined = $state();
	/** The row the keyboard focus is on in the task list. */
	let focusKey = $state<string | null>(null);
	let paletteOpen = $state(true);
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

	// --- Direct manipulation (phase-2.md 7.1 to 7.3, 10.2; T16) ---------------------------------
	/** What the Gantt says aloud (the treegrid's live region): a new sentence is spoken once. */
	let flip = false;
	function announce(text: string): void {
		flip = !flip;
		announcement = flip ? text : `${text}​`;
	}

	// The context the previews are planned with: the index and the shown result (not the edit's).
	const actionCtx = $derived(previewContext(app.index, critical.shown, zones));
	const workTime = $derived(actionCtx?.wt ?? workingTimeFor(result, zones));
	const selectedKeyRow = $derived(selectedRow === null ? undefined : model.rows[selectedRow]);
	const baseHandles = $derived(
		handlesOf(
			selectedKeyRow,
			selectedKeyRow?.id && actionCtx ? resizeEdge(selectedKeyRow.id, actionCtx) : null,
		),
	);
	// The handles the edit API would refuse are hidden (7.3): one dry run each, in an idle task.
	let refined = $state.raw<{ base: HandleSet; set: HandleSet } | null>(null);
	$effect(() => {
		const set = baseHandles;
		const id = untrack(() => selectedKeyRow?.id);
		const edits = app.edits;
		void app.index;
		if (!id || !edits || (set.resize === null && set.progress === null)) return;
		return whenIdle(() => {
			const src = untrack(() => critical.shown);
			const refuses = (a: Parameters<typeof edits.check>[0]): boolean => {
				const o = edits.check(a, src);
				return o?.status === 'refused' && o.reason !== 'at-limit';
			};
			let next = set;
			if (set.resize !== null && refuses({ type: 'size-step', task: id, steps: 1 })) {
				next = { ...next, resize: null };
			}
			if (set.progress !== null) {
				const to = set.progress >= 100 ? 95 : set.progress + 5;
				if (refuses({ type: 'progress', task: id, percent: to }))
					next = { ...next, progress: null };
			}
			refined = { base: set, set: next };
		});
	});
	const handles = $derived(
		selectedRow === null ? null : refined?.base === baseHandles ? refined.set : baseHandles,
	);

	function visibleBox(): Box {
		const r = scroller?.getBoundingClientRect();
		if (!r) return { left: 0, top: 0, right: 0, bottom: 0 };
		const drawer = document.querySelector('[data-drawer]')?.getBoundingClientRect();
		return visibleChart(r, chartLeft, metrics.headerHeight, {
			sheetTop: sheetTopOf(app.inspector.sheetHeight, window.innerHeight),
			drawerLeft: drawer?.left ?? null,
		});
	}

	function focusRowSoon(key: string): void {
		let tries = 0;
		const attempt = (): void => {
			if (grid?.focusRowByKey(key) || ++tries > 30) return;
			requestAnimationFrame(attempt);
		};
		requestAnimationFrame(attempt);
	}

	// svelte-ignore state_referenced_locally
	const interactions = new GanttInteractions({
		app,
		model: () => model,
		shown: () => critical.shown,
		ctx: () => actionCtx,
		wt: () => workTime,
		reveal: revealRow,
		today: goToday,
		focusRowSoon,
		announce,
	});
	const links = interactions.links;

	function selectLink(i: number): void {
		const l = model.links[i];
		if (l) app.inspector.showLink(l.pred, l.succ);
	}

	/** Zooms about a viewport x (a pinch): shown at once, painted when the fingers pause. */
	function pinchTo(target: number, clientX: number): void {
		if (!scroller) return;
		const x = clientX - scroller.getBoundingClientRect().left - chartLeft;
		zoomPreview.step(clampZoom(target), Math.max(0, x));
	}

	const gestures = new GanttGestures({
		actor: interactions.actor,
		links,
		model: () => model,
		layout: () => layout,
		origin: () => plotCell?.getBoundingClientRect() ?? { left: 0, top: 0 },
		selectedRow: () => selectedRow,
		handles: () => handles,
		ctx: () => actionCtx,
		wt: () => workTime,
		visible: visibleBox,
		scroller: () => scroller,
		select: selectRow,
		selectLink,
		showSource: (id) => (app.inspector.source = id),
		announce,
		zoom: () => zoomPreview.target ?? pxPerDay,
		zoomTo: pinchTo,
		hover: (r) => (hoverRow = r),
	});

	// Dragging a row by its grip (R5).
	const rowTree = (): ReadonlyMap<string, OutlineNode> => app.outline.byKey;
	const roots = (): string[] =>
		rootsOf(
			rowTree(),
			app.outline.tasks.map((n) => n.key),
		);
	const rowDrag = new RowDrag({
		rows: () => model.rows,
		tree: rowTree,
		roots,
		rowHeight: () => metrics.rowHeight,
		bodyTop: () =>
			(scroller?.getBoundingClientRect().top ?? 0) +
			metrics.headerHeight -
			(scroller?.scrollTop ?? 0),
		visible: visibleBox,
		scroller: () => scroller,
		nameOf: (k) => model.rows[model.rowOf.get(k) ?? -1]?.name ?? rowTree().get(k)?.name ?? k,
		open: (k) => {
			if (app.collapsed.has(k)) app.toggleNode(k);
		},
		move: (k, parent, index) => void interactions.moveTo(k, parent, index),
		announce,
	});

	// The people palette (R6): the plan's people, in the result's order for the avatar colours.
	const people = $derived.by<Person[]>(() => {
		if (!app.index) return [];
		const order = resourceOrder(result);
		return assignable(app.index).map((r, i) => ({ ...r, index: order.get(r.id) ?? i }));
	});
	const booked = $derived(new Set(selectedKeyRow?.allocated ?? []));
	const chips = new ChipDrag({
		rowAt: (x, y) => {
			const o = plotCell?.getBoundingClientRect();
			if (!o) return null;
			const hit = hitTest(layout, model, x - o.left, y - o.top);
			return hit.kind === 'bar' ? hit.row : null;
		},
		drop: (chip, row) => {
			const p = people[chip];
			if (p) void interactions.assign(row, p.id);
		},
		announce,
	});
	const paletteView = $derived.by(() => {
		const v = chips.view;
		if (!v) return null;
		const o = plotCell?.getBoundingClientRect();
		const p = people[v.chip];
		const task = v.row === null ? undefined : model.rows[v.row];
		const label =
			o && p && task
				? {
						text: gestureStrings.palette.over(p.name, task.name),
						x: v.x - o.left,
						y: v.y - o.top,
						blocked: false,
					}
				: null;
		return { row: v.row, label };
	});

	/** The bars the dispatcher holds as preview or pending (a dropped drag, a key nudge). */
	const pendingGhosts = $derived.by<Ghost[]>(() => {
		const by = app.edits?.pending.byTask;
		if (!by || by.size === 0) return [];
		const out: Ghost[] = [];
		for (const [task, bar] of by) {
			const i = model.rowOf.get(`task:${task}`);
			const r = i === undefined ? undefined : model.rows[i];
			if (i === undefined || !r || r.start === null || r.end === null) continue;
			out.push({
				row: i,
				start: bar.mark.start ?? r.start,
				end: bar.mark.end ?? r.end,
				state: bar.state,
				complete: bar.mark.complete ?? null,
			});
		}
		return out;
	});
	const pendingKeys = $derived(
		new Set([...(app.edits?.pending.byTask.keys() ?? [])].map((t) => `task:${t}`)),
	);
	const selectedLinkIndex = $derived.by(() => {
		const l = app.inspector.link;
		if (!l) return null;
		const i = model.links.findIndex((x) => x.pred === l.pred && x.succ === l.succ);
		return i < 0 ? null : i;
	});
	const focusRow = $derived(focusKey === null ? null : (model.rowOf.get(focusKey) ?? null));

	// The row menu (R5): the keys' commands as buttons.
	const rowActions = $derived.by(() => {
		const key = app.selectedTask;
		const can = (step: Step): boolean =>
			key !== null && stepTarget(rowTree(), key, step, roots()) !== null;
		const R = gestureStrings.row;
		return {
			disabled: key === null || !model.rowOf.has(key),
			actions: [
				{ id: 'up', label: R.up, disabled: !can('up') },
				{ id: 'down', label: R.down, disabled: !can('down') },
				{ id: 'indent', label: R.indent, disabled: !can('indent') },
				{ id: 'outdent', label: R.outdent, disabled: !can('outdent') },
				{ id: 'rename', label: R.rename },
				{ id: 'add', label: R.add },
				{ id: 'delete', label: R.delete },
			],
			onaction: (id: string) => {
				if (key === null) return;
				if (id === 'rename') interactions.startRename(key);
				else if (id === 'add') void interactions.add(key);
				else if (id === 'delete') void interactions.deleteTask(key);
				else void interactions.reorder(key, id as Step);
			},
		};
	});

	/** Delete with a link selected removes it (R4), wherever the focus is except a text field. */
	function onwindowkeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && links.active && links.state?.via !== 'key') {
			links.cancel();
			return;
		}
		if (e.key !== 'Delete' || !app.inspector.link || e.defaultPrevented) return;
		const t = e.target;
		if (
			t instanceof Element &&
			t.closest('input, textarea, select, [contenteditable], .cm-editor')
		) {
			return;
		}
		const key = app.selectedTask ?? model.rows[0]?.key;
		if (key) {
			e.preventDefault();
			void interactions.remove(key);
		}
	}

	onMount(() =>
		installGanttHook(new URLSearchParams(location.search), () => ({
			model,
			layout,
			origin: plotCell?.getBoundingClientRect() ?? { left: 0, top: 0 },
			pxPerDay,
			scroller,
		})),
	);

	function onscroll(): void {
		if (!scroller) return;
		scrollLeft = scroller.scrollLeft;
		scrollTop = scroller.scrollTop;
		gestures.scrolled();
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

	function goToday(): boolean {
		if (markers.target === null || !scroller) return false;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		scroller.scrollTo({
			left: Math.max(0, scale.x(markers.target) - viewW / 2),
			behavior: reduce ? 'auto' : 'smooth',
		});
		return true;
	}

	/** Scrolls a row into view below the sticky header. */
	async function revealRow(index: number): Promise<void> {
		if (!scroller) return;
		scroller.scrollTop = revealTop(index, metrics.rowHeight, scroller.scrollTop, viewH);
		scrollTop = scroller.scrollTop;
		await tick();
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

<svelte:window onkeydown={onwindowkeydown} />

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
		people={env.coarse
			? undefined
			: { open: paletteOpen, count: people.length, ontoggle: () => (paletteOpen = !paletteOpen) }}
		{rowActions}
		onpill={(h) => (pillH = h)}
	/>
	<!-- Link mode (R3): what to do, and the way out for a pointer that has no Escape. It floats
	     over the top of the chart (a zero-height anchor), so entering the mode moves nothing. -->
	<div class="banner-anchor">
		{#if links.state && links.state.via !== 'drag'}
			<div class="banner" role="status" data-testid="link-banner">
				<span>{gestureStrings.link.banner(links.state.name)}</span>
				<button
					type="button"
					onclick={() => links.cancel()}
					aria-label={gestureStrings.link.cancelLabel}
				>
					{gestureStrings.link.cancel}
				</button>
			</div>
		{/if}
	</div>
	{#if paletteOpen && !env.coarse && !phone && people.length > 0}
		<PeoplePalette
			{people}
			{booked}
			hasTask={selectedKeyRow?.id !== undefined && selectedKeyRow.id !== null}
			drag={chips}
			onbook={(p) => {
				const r = selectedKeyRow;
				if (r?.id) void interactions.book(r.id, p.id, p.name, booked.has(p.id));
			}}
		/>
	{/if}

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
						pending={pendingKeys}
						bind:this={grid}
						renaming={interactions.renaming}
						onrename={(k) => interactions.startRename(k)}
						onrenamed={(k, n) => void interactions.finishRename(k, n)}
						oncancelrename={() => interactions.cancelRename()}
						onkeycmd={(e, k) => interactions.key(e, k)}
						onfocusrow={(k) => {
							focusKey = k;
							interactions.focusMoved(k);
						}}
						{rowDrag}
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
				<div class="plot" style:--gantt-names="{chartLeft}px" bind:this={plotCell}>
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
						{gestures}
						{handles}
						pending={pendingGhosts}
						link={links.state}
						selectedLink={selectedLinkIndex}
						{focusRow}
						within={{ left: scrollLeft, right: scrollLeft + viewW }}
						palette={paletteView}
					/>
				</div>
			</div>
			<!-- Room to scroll the last rows above the details sheet (inspector, WCAG 2.4.11). -->
			<div class="inset" aria-hidden="true" style:block-size="{app.inspector.sheetHeight}px"></div>
		</div>
	{/if}
	<MovePreferenceDialog
		ask={interactions.actor.ask}
		onanswer={(k) => interactions.actor.answer(k)}
	/>
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
	/* Link mode's banner floats over the top of the chart, with the way out for a finger. */
	.banner-anchor {
		flex: none;
		position: relative;
		z-index: 8;
		block-size: 0;
	}
	.banner {
		position: absolute;
		inset-inline: 0;
		inset-block-start: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) 14px;
		border-block-end: 1px solid var(--color-gantt-border);
		background: var(--color-gantt-accent);
		color: var(--color-gantt-accent-text);
		font-size: var(--text-sm);
	}
	.banner button {
		min-block-size: 32px;
		padding-inline: var(--space-3);
		border: 1px solid currentColor;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.banner button:focus-visible {
		outline: 3px solid var(--color-gantt-accent-text);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.banner button {
			min-block-size: var(--size-tap);
		}
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
