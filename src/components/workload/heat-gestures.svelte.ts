// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's pointer wiring (phase-3.md 7.1 W1 and W2, 7.2, 12; src/lib/gesture/README.md):
 * DOM pointer events on the overlay canvas become `GestureInput`s for the shared gesture machine
 * (src/lib/gesture/, unchanged), and its outputs become the hover, a tap, a lifted cell, the
 * rebalance drag's ghost and one drop. The machine owns every rule (slop, the 350 ms long-press,
 * pinch, Escape, the lost-release checks); this file translates the DOM into it and acts on what
 * comes out. The controller of the Gantt is not used: its drag modes are about time on a bar.
 *
 * - A target is a cell, as one number (`cellId`), so a double tap and the machine's own tap
 *   bookkeeping work per cell.
 * - **Mouse and pen:** a press on a cell with a movable task drags after 3 px; a click selects the
 *   cell and opens its details; a hover outlines the cell.
 * - **Touch:** `touch-action: pan-x pan-y` keeps one-finger panning native; a press that moves
 *   first is a pan. A tap selects, a second tap opens the details; a long-press lifts the cell,
 *   then a drag rebalances, and letting go without moving opens the details. A cell with no
 *   movable task opens its details at the long-press.
 * - **Pinch** steps the zoom one level per `PINCH_STEP` of scale (day, week, month).
 * - The drag **locks to an axis** past the slop (heat-drag.ts): rows change the person, columns the
 *   period. The label by the pointer is visual; nothing is dispatched until the drop, and the drop
 *   is the host's (it may ask "Move which task?").
 * - Edge auto-scroll while dragging, against the visible plot (up to 600 px/s).
 *
 * Over 400 lines on purpose: one class owns the DOM events, the machine and the drag state they
 * share (`#session`, `#pointer`, the timers), as the Gantt's gestures class does; the pure rules are
 * in lib/workload/heat-drag.ts and lib/gesture.
 *
 * Nothing here changes the plan.
 */
import { autoScrollVelocity } from '../../lib/gesture/autoscroll';
import { createGestureMachine } from '../../lib/gesture/machine';
import type {
	GestureInput,
	GestureMachine,
	GestureOutput,
	GestureTarget,
	Modifiers,
	PointerKind,
} from '../../lib/gesture/types';
import { workloadStrings as W } from '../../lib/strings-workload';
import { dragPlan, movableTasks, targetOf, type DragPlan } from '../../lib/workload/heat-drag';
import type { RebalanceAction } from '../../lib/workload/rebalance';
import { lockAxis, type RebalanceAxis } from '../../lib/workload/rebalance-drop';
import type { AxisLabels } from '../../lib/workload/heat-labels';
import { cellId, type Box, type Cell, type HeatLayout } from '../../lib/workload/heat-layout';
import type { DragMark } from '../../lib/workload/heat-paint';
import type { CellTask, LoadModel } from '../../lib/workload/types';

/** One zoom level for each time the pinch scale grows or shrinks by this factor. */
export const PINCH_STEP = 1.5;
const SLOP = { mouse: 3, pen: 4, touch: 8 } as const;

/**
 * What a press hits: the cell it is in, and the tasks a drag from it moves. The heatmap's target is
 * a cell (every movable task in it, `key` the cell's number); a lane's is a bar (its one task, or
 * none for a text-only bar or empty lane space, `key` the bar's own number, so two bars in one
 * period are two targets). `ref` is the host's own (the lanes' bar), handed back with a tap.
 */
export interface PressTarget {
	/** One number per target: the machine's tap bookkeeping and its hit are by it. */
	readonly key: number;
	readonly cell: Cell;
	readonly tasks: readonly CellTask[];
	readonly ref?: unknown;
}

export interface HeatHost {
	/**
	 * What is under a content point, when it is not just the cell (the lanes: a bar). Without it the
	 * target is the cell and every movable task it holds (the heatmap).
	 */
	target?(x: number, y: number): PressTarget | null;
	/** What announces a lifted target (the lanes name the bar's task); default: the person's. */
	liftedText?(target: PressTarget): string;
	layout(): HeatLayout;
	model(): LoadModel | null;
	labels(): AxisLabels | null;
	/** The plot's own box: content x = client x minus its left, content y likewise. */
	origin(): { readonly left: number; readonly top: number };
	scroller(): HTMLElement | undefined;
	/** The visible plot in viewport px, minus what a sheet covers. */
	visible(): Box;
	/** A click or tap on a cell (null: outside the grid); `touch` for a finger; the target it hit. */
	tap(cell: Cell | null, touch: boolean, hit?: PressTarget | null): void;
	/** Opens the cell's details (a long-press that did not drag, or a cell with nothing to move). */
	open(cell: Cell): void;
	/**
	 * The dry run of a drop (`checkRebalance`, 7.2): whether the planner and the edit API would take
	 * it, and the sentence when not. Null when there is no answer yet.
	 */
	check(action: RebalanceAction): { readonly ok: boolean; readonly message: string | null } | null;
	/** A drag was dropped on `to`: the host plans it (and may ask which task first). */
	drop(d: {
		readonly from: Cell;
		readonly to: Cell;
		readonly tasks: readonly CellTask[];
		readonly plan: (task: CellTask | null) => DragPlan;
	}): void;
	/** One level of zoom (+1 in, -1 out) about a viewport x. */
	zoomStep(dir: 1 | -1, clientX: number): void;
	announce(text: string): void;
}

interface Pointer {
	id: number;
	kind: PointerKind;
	clientX: number;
	clientY: number;
	modifiers: Modifiers;
}

interface Session {
	/** The origin's target key: a press that is dragging hits nothing new (the origin's tasks stand). */
	readonly key: number;
	readonly from: Cell;
	readonly tasks: readonly CellTask[];
	readonly x0: number;
	readonly y0: number;
	readonly kind: PointerKind;
	lock: RebalanceAxis | null;
	target: Cell | null;
	/** The target the dry run was asked about, its answer, and the timer that asks. */
	checked: string;
	verdict: { readonly ok: boolean; readonly message: string | null } | null;
	timer: ReturnType<typeof setTimeout> | null;
}

const mods = (e: PointerEvent): Modifiers => ({
	shift: e.shiftKey,
	alt: e.altKey,
	ctrl: e.ctrlKey,
	meta: e.metaKey,
});

export class HeatGestures {
	/** The cell under a mouse, for the outline and the cell line. */
	hover = $state.raw<Cell | null>(null);
	/** What the mouse is on (the lanes outline the bar). */
	hoverTarget = $state.raw<PressTarget | null>(null);
	/** What is lifted: the target of a long-press, or of the drag in flight. */
	liftedTarget = $state.raw<PressTarget | null>(null);
	/** The lifted cell (a long-press, or the drag in flight). */
	lifted = $state.raw<Cell | null>(null);
	drag = $state.raw<DragMark | null>(null);
	cursor = $state('default');

	readonly #h: HeatHost;
	readonly #machine: GestureMachine;
	#el: HTMLElement | null = null;
	#session: Session | null = null;
	#pointer: Pointer | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#raf = 0;
	#lastFrame = 0;
	#pinchFrom = 0;
	/** The press lifted a cell (touch) and has not moved: letting go opens its details. */
	#liftedAt: Cell | null = null;
	/** The targets the pointer hit lately, by key: a machine hit carries only its number. */
	readonly #known = new Map<number, PressTarget>();

	constructor(host: HeatHost) {
		this.#h = host;
		this.#machine = createGestureMachine(
			{},
			{
				canDrag: (hit) => hit.kind === 'bar' && this.#tasksOf(hit).length > 0,
				isSelected: () => false,
			},
		);
	}

	#pressed(hit: GestureTarget): PressTarget | null {
		return hit.kind === 'bar' ? (this.#known.get(hit.row) ?? null) : null;
	}

	#cell(hit: GestureTarget): Cell | null {
		return this.#pressed(hit)?.cell ?? null;
	}

	#tasksOf(hit: GestureTarget): readonly CellTask[] {
		return this.#pressed(hit)?.tasks ?? [];
	}

	/** Listens on the overlay canvas; returns the function that stops. */
	attach(el: HTMLElement): () => void {
		this.#el = el;
		const on = <K extends keyof HTMLElementEventMap>(
			type: K,
			fn: (e: HTMLElementEventMap[K]) => void,
			opts?: AddEventListenerOptions,
		): void => el.addEventListener(type, fn as EventListener, opts);
		on('pointerdown', (e) => this.#feed(this.#input('down', e)));
		on('pointermove', (e) => this.#move(e));
		on('pointerup', (e) => this.#feed(this.#input('up', e)));
		on('pointercancel', (e) => this.#feed(this.#input('cancel', e)));
		on('lostpointercapture', () => {
			if (this.#machine.state === 'dragging') this.#feed({ type: 'reset' });
		});
		on('pointerleave', () => this.#leave());
		// Android fires a contextmenu on a long-press, over the lifted cell.
		on('contextmenu', (e) => e.preventDefault());
		for (const t of ['gesturestart', 'gesturechange'] as const) {
			el.addEventListener(t, (e) => e.preventDefault());
		}
		// Non-passive, and it returns at once unless the machine owns the touch.
		on(
			'touchmove',
			(e) => {
				if (this.#machine.claimsTouch && e.cancelable) e.preventDefault();
			},
			{ passive: false },
		);
		const reset = (): void => void this.#feed({ type: 'reset' });
		const hidden = (): void => {
			if (document.visibilityState === 'hidden') reset();
		};
		const escape = (e: KeyboardEvent): void => {
			if (e.key === 'Escape' && this.#machine.state !== 'idle') {
				e.stopPropagation();
				this.#feed({ type: 'escape' });
			}
		};
		window.addEventListener('blur', reset);
		window.addEventListener('pagehide', reset);
		document.addEventListener('visibilitychange', hidden);
		window.addEventListener('keydown', escape, true);
		return () => {
			window.removeEventListener('blur', reset);
			window.removeEventListener('pagehide', reset);
			document.removeEventListener('visibilitychange', hidden);
			window.removeEventListener('keydown', escape, true);
			this.dispose();
			this.#el = null;
		};
	}

	/**
	 * A new result or model: the targets looked up so far are forgotten (a hit carries a number, and
	 * what it stood for may be gone). Not while a press or a drag holds one.
	 */
	reset(): void {
		if (this.#machine.state !== 'idle') return;
		this.#known.clear();
		this.hover = null;
		this.hoverTarget = null;
	}

	/** A user scroll of the plot: a press before its long-press is a pan. */
	scrolled(): void {
		if (this.#machine.state === 'pressed') this.#feed({ type: 'scroll', t: performance.now() });
	}

	dispose(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
		this.#timer = null;
		this.#raf = 0;
	}

	#point(clientX: number, clientY: number): { x: number; y: number } {
		const o = this.#h.origin();
		return { x: clientX - o.left, y: clientY - o.top };
	}

	#hit(x: number, y: number): GestureTarget {
		// A drag in flight moves over targets the machine does not need: no lookup per move.
		if (this.#session) return { kind: 'bar', row: this.#session.key };
		const t = this.#resolve(x, y);
		if (!t) return { kind: 'empty', row: null, at: 0 };
		this.#known.set(t.key, t);
		return { kind: 'bar', row: t.key };
	}

	#resolve(x: number, y: number): PressTarget | null {
		if (this.#h.target) return this.#h.target(x, y);
		const l = this.#h.layout();
		const c = l.cellAt(x, y);
		const model = this.#h.model();
		return c
			? { key: cellId(c, l.cols), cell: c, tasks: model ? movableTasks(model, c) : [] }
			: null;
	}

	#input(type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent): GestureInput {
		const p = this.#point(e.clientX, e.clientY);
		const kind = (
			e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse'
		) as PointerKind;
		this.#pointer = {
			id: e.pointerId,
			kind,
			clientX: e.clientX,
			clientY: e.clientY,
			modifiers: mods(e),
		};
		return {
			type,
			id: e.pointerId,
			kind,
			x: p.x,
			y: p.y,
			clientX: e.clientX,
			clientY: e.clientY,
			t: e.timeStamp,
			target: this.#hit(p.x, p.y),
			buttons: e.buttons,
			modifiers: mods(e),
		};
	}

	#move(e: PointerEvent): void {
		if (this.#machine.state === 'idle') {
			if (e.pointerType !== 'touch') this.#hover(e);
			return;
		}
		this.#feed(this.#input('move', e));
	}

	#hover(e: PointerEvent): void {
		const p = this.#point(e.clientX, e.clientY);
		// The machine is idle (the caller checks), so nothing holds a hit from before: forget them.
		if (this.#known.size > 64) this.#known.clear();
		const hit = this.#hit(p.x, p.y);
		const cell = this.#cell(hit);
		const target = this.#pressed(hit);
		if (target?.key !== this.hoverTarget?.key) this.hoverTarget = target;
		if (cell?.row !== this.hover?.row || cell?.col !== this.hover?.col) this.hover = cell;
		this.cursor = hit.kind === 'bar' && this.#tasksOf(hit).length > 0 ? 'grab' : 'default';
	}

	#leave(): void {
		if (this.#machine.state !== 'idle') return;
		this.hover = null;
		this.hoverTarget = null;
		this.cursor = 'default';
	}

	#feed(input: GestureInput): void {
		const outs = this.#machine.send(input);
		for (const o of outs) this.#act(o);
		this.#arm();
	}

	/** The long-press timer: the machine says when (`timerAt`), this keeps the clock. */
	#arm(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		const at = this.#machine.timerAt;
		if (at === null) return;
		this.#timer = setTimeout(
			() => {
				this.#timer = null;
				this.#feed({ type: 'timer', t: performance.now() });
			},
			Math.max(0, at - performance.now()),
		);
	}

	#act(o: GestureOutput): void {
		switch (o.type) {
			case 'capture':
				try {
					this.#el?.setPointerCapture(o.id);
				} catch {
					// The pointer is gone: the drag ends with its up or cancel.
				}
				return;
			case 'release':
				try {
					if (this.#el?.hasPointerCapture(o.id)) this.#el.releasePointerCapture(o.id);
				} catch {
					// Already released by the browser.
				}
				return;
			case 'tap':
				return this.#h.tap(
					this.#cell(o.hit),
					this.#pointer?.kind === 'touch',
					this.#pressed(o.hit),
				);
			case 'long-press':
				return this.#longPress(o.hit);
			case 'drag-start':
				return this.#start(o.hit, o.x, o.y);
			case 'drag-move':
				return this.#dragMove(o.x, o.y);
			case 'drag-end':
				return this.#end(o.x, o.y);
			case 'drag-cancel':
				return this.#cancel(o.reason);
			case 'pinch':
				return this.#pinch(o.scale, o.cx);
			case 'pinch-end':
				this.#pinchFrom = 0;
				return;
			case 'pan2':
				return this.#pan(o.dx, o.dy);
			case 'pan-native':
				return;
		}
	}

	#longPress(hit: GestureTarget): void {
		const cell = this.#cell(hit);
		if (!cell) return;
		globalThis.navigator?.vibrate?.(10);
		if (this.#tasksOf(hit).length === 0) {
			// Nothing to lift: a long-press is "show me this cell".
			this.#h.open(cell);
			return;
		}
		this.lifted = cell;
		this.#liftedAt = cell;
		const target = this.#pressed(hit);
		this.liftedTarget = target;
		const name = this.#h.model()?.rows[cell.row]?.name ?? '';
		this.#h.announce(
			target && this.#h.liftedText ? this.#h.liftedText(target) : W.rebalance.lifted(name),
		);
	}

	#start(hit: GestureTarget, x: number, y: number): void {
		const cell = this.#cell(hit);
		if (!cell) return;
		const tasks = this.#tasksOf(hit);
		if (tasks.length === 0) return;
		this.#liftedAt = null;
		this.#session = {
			key: this.#pressed(hit)?.key ?? 0,
			from: cell,
			tasks,
			x0: x,
			y0: y,
			kind: this.#pointer?.kind ?? 'mouse',
			lock: null,
			target: null,
			checked: '',
			verdict: null,
			timer: null,
		};
		this.lifted = cell;
		this.liftedTarget = this.#pressed(hit);
		this.cursor = 'grabbing';
		this.#pump();
	}

	#dragMove(x: number, y: number): void {
		const s = this.#session;
		const model = this.#h.model();
		const labels = this.#h.labels();
		if (!s || !model || !labels) return;
		s.lock = lockAxis(x - s.x0, y - s.y0, SLOP[s.kind], s.lock);
		s.target = targetOf(s.lock, s.from, x, y, this.#h.layout());
		// With one task the label can name the whole ask; with several it names the target.
		const plan = dragPlan(
			model,
			labels,
			s.tasks.length === 1 ? (s.tasks[0]?.task ?? null) : null,
			s.from,
			s.target,
		);
		// One dry run per target change, in an idle task (7.2), as the Gantt does at a link's target.
		const key = s.target ? `${s.target.row}:${s.target.col}` : '';
		if (key !== s.checked) {
			s.checked = key;
			s.verdict = null;
			if (s.timer !== null) clearTimeout(s.timer);
			const action = plan.action;
			s.timer = action
				? setTimeout(() => {
						s.timer = null;
						if (this.#session !== s || s.checked !== key) return;
						s.verdict = this.#h.check(action);
						const last = this.#pointer
							? this.#point(this.#pointer.clientX, this.#pointer.clientY)
							: { x, y };
						this.#show(s, plan, last.x, last.y);
					}, 0)
				: null;
		}
		this.#show(s, plan, x, y);
	}

	/** The ghost and its label: the planner's sentence when the dry run refused, else the ask. */
	#show(s: Session, plan: DragPlan, x: number, y: number): void {
		const refused = s.verdict !== null && !s.verdict.ok;
		const text = refused ? (s.verdict?.message ?? plan.label) : plan.label;
		this.drag = {
			target: s.target,
			ok: plan.ok && !refused,
			label: text === '' ? null : { text, x, y },
		};
	}

	#end(x: number, y: number): void {
		const s = this.#session;
		this.#dragMove(x, y);
		this.#clear();
		const model = this.#h.model();
		const labels = this.#h.labels();
		if (!s || !model || !labels) return;
		if (!s.target || (s.target.row === s.from.row && s.target.col === s.from.col)) {
			this.#h.announce(W.rebalance.sameCell);
			return;
		}
		const to = s.target;
		this.#h.drop({
			from: s.from,
			to,
			tasks: s.tasks,
			plan: (task) => dragPlan(model, labels, task?.task ?? null, s.from, to),
		});
	}

	#cancel(reason: string): void {
		const opened = this.#liftedAt;
		this.#clear();
		// A long-press that never moved and was let go: show the cell's details.
		if (reason === 'back-to-origin' && opened) this.#h.open(opened);
		else if (reason === 'escape') this.#h.announce(W.rebalance.cancelled);
	}

	#clear(): void {
		if (this.#session?.timer) clearTimeout(this.#session.timer);
		this.#session = null;
		this.#liftedAt = null;
		this.drag = null;
		this.lifted = null;
		this.liftedTarget = null;
		this.cursor = 'default';
	}

	// --- two fingers -------------------------------------------------------------------------

	#pinch(scale: number, cx: number): void {
		// One level per PINCH_STEP of scale, counted from the pinch's start (a spread zooms in).
		const steps = Math.trunc(Math.log(scale) / Math.log(PINCH_STEP));
		if (steps === this.#pinchFrom) return;
		const dir = steps > this.#pinchFrom ? 1 : -1;
		this.#pinchFrom += dir;
		this.#h.zoomStep(dir, cx);
	}

	#pan(dx: number, dy: number): void {
		const sc = this.#h.scroller();
		if (!sc) return;
		sc.scrollLeft -= dx;
		sc.scrollTop -= dy;
	}

	// --- edge auto-scroll --------------------------------------------------------------------

	#pump(): void {
		if (this.#raf !== 0) return;
		this.#lastFrame = performance.now();
		const frame = (now: number): void => {
			this.#raf = 0;
			if (this.#machine.state !== 'dragging') return;
			const dt = Math.min(64, now - this.#lastFrame);
			this.#lastFrame = now;
			const p = this.#pointer;
			const sc = this.#h.scroller();
			if (p && sc) {
				const v = this.#h.visible();
				const vx = autoScrollVelocity(p.clientX, v.x, v.x + v.w);
				const vy = autoScrollVelocity(p.clientY, v.y, v.y + v.h);
				if (vx !== 0 || vy !== 0) {
					sc.scrollLeft += (vx * dt) / 1000;
					sc.scrollTop += (vy * dt) / 1000;
					const at = this.#point(p.clientX, p.clientY);
					this.#feed({
						type: 'move',
						id: p.id,
						kind: p.kind,
						x: at.x,
						y: at.y,
						clientX: p.clientX,
						clientY: p.clientY,
						t: now,
						target: this.#hit(at.x, at.y),
						// A synthetic move must carry the button, or the lost-release check cancels.
						buttons: 1,
						modifiers: p.modifiers,
					});
				}
			}
			this.#raf = requestAnimationFrame(frame);
		};
		this.#raf = requestAnimationFrame(frame);
	}
}
