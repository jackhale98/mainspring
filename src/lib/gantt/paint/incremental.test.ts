// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { Rect } from '../layout';
import { D, modelOf, row } from '../testing';
import { IncrementalLayer } from './incremental';
import { frameOf } from './testing';

const model = modelOf([row(0, 0, 2 * D)]);

function setup(opts: { budgetMs?: number; chunkH?: number } = {}) {
	let now = 0;
	const queue: Array<(() => void) | null> = [];
	const areas: Rect[] = [];
	const layer = new IncrementalLayer(
		(_f, area) => {
			areas.push({ ...area });
			// A piece costs a millisecond of the fake clock.
			now += 1;
		},
		{
			now: () => now,
			schedule: (cb) => queue.push(cb),
			cancel: (h) => {
				queue[h - 1] = null;
			},
			...opts,
		},
	);
	const at = (x: number, y: number, w = 400, h = 300, dpr = 1) =>
		frameOf(model, { win: { x, y, w, h }, dpr });
	const flush = (): number => {
		const run = queue.splice(0).filter((cb) => cb !== null);
		for (const cb of run) cb();
		return run.length;
	};
	return { layer, areas, at, flush };
}

describe('IncrementalLayer', () => {
	it('paints the whole window the first time, and nothing when nothing changed', () => {
		const { layer, areas, at } = setup();
		const a = at(0, 0);
		layer.paint(a.frame, ['k']);
		expect(areas).toEqual([{ x: 0, y: 0, w: 400, h: 300 }]);
		expect(a.rec.of('clearRect')).toHaveLength(1);
		areas.length = 0;
		layer.paint(at(0, 0).frame, ['k']);
		expect(areas).toEqual([]);
		expect(layer.window).toEqual({ x: 0, y: 0, w: 400, h: 300 });
	});

	it('repaints in full for a change of keys, of window size, of pixel ratio, or of a move not sliced', () => {
		const { layer, areas, at } = setup();
		layer.paint(at(0, 0).frame, ['k']);
		const next = at(0, 100).frame;
		layer.paint(next, ['other']);
		expect(areas.at(-1)).toEqual(next.win);
		areas.length = 0;
		// A move with the same keys is a full paint unless the caller allows slicing.
		const moved = at(0, 150).frame;
		layer.paint(moved, ['other']);
		expect(areas).toEqual([moved.win]);
		areas.length = 0;
		const wider = at(0, 150, 500, 300).frame;
		layer.paint(wider, ['other']);
		expect(areas).toEqual([wider.win]);
		areas.length = 0;
		const dpr = at(0, 150, 500, 300, 2).frame;
		layer.paint(dpr, ['other']);
		expect(areas).toEqual([dpr.win]);
	});

	it('never copies the canvas onto itself, which costs more than painting', () => {
		const { layer, at } = setup();
		layer.paint(at(0, 0).frame, ['k'], { sliced: true });
		const moved = at(0, 100);
		layer.paint(moved.frame, ['k'], { sliced: true });
		expect(moved.rec.of('drawImage')).toHaveLength(0);
	});

	it('paints a moved window in bands, the middle first and then outwards, within a budget per frame', () => {
		const { layer, areas, at, flush } = setup({ budgetMs: 2, chunkH: 100 });
		layer.paint(at(0, 0, 400, 500).frame, ['k'], { sliced: true });
		areas.length = 0;
		const moved = at(0, 80, 400, 500);
		layer.paint(moved.frame, ['k'], { sliced: true });
		// The canvas was cleared and the bands are painted, two (2 ms) a frame, from the middle (y 330), the nearer first.
		expect(moved.rec.of('clearRect')[0]?.slice(1)).toEqual([0, 0, 1000, 600]);
		expect(areas.map((a) => a.y)).toEqual([280, 180]);
		expect(layer.busy).toBe(true);
		expect(flush()).toBe(1);
		expect(areas.map((a) => a.y)).toEqual([280, 180, 380, 80]);
		expect(flush()).toBe(1);
		expect(areas.map((a) => a.y)).toEqual([280, 180, 380, 80, 480]);
		expect(areas.every((a) => a.h <= 100)).toBe(true);
		expect(layer.busy).toBe(false);
		expect(flush()).toBe(0);
	});

	it('does not paint a vertical move of a layer that is the same at every y, only what is dirty', () => {
		const { layer, areas, at } = setup();
		layer.paint(at(0, 0).frame, ['k'], { invariantY: true });
		areas.length = 0;
		const moved = at(0, 120);
		layer.paint(moved.frame, ['k'], { invariantY: true, dirty: [{ x: 0, y: 200, w: 400, h: 28 }] });
		expect(areas).toEqual([{ x: 0, y: 200, w: 400, h: 28 }]);
		expect(moved.rec.of('clearRect').slice(0, 1).length).toBe(1);
		// A dirty area that is not in the window is dropped.
		areas.length = 0;
		layer.paint(at(0, 120).frame, ['k'], {
			invariantY: true,
			dirty: [{ x: 0, y: 0, w: 400, h: 28 }],
		});
		expect(areas).toEqual([]);
		// A sideways move changes the picture: all of it again.
		areas.length = 0;
		const side = at(40, 120).frame;
		layer.paint(side, ['k'], { invariantY: true });
		expect(areas).toEqual([side.win]);
	});

	it('lets a later paint take over what is waiting', () => {
		const { layer, areas, at, flush } = setup({ budgetMs: 1, chunkH: 100 });
		layer.paint(at(0, 0, 400, 500).frame, ['k'], { sliced: true });
		layer.paint(at(0, 80, 400, 500).frame, ['k'], { sliced: true });
		areas.length = 0;
		layer.paint(at(0, 300, 400, 500).frame, ['k'], { sliced: true });
		expect(flush()).toBe(1);
		let guard = 0;
		while (layer.busy && guard++ < 50) flush();
		// All of the last window, once, and none of what was waiting for the one before.
		expect(areas.map((a) => a.y).sort((a, b) => a - b)).toEqual([300, 400, 500, 600, 700]);
	});
});
