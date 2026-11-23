// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	MAX_EXPORT_DPR,
	exportDpr,
	fitText,
	frameSize,
	limitDpr,
	MAX_EXPORT_PIXELS,
	nameCells,
	type NameLayout,
	type NameRow,
} from './png-frame';

/** 6 px a character, 7 for bold. */
const width = (t: string, bold = false): number => [...t].length * (bold ? 7 : 6);

describe('exportDpr', () => {
	it('is the screen ratio from 1 to 3', () => {
		expect(exportDpr(1)).toBe(1);
		expect(exportDpr(2.625)).toBe(2.625);
		expect(exportDpr(3)).toBe(3);
		expect(exportDpr(4)).toBe(MAX_EXPORT_DPR);
		expect(exportDpr(0.5)).toBe(1);
	});
	it('is 1 for what is not a number', () => {
		expect(exportDpr(Number.NaN)).toBe(1);
		expect(exportDpr(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe('limitDpr', () => {
	it('keeps the ratio of a picture of an ordinary size', () => {
		expect(limitDpr(1600, 900, 2)).toBe(2);
		expect(limitDpr(1600, 900, 3)).toBe(3);
	});
	it('lowers it so that a very large picture stays under the pixel limit', () => {
		const d = limitDpr(4000, 3000, 3);
		expect(d).toBeLessThan(3);
		expect(4000 * 3000 * d * d).toBeLessThanOrEqual(MAX_EXPORT_PIXELS + 1);
	});
	it('never goes below 1', () => {
		expect(limitDpr(20_000, 20_000, 2)).toBe(1);
	});
});

describe('frameSize', () => {
	it('puts the name column beside the plot and the header over both', () => {
		const s = frameSize({ names: 200, headerH: 64, viewW: 800, viewH: 400, dpr: 1 });
		expect(s).toEqual({ width: 1000, height: 464, pxWidth: 1000, pxHeight: 464 });
	});
	it('multiplies by the pixel ratio and rounds to whole pixels', () => {
		const s = frameSize({ names: 100.5, headerH: 64, viewW: 300, viewH: 200.3, dpr: 2.625 });
		expect(s.pxWidth).toBe(Math.round(400.5 * 2.625));
		expect(s.pxHeight).toBe(Math.round(264.3 * 2.625));
	});
	it('is never empty', () => {
		expect(frameSize({ names: 0, headerH: 0, viewW: 0, viewH: 0, dpr: 1 }).pxWidth).toBe(1);
	});
});

describe('fitText', () => {
	const w = (t: string): number => width(t);
	it('keeps what fits', () => {
		expect(fitText('Research', 100, w)).toBe('Research');
		expect(fitText('Research', 48, w)).toBe('Research');
	});
	it('cuts with an ellipsis where it runs out', () => {
		const t = fitText('Research-and-design', 60, w);
		expect(t.endsWith('…')).toBe(true);
		expect(w(t)).toBeLessThanOrEqual(60);
		expect(w(fitText('Research-and-design', 66, w))).toBeLessThanOrEqual(66);
		// One more character would not fit.
		const kept = t.slice(0, -1);
		expect('Research-and-design'.startsWith(kept)).toBe(true);
		expect(w('Research-and-design'.slice(0, kept.length + 1) + '…')).toBeGreaterThan(60);
	});
	it('does not leave a space before the ellipsis', () => {
		expect(fitText('ab cdef', 24, w)).toBe('ab…');
	});
	it('says nothing where not even one letter fits', () => {
		expect(fitText('Research', 6, w)).toBe('');
		expect(fitText('Research', 0, w)).toBe('');
		expect(fitText('Research', -5, w)).toBe('');
	});
});

describe('nameCells', () => {
	const layout: NameLayout = {
		width: 200,
		rowHeight: 40,
		scrollTop: 0,
		viewH: 120,
		headerH: 64,
		pad: 10,
		indent: 16,
		arrow: 14,
	};
	const rows: NameRow[] = [
		{ name: 'Design', depth: 0, kind: 'container', expanded: true, context: false },
		{ name: 'Research', depth: 1, kind: 'task', expanded: null, context: false },
		{ name: 'Sketch', depth: 1, kind: 'task', expanded: null, context: true },
		{ name: 'Build', depth: 0, kind: 'container', expanded: false, context: false },
		{ name: 'Ship', depth: 0, kind: 'milestone', expanded: null, context: false },
	];
	const w = (t: string, bold: boolean): number => width(t, bold);

	it('lays out the rows in view below the header, each in the middle of its row', () => {
		const cells = nameCells(rows, layout, w);
		expect(cells.map((c) => c.row)).toEqual([0, 1, 2]);
		expect(cells.map((c) => c.y)).toEqual([64 + 20, 64 + 60, 64 + 100]);
	});

	it('indents by depth, after the arrow slot, and keeps the arrow where the depth puts it', () => {
		const [design, research] = nameCells(rows, layout, w);
		expect(design).toMatchObject({ x: 24, arrowX: 10, arrow: 'open', bold: true });
		expect(research).toMatchObject({ x: 40, arrowX: 26, arrow: null, bold: false });
	});

	it('has the closed arrow for a collapsed container, and mutes context rows', () => {
		const cells = nameCells(rows, { ...layout, viewH: 200 }, w);
		expect(cells[2]?.muted).toBe(true);
		expect(cells[3]?.arrow).toBe('closed');
		expect(cells[0]?.muted).toBe(false);
	});

	it('starts at the row the scroll is in, with that row cut off above', () => {
		const cells = nameCells(rows, { ...layout, scrollTop: 50 }, w);
		expect(cells.map((c) => c.row)).toEqual([1, 2, 3, 4]);
		// Row 1 starts 10 px above the plot's top: its middle is 10 px into it.
		expect(cells[0]?.y).toBe(64 + 10);
	});

	it('draws no more rows than there are', () => {
		const cells = nameCells(rows, { ...layout, scrollTop: 160, viewH: 400 }, w);
		expect(cells.map((c) => c.row)).toEqual([4]);
		expect(nameCells([], layout, w)).toEqual([]);
	});

	it('cuts a long name to the column, measured in its own weight', () => {
		const long: NameRow[] = [
			{
				name: 'A very long container name',
				depth: 0,
				kind: 'container',
				expanded: true,
				context: false,
			},
			{
				name: 'A very long task name here',
				depth: 0,
				kind: 'task',
				expanded: null,
				context: false,
			},
		];
		const [c, t] = nameCells(long, { ...layout, width: 120 }, w);
		expect(c?.text.endsWith('…')).toBe(true);
		expect(w(c?.text ?? '', true)).toBeLessThanOrEqual(120 - 10 - 24);
		expect(w(t?.text ?? '', false)).toBeLessThanOrEqual(120 - 10 - 24);
		expect((t?.text.length ?? 0) > (c?.text.length ?? 0)).toBe(true);
	});

	it('leaves the text empty for a name pushed past the column by its depth', () => {
		const deep: NameRow[] = [
			{ name: 'Deep', depth: 20, kind: 'task', expanded: null, context: false },
		];
		expect(nameCells(deep, layout, w)[0]?.text).toBe('');
	});
});
