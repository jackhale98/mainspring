// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { frameStats, inputLatency, percentile, pipelineOf, scriptTimes } from './perf';

describe('frameStats', () => {
	it('counts on-time frames, the 50 ms ones and the percentiles', () => {
		const frames = [...new Array<number>(95).fill(16.7), 25, 33.4, 33.4, 60, 120];
		const s = frameStats(frames, [70, 130]);
		expect(s.frames).toBe(100);
		expect(s.onTimePct).toBe(95);
		expect(s.over50).toBe(2);
		expect(s.maxMs).toBe(120);
		expect(s.medianMs).toBe(16.7);
		expect(s.loafCount).toBe(2);
		expect(s.loafMaxMs).toBe(130);
	});
	it('reports zeros for no frames', () => {
		const s = frameStats([], []);
		expect(s).toMatchObject({ frames: 0, onTimePct: 0, maxMs: 0, p95Ms: 0 });
	});
	it('takes the percentile by rank', () => {
		expect(percentile([1, 2, 3, 4], 50)).toBe(3);
		expect(percentile([], 95)).toBe(0);
	});
});

const reporter = (state: string, extra: Record<string, unknown> = {}) => ({
	name: 'PipelineReporter',
	ph: 'b',
	args: { frame_reporter: { state, ...extra } },
});

describe('pipelineOf', () => {
	it('counts presented and dropped frames and the checkerboarded ones', () => {
		const p = pipelineOf([
			reporter('STATE_PRESENTED_ALL'),
			reporter('STATE_PRESENTED_PARTIAL', { checkerboarded_needs_raster: true }),
			reporter('STATE_PRESENTED_ALL'),
			reporter('STATE_DROPPED'),
			reporter('STATE_NO_UPDATE_DESIRED'),
			{ name: 'PipelineReporter', ph: 'e' },
		]);
		expect(p).toEqual({ presented: 3, dropped: 1, droppedPct: 25, checkerboardedFrames: 1 });
	});
});

describe('scriptTimes', () => {
	const thread = { ph: 'M', name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } };
	const frame = (ts: number, dur: number) => ({
		ph: 'X',
		name: 'FireAnimationFrame',
		pid: 1,
		tid: 2,
		ts,
		dur,
	});
	const input = (ts: number, dur: number, type: string) => ({
		ph: 'X',
		name: 'EventDispatch',
		pid: 1,
		tid: 2,
		ts,
		dur,
		args: { data: { type } },
	});
	it('puts the move events before a frame into that frame, in ms', () => {
		const s = scriptTimes([
			thread,
			frame(1000, 2000),
			input(1500, 1000, 'pointermove'),
			input(2000, 3000, 'touchmove'),
			input(2100, 9000, 'click'),
			frame(17000, 4000),
			frame(34000, 6000),
		]);
		// Frame 1 (at 17000) gets the two moves (1 + 3 ms), the click is not a move.
		expect(s.input.count).toBe(3);
		expect(s.input.maxMs).toBe(4);
		expect(s.raf).toMatchObject({ count: 3, maxMs: 6 });
	});
	it('ignores other threads and an empty trace', () => {
		const s = scriptTimes([
			thread,
			{ ph: 'X', name: 'FireAnimationFrame', pid: 9, tid: 9, ts: 1, dur: 99_000 },
		]);
		expect(s.raf.count).toBe(0);
		expect(scriptTimes([]).raf.count).toBe(0);
	});
});

describe('inputLatency', () => {
	it('pairs the begin and end of each move span, in ms', () => {
		const ev = (ph: string, ts: number, id: string, name = 'InputLatency::MouseMove') => ({
			name,
			ph,
			ts,
			id,
		});
		const l = inputLatency([
			ev('b', 1000, 'a'),
			ev('b', 2000, 'b'),
			ev('e', 13000, 'a'),
			ev('e', 22000, 'b'),
			ev('b', 3000, 'c', 'InputLatency::MouseDown'),
			ev('e', 90000, 'c', 'InputLatency::MouseDown'),
		]);
		expect(l).toMatchObject({ count: 2, maxMs: 20 });
	});
});
