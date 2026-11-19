// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Calendar's pointer wiring (phase-3.md 7.1 W3 and W4, 7.2; src/lib/gesture/README.md): DOM
 * pointer events on the month become `GestureInput`s for the shared gesture machine
 * (src/lib/gesture/, unchanged), and its outputs become a tap, a lifted day, a run of days being
 * dragged over and one drop. The machine owns every rule (slop, the 350 ms long-press, Escape,
 * the lost-release checks); this translates the DOM into it and acts on what comes out. The days
 * are real elements, so what is under a pointer is asked of the document (`elementFromPoint`) on
 * a press and a move, and in each frame of an edge auto-scroll (a month that scrolls, a tablet's or
 * a phone's, moves under a still pointer, so the day under it changes). The box is read once per
 * drag, not per frame; no layout is read while it is only scrolled. The month that fills a
 * desktop's view does not scroll, so a drag that leaves it at the top or bottom edge simply keeps
 * the run it had: Shift and the arrows or Shift and a click go on into the next month.
 *
 * - A target is a day, as one number (`GestureTarget` `bar`, `row` is the day's index).
 * - **Mouse and pen:** a press and a release on one day is a tap; a press that moves 3 px is a
 *   drag over a run of days. What a tap or a drop does depends on the mode (the host's): Select
 *   selects, Paint adds leave, Erase clears it.
 * - **Touch:** `touch-action: pan-x pan-y` keeps one-finger scrolling native; a press that moves
 *   first is a scroll. A tap selects, a second tap opens the details; a long-press lifts the day
 *   and a drag then covers a run of days (Paint and Erase apply it at the drop, Select selects
 *   it). Letting go of a lift without moving is the mode's action on that one day.
 * - The drag is a **preview** (`drag`): nothing is dispatched until the drop, and the drop is the
 *   host's (it plans one intent). Edge auto-scroll while dragging scrolls a month that scrolls.
 *
 * Nothing here changes the plan.
 */
import { AxisScroll } from '../../lib/gesture/autoscroll';
import { createGestureMachine } from '../../lib/gesture/machine';
import type {
	GestureInput,
	GestureMachine,
	GestureOutput,
	GestureTarget,
	Modifiers,
	PointerKind,
} from '../../lib/gesture/types';
import { between } from '../../lib/calendar/nav';
import type { CalendarMode } from './calendar-state.svelte';

export interface CalendarHost {
	mode(): CalendarMode;
	scroller(): HTMLElement | undefined;
	/** How much of the scroller's foot a bottom sheet covers, in px (0 when there is none): a drag's edge scroll starts above it. */
	covered?(): number;
	/** Whether a day (an index) can be selected: the grid has it and it is inside the plan. */
	valid(day: number): boolean;
	/** A tap or click on a day; `shift` extends the selection. */
	tap(day: number, touch: boolean, shift: boolean): void;
	/** A run of days was dropped (a drag), or a lifted day let go: the mode's action on it. */
	drop(lo: number, hi: number, touch: boolean): void;
	/** The lifted day let go without moving (a touch long-press): in Select it opens the details. */
	open(day: number): void;
	announce(text: string): void;
	/** The word for a day, for the "lifted" announcement. */
	label(day: number): string;
}

interface Pointer {
	id: number;
	kind: PointerKind;
	clientX: number;
	clientY: number;
	modifiers: Modifiers;
}

const mods = (e: PointerEvent): Modifiers => ({
	shift: e.shiftKey,
	alt: e.altKey,
	ctrl: e.ctrlKey,
	meta: e.metaKey,
});

/** The run of days being dragged over, `lo` to `hi` inclusive. */
export interface DragRun {
	readonly lo: number;
	readonly hi: number;
}

export class CalendarGestures {
	/** The run under the drag, for the live selection. Null when nothing is dragged. */
	drag = $state.raw<DragRun | null>(null);
	/** The lifted day (a touch long-press). */
	lifted = $state<number | null>(null);

	readonly #h: CalendarHost;
	readonly #machine: GestureMachine;
	#el: HTMLElement | null = null;
	#pointer: Pointer | null = null;
	/** Where the primary pointer pressed: an edge it pressed near does not scroll until it moves toward it. */
	#press: { readonly y: number } | null = null;
	readonly #edge = new AxisScroll();
	#from = -1;
	#last = -1;
	#liftedAt = -1;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#raf = 0;
	/** The scroller's visible box in viewport px for the drag in flight, or null when it cannot scroll. */
	#box: { top: number; bottom: number } | null = null;
	#lastFrame = 0;

	constructor(host: CalendarHost) {
		this.#h = host;
		this.#machine = createGestureMachine(
			{},
			{ canDrag: (hit) => hit.kind === 'bar', isSelected: () => false },
		);
	}

	/** Listens on the month's scroller; returns the function that stops. */
	attach(el: HTMLElement): () => void {
		this.#el = el;
		const on = <K extends keyof HTMLElementEventMap>(
			type: K,
			fn: (e: HTMLElementEventMap[K]) => void,
			opts?: AddEventListenerOptions,
		): void => el.addEventListener(type, fn as EventListener, opts);
		on('pointerdown', (e) => {
			// A milestone's or a "+N more" button is a button, not a day.
			if ((e.target as Element | null)?.closest('[data-milestone], [data-more]')) return;
			this.#feed(this.#input('down', e));
		});
		on('pointermove', (e) => {
			if (this.#machine.state !== 'idle') this.#feed(this.#input('move', e));
		});
		on('pointerup', (e) => this.#feed(this.#input('up', e)));
		on('pointercancel', (e) => this.#feed(this.#input('cancel', e)));
		// Only the host's own: a touch is implicitly captured by the day it began on, and that capture
		// ends (and bubbles here) when the machine moves the capture to the host.
		on('lostpointercapture', (e) => {
			if (e.target === el && this.#machine.state === 'dragging') this.#feed({ type: 'reset' });
		});
		// Android fires a contextmenu on a long-press, over the lifted day.
		on('contextmenu', (e) => e.preventDefault());
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

	/** A user scroll of the month: a press before its long-press is a scroll. */
	scrolled(): void {
		if (this.#machine.state === 'pressed') this.#feed({ type: 'scroll', t: performance.now() });
	}

	dispose(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
		this.#timer = null;
		this.#raf = 0;
	}

	/** The day under a viewport point, or -1. */
	#dayAt(x: number, y: number): number {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]');
		const n = el ? Number(el.dataset['day']) : -1;
		return this.#h.valid(n) ? n : -1;
	}

	#hit(x: number, y: number): GestureTarget {
		const d = this.#dayAt(x, y);
		return d >= 0 ? { kind: 'bar', row: d } : { kind: 'empty', row: null, at: 0 };
	}

	#input(type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent): GestureInput {
		const kind = (
			e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse'
		) as PointerKind;
		if (type === 'down' && e.isPrimary) this.#press = { y: e.clientY };
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
			// The days are not painted on a canvas: content and viewport coordinates are the same
			// here, and the machine only compares them with where the press began.
			x: e.clientX,
			y: e.clientY,
			clientX: e.clientX,
			clientY: e.clientY,
			t: e.timeStamp,
			target: this.#hit(e.clientX, e.clientY),
			buttons: e.buttons,
			modifiers: mods(e),
		};
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

	#day(hit: GestureTarget): number {
		return hit.kind === 'bar' ? hit.row : -1;
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
			case 'tap': {
				const d = this.#day(o.hit);
				if (d >= 0) this.#h.tap(d, this.#pointer?.kind === 'touch', o.modifiers.shift);
				return;
			}
			case 'long-press': {
				const d = this.#day(o.hit);
				if (d < 0) return;
				globalThis.navigator?.vibrate?.(10);
				this.lifted = d;
				this.#liftedAt = d;
				this.#h.announce(this.#h.label(d));
				return;
			}
			case 'drag-start': {
				const d = this.#day(o.hit);
				if (d < 0) return;
				this.#from = d;
				this.#last = d;
				this.#liftedAt = -1;
				this.lifted = d;
				this.drag = { lo: d, hi: d };
				this.#pump();
				return;
			}
			case 'drag-move':
				this.#move(this.#day(o.target));
				return;
			case 'drag-end': {
				this.#move(this.#day(o.target));
				const run = this.drag;
				const touch = this.#pointer?.kind === 'touch';
				this.#clear();
				if (run) this.#h.drop(run.lo, run.hi, touch);
				return;
			}
			case 'drag-cancel': {
				const at = this.#liftedAt;
				const touch = this.#pointer?.kind === 'touch';
				this.#clear();
				// A long-press that never moved and was let go acts on that one day.
				if (o.reason === 'back-to-origin' && at >= 0) {
					if (this.#h.mode() === 'select') this.#h.open(at);
					else this.#h.drop(at, at, touch);
				}
				return;
			}
			case 'pinch':
			case 'pinch-end':
			case 'pan2':
			case 'pan-native':
				return;
		}
	}

	/** The drag reached a day (-1: not over one, the run stays). */
	#move(day: number): void {
		if (day < 0 || this.#from < 0 || day === this.#last) return;
		this.#last = day;
		const [lo, hi] = between(this.#from, day);
		this.drag = { lo, hi };
	}

	#clear(): void {
		this.#from = -1;
		this.#last = -1;
		this.#liftedAt = -1;
		this.drag = null;
		this.lifted = null;
		this.#box = null;
	}

	/** Edge auto-scroll of the month while dragging, against its visible box. */
	#pump(): void {
		// The list's box, once per drag (before the frame guard: a frame of the last drag may still
		// be pending): a month that fits (the one that fills the view) has nothing to scroll.
		const list = this.#h.scroller();
		if (list && list.scrollHeight > list.clientHeight) {
			const r = list.getBoundingClientRect();
			this.#box = { top: r.top, bottom: Math.max(r.top, r.bottom - (this.#h.covered?.() ?? 0)) };
		} else this.#box = null;
		if (this.#box && this.#press) this.#edge.begin(this.#press.y, this.#box.top, this.#box.bottom);
		else this.#edge.reset();
		if (this.#raf !== 0) return;
		this.#lastFrame = performance.now();
		const frame = (now: number): void => {
			this.#raf = 0;
			if (this.#machine.state !== 'dragging') return;
			const dt = Math.min(64, now - this.#lastFrame);
			this.#lastFrame = now;
			const p = this.#pointer;
			const sc = this.#h.scroller();
			const r = this.#box;
			if (p && sc && r) {
				const v = this.#edge.velocity(p.clientY, r.top, r.bottom);
				if (v !== 0) {
					sc.scrollTop += (v * dt) / 1000;
					// A synthetic move keeps the machine's lost-release check satisfied.
					this.#feed({
						type: 'move',
						id: p.id,
						kind: p.kind,
						x: p.clientX,
						y: p.clientY,
						clientX: p.clientX,
						clientY: p.clientY,
						t: now,
						target: this.#hit(p.clientX, p.clientY),
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
