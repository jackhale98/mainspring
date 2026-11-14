// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plot's pointer wiring (phase-2.md 7.1 to 7.3, 8.2; src/lib/gesture/README.md): DOM pointer
 * events on the overlay canvas become `GestureInput`s for the shared gesture controller, and its
 * intents become previews, link mode and one dispatched action at the drop. The controller owns
 * every rule (slop, the 350 ms long-press, pinch, a selected bar's handles dragging at once, the
 * snapping); this file only translates the DOM into it and acts on what comes out.
 *
 * - **Previews** are drawn on the overlay from `drag` (a ghost and the label by the pointer): no
 *   edit API and no engine run per pointer move (7.3), and no layout is built. At the drop the
 *   action goes to the dispatcher with the ghost as its preview mark, and `drag` is cleared in
 *   the same task: the pending bar (`app.edits.pending`) is what shows from then on.
 * - **Touch**: `touch-action: pan-x pan-y` keeps one-finger panning native; a non-passive
 *   `touchmove` listener cancels it only while the controller says it owns the touch (an armed
 *   long-press, a drag, a pinch, a selected bar's handle) and returns at once otherwise (8.2).
 * - **Edge auto-scroll** while dragging (up to 600 px/s) is measured against the part of the chart
 *   that is visible, not the whole scroller (a sheet or a drawer may cover an edge; viewport.ts).
 * - A pinch zooms about the fingers and two fingers pan (README, section 2).
 *
 * Over 400 lines on purpose: one class owns the DOM events, the controller and the drag state
 * they share (`#session`, `#pointer`, the timers), and the three modes read each other's state;
 * the pure parts are already in lib/gantt (drag.ts, preview.ts, handles.ts, viewport.ts).
 *
 * Nothing here changes the plan. A tap selects, a long-press on a task written with macros opens
 * its source, and Escape or a lost pointer cancels with no edit.
 */
import {
	calendarDragSnapper,
	createGestureController,
	dragSnapperFromWorkingDays,
	pinchZoom,
	type DragSnapper,
	type GestureController,
	type GestureEnv,
	type GestureInput,
	type GestureIntent,
	type GestureTarget,
	type Modifiers,
	type PointerKind,
} from '../../lib/gesture';
import {
	advance,
	beginSession,
	blockedBy,
	dropOf,
	probeFor,
	type DragEnv,
	type Session,
} from '../../lib/gantt/drag';
import { type HandleSet } from '../../lib/gantt/handles';
import { hitTest } from '../../lib/gantt/hit';
import type { ActionContext } from '../../lib/gantt/intents';
import { resizeEdge } from '../../lib/gantt/intents';
import type { GanttLayout } from '../../lib/gantt/layout';
import type { GanttModel } from '../../lib/gantt/model';
import { moveRef, resizeRef } from '../../lib/gantt/preview';
import type { GestureLabel } from '../../lib/gantt/paint/gestures';
import { edgeVelocity, type Box } from '../../lib/gantt/viewport';
import { MAX_PX_PER_DAY, MIN_PX_PER_DAY } from '../../lib/gantt/scale';
import type { WorkingTime } from '../../lib/schedule/working-time';
import { gestureStrings } from '../../lib/strings';
import type { GanttActor } from './actor.svelte';
import type { LinkMode } from './link-mode.svelte';

/** What the host (Gantt.svelte, through Timeline.svelte) tells the wiring about the chart. */
export interface GestureHost {
	readonly actor: GanttActor;
	readonly links: LinkMode;
	model(): GanttModel;
	layout(): GanttLayout;
	/** The plot's own box: content x = client x minus its left, content y likewise. */
	origin(): { readonly left: number; readonly top: number };
	selectedRow(): number | null;
	/** The handles the selected bar shows (after the dry runs have had their say). */
	handles(): HandleSet | null;
	ctx(): ActionContext | null;
	wt(): WorkingTime | null;
	/** The visible chart in viewport px, minus what a sheet or a drawer covers. */
	visible(): Box;
	scroller(): HTMLElement | undefined;
	/** `drop`: the selection after a drag, which never opens the details. */
	select(row: number, drop?: boolean): void;
	selectLink(link: number): void;
	/** A task written with macros: its source (long-press). */
	showSource(task: string): void;
	announce(text: string): void;
	/** The zoom in px per day now, and a zoom about a viewport x. */
	zoom(): number;
	zoomTo(pxPerDay: number, anchorClientX: number): void;
	/** Reports the row under a mouse, for the task line (hover). */
	hover(row: number | null): void;
}

/** What the overlay draws for the drag in flight. */
export interface DragView {
	readonly ghost: import('../../lib/gantt/preview').Ghost | null;
	readonly label: GestureLabel | null;
	readonly lifted: number | null;
}

interface Pointer {
	id: number;
	kind: PointerKind;
	clientX: number;
	clientY: number;
	modifiers: Modifiers;
}

const cursorOf = (hit: GestureTarget, textOnly: boolean): string => {
	if (hit.kind === 'link') return 'pointer';
	if (hit.kind !== 'bar') return 'default';
	if (hit.part === 'end-handle' || hit.part === 'progress') return 'ew-resize';
	if (hit.part === 'link-dot') return 'crosshair';
	return textOnly ? 'not-allowed' : 'grab';
};

const mods = (e: PointerEvent): Modifiers => ({
	shift: e.shiftKey,
	alt: e.altKey,
	ctrl: e.ctrlKey,
	meta: e.metaKey,
});

export class GanttGestures {
	/** The drag in flight, for the overlay. */
	drag = $state.raw<DragView | null>(null);
	/** The mouse's row and link, for the hover outlines. */
	hoverRow = $state<number | null>(null);
	hoverLink = $state<number | null>(null);
	cursor = $state('default');

	readonly #h: GestureHost;
	readonly #ctl: GestureController;
	#el: HTMLElement | null = null;
	#session: Session | null = null;
	#pointer: Pointer | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#raf = 0;
	#lastFrame = 0;
	#pinchFrom: number | null = null;
	#snappers: { wt: WorkingTime; day: DragSnapper; alap: DragSnapper } | null = null;
	#alap = false;
	#linking = false;
	#preflight: ReturnType<typeof setTimeout> | null = null;

	constructor(host: GestureHost) {
		this.#h = host;
		const self = this;
		const env: GestureEnv = {
			minutesAt: (x) => host.layout().scale.m(x),
			get snap() {
				return self.#snapper();
			},
			edgeMin: (bar, mode) => {
				const row = host.model().rows[bar.row];
				if (!row) return null;
				const ctx = host.ctx();
				self.#alap = !!row.id && !!ctx && resizeEdge(row.id, ctx) === 'start';
				return mode === 'move' ? moveRef(host.wt(), row) : resizeRef(host.wt(), row, self.#alap);
			},
		};
		this.#ctl = createGestureController(
			env,
			{},
			{
				canDrag: (hit) => {
					if (hit.kind !== 'bar') return false;
					const row = host.model().rows[hit.row];
					return !!row && row.textOnly === null && row.scheduled;
				},
				isSelected: (row) => row === host.selectedRow(),
			},
		);
	}

	/** Snapping on working days: the day's start for a move, and for an ALAP task's start edge. */
	#snapper(): DragSnapper {
		const wt = this.#h.wt();
		if (!wt) return calendarDragSnapper();
		if (this.#snappers?.wt !== wt) {
			this.#snappers = {
				wt,
				day: dragSnapperFromWorkingDays(wt),
				// An ALAP task's free edge is its start: resizing snaps to day starts, not ends.
				alap: dragSnapperFromWorkingDays({ shiftDays: (m, d) => wt.shiftDays(m, d, 'start') }),
			};
		}
		return this.#alap ? this.#snappers.alap : this.#snappers.day;
	}

	#env(): DragEnv {
		return {
			wt: this.#h.wt(),
			model: this.#h.model(),
			layout: this.#h.layout(),
			ctx: this.#h.ctx(),
		};
	}

	// --- the DOM ----------------------------------------------------------------------------

	/** Listens on the overlay canvas; returns the function that stops. */
	attach(el: HTMLElement): () => void {
		this.#el = el;
		const on = <K extends keyof HTMLElementEventMap>(
			type: K,
			fn: (e: HTMLElementEventMap[K]) => void,
			opts?: AddEventListenerOptions,
		): void => el.addEventListener(type, fn as EventListener, opts);
		on('pointerdown', (e) => this.#pointerdown(e));
		on('pointermove', (e) => this.#pointermove(e));
		on('pointerup', (e) => this.#pointerup(e));
		on('pointercancel', (e) => this.#feed(this.#input('cancel', e)));
		on('lostpointercapture', () => {
			if (this.#ctl.state === 'dragging') this.#feed({ type: 'reset' });
		});
		on('pointerleave', () => this.#leave());
		// Android fires a contextmenu on a long-press, over the lifted bar.
		on('contextmenu', (e) => e.preventDefault());
		// iOS Safari would zoom the page under our pinch.
		for (const t of ['gesturestart', 'gesturechange'] as const) {
			el.addEventListener(t, (e) => e.preventDefault());
		}
		// Non-passive, and it returns at once unless the controller owns the touch (8.2).
		on(
			'touchmove',
			(e) => {
				if (this.#ctl.claimsTouch && e.cancelable) e.preventDefault();
			},
			{ passive: false },
		);
		const reset = (): void => void this.#feed({ type: 'reset' });
		const hidden = (): void => {
			if (document.visibilityState === 'hidden') reset();
		};
		const escape = (e: KeyboardEvent): void => {
			if (e.key === 'Escape' && this.#ctl.state !== 'idle') {
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

	/** A user scroll of the chart (not the wiring's own): a press before its long-press is a pan. */
	scrolled(): void {
		if (this.#ctl.state === 'pressed') this.#feed({ type: 'scroll', t: performance.now() });
	}

	dispose(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		if (this.#preflight !== null) clearTimeout(this.#preflight);
		if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
		this.#timer = this.#preflight = null;
		this.#raf = 0;
	}

	#point(clientX: number, clientY: number): { x: number; y: number } {
		const o = this.#h.origin();
		return { x: clientX - o.left, y: clientY - o.top };
	}

	#hit(x: number, y: number): GestureTarget {
		const h = this.#h;
		return hitTest(h.layout(), h.model(), x, y, {
			selected: h.selectedRow(),
			handles: h.handles(),
		});
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

	#pointerdown(e: PointerEvent): void {
		this.#feed(this.#input('down', e));
	}

	#pointermove(e: PointerEvent): void {
		const idle = this.#ctl.state === 'idle';
		if (idle && e.pointerType !== 'touch') {
			this.#hover(e);
			return;
		}
		if (this.#ctl.state === 'idle') return;
		this.#feed(this.#input('move', e));
	}

	#pointerup(e: PointerEvent): void {
		this.#feed(this.#input('up', e));
	}

	#leave(): void {
		if (this.#ctl.state !== 'idle') return;
		this.#h.hover(null);
		this.hoverRow = null;
		this.hoverLink = null;
		this.#h.links.target(null);
	}

	/** A mouse or pen over the chart with nothing pressed: hover, cursor, and link mode's target. */
	#hover(e: PointerEvent): void {
		const p = this.#point(e.clientX, e.clientY);
		const hit = this.#hit(p.x, p.y);
		const model = this.#h.model();
		const row =
			hit.kind === 'link' ? null : hit.kind === 'bar' || hit.kind === 'empty' ? hit.row : null;
		if (row !== this.hoverRow) {
			this.hoverRow = row;
			this.#h.hover(row);
		}
		const link = hit.kind === 'link' ? hit.link : null;
		if (link !== this.hoverLink) this.hoverLink = link;
		const textOnly = hit.kind === 'bar' && model.rows[hit.row]?.textOnly != null;
		this.cursor = this.#h.links.active ? 'crosshair' : cursorOf(hit, textOnly);
		const links = this.#h.links;
		if (links.active && links.state?.via === 'tap') {
			links.point(p.x, p.y);
			links.target(hit.kind === 'bar' && hit.row !== links.state.from ? hit.row : null);
		}
	}

	// --- the controller -----------------------------------------------------------------------

	#feed(input: GestureInput): void {
		const out = this.#ctl.send(input);
		for (const i of out) this.#act(i);
		this.#arm();
	}

	/** The long-press timer: the controller says when (`timerAt`), this keeps the clock. */
	#arm(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		const at = this.#ctl.timerAt;
		if (at === null) return;
		this.#timer = setTimeout(
			() => {
				this.#timer = null;
				this.#feed({ type: 'timer', t: performance.now() });
			},
			Math.max(0, at - performance.now()),
		);
	}

	#act(i: GestureIntent): void {
		switch (i.type) {
			case 'capture':
				try {
					this.#el?.setPointerCapture(i.id);
				} catch {
					// The pointer is gone: the drag ends with its up or cancel.
				}
				return;
			case 'release':
				try {
					if (this.#el?.hasPointerCapture(i.id)) this.#el.releasePointerCapture(i.id);
				} catch {
					// Already released by the browser.
				}
				return;
			case 'tap':
				return this.#tap(i.hit);
			case 'long-press':
				return this.#longPress(i.hit);
			case 'drag-start':
				return this.#start(i.mode, i.hit);
			case 'drag-move':
				return this.#move(i);
			case 'drag-end':
				return this.#end();
			case 'cancel':
				return this.#cancel(i.reason);
			case 'link-start':
				this.#linking = true;
				this.#h.links.begin(i.from, 'drag', i.x, i.y);
				this.cursor = 'crosshair';
				return this.#pump();
			case 'link-move':
				return this.#h.links.point(i.x, i.y);
			case 'link-hover':
				return this.#h.links.target(i.target && i.target.row !== i.from ? i.target.row : null);
			case 'link-drop': {
				this.#linking = false;
				void this.#h.links.complete(i.to.row);
				return;
			}
			case 'pinch':
				return this.#pinch(i.scale, i.cx);
			case 'pinch-end':
				this.#pinchFrom = null;
				return;
			case 'pan2':
				return this.#pan(i.dx, i.dy);
			case 'pan-native':
				return;
		}
	}

	#tap(hit: GestureTarget): void {
		const h = this.#h;
		const links = h.links;
		if (hit.kind === 'bar') {
			if (links.active && links.state?.via === 'tap') {
				if (hit.row === links.state.from) links.cancel();
				else void links.complete(hit.row);
				return;
			}
			if (hit.part === 'link-dot') {
				links.begin(hit.row, 'tap');
				return;
			}
			h.select(hit.row);
			return;
		}
		if (links.active && links.state?.via === 'tap') {
			links.cancel();
			return;
		}
		if (hit.kind === 'link') h.selectLink(hit.link);
		else if (hit.kind === 'empty' && hit.row !== null) h.select(hit.row);
	}

	#longPress(hit: GestureTarget): void {
		if (hit.kind !== 'bar') return;
		const row = this.#h.model().rows[hit.row];
		if (!row) return;
		globalThis.navigator?.vibrate?.(10);
		if (row.textOnly !== null) {
			if (row.id) this.#h.showSource(row.id);
			return;
		}
		this.drag = { ghost: null, label: null, lifted: hit.row };
		this.#h.announce(gestureStrings.live.lifted(row.name));
	}

	#start(mode: 'move' | 'resize-end' | 'progress' | 'row', hit: GestureTarget): void {
		if (hit.kind !== 'bar' || mode === 'row') return;
		const env = this.#env();
		const s = beginSession(env, mode, hit.row);
		if (!s) return;
		this.#session = s;
		this.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
		this.drag = { ghost: s.ghost, label: null, lifted: null };
		// One idle task: would the drop be refused? (text-only, macro-in-body, inherited, ...)
		this.#preflight = setTimeout(() => {
			this.#preflight = null;
			const cur = this.#session;
			if (!cur || cur.row !== s.row) return;
			const o = this.#h.actor.check(probeFor(cur, this.#env()));
			const blocked = o && o.status === 'refused' && o.reason !== 'at-limit' ? o.message : null;
			this.#session = blockedBy(cur, blocked);
			this.#show(this.#last());
		}, 0);
		this.#pump();
	}

	#last(): { x: number; y: number } {
		const p = this.#pointer;
		return p ? this.#point(p.clientX, p.clientY) : { x: 0, y: 0 };
	}

	#move(i: Extract<GestureIntent, { type: 'drag-move' }>): void {
		const s = this.#session;
		if (!s) return;
		this.#session = advance(this.#env(), s, { time: i.time, atOrigin: i.atOrigin, x: i.x });
		this.#show({ x: i.x, y: i.y });
	}

	#show(at: { x: number; y: number }): void {
		const s = this.#session;
		if (!s) return;
		const v = this.#h.visible();
		const o = this.#h.origin();
		const label: GestureLabel | null =
			s.text === ''
				? null
				: {
						text: s.text,
						x: at.x,
						y: at.y,
						blocked: s.blocked !== null,
						within: { left: v.left - o.left, right: v.right - o.left },
					};
		this.drag = { ghost: s.ghost, label, lifted: null };
	}

	#end(): void {
		const s = this.#session;
		this.#done();
		if (!s) return;
		const drop = dropOf(s, this.#env());
		if (!drop) {
			this.#h.announce(gestureStrings.live.cancelled);
			return;
		}
		// The action is queued (and its pending bar set) before the preview goes, in one task.
		void this.#h.actor.run(drop.action, { defer: true }, drop.mark);
		this.drag = null;
		// The dragged task becomes the selection once it is dropped; the details stay as they are
		// (opening the sheet while a finger is down would scroll the chart under it).
		if (s.row !== this.#h.selectedRow()) this.#h.select(s.row, true);
	}

	#cancel(reason: string): void {
		const hadLink = this.#linking || this.#h.links.state?.via === 'drag';
		this.#done();
		if (hadLink) this.#h.links.cancel(reason === 'escape');
		else if (reason === 'escape') this.#h.announce(gestureStrings.live.cancelled);
	}

	#done(): void {
		this.#session = null;
		this.#linking = false;
		this.drag = null;
		this.cursor = 'default';
		if (this.#preflight !== null) clearTimeout(this.#preflight);
		this.#preflight = null;
	}

	// --- two fingers -------------------------------------------------------------------------

	#pinch(scale: number, cx: number): void {
		this.#pinchFrom ??= this.#h.zoom();
		const target = pinchZoom(this.#pinchFrom, scale, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
		this.#h.zoomTo(target, cx);
	}

	#pan(dx: number, dy: number): void {
		const sc = this.#h.scroller();
		if (!sc) return;
		sc.scrollLeft -= dx;
		sc.scrollTop -= dy;
	}

	// --- edge auto-scroll --------------------------------------------------------------------

	/** Each frame of a drag: scroll toward a near edge of the visible chart, and move with it. */
	#pump(): void {
		if (this.#raf !== 0) return;
		this.#lastFrame = performance.now();
		const frame = (now: number): void => {
			this.#raf = 0;
			if (this.#ctl.state !== 'dragging') return;
			const dt = Math.min(64, now - this.#lastFrame);
			this.#lastFrame = now;
			const p = this.#pointer;
			const sc = this.#h.scroller();
			if (p && sc) {
				const vertical = this.#session === null;
				const v = edgeVelocity(p.clientX, p.clientY, this.#h.visible(), vertical);
				if (v.x !== 0 || v.y !== 0) {
					sc.scrollLeft += (v.x * dt) / 1000;
					sc.scrollTop += (v.y * dt) / 1000;
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
