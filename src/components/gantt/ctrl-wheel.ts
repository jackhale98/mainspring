// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A Svelte action: calls `handler` for wheel events with Ctrl or Cmd held, and cancels them (so
 * the browser does not zoom the page). It is an action, not an `onMount` listener, because the
 * element it belongs to is created and replaced after the component mounts.
 *
 * A non-passive wheel listener makes the browser wait for the main thread before it scrolls, on
 * every wheel event. So the listener is attached only while it can be needed:
 * - while Ctrl or Cmd is down (tracked on the window), removed when it is released or the window
 *   loses focus;
 * - while a mouse or pen pointer is over the element, because a trackpad pinch arrives as a
 *   Ctrl+wheel with no key down, and nothing announces it beforehand.
 *
 * Decision (phase-2.md 8.2, "pinch is ours"; recorded in ADR-0009's consequences): a pinch over
 * the chart zooms the chart, not the page. The app is a fixed shell like a native app, and the
 * page-level zoom stays available from the keyboard (Ctrl and plus) and the browser menu, so
 * WCAG 1.4.4 is still met. The price is a wheel listener that waits for the main thread while a
 * mouse is over the chart; it returns at once for an event without a modifier, and T22 measures
 * the scroll cost. Touch never attaches it: a two-finger pinch on a phone is the gesture
 * machine's (T9), and the chart has `touch-action: pan-x pan-y`.
 */
export interface CtrlWheelOptions {
	handler: (event: WheelEvent) => void;
}

const isModifier = (e: KeyboardEvent): boolean => e.key === 'Control' || e.key === 'Meta';

export function ctrlWheel(node: HTMLElement, options: CtrlWheelOptions) {
	let current = options;
	let attached = false;
	const onWheel = (e: WheelEvent): void => {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		current.handler(e);
	};
	const attach = (): void => {
		if (attached) return;
		attached = true;
		node.addEventListener('wheel', onWheel, { passive: false });
	};
	const detach = (): void => {
		if (!attached) return;
		attached = false;
		node.removeEventListener('wheel', onWheel);
	};
	let held = false;
	let over = false;
	const onKeyDown = (e: KeyboardEvent): void => {
		if (!isModifier(e)) return;
		held = true;
		attach();
	};
	const onKeyUp = (e: KeyboardEvent): void => {
		if (!isModifier(e)) return;
		held = false;
		if (!over) detach();
	};
	const onBlur = (): void => {
		held = false;
		over = false;
		detach();
	};
	const onEnter = (e: PointerEvent): void => {
		if (e.pointerType === 'touch') return;
		over = true;
		attach();
	};
	const onLeave = (): void => {
		over = false;
		if (!held) detach();
	};
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);
	node.addEventListener('pointerenter', onEnter);
	node.addEventListener('pointerleave', onLeave);
	return {
		update(next: CtrlWheelOptions): void {
			current = next;
		},
		destroy(): void {
			detach();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', onLeave);
		},
	};
}
