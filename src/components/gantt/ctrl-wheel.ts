// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A Svelte action: calls `handler` for wheel events with Ctrl or Cmd held, and cancels them (so
 * the browser does not zoom the page). It is an action, not an `onMount` listener, because the
 * element it belongs to is created and replaced after the component mounts.
 *
 * A non-passive wheel listener makes the browser wait for the main thread before it scrolls, on
 * every wheel event. So the listener is attached only while Ctrl or Cmd is down (tracked on the
 * window) and removed when it is released or the window loses focus. A trackpad pinch, which
 * arrives as a Ctrl+wheel with no key down, is left to the browser.
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
	const onKeyDown = (e: KeyboardEvent): void => {
		if (isModifier(e)) attach();
	};
	const onKeyUp = (e: KeyboardEvent): void => {
		if (isModifier(e)) detach();
	};
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', detach);
	return {
		update(next: CtrlWheelOptions): void {
			current = next;
		},
		destroy(): void {
			detach();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', detach);
		},
	};
}
