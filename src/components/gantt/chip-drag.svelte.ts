// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dragging a person from the people palette onto a bar (phase-2.md 7.1 R6; mouse and pen). The
 * press is on a chip, and the shared gesture controller decides when it is a drag (3 px; Escape or
 * a lost pointer cancels with no edit). A chip is a `row-handle` target whose `row` is its place in
 * the palette, because the controller only needs to know that something is being dragged from
 * here; where it lands is read from the pointer. While it moves the bar under it is the target
 * (`view.row`), and the drop is one `assign` action. A finger books people from the details
 * sheet, and a keyboard from the chip itself (Enter or Space): WCAG 2.5.7's alternatives.
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
import { gestureStrings } from '../../lib/strings';

export interface ChipDragHost {
	/** The bar row under a viewport point, or null off any bar. */
	rowAt(clientX: number, clientY: number): number | null;
	/** The drop on a bar. */
	drop(chip: number, row: number): void;
	announce(text: string): void;
}

export interface ChipDragView {
	readonly chip: number;
	/** The pointer, in viewport px, for the ghost chip. */
	readonly x: number;
	readonly y: number;
	/** The bar it is over, or null. */
	readonly row: number | null;
}

const mods = (e: PointerEvent): Modifiers => ({
	shift: e.shiftKey,
	alt: e.altKey,
	ctrl: e.ctrlKey,
	meta: e.metaKey,
});

export class ChipDrag {
	view = $state.raw<ChipDragView | null>(null);
	readonly #h: ChipDragHost;
	readonly #ctl: GestureController;
	#chip = -1;
	#off: (() => void) | null = null;

	constructor(host: ChipDragHost) {
		this.#h = host;
		this.#ctl = createGestureController(
			{ minutesAt: (x) => x, snap: calendarDragSnapper() },
			{},
			{ canDrag: () => true, isSelected: () => false },
		);
	}

	get dragging(): boolean {
		return this.view !== null;
	}

	/** A press on chip number `chip` of the palette. */
	down(e: PointerEvent, chip: number): void {
		if (this.#ctl.state !== 'idle' || e.pointerType === 'touch') return;
		this.#chip = chip;
		const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
		const send = (type: 'move' | 'up' | 'cancel') => (ev: PointerEvent) => this.#feed(type, ev, el);
		const move = send('move');
		const up = send('up');
		const cancel = send('cancel');
		const escape = (ev: KeyboardEvent): void => {
			if (ev.key === 'Escape') this.#send({ type: 'escape' });
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('keydown', escape, true);
		this.#off = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
			window.removeEventListener('keydown', escape, true);
		};
		this.#feed('down', e, el);
	}

	#feed(type: 'down' | 'move' | 'up' | 'cancel', e: PointerEvent, el: HTMLElement | null): void {
		const kind = (e.pointerType === 'pen' ? 'pen' : 'mouse') as PointerKind;
		this.#send(
			{
				type,
				id: e.pointerId,
				kind,
				x: e.clientX,
				y: e.clientY,
				clientX: e.clientX,
				clientY: e.clientY,
				t: e.timeStamp,
				target: { kind: 'row-handle', row: this.#chip },
				buttons: e.buttons,
				modifiers: mods(e),
			},
			el,
		);
	}

	#send(input: GestureInput, el: HTMLElement | null = null): void {
		for (const i of this.#ctl.send(input)) this.#act(i, el);
		if (this.#ctl.state === 'idle') {
			this.#off?.();
			this.#off = null;
		}
	}

	#act(i: GestureIntent, el: HTMLElement | null): void {
		switch (i.type) {
			case 'capture':
				try {
					el?.setPointerCapture(i.id);
				} catch {
					// The pointer is gone.
				}
				return;
			case 'release':
				try {
					if (el?.hasPointerCapture(i.id)) el.releasePointerCapture(i.id);
				} catch {
					// Already released.
				}
				return;
			case 'drag-move':
				this.view = { chip: this.#chip, x: i.x, y: i.y, row: this.#h.rowAt(i.x, i.y) };
				return;
			case 'drag-end': {
				const row = this.#h.rowAt(i.x, i.y);
				this.view = null;
				if (row !== null) this.#h.drop(this.#chip, row);
				else this.#h.announce(gestureStrings.live.cancelled);
				return;
			}
			case 'cancel':
				this.view = null;
				if (i.reason === 'escape') this.#h.announce(gestureStrings.live.cancelled);
				return;
			default:
				return;
		}
	}

	dispose(): void {
		this.#off?.();
		this.#off = null;
		this.view = null;
	}
}
