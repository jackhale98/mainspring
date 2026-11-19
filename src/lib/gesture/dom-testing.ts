// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Helpers for tests of the DOM pointer wiring (jsdom): a pointer event with the fields the wiring
 * reads, and a scroll container whose geometry is set by the test (jsdom has no layout).
 * Test-only (imported by *.test.ts alone), so it has no test of its own. Its pointer events are
 * primary; a second-pointer path needs its own event.
 */

export interface PointerInit {
	readonly x: number;
	readonly y: number;
	readonly id?: number;
	readonly type?: 'mouse' | 'touch' | 'pen';
	readonly buttons?: number;
}

/** A `pointerdown`, `pointermove`, `pointerup` or `pointercancel` at a client point. */
export function pointerEvent(name: string, p: PointerInit): PointerEvent {
	const e = new MouseEvent(name, {
		bubbles: true,
		cancelable: true,
		clientX: p.x,
		clientY: p.y,
		buttons: p.buttons ?? (name === 'pointerup' ? 0 : 1),
	});
	Object.defineProperties(e, {
		pointerId: { value: p.id ?? 1 },
		pointerType: { value: p.type ?? 'mouse' },
		isPrimary: { value: true },
	});
	return e as unknown as PointerEvent;
}

/** A scroll container `width` by `height` px at (`left`, `top`) with content of the given size. */
export function fakeScroller(o: {
	left?: number;
	top?: number;
	width: number;
	height: number;
	contentHeight?: number;
	contentWidth?: number;
}): HTMLElement {
	const el = document.createElement('div');
	const left = o.left ?? 0;
	const top = o.top ?? 0;
	const rect = {
		left,
		top,
		right: left + o.width,
		bottom: top + o.height,
		width: o.width,
		height: o.height,
		x: left,
		y: top,
		toJSON: () => ({}),
	};
	el.getBoundingClientRect = () => rect as DOMRect;
	Object.defineProperties(el, {
		clientHeight: { value: o.height },
		clientWidth: { value: o.width },
		scrollHeight: { value: o.contentHeight ?? o.height },
		scrollWidth: { value: o.contentWidth ?? o.width },
	});
	return el;
}
