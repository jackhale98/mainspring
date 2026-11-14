// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { KeyTimers } from '../tjp/cm/android-key';
import { ButtonHold, HOLD_MS, type HoldPointer } from './button-hold';

/** A manual clock: timers run when `advance` passes them. */
function clock(): KeyTimers & { advance(ms: number): void; pending(): number } {
	let now = 0;
	let id = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	return {
		setTimeout(fn, ms) {
			timers.set(++id, { at: now + ms, fn });
			return id;
		},
		clearTimeout(h) {
			timers.delete(h as number);
		},
		advance(ms) {
			now += ms;
			for (const [k, t] of [...timers]) {
				if (t.at <= now) {
					timers.delete(k);
					t.fn();
				}
			}
		},
		pending: () => timers.size,
	};
}

const p = (o: Partial<HoldPointer> = {}): HoldPointer => ({
	pointerId: 1,
	pointerType: 'touch',
	button: 0,
	clientX: 100,
	clientY: 100,
	...o,
});

describe('ButtonHold', () => {
	it('fires once after the hold time and swallows the click that follows', () => {
		const c = clock();
		const onhold = vi.fn();
		const h = new ButtonHold(onhold, c);
		h.down(p());
		c.advance(HOLD_MS - 1);
		expect(onhold).not.toHaveBeenCalled();
		c.advance(1);
		expect(onhold).toHaveBeenCalledOnce();
		h.end();
		expect(h.consumeClick()).toBe(true);
		expect(h.consumeClick()).toBe(false);
	});

	it('a tap is not a hold: the click goes through', () => {
		const c = clock();
		const onhold = vi.fn();
		const h = new ButtonHold(onhold, c);
		h.down(p());
		c.advance(120);
		h.end();
		c.advance(2000);
		expect(onhold).not.toHaveBeenCalled();
		expect(h.consumeClick()).toBe(false);
		expect(c.pending()).toBe(0);
	});

	it('moving past the slop ends the press (a finger scrolls), within it does not', () => {
		const c = clock();
		const onhold = vi.fn();
		const h = new ButtonHold(onhold, c);
		h.down(p());
		h.move(p({ clientX: 107 }));
		c.advance(HOLD_MS);
		expect(onhold).toHaveBeenCalledOnce();
		h.end();
		h.down(p());
		h.move(p({ clientY: 109 }));
		c.advance(HOLD_MS);
		expect(onhold).toHaveBeenCalledOnce();
	});

	it('ignores another pointer and a mouse right click', () => {
		const c = clock();
		const onhold = vi.fn();
		const h = new ButtonHold(onhold, c);
		h.down(p());
		h.move(p({ pointerId: 2, clientX: 500 }));
		c.advance(HOLD_MS);
		expect(onhold).toHaveBeenCalledOnce();
		h.down(p({ pointerType: 'mouse', button: 2 }));
		c.advance(HOLD_MS);
		expect(onhold).toHaveBeenCalledOnce();
	});

	it('a new press clears the old verdict; markFired covers the context menu', () => {
		const c = clock();
		const h = new ButtonHold(() => undefined, c);
		h.down(p());
		c.advance(HOLD_MS);
		h.down(p());
		expect(h.consumeClick()).toBe(false);
		h.markFired();
		c.advance(HOLD_MS * 2);
		expect(h.consumeClick()).toBe(true);
	});
});
