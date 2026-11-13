// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
import { paintBars } from './bars';
import { frameOf } from './testing';

describe('paintBars', () => {
	it('draws a rounded bar, a summary with notches and a diamond, each with a label', () => {
		const m = modelOf([
			row(0, 0, 10 * D, 'task', { name: 'Code' }),
			row(1, 0, 10 * D, 'container', { name: 'Phase' }),
			row(2, 3 * D, 3 * D, 'milestone', { name: 'Ship' }),
		]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const labels = rec.of('fillText').map((c) => c[1]);
		expect(labels).toEqual(['Code', 'Phase', 'Ship']);
		// Inside the task bar, right of the other two.
		const [code, phase, ship] = rec.of('fillText');
		expect(code?.[2]).toBe(6);
		expect(phase?.[2]).toBeGreaterThan(480);
		expect(ship?.[2]).toBeGreaterThan(144);
		expect(rec.of('arcTo').length).toBe(4);
	});

	it('puts a label that does not fit beside its bar, not inside', () => {
		const m = modelOf([row(0, 0, D / 4, 'task', { name: 'A long task name' })]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const text = rec.of('fillText')[0];
		expect(text?.[2]).toBeGreaterThanOrEqual(12 + 6);
		// Beside the bar the label is muted, at the smaller label size.
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.textMuted);
		expect(rec.of('set:font').map((c) => c[1])).toContain(`11px ${frame.theme.fontSans}`);
	});

	it('draws no bar for an unscheduled row', () => {
		const { frame, rec } = frameOf(modelOf([row(0, null, null)]));
		paintBars(frame);
		expect(rec.of('fillText')).toHaveLength(0);
		expect(rec.of('fill')).toHaveLength(0);
	});

	it('paints only the rows inside the window', () => {
		const rows = Array.from({ length: 200 }, (_, i) => row(i, 0, 2 * D, 'task', { name: `T${i}` }));
		const { frame, rec } = frameOf(modelOf(rows), {
			win: { x: 0, y: 28 * 100, w: 1000, h: 28 * 5 },
		});
		paintBars(frame);
		const names = rec.of('fillText').map((c) => c[1] as string);
		expect(names).toEqual(['T100', 'T101', 'T102', 'T103', 'T104']);
	});

	it('skips bars right of or left of the window, but keeps a label that reaches into it', () => {
		const m = modelOf([
			row(0, 0, 2 * D, 'task', { name: 'Left' }),
			row(1, 100 * D, 102 * D, 'task', { name: 'Far' }),
			row(2, 20 * D, 22 * D, 'task', { name: 'In' }),
		]);
		const { frame, rec } = frameOf(m, { win: { x: 900, y: 0, w: 400, h: 84 } });
		paintBars(frame);
		expect(rec.of('fillText').map((c) => c[1])).toEqual(['In']);
	});

	it('fades everything when the schedule shown is not the newest outcome', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 0, 2 * D)], [], { dimmed: true }));
		paintBars(frame);
		expect(rec.of('set:globalAlpha')[0]?.[1]).toBe(0.5);
		expect(rec.of('set:globalAlpha').at(-1)?.[1]).toBe(1);
	});

	it('does not rely on colour for critical, text-only and engine-only', () => {
		const m = modelOf(
			[
				row(0, 0, 4 * D, 'task', { critical: true }),
				row(1, 0, 4 * D, 'task', { textOnly: 'unresolved' }),
				row(2, 0, 4 * D),
				row(3, 0, 4 * D),
			],
			[link(2, 3, { state: 'engine' }), link(0, 1, { critical: true })],
		);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		// Critical: a thick outline as well as the fill. Text-only: a dashed outline.
		expect(rec.of('set:lineWidth').map((c) => c[1])).toContain(2.5);
		expect(rec.of('setLineDash').some((c) => (c[1] as number[]).length > 0)).toBe(true);
		// Links: critical thicker than a plain one.
		const widths = rec.of('set:lineWidth').map((c) => c[1] as number);
		expect(widths).toContain(1.25);
		expect(widths).toContain(2);
	});

	it('draws a float tail after the end when an analysis gives one', () => {
		const m = modelOf([row(0, 0, 2 * D, 'task', { floatMin: 2 * D, lateEnd: 4 * D })]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const tail = rec.of('fillRect').find((c) => c[1] === 96 && c[3] === 96);
		expect(tail).toBeDefined();
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.float);
	});

	it('draws links under the bars, elbowed, with an arrow head each', () => {
		const m = modelOf(
			[row(0, 0, 2 * D), row(1, 4 * D, 6 * D), row(2, 8 * D, 9 * D)],
			[link(0, 1), link(1, 2)],
		);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const order = rec.calls.map((c) => c[0]);
		expect(order.indexOf('stroke')).toBeLessThan(order.indexOf('fillText'));
		expect(rec.of('lineTo').length).toBeGreaterThanOrEqual(2 * 3 + 2 * 2);
		expect(rec.of('closePath').length).toBeGreaterThanOrEqual(2);
	});

	it('fills the done part of a bar, clipped to the pill', () => {
		const m = modelOf([row(0, 0, 10 * D, 'task', { complete: 40 })]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		expect(rec.of('clip')).toHaveLength(1);
		const done = rec.of('fillRect').find((c) => c[3] === 10 * 48 * 0.4);
		expect(done).toBeDefined();
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.barProgress);
		// No progress, no clip.
		rec.clear();
		paintBars(frameOf(modelOf([row(0, 0, 10 * D)])).frame);
		expect(rec.of('clip')).toHaveLength(0);
	});
});
