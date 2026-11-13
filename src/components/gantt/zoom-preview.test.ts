// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEP_IDLE_MS, WHEEL_IDLE_MS, ZoomPreview, type ZoomPreviewHost } from './zoom-preview';

interface TestHost extends ZoomPreviewHost {
	zoomValue: number;
	commits: Array<[number, number, number]>;
}

function setup() {
	const space = document.createElement('div');
	const host: TestHost = {
		zoomValue: 16,
		commits: [] as Array<[number, number, number]>,
		space: () => space,
		zoom: () => host.zoomValue,
		minuteAt: (x: number) => x * 10,
		contentX: (x: number) => 1000 + x,
		clamp: (z: number) => Math.min(96, Math.max(0.8, z)),
		commit: (target: number, min: number, x: number) => {
			host.commits.push([target, min, x]);
			host.zoomValue = target;
			preview.settled();
		},
	};
	const preview = new ZoomPreview(host);
	return { space, host, preview };
}

beforeEach(() => {
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
	});
});
afterEach(() => {
	vi.useRealTimers();
});

describe('ZoomPreview', () => {
	it('stretches at once and commits once, after the idle time', () => {
		const { space, host, preview } = setup();
		preview.step(32, 200);
		expect(space.style.getPropertyValue('--zoom-ratio')).toBe('2');
		expect(space.style.getPropertyValue('--zoom-origin')).toBe('1200px');
		expect(preview.target).toBe(32);
		expect(host.commits).toEqual([]);
		vi.advanceTimersByTime(STEP_IDLE_MS - 1);
		expect(host.commits).toEqual([]);
		vi.advanceTimersByTime(1);
		// The anchor is the minute under the point when the preview began.
		expect(host.commits).toEqual([[32, 2000, 200]]);
	});

	it('takes the stretch off in the frame after the commit, not before', () => {
		const { space, preview } = setup();
		preview.step(32, 0);
		vi.advanceTimersByTime(STEP_IDLE_MS);
		expect(space.style.getPropertyValue('--zoom-ratio')).toBe('2');
		vi.advanceTimersByTime(20);
		expect(space.style.getPropertyValue('--zoom-ratio')).toBe('');
		expect(preview.target).toBeNull();
	});

	it('adds up a burst of wheel events into one stretch per frame and one commit', () => {
		const { space, host, preview } = setup();
		for (let i = 0; i < 5; i++) preview.wheel(-100, 300);
		// Nothing is applied until the frame.
		expect(space.style.getPropertyValue('--zoom-ratio')).toBe('');
		vi.advanceTimersByTime(20);
		const ratio = Number(space.style.getPropertyValue('--zoom-ratio'));
		expect(ratio).toBeCloseTo(Math.exp(1), 5);
		// More wheel keeps the same anchor and pushes the commit back.
		vi.advanceTimersByTime(WHEEL_IDLE_MS - 40);
		preview.wheel(-100, 900);
		vi.advanceTimersByTime(20);
		expect(host.commits).toEqual([]);
		vi.advanceTimersByTime(WHEEL_IDLE_MS);
		expect(host.commits).toHaveLength(1);
		const [target, minute, x] = host.commits[0] ?? [0, 0, 0];
		expect(target).toBeCloseTo(16 * Math.exp(1) * Math.exp(0.2), 5);
		expect(minute).toBe(3000);
		expect(x).toBe(300);
	});

	it('clamps the zoom', () => {
		const { space, preview } = setup();
		preview.wheel(-10_000, 0);
		vi.advanceTimersByTime(20);
		expect(preview.target).toBe(96);
		expect(space.style.getPropertyValue('--zoom-ratio')).toBe('6');
	});

	it('does not commit after it was disposed', () => {
		const { host, preview } = setup();
		preview.step(32, 0);
		preview.dispose();
		vi.advanceTimersByTime(1000);
		expect(host.commits).toEqual([]);
	});

	it('leaves the stretch of a newer preview alone when an older one settles', () => {
		const { space, host, preview } = setup();
		preview.step(32, 0);
		vi.advanceTimersByTime(STEP_IDLE_MS);
		expect(host.commits).toHaveLength(1);
		// A new zoom begins in the same frame as the settle.
		preview.step(64, 0);
		vi.advanceTimersByTime(20);
		expect(space.style.getPropertyValue('--zoom-ratio')).toBe('2');
	});
});
