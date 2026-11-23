// SPDX-License-Identifier: GPL-2.0-or-later
// The picture's composition, on recording canvases (the real pixels are checked by
// tests/e2e/export.spec.ts, in the browser): sizes, where each canvas is placed, and what is said
// in the name column.
import { describe, expect, it } from 'vitest';
import { createLayout } from '../gantt/layout';
import { recorder, type Recorder } from '../gantt/paint/testing';
import { createScale } from '../gantt/scale';
import { D, FIXED_MEASURE, TEST_THEME, metricsOf, modelOf, row } from '../gantt/testing';
import { renderGanttPng, type GanttPngInput } from './gantt-png';

interface FakeCanvas {
	width: number;
	height: number;
	style: Record<string, string>;
	rec: Recorder;
	getContext: () => CanvasRenderingContext2D;
	toBlob: (cb: (b: Blob | null) => void, type?: string) => void;
}

function fakeDocument(): { doc: Document; canvases: FakeCanvas[] } {
	const canvases: FakeCanvas[] = [];
	const doc = {
		fonts: { ready: Promise.resolve() },
		createElement: (tag: string): FakeCanvas => {
			if (tag !== 'canvas') throw new Error(tag);
			const rec = recorder();
			const c: FakeCanvas = {
				width: 300,
				height: 150,
				style: {},
				rec,
				getContext: () => rec.ctx,
				toBlob: (cb, type) => cb(new Blob(['png'], type === undefined ? {} : { type })),
			};
			canvases.push(c);
			return c;
		},
	} as unknown as Document;
	return { doc, canvases };
}

const calendar = { startEpoch: Date.UTC(2026, 0, 5) / 1000, env: { zone: null }, locale: 'en-US' };

function input(over: Partial<GanttPngInput> = {}): GanttPngInput {
	const model = modelOf(
		[
			row(0, 0, 5 * D, 'container', { name: 'Design' }),
			row(1, 0, 2 * D, 'task', { name: 'Research', depth: 1 }),
			row(2, 2 * D, 5 * D, 'task', { name: 'Sketch', depth: 1 }),
		],
		[],
		{ calendar },
	);
	const layout = createLayout(
		model,
		createScale(48, model.originMin),
		metricsOf(false),
		1000,
		FIXED_MEASURE,
	);
	return {
		model,
		layout,
		theme: TEST_THEME,
		pxPerDay: 48,
		scrollLeft: 0,
		scrollTop: 0,
		viewW: 600,
		viewH: 200,
		namesW: 180,
		todayMin: null,
		dpr: 2,
		heading: 'Task',
		...over,
	};
}

describe('renderGanttPng', () => {
	it('is a PNG as wide as the names and the plot and as tall as the header and the plot, at the ratio', async () => {
		const { doc, canvases } = fakeDocument();
		const i = input();
		const blob = await renderGanttPng(i, doc);
		expect(blob.type).toBe('image/png');
		expect(blob.size).toBeGreaterThan(0);
		const out = canvases.at(-1);
		const header = i.layout.metrics.headerHeight;
		expect(out?.width).toBe((180 + 600) * 2);
		expect(out?.height).toBe((header + 200) * 2);
	});

	it('paints the plot in three layers and puts them beside the names, under the header', async () => {
		const { doc, canvases } = fakeDocument();
		const i = input();
		await renderGanttPng(i, doc);
		const out = canvases.at(-1) as FakeCanvas;
		const draws = out.rec.of('drawImage');
		// The header, then the grid, the bars and the lines.
		expect(draws).toHaveLength(4);
		const header = i.layout.metrics.headerHeight;
		expect(draws[0]?.slice(2)).toEqual([360, 0]);
		for (const d of draws.slice(1)) expect(d.slice(2)).toEqual([360, header * 2]);
		// The layers are sized to the visible plot at the ratio.
		const layers = canvases.slice(0, 4);
		expect(layers.map((c) => [c.width, c.height])).toEqual([
			[1200, 400],
			[1200, 400],
			[1200, 400],
			[1200, header * 2],
		]);
	});

	it('writes the heading and every visible row’s name in the name column', async () => {
		const { doc, canvases } = fakeDocument();
		await renderGanttPng(input(), doc);
		const out = canvases.at(-1) as FakeCanvas;
		const said = out.rec.of('fillText').map((c) => c[1]);
		expect(said).toEqual(['Task', 'Design', 'Research', 'Sketch']);
	});

	it('writes the header’s dates on the header canvas when the plan has a calendar', async () => {
		const { doc, canvases } = fakeDocument();
		await renderGanttPng(input(), doc);
		const header = canvases.find((c) => c.height === input().layout.metrics.headerHeight * 2);
		expect(header?.rec.of('fillText').length).toBeGreaterThan(0);
	});

	it('draws a header of its own colour and no dates without a calendar', async () => {
		const { doc, canvases } = fakeDocument();
		const i = input();
		await renderGanttPng({ ...i, model: { ...i.model, calendar: null } }, doc);
		const header = canvases.find((c) => c.height === i.layout.metrics.headerHeight * 2);
		expect(header?.rec.of('fillText')).toHaveLength(0);
		expect(header?.rec.of('fillRect').length).toBeGreaterThan(0);
	});

	it('names only the rows in view when the chart is scrolled', async () => {
		const { doc, canvases } = fakeDocument();
		const i = input();
		await renderGanttPng({ ...i, scrollTop: 2 * i.layout.metrics.rowHeight }, doc);
		const out = canvases.at(-1) as FakeCanvas;
		expect(out.rec.of('fillText').map((c) => c[1])).toEqual(['Task', 'Sketch']);
	});

	it('lowers the ratio for a picture that would be too large to encode', async () => {
		const { doc, canvases } = fakeDocument();
		await renderGanttPng(input({ viewW: 3000, viewH: 1500, dpr: 3 }), doc);
		const out = canvases.at(-1) as FakeCanvas;
		expect(out.width * out.height).toBeLessThanOrEqual(16_100_000);
		expect(out.width).toBeLessThan((180 + 3000) * 3);
	});

	it('rejects when the browser cannot encode', async () => {
		const { doc } = fakeDocument();
		const make = doc.createElement.bind(doc);
		(doc as { createElement: unknown }).createElement = (tag: string) => {
			const c = make(tag) as unknown as FakeCanvas;
			c.toBlob = (cb) => cb(null);
			return c;
		};
		await expect(renderGanttPng(input(), doc)).rejects.toThrow(/encoded/);
	});
});
