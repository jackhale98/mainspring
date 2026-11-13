// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ctrlWheel } from './ctrl-wheel';

function setup() {
	const node = document.createElement('div');
	document.body.append(node);
	const handler = vi.fn();
	const action = ctrlWheel(node, { handler });
	return { node, handler, action };
}

const wheel = (init: WheelEventInit): WheelEvent =>
	new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
const key = (type: 'keydown' | 'keyup', k: string): void => {
	window.dispatchEvent(new KeyboardEvent(type, { key: k }));
};

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ctrlWheel', () => {
	it('does not listen for wheel events until Ctrl or Cmd is down, so scrolling stays on the compositor', () => {
		const { node, handler, action } = setup();
		const plain = wheel({ ctrlKey: true });
		node.dispatchEvent(plain);
		expect(handler).not.toHaveBeenCalled();
		expect(plain.defaultPrevented).toBe(false);
		key('keydown', 'Control');
		const zoom = wheel({ ctrlKey: true, deltaY: -100 });
		node.dispatchEvent(zoom);
		expect(handler).toHaveBeenCalledOnce();
		expect(zoom.defaultPrevented).toBe(true);
		action.destroy();
	});

	it('ignores wheel events without the modifier, and stops listening on key up', () => {
		const { node, handler, action } = setup();
		key('keydown', 'Meta');
		const scroll = wheel({ deltaY: 100 });
		node.dispatchEvent(scroll);
		expect(handler).not.toHaveBeenCalled();
		expect(scroll.defaultPrevented).toBe(false);
		key('keyup', 'Meta');
		node.dispatchEvent(wheel({ metaKey: true }));
		expect(handler).not.toHaveBeenCalled();
		action.destroy();
	});

	it('stops listening when the window loses focus, and when the action is destroyed', () => {
		const { node, handler, action } = setup();
		key('keydown', 'Control');
		window.dispatchEvent(new Event('blur'));
		node.dispatchEvent(wheel({ ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
		key('keydown', 'Control');
		action.destroy();
		key('keydown', 'Control');
		node.dispatchEvent(wheel({ ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
	});

	it('listens while a mouse is over the element, so a trackpad pinch (Ctrl+wheel, no key) zooms the chart', () => {
		const { node, handler, action } = setup();
		const enter = new Event('pointerenter') as PointerEvent;
		Object.defineProperty(enter, 'pointerType', { value: 'mouse' });
		node.dispatchEvent(enter);
		const pinch = wheel({ ctrlKey: true, deltaY: -4 });
		node.dispatchEvent(pinch);
		expect(handler).toHaveBeenCalledOnce();
		expect(pinch.defaultPrevented).toBe(true);
		// A plain scroll is left alone while hovering.
		const scroll = wheel({ deltaY: 80 });
		node.dispatchEvent(scroll);
		expect(scroll.defaultPrevented).toBe(false);
		node.dispatchEvent(new Event('pointerleave'));
		node.dispatchEvent(wheel({ ctrlKey: true }));
		expect(handler).toHaveBeenCalledOnce();
		action.destroy();
	});

	it('keeps listening on leave while the modifier is held, and never attaches for touch', () => {
		const { node, handler, action } = setup();
		const touch = new Event('pointerenter') as PointerEvent;
		Object.defineProperty(touch, 'pointerType', { value: 'touch' });
		node.dispatchEvent(touch);
		node.dispatchEvent(wheel({ ctrlKey: true }));
		expect(handler).not.toHaveBeenCalled();
		key('keydown', 'Control');
		const enter = new Event('pointerenter') as PointerEvent;
		Object.defineProperty(enter, 'pointerType', { value: 'pen' });
		node.dispatchEvent(enter);
		node.dispatchEvent(new Event('pointerleave'));
		node.dispatchEvent(wheel({ ctrlKey: true }));
		expect(handler).toHaveBeenCalledOnce();
		action.destroy();
	});

	it('uses the newest handler after an update', () => {
		const { node, handler, action } = setup();
		const next = vi.fn();
		action.update({ handler: next });
		key('keydown', 'Control');
		node.dispatchEvent(wheel({ ctrlKey: true }));
		expect(next).toHaveBeenCalledOnce();
		expect(handler).not.toHaveBeenCalled();
		action.destroy();
	});
});
