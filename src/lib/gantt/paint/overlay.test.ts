// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
import { MIN_PER_DAY } from '../scale';
import { paintLinks } from './links';
import { NO_OVERLAY, linkPathOf, paintOverlay } from './overlay';
import { frameOf } from './testing';

const rows = [row(0, 0, 2 * D), row(1, 2 * D, 5 * D), row(2, 3 * D, 3 * D, 'milestone')];

describe('paintOverlay', () => {
	it('draws nothing but the clear for an empty state', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, NO_OVERLAY);
		expect(rec.of('clearRect')).toHaveLength(1);
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('stroke')).toHaveLength(0);
	});

	it('rings the selected bar; the row tint belongs to the grid layer', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { ...NO_OVERLAY, selectedRow: 1 });
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toContain(frame.theme.focus);
		expect(rec.of('stroke')).toHaveLength(1);
		expect(rec.of('set:lineWidth')[0]?.[1]).toBe(2);
	});

	it('rings a milestone as a diamond', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { ...NO_OVERLAY, selectedRow: 2 });
		expect(rec.of('lineTo')).toHaveLength(3);
		expect(rec.of('arcTo')).toHaveLength(0);
	});

	it('outlines the hovered bar without veiling it, and not the selected one twice', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { selectedRow: 0, hoverRow: 0, hoverLink: null });
		expect(rec.of('stroke')).toHaveLength(1);
		rec.clear();
		paintOverlay(frame, { selectedRow: 0, hoverRow: 1, hoverLink: null });
		// The hover outline, then the selection ring, and no filled band over any bar.
		expect(rec.of('stroke')).toHaveLength(2);
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('fill')).toHaveLength(0);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toEqual([
			frame.theme.borderStrong,
			frame.theme.focus,
		]);
	});

	it('ignores rows outside the painted window', () => {
		const { frame, rec } = frameOf(modelOf(rows), { win: { x: 0, y: 28, w: 1000, h: 28 } });
		paintOverlay(frame, { selectedRow: 0, hoverRow: 2, hoverLink: null });
		expect(rec.of('fillRect')).toHaveLength(0);
		expect(rec.of('stroke')).toHaveLength(0);
	});

	it('highlights a hovered link on the same shortened, rounded path as the base layer', () => {
		const m = modelOf(
			[row(0, 0, 2 * D), row(1, 3 * D, 5 * D), row(2, 0, 2 * D)],
			[link(0, 1), link(0, 2)],
		);
		const base = frameOf(m);
		paintLinks(base.frame);
		const { frame, rec } = frameOf(m);
		paintOverlay(frame, { ...NO_OVERLAY, hoverLink: 1 });
		const line = (calls: readonly (readonly unknown[])[]) =>
			calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo' || c[0] === 'quadraticCurveTo');
		// The overlay's line is a run of the base layer's calls: the second link's path.
		// (without the arrow head, three more calls)
		const drawn = line(rec.calls).slice(0, -3);
		const all = line(base.rec.calls);
		const at = all.findIndex((_c, i) =>
			drawn.every((d, j) => JSON.stringify(all[i + j]) === JSON.stringify(d)),
		);
		expect(at).toBeGreaterThanOrEqual(0);
		// Thicker, in the accent; the arrow head is drawn too.
		expect(rec.of('set:lineWidth')[0]?.[1]).toBe(frame.theme.linkWidthHover);
		expect(rec.of('set:strokeStyle')[0]?.[1]).toBe(frame.theme.accent);
		expect(rec.of('stroke')).toHaveLength(1);
		expect(rec.of('quadraticCurveTo').length).toBeGreaterThan(0);
	});

	it('draws today solid and the status date dashed, in their own colours', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintOverlay(frame, { ...NO_OVERLAY, todayMin: 4 * D });
		const styles = rec.of('set:fillStyle').map((c) => c[1]);
		expect(styles).toContain(frame.theme.today);
		expect(styles).toContain(frame.theme.statusDate);
		const todayX = (4 * D * 48) / MIN_PER_DAY - 1;
		const solid = rec.of('fillRect').filter((c) => c[1] === todayX && c[4] === 100);
		expect(solid).toHaveLength(1);
		const dashes = rec.of('fillRect').filter((c) => c[1] === 95 && c[4] === 6);
		expect(dashes.length).toBeGreaterThan(5);
	});

	it('leaves a gap in a marker line where it would cross a name, and only there', () => {
		// Row 1's bar is 24 px wide, so its name sits beside it from 24 + 14 = 38 to 74 (36 px wide).
		const model = modelOf([row(0, 0, 2 * D), row(1, 0, D / 2), row(2, 0, 2 * D)], [], {
			statusMin: 0,
		});
		const win = { x: 0, y: 0, w: 1000, h: 84 };
		const through = frameOf(model, { win, names: true });
		paintOverlay(through.frame, { ...NO_OVERLAY, todayMin: (50 / 48) * D });
		// The line at x 50 crosses row 1's name (38 to 74) and the name inside row 0's bar (6 to 42)
		// does not reach it: one gap, centred on row 1.
		const gaps = through.rec.of('clearRect').slice(1);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.[2]).toBeLessThan(42);
		const y = Number(gaps[0]?.[2]);
		const h = Number(gaps[0]?.[4]);
		expect(y + h / 2).toBe(28 + 14);

		// Clear of every name: the full line, no gap. Without reserved names too.
		const clear = frameOf(model, { win, names: true });
		paintOverlay(clear.frame, { ...NO_OVERLAY, todayMin: (500 / 48) * D });
		expect(clear.rec.of('clearRect').slice(1)).toHaveLength(0);
		const unknown = frameOf(model, { win });
		paintOverlay(unknown.frame, { ...NO_OVERLAY, todayMin: (50 / 48) * D });
		expect(unknown.rec.of('clearRect').slice(1)).toHaveLength(0);
	});

	it('takes today from the overlay state, so that the clock is not part of the model', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintOverlay(frame, { ...NO_OVERLAY, todayMin: 6 * D });
		const x = (6 * D * 48) / MIN_PER_DAY - 1;
		expect(rec.of('fillRect').filter((c) => c[1] === x && c[4] === 100)).toHaveLength(1);
		// A state that says "no today" draws none.
		rec.clear();
		paintOverlay(frame, { ...NO_OVERLAY, todayMin: null });
		expect(rec.of('set:fillStyle').map((c) => c[1])).not.toContain(frame.theme.today);
	});

	it('has no path for a link index that does not exist', () => {
		const { layout } = frameOf(modelOf(rows));
		expect(linkPathOf(layout, modelOf(rows), 3)).toEqual([]);
	});

	it('erases only what it drew last, not the whole canvas, on the next paint', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, { ...NO_OVERLAY, selectedRow: 1 });
		// The first paint clears the canvas.
		expect(rec.of('clearRect')).toEqual([['clearRect', 0, 0, 1000, 600]]);
		rec.clear();
		paintOverlay(frame, { ...NO_OVERLAY, hoverRow: 0 });
		const cleared = rec.of('clearRect');
		expect(cleared).toHaveLength(1);
		// The ring round row 1's bar (96, 34, 144 x 16) grown by its gap and width, and a little.
		const [, x, y, w, h] = cleared[0] as unknown as [string, number, number, number, number];
		const t = frame.theme;
		const pad = t.ringGap + t.ringWidth;
		expect(x).toBeLessThanOrEqual(96 - pad);
		expect(y).toBeLessThanOrEqual(34 - pad);
		expect(x + w).toBeGreaterThanOrEqual(96 + 144 + pad);
		expect(y + h).toBeGreaterThanOrEqual(34 + 16 + pad);
		expect(w).toBeLessThan(400);
		// A resize (the canvas size changed) clears it all again.
		rec.clear();
		paintOverlay({ ...frame, dpr: 2 }, NO_OVERLAY);
		expect(rec.of('clearRect')).toEqual([['clearRect', 0, 0, 1000, 600]]);
	});

	it('erases the lines of the markers and of a hovered link too', () => {
		const model = modelOf(rows, [link(0, 1)], { statusMin: 2 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 100 } });
		paintOverlay(frame, { ...NO_OVERLAY, hoverLink: 0 });
		rec.clear();
		paintOverlay(frame, NO_OVERLAY);
		// One rect for the status line, one for the link.
		expect(rec.of('clearRect')).toHaveLength(2);
	});

	it('does not touch the canvas for a vertical move when only the full-height lines are on it', () => {
		const model = modelOf(rows, [], { statusMin: 2 * D });
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 56 } });
		paintOverlay(frame, NO_OVERLAY);
		rec.clear();
		// Down by whole dash steps (the window moves on multiples of 20): the lines are where they
		// were on the canvas, and nothing else was drawn.
		paintOverlay({ ...frame, win: { x: 0, y: 20, w: 1000, h: 56 } }, NO_OVERLAY);
		expect(rec.calls).toEqual([]);
		// A move that is not a whole step shifts the dashes against the content: drawn again.
		paintOverlay({ ...frame, win: { x: 0, y: 28, w: 1000, h: 56 } }, NO_OVERLAY);
		expect(rec.of('clearRect').length).toBeGreaterThan(0);
		rec.clear();
		// A move sideways puts the lines elsewhere on the canvas.
		paintOverlay({ ...frame, win: { x: 20, y: 48, w: 1000, h: 56 } }, NO_OVERLAY);
		expect(rec.of('clearRect').length).toBeGreaterThan(0);
	});

	it('paints again on a vertical move when a ring was drawn, or one comes into the window', () => {
		const model = modelOf(rows);
		const { frame, rec } = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 56 } });
		paintOverlay(frame, { ...NO_OVERLAY, selectedRow: 1 });
		rec.clear();
		paintOverlay(
			{ ...frame, win: { x: 0, y: 28, w: 1000, h: 56 } },
			{ ...NO_OVERLAY, selectedRow: 1 },
		);
		expect(rec.of('stroke')).toHaveLength(1);
		// Selected row 2 is outside the first window and inside the second.
		const other = frameOf(model, { win: { x: 0, y: 0, w: 1000, h: 28 } });
		paintOverlay(other.frame, { ...NO_OVERLAY, selectedRow: 2 });
		other.rec.clear();
		paintOverlay(
			{ ...other.frame, win: { x: 0, y: 56, w: 1000, h: 28 } },
			{ ...NO_OVERLAY, selectedRow: 2 },
		);
		expect(other.rec.of('stroke')).toHaveLength(1);
	});
});
