// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's direct manipulation, assembled (phase-2.md 7.1 to 7.3, 10.2; T16): `createManipulation`
 * builds the pieces that Gantt.svelte wires to its model, layout and selection, and the state
 * that the chart and the task list draw from them. It is called while the component initialises
 * (it sets up an effect), and reads the component through `ManipulationHost` getters.
 *
 * - `interactions` (keys, modes, row commands; `link`, `progress`, `renaming` live there), the
 *   `gestures` of the plot, the `rowDrag` of the task list and the palette's `chips` drag.
 * - `handles`: the selected bar's handles, with those the edit API would refuse hidden after one
 *   idle dry run each (7.3).
 * - `pendingGhosts`, `pendingKeys`: the bars the dispatcher holds as preview or pending.
 * - `people`, `booked`, `paletteView`: the palette (R6). `rowActions`: the row menu (R5).
 * - `focusKey`/`focusRow`, `selectedLinkIndex`: what the canvas rings and highlights.
 *
 * Nothing here changes the plan: every edit goes out through `interactions.actor`.
 *
 * Over 400 lines on purpose: the derived values all read the same host getters and one model,
 * and a class owns them so that Gantt.svelte stays a layout; the logic is in lib/gantt.
 */
import { untrack } from 'svelte';
import type { ScheduleResult } from '../../engine/protocol';
import { whenIdle } from '../../lib/gantt/analysis';
import { previewContext, workingTimeFor } from '../../lib/gantt/context';
import { handlesOf, type HandleSet } from '../../lib/gantt/handles';
import { hitTest } from '../../lib/gantt/hit';
import { resizeEdge, type ActionContext } from '../../lib/gantt/intents';
import type { GanttLayout, Metrics } from '../../lib/gantt/layout';
import type { GanttModel, GanttRow } from '../../lib/gantt/model';
import type { GestureLabel } from '../../lib/gantt/paint/gestures';
import type { Ghost } from '../../lib/gantt/preview';
import { rootsOf, stepTarget, type Step } from '../../lib/gantt/reorder';
import { sheetTopOf, visibleChart, type Box } from '../../lib/gantt/viewport';
import { assignable } from '../../lib/inspector/task';
import type { WorkingTime } from '../../lib/schedule/working-time';
import type { AppState } from '../../lib/state/app.svelte';
import type { ActionSource } from '../../lib/state/edits.svelte';
import type { OutlineNode } from '../../lib/state/outline';
import { gestureStrings } from '../../lib/strings';
import type { AddMode } from '../../lib/gantt/add-task';
import type { ZoneOffsets } from '../../lib/tjp/values/civil';
import { addTaskFlow } from './add-task-flow';
import { ChipDrag } from './chip-drag.svelte';
import { GanttGestures } from './gestures.svelte';
import { GanttInteractions, resourceOrder } from './interactions.svelte';

import { RowDrag } from './row-drag.svelte';
import type { Person, RowAction } from './types';

export interface RowActions {
	readonly actions: readonly RowAction[];
	readonly disabled: boolean;
	readonly onaction: (id: string) => void;
}

/** What the manipulation reads from Gantt.svelte, live. */
export interface ManipulationHost {
	readonly app: AppState;
	model(): GanttModel;
	layout(): GanttLayout;
	metrics(): Metrics;
	/** The result the chart draws. */
	result(): ScheduleResult | null;
	/** The result and its analysis, as the source of an action. */
	shown(): ActionSource;
	zones: ZoneOffsets;
	/** The selected task's row, or null. */
	selectedRow(): number | null;
	scroller(): HTMLElement | undefined;
	/** The plot's grid cell: content x = client x minus its left. */
	plotCell(): HTMLElement | undefined;
	/** The task list, for putting the focus on a row. */
	grid(): { focusRowByKey(key: string): boolean } | undefined;
	chartLeft(): number;
	announce(text: string): void;
	revealRow(index: number): Promise<void>;
	goToday(): boolean;
	/** A tap selects a row (a second tap, or the first on a desktop, opens the details); a drop never does. */
	select(row: number, drop?: boolean): void;
	zoom(): number;
	zoomTo(pxPerDay: number, anchorClientX: number): void;
	hover(row: number | null): void;
}

export class Manipulation {
	/** The row the keyboard focus is on in the task list, by key. */
	focusKey = $state<string | null>(null);
	readonly interactions: GanttInteractions;
	readonly gestures: GanttGestures;
	readonly rowDrag: RowDrag;
	readonly chips: ChipDrag;

	readonly #h: ManipulationHost;
	#refined = $state.raw<{ base: HandleSet; set: HandleSet } | null>(null);
	readonly #ctx: ActionContext | null;
	readonly #wt: WorkingTime | null;
	readonly #row: GanttRow | undefined;
	readonly #base: HandleSet;
	readonly #handles: HandleSet | null;
	readonly #people: Person[];
	readonly #booked: ReadonlySet<string>;
	readonly #palette: { row: number | null; ok: boolean; label: GestureLabel | null } | null;
	readonly #pending: Ghost[];
	readonly #pendingKeys: ReadonlySet<string>;
	readonly #link: number | null;
	readonly #focus: number | null;
	readonly #actions: RowActions;

	constructor(h: ManipulationHost) {
		this.#h = h;
		const app = h.app;
		// The context the previews are planned with: the index and the shown result (not the edit's).
		this.#ctx = $derived(previewContext(app.index, h.shown(), h.zones));
		this.#wt = $derived(this.#ctx?.wt ?? workingTimeFor(h.result(), h.zones));
		this.#row = $derived.by(() => {
			const i = h.selectedRow();
			return i === null ? undefined : h.model().rows[i];
		});
		this.#base = $derived(
			handlesOf(this.#row, this.#row?.id && this.#ctx ? resizeEdge(this.#row.id, this.#ctx) : null),
		);
		// The handles the edit API would refuse are hidden (7.3): one dry run each, in an idle task.
		$effect(() => {
			const set = this.#base;
			const id = untrack(() => this.#row?.id);
			const edits = app.edits;
			void app.index;
			if (!id || !edits || (set.resize === null && set.progress === null)) return;
			return whenIdle(() => {
				const src = untrack(() => h.shown());
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
					if (refuses({ type: 'progress', task: id, percent: to })) {
						next = { ...next, progress: null };
					}
				}
				this.#refined = { base: set, set: next };
			});
		});
		this.#handles = $derived(
			h.selectedRow() === null
				? null
				: this.#refined?.base === this.#base
					? this.#refined.set
					: this.#base,
		);

		this.interactions = new GanttInteractions({
			app,
			model: () => h.model(),
			shown: () => h.shown(),
			ctx: () => this.#ctx,
			wt: () => this.#wt,
			reveal: (i) => h.revealRow(i),
			today: () => h.goToday(),
			focusRowSoon: (key) => this.#focusRowSoon(key),
			announce: (t) => h.announce(t),
		});
		const links = this.interactions.links;
		this.gestures = new GanttGestures({
			actor: this.interactions.actor,
			links,
			model: () => h.model(),
			layout: () => h.layout(),
			origin: () => h.plotCell()?.getBoundingClientRect() ?? { left: 0, top: 0 },
			selectedRow: () => h.selectedRow(),
			handles: () => this.#handles,
			ctx: () => this.#ctx,
			wt: () => this.#wt,
			visible: () => this.visibleBox(),
			scroller: () => h.scroller(),
			select: (r, drop) => h.select(r, drop),
			selectLink: (i) => {
				const l = h.model().links[i];
				if (l) app.inspector.showLink(l.pred, l.succ);
			},
			showSource: (id) => (app.inspector.source = id),
			announce: (t) => h.announce(t),
			zoom: () => h.zoom(),
			zoomTo: (target, x) => h.zoomTo(target, x),
			hover: (r) => h.hover(r),
		});

		this.rowDrag = new RowDrag({
			rows: () => h.model().rows,
			tree: () => this.#tree,
			roots: () => this.#roots(),
			rowHeight: () => h.metrics().rowHeight,
			bodyTop: () =>
				(h.scroller()?.getBoundingClientRect().top ?? 0) +
				h.metrics().headerHeight -
				(h.scroller()?.scrollTop ?? 0),
			visible: () => this.visibleBox(),
			scroller: () => h.scroller(),
			nameOf: (k) =>
				h.model().rows[h.model().rowOf.get(k) ?? -1]?.name ?? this.#tree.get(k)?.name ?? k,
			open: (k) => {
				if (app.collapsed.has(k)) app.toggleNode(k);
			},
			move: (k, parent, index) => void this.interactions.moveTo(k, parent, index),
			announce: (t) => h.announce(t),
		});

		// The people palette (R6): the plan's people, in the result's order for the avatar colours.
		this.#people = $derived.by<Person[]>(() => {
			if (!app.index) return [];
			const order = resourceOrder(h.result());
			return assignable(app.index).map((r, i) => ({ ...r, index: order.get(r.id) ?? i }));
		});
		this.#booked = $derived(new Set(this.#row?.allocated ?? []));
		this.chips = new ChipDrag({
			rowAt: (x, y) => {
				// Only a bar that is on screen: not one under the palette, the header or a sheet.
				const v = this.visibleBox();
				if (x < v.left || x > v.right || y < v.top || y > v.bottom) return null;
				const o = h.plotCell()?.getBoundingClientRect();
				if (!o) return null;
				const hit = hitTest(h.layout(), h.model(), x - o.left, y - o.top);
				return hit.kind === 'bar' ? hit.row : null;
			},
			drop: (chip, row) => {
				const p = this.#people[chip];
				if (p) void this.interactions.assign(row, p.id);
			},
			announce: (t) => h.announce(t),
		});
		this.#palette = $derived.by(() => {
			const v = this.chips.view;
			if (!v) return null;
			const o = h.plotCell()?.getBoundingClientRect();
			const p = this.#people[v.chip];
			const task = v.row === null ? undefined : h.model().rows[v.row];
			// A container takes no people: say so while the chip is over it.
			const no = task?.kind === 'container';
			const label: GestureLabel | null =
				o && p && task
					? {
							text: no
								? gestureStrings.palette.container
								: gestureStrings.palette.over(p.name, task.name),
							x: v.x - o.left,
							y: v.y - o.top,
							blocked: no,
						}
					: null;
			return { row: v.row, ok: !no, label };
		});

		this.#pending = $derived.by<Ghost[]>(() => {
			const by = app.edits?.pending.byTask;
			if (!by || by.size === 0) return [];
			const m = h.model();
			const out: Ghost[] = [];
			for (const [task, bar] of by) {
				const i = m.rowOf.get(`task:${task}`);
				const r = i === undefined ? undefined : m.rows[i];
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
		this.#pendingKeys = $derived(
			new Set([...(app.edits?.pending.byTask.keys() ?? [])].map((t) => `task:${t}`)),
		);
		this.#link = $derived.by(() => {
			const l = app.inspector.link;
			if (!l) return null;
			const i = h.model().links.findIndex((x) => x.pred === l.pred && x.succ === l.succ);
			return i < 0 ? null : i;
		});
		this.#focus = $derived(
			this.focusKey === null ? null : (h.model().rowOf.get(this.focusKey) ?? null),
		);
		this.#actions = $derived.by(() => this.#rowActions());
		// While a link is made or a row is lifted the details sheet shrinks to a peek, so that the
		// rows stay in reach (phone, tablet); it gets its height back afterwards.
		$effect(() => {
			const busy = this.interactions.links.active || this.rowDrag.lifted;
			untrack(() => (busy ? app.inspector.peek() : app.inspector.unpeek()));
		});
	}

	get #tree(): ReadonlyMap<string, OutlineNode> {
		return this.#h.app.outline.byKey;
	}

	#roots(): string[] {
		return rootsOf(
			this.#tree,
			this.#h.app.outline.tasks.map((n) => n.key),
		);
	}

	// --- what the chart and the task list draw ------------------------------------------------

	get selectedHandles(): HandleSet | null {
		return this.#handles;
	}
	get people(): Person[] {
		return this.#people;
	}
	get booked(): ReadonlySet<string> {
		return this.#booked;
	}
	get hasTask(): boolean {
		return !!this.#row?.id;
	}
	get paletteView(): { row: number | null; ok: boolean; label: GestureLabel | null } | null {
		return this.#palette;
	}
	get pendingGhosts(): Ghost[] {
		return this.#pending;
	}
	get pendingKeys(): ReadonlySet<string> {
		return this.#pendingKeys;
	}
	get selectedLinkIndex(): number | null {
		return this.#link;
	}
	get focusRow(): number | null {
		return this.#focus;
	}
	get rowActions(): RowActions {
		return this.#actions;
	}

	/** Add task (+): a new task, selected, its details open with the name focused (add-task-flow.ts). */
	addTask(mode: AddMode): Promise<string | null> {
		const h = this.#h;
		return addTaskFlow(
			{
				app: h.app,
				add: (a) => this.interactions.actor.run({ type: 'add', ...a }),
				reveal: (key) => {
					const row = h.model().rowOf.get(key);
					if (row !== undefined) void h.revealRow(row);
				},
			},
			mode,
		);
	}

	/** Books a person on the selected task, or releases them (the palette's key path). */
	book(p: Person): void {
		const r = this.#row;
		if (r?.id) void this.interactions.book(r.id, p.id, p.name, this.#booked.has(p.id));
	}

	/** The visible chart in viewport px: minus the task column, the header and what covers it. */
	visibleBox(): Box {
		const h = this.#h;
		const r = h.scroller()?.getBoundingClientRect();
		if (!r) return { left: 0, top: 0, right: 0, bottom: 0 };
		const drawer = document.querySelector('[data-drawer]')?.getBoundingClientRect();
		return visibleChart(r, h.chartLeft(), h.metrics().headerHeight, {
			sheetTop: sheetTopOf(this.#h.app.inspector.sheetHeight, window.innerHeight),
			drawerLeft: drawer?.left ?? null,
		});
	}

	#focusRowSoon(key: string): void {
		let tries = 0;
		const attempt = (): void => {
			if (this.#h.grid()?.focusRowByKey(key) || ++tries > 30) return;
			requestAnimationFrame(attempt);
		};
		requestAnimationFrame(attempt);
	}

	/** The row menu (R5): the keys' commands as buttons. */
	#rowActions(): RowActions {
		const h = this.#h;
		const key = h.app.selectedTask;
		const can = (step: Step): boolean =>
			key !== null && stepTarget(this.#tree, key, step, this.#roots()) !== null;
		const R = gestureStrings.row;
		const k = (aria: string, show: string): { aria: string; show: string } => ({ aria, show });
		return {
			disabled: key === null || !h.model().rowOf.has(key),
			actions: [
				{ id: 'up', label: R.up, disabled: !can('up'), ...k('Alt+Shift+ArrowUp', 'Alt+Shift+↑') },
				{
					id: 'down',
					label: R.down,
					disabled: !can('down'),
					...k('Alt+Shift+ArrowDown', 'Alt+Shift+↓'),
				},
				{
					id: 'indent',
					label: R.indent,
					disabled: !can('indent'),
					...k('Alt+Shift+ArrowRight', 'Alt+Shift+→'),
				},
				{
					id: 'outdent',
					label: R.outdent,
					disabled: !can('outdent'),
					...k('Alt+Shift+ArrowLeft', 'Alt+Shift+←'),
				},
				{ id: 'longer', label: R.longer, ...k('Control+Alt+ArrowRight', 'Ctrl+Alt+→') },
				{ id: 'shorter', label: R.shorter, ...k('Control+Alt+ArrowLeft', 'Ctrl+Alt+←') },
				{ id: 'later', label: R.later, ...k('Alt+ArrowRight', 'Alt+→') },
				{ id: 'earlier', label: R.earlier, ...k('Alt+ArrowLeft', 'Alt+←') },
				{ id: 'link', label: R.link, ...k('L', 'L') },
				{ id: 'rename', label: R.rename, ...k('F2', 'F2') },
				{ id: 'add', label: R.add, ...k('Insert', 'Insert') },
				{ id: 'delete', label: R.delete, ...k('Delete', 'Delete') },
			],
			onaction: (id: string) => {
				if (key === null) return;
				const i = this.interactions;
				if (id === 'rename') i.startRename(key);
				else if (id === 'add') void i.add(key);
				else if (id === 'delete') void i.deleteTask(key);
				else if (id === 'link') i.beginLinkTap(key);
				else if (id === 'longer' || id === 'shorter') {
					void i.perform({ type: 'size', steps: id === 'longer' ? 1 : -1 }, key);
				} else if (id === 'later' || id === 'earlier') {
					void i.perform({ type: 'move', days: id === 'later' ? 1 : -1 }, key);
				} else void i.reorder(key, id as Step);
			},
		};
	}

	/** Delete with a link selected removes it (R4), wherever the focus is except a text field. */
	onWindowKey(e: KeyboardEvent): void {
		const links = this.interactions.links;
		if (e.key === 'Escape' && links.active && links.state?.via !== 'key') {
			links.cancel();
			return;
		}
		const app = this.#h.app;
		if (e.key !== 'Delete' || !app.inspector.link || e.defaultPrevented) return;
		const t = e.target;
		if (
			t instanceof Element &&
			t.closest('input, textarea, select, [contenteditable], .cm-editor')
		) {
			return;
		}
		const key = app.selectedTask ?? app.selectedRow ?? this.#h.model().rows[0]?.key;
		if (key) {
			e.preventDefault();
			void this.interactions.remove(key);
		}
	}
}

export function createManipulation(host: ManipulationHost): Manipulation {
	return new Manipulation(host);
}
