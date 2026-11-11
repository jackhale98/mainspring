// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ROUNDING_MS, splitByReady, windowStats, type MonitorData } from './responsiveness-monitor';

describe('splitByReady', () => {
	it('counts the task that handled the ready message as post-ready despite truncation', () => {
		// Seen in Chromium: a 60 ms task whose reported end is 0.3 ms before the mark it set.
		const task = { start: 72.9, duration: 60 };
		const { boot, afterReady } = splitByReady([task], 133.2);
		expect(boot).toEqual([]);
		expect(afterReady).toEqual([task]);
	});

	it('counts tasks that ended clearly before ready as boot', () => {
		const early = { start: 500, duration: 97 };
		const late = { start: 1500, duration: 70 };
		const { boot, afterReady } = splitByReady([early, late], 1400);
		expect(boot).toEqual([early]);
		expect(afterReady).toEqual([late]);
	});

	it('treats a task ending exactly ROUNDING_MS before ready as post-ready', () => {
		const t = { start: 0, duration: 99 };
		expect(splitByReady([t], 99 + ROUNDING_MS).afterReady).toEqual([t]);
		expect(splitByReady([t], 99 + ROUNDING_MS + 0.01).boot).toEqual([t]);
	});
});

describe('windowStats', () => {
	const data: MonitorData = {
		longTasks: [
			{ start: 10, duration: 60 },
			{ start: 200, duration: 55 },
		],
		frames: [
			{ at: 20, gapMs: 16 },
			{ at: 120, gapMs: 100 },
			{ at: 300, gapMs: 30 },
		],
		events: [
			{ name: 'keydown', startTime: 50, duration: 144, processingStart: 90 },
			{ name: 'keydown', startTime: 250, duration: 48, processingStart: 252 },
		],
		keys: [50, 150, 250, 350],
	};

	it('keeps only what falls in the window, overlapping long tasks included', () => {
		const s = windowStats(data, 100, 260);
		expect(s.longTasks).toEqual([{ start: 200, duration: 55 }]);
		expect(s.maxFrameGapMs).toBe(100);
		expect(s.maxEventMs).toBe(48);
		expect(s.maxInputDelayMs).toBe(2);
		expect(s.keyCount).toBe(2);
	});

	it('includes a long task that started before the window but overlaps it', () => {
		expect(windowStats(data, 50, 60).longTasks).toEqual([{ start: 10, duration: 60 }]);
	});

	it('reports zeros for an empty window', () => {
		expect(windowStats(data, 1000, 2000)).toEqual({
			longTasks: [],
			maxFrameGapMs: 0,
			maxEventMs: 0,
			maxInputDelayMs: 0,
			keyCount: 0,
		});
	});

	it('handles many frames without spreading them into Math.max', () => {
		const frames = Array.from({ length: 200_000 }, (_, i) => ({
			at: i,
			gapMs: i === 777 ? 42 : 16,
		}));
		expect(windowStats({ ...data, frames }, 0, 200_000).maxFrameGapMs).toBe(42);
	});
});
