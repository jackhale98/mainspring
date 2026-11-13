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
