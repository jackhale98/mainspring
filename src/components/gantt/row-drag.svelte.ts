// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dragging a row in the task list to reorder or reparent it (phase-2.md 7.1 R5). The press is on
 * the row's grip, and the shared gesture controller (`row-handle` targets, mode `row`) decides
 * when it is a drag: a mouse after 3 px, a finger after the 350 ms long-press, Escape or a lost
 * pointer cancels with no edit. The pointer's height picks the boundary between two rows and how
 * far it moved sideways picks the depth, one indent step (16 px) per level (reorder.ts); a drop
 * line shows exactly where the row would go, and a collapsed container the row is held over opens
 * after 600 ms. The drop is one `reorder` action: `moveTask(task, parent, index)`.
 *
 * The listeners go on the window while a press is down, so the drag follows the pointer wherever
 * it goes. The task list's rows are DOM, so the line and the label are DOM too (OutlineGrid.svelte);
 * nothing here paints, and nothing changes the plan before the drop.
 */
import {
	calendarDragSnapper,
	createGestureController,
	type GestureController,
	type GestureInput,
	type GestureIntent,
	type Modifiers,
	type PointerKind,
} from '../../lib/gesture';
import {
	boundaryAt,
	dropTarget,
	wantedDepth,
	type Drop,
	type DropRow,
	type Tree,
} from '../../lib/gantt/reorder';
import type { Box } from '../../lib/gantt/viewport';
import { autoScrollVelocity } from '../../lib/gesture';
import { gestureStrings } from '../../lib/strings';

export interface RowDragHost {
	rows(): readonly DropRow[];
	tree(): Tree;
	roots(): readonly string[];
	rowHeight(): number;
	/** The client y of the top of the first row (it moves with the scroll). */
	bodyTop(): number;
	/** The visible rows' area in viewport px, for the edge auto-scroll. */
	visible(): Box;
	scroller(): HTMLElement | undefined;
	nameOf(key: string): string;
	/** Opens a collapsed container. */
	open(key: string): void;
	/** The drop: `moveTask`. */
	move(key: string, parent: string | null, index: number): void;
	announce(text: string): void;
}

/** What the task list draws while a row is dragged. */
export interface RowDragView {
	readonly dragged: string;
	/** The drop line goes above this visible row (the row count for the end). */
	readonly lineRow: number;
	readonly depth: number;
	/** False where the drop would change nothing, or cannot be made. */
	readonly valid: boolean;
	readonly label: string;
	/** The pointer's client position, for the label. */
	readonly x: number;
	readonly y: number;
}

export const OPEN_AFTER_MS = 600;

const mods = (e: PointerEvent): Modifiers => ({
	shift: e.shiftKey,
	alt: e.altKey,
	ctrl: e.ctrlKey,
	meta: e.metaKey,
});

export class RowDrag {
	view = $state.raw<RowDragView | null>(null);
	readonly #h: RowDragHost;
	readonly #ctl: GestureController;
	#key: string | null = null;
	#grip: HTMLElement | null = null;
	#drop: Drop | null = null;
	#last: { id: number; kind: PointerKind; x: number; y: number; m: Modifiers } | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#open: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
	#raf = 0;
	#lastFrame = 0;
	#off: (() => void) | null = null;

	constructor(host: RowDragHost) {
		this.#h = host;
		this.#ctl = createGestureController(
			{ minutesAt: (x) => x, snap: calendarDragSnapper() },
			{},
			{ canDrag: () => true, isSelected: () => false },
		);
	}

	get dragging(): boolean {
		return this.#ctl.state === 'dragging';
	}

	/** Cancels the touch's native scroll while a lifted row is dragged (8.2): once, on the list. */
	attach(el: HTMLElement): () => void {
		const fn = (e: TouchEvent): void => {
			if (this.#ctl.claimsTouch && e.cancelable) e.preventDefault();
		};
		el.addEventListener('touchmove', fn, { passive: false });
		return () => {
			el.removeEventListener('touchmove', fn);
			this.dispose();
		};
	}

	/** A press on the grip of row `key` (a visible row, by key). */
	down(e: PointerEvent, key: string): void {
		if (this.#ctl.state !== 'idle') return;
		const row = this.#h.rows().findIndex((r) => r.key === key);
		if (row < 0) return;
		this.#key = key;
		this.#grip = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
		const move = (ev: PointerEvent): void => this.#event('move', ev);
		const up = (ev: PointerEvent): void => this.#event('up', ev);
		const cancel = (ev: PointerEvent): void => this.#event('cancel', ev);
		const escape = (ev: KeyboardEvent): void => {
			if (ev.key === 'Escape') this.#feed({ type: 'escape' });
		};
		const reset = (): void => void this.#feed({ type: 'reset' });
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('keydown', escape, true);
		window.addEventListener('blur', reset);
		this.#off = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
			window.removeEventListener('keydown', escape, true);
			window.removeEventListener('blur', reset);
		};
		this.#event('down', e, row);
	}

	#event(type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent, row?: number): void {
		const sc = this.#h.scroller();
		const kind = (
			e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse'
		) as PointerKind;
		const index = row ?? this.#h.rows().findIndex((r) => r.key === this.#key);
		this.#last = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, m: mods(e) };
		this.#feed({
			type,
			id: e.pointerId,
			kind,
			x: e.clientX + (sc?.scrollLeft ?? 0),
			y: e.clientY + (sc?.scrollTop ?? 0),
			clientX: e.clientX,
			clientY: e.clientY,
			t: e.timeStamp,
			target: { kind: 'row-handle', row: index },
			buttons: e.buttons,
			modifiers: mods(e),
		});
	}

	#feed(input: GestureInput): void {
		for (const i of this.#ctl.send(input)) this.#act(i);
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		const at = this.#ctl.timerAt;
		if (at !== null) {
			this.#timer = setTimeout(
				() => this.#feed({ type: 'timer', t: performance.now() }),
				Math.max(0, at - performance.now()),
			);
		}
		if (this.#ctl.state === 'idle' && this.#key !== null) this.#finish();
	}

	#act(i: GestureIntent): void {
		switch (i.type) {
			case 'capture':
				try {
					this.#grip?.setPointerCapture(i.id);
				} catch {
					// The pointer is gone.
				}
				return;
			case 'release':
				try {
					if (this.#grip?.hasPointerCapture(i.id)) this.#grip.releasePointerCapture(i.id);
				} catch {
					// Already released.
				}
				return;
			case 'long-press':
				globalThis.navigator?.vibrate?.(10);
				this.#h.announce(gestureStrings.live.lifted(this.#h.nameOf(this.#key ?? '')));
				return;
			case 'drag-start':
				this.#pump();
				return;
			case 'drag-move':
				return this.#show(i.dx);
			case 'drag-end': {
				const key = this.#key;
				const drop = this.#drop;
				this.#clear();
				if (key && drop && !drop.same) this.#h.move(key, drop.parent, drop.index);
				else this.#h.announce(gestureStrings.live.cancelled);
				return;
			}
			case 'cancel':
				this.#clear();
				if (i.reason === 'escape') this.#h.announce(gestureStrings.live.cancelled);
				return;
			default:
				return;
		}
	}

	/** The line and the label for the pointer's place (a boundary, a depth). */
	#show(dx: number): void {
		const key = this.#key;
		const p = this.#last;
		if (!key || !p) return;
		const rows = this.#h.rows();
		const own = rows.find((r) => r.key === key)?.depth ?? 0;
		const boundary = boundaryAt(p.y - this.#h.bodyTop(), this.#h.rowHeight(), rows.length);
		const drop = dropTarget(
			rows,
			this.#h.tree(),
			this.#h.roots(),
			key,
			boundary,
			wantedDepth(own, dx),
		);
		this.#drop = drop;
		if (!drop) {
			this.view = null;
			return;
		}
		const parent = drop.parentKey === null ? null : this.#h.nameOf(drop.parentKey);
		this.view = {
			dragged: key,
			lineRow: drop.lineRow,
			depth: drop.depth,
			valid: !drop.same,
			label: gestureStrings.live.rowDrop(parent, drop.index + 1),
			x: p.x,
			y: p.y,
		};
		this.#watchOpen(drop.opens);
	}

	/** A collapsed container the row is held over opens after a pause. */
	#watchOpen(key: string | null): void {
		if (this.#open?.key === key) return;
		if (this.#open) clearTimeout(this.#open.timer);
		this.#open = null;
		if (key === null) return;
		this.#open = {
			key,
			timer: setTimeout(() => {
				this.#open = null;
				this.#h.open(key);
			}, OPEN_AFTER_MS),
		};
	}

	/** Each frame of a drag: scroll the list toward a near edge, and keep the line with it. */
	#pump(): void {
		if (this.#raf !== 0) return;
		this.#lastFrame = performance.now();
		const frame = (now: number): void => {
			this.#raf = 0;
			if (this.#ctl.state !== 'dragging') return;
			const dt = Math.min(64, now - this.#lastFrame);
			this.#lastFrame = now;
			const p = this.#last;
			const sc = this.#h.scroller();
			if (p && sc) {
				const box = this.#h.visible();
				const v = autoScrollVelocity(p.y, box.top, box.bottom);
				if (v !== 0) {
					sc.scrollTop += (v * dt) / 1000;
					const index = this.#h.rows().findIndex((r) => r.key === this.#key);
					this.#feed({
						type: 'move',
						id: p.id,
						kind: p.kind,
						x: p.x + sc.scrollLeft,
						y: p.y + sc.scrollTop,
						clientX: p.x,
						clientY: p.y,
						t: now,
						target: { kind: 'row-handle', row: index },
						buttons: 1,
						modifiers: p.m,
					});
				}
			}
			this.#raf = requestAnimationFrame(frame);
		};
		this.#raf = requestAnimationFrame(frame);
	}

	#clear(): void {
		this.view = null;
		this.#drop = null;
		if (this.#open) clearTimeout(this.#open.timer);
		this.#open = null;
	}

	#finish(): void {
		this.#off?.();
		this.#off = null;
		this.#key = null;
		this.#grip = null;
		this.#last = null;
	}

	dispose(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
		this.#timer = null;
		this.#raf = 0;
		this.#clear();
		this.#finish();
	}
}
