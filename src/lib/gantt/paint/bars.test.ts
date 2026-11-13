// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
import { paintBars } from './bars';
import { frameOf } from './testing';

describe('paintBars', () => {
	it('draws a brass pill, a summary and a jewel; only tasks and milestones get a label', () => {
		const m = modelOf([
			row(0, 0, 10 * D, 'task', { name: 'Code' }),
			row(1, 0, 10 * D, 'container', { name: 'Phase' }),
			row(2, 3 * D, 3 * D, 'milestone', { name: 'Ship' }),
		]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const labels = rec.of('fillText').map((c) => c[1]);
		expect(labels).toEqual(['Code', 'Ship']);
		const [code, ship] = rec.of('fillText');
		// The task's name is inside its pill; the milestone's name is right of the jewel.
		expect(code?.[2]).toBe(frame.theme.labelPad);
		expect(ship?.[2]).toBeGreaterThan(144);
		// The pill's path three times (fill, clip, outline), four corners each, and the jewel's one:
		// a rounded square turned a quarter.
		expect(rec.of('arcTo').length).toBe(16);
		expect(rec.of('rotate').length).toBe(2);
	});

	it('gives a brass pill a gradient, a shadow, a lit edge and an outline', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 0, 10 * D)]));
		paintBars(frame);
		const stops = rec.of('addColorStop').map((c) => c[2]);
		expect(stops).toEqual([frame.theme.barTop, frame.theme.barBottom]);
		expect(rec.of('set:shadowColor')[0]?.[1]).toBe(frame.theme.barShadow);
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.barHighlight);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toEqual([frame.theme.barOutline]);
		expect(rec.of('set:lineWidth').map((c) => c[1])).toContain(frame.theme.barOutlineWidth);
		// Text inside, in the bar ink.
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.barInk);
	});

	it('gives a critical bar a steel gradient and white text, and no outline', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 0, 10 * D, 'task', { critical: true })]));
		paintBars(frame);
		expect(rec.of('addColorStop').map((c) => c[2])).toEqual([
			frame.theme.steelTop,
			frame.theme.steelBottom,
		]);
		expect(rec.of('set:shadowColor')[0]?.[1]).toBe(frame.theme.steelShadow);
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.steelInk);
		expect(rec.of('stroke')).toHaveLength(0);
	});

	it('draws a summary as a stem with a short cap at each end', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 0, 10 * D, 'container')]));
		paintBars(frame);
		const bar = frame.layout.barRect(0);
		const rects = rec.of('fillRect');
		expect(rects).toEqual([
			['fillRect', bar?.x, bar?.y, bar?.w, frame.theme.summaryStem],
			['fillRect', bar?.x, bar?.y, frame.theme.summaryCap, bar?.h],
			[
				'fillRect',
				(bar?.x ?? 0) + (bar?.w ?? 0) - frame.theme.summaryCap,
				bar?.y,
				frame.theme.summaryCap,
				bar?.h,
			],
		]);
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.summary);
	});

	it('draws a jewel with a glow, and a critical one in steel', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 2 * D, 2 * D, 'milestone')]));
		paintBars(frame);
		expect(rec.of('set:shadowColor')[0]?.[1]).toBe(frame.theme.jewelGlow);
		expect(rec.of('addColorStop').map((c) => c[2])).toEqual([
			frame.theme.jewelHigh,
			frame.theme.milestone,
			frame.theme.jewelDeep,
		]);
		const steel = frameOf(modelOf([row(0, 2 * D, 2 * D, 'milestone', { critical: true })]));
		paintBars(steel.frame);
		expect(steel.rec.of('addColorStop').map((c) => c[2])).toContain(steel.frame.theme.steelTop);
	});

	it('shows the people on a task as avatars right of the bar, with the initials', () => {
		const m = modelOf([
			row(0, 0, 4 * D, 'task', {
				name: 'Code',
				people: ['ana', 'Ben', 'Cy', 'Dee', 'Eli'],
				peopleIndex: [0, 1, 2, 3, 4],
			}),
		]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const texts = rec.of('fillText').map((c) => c[1]);
		// Three avatars, then "+2"; the name is inside the bar.
		expect(texts).toEqual(['Code', 'A', 'B', 'C', '+2']);
		// A ring and a disc per avatar.
		expect(rec.of('arc')).toHaveLength(6);
		const fills = rec.of('set:fillStyle').map((c) => c[1]);
		expect(fills).toContain(frame.theme.avatars[1]?.bg);
		expect(fills).toContain(frame.theme.avatars[2]?.ink);
		// The first avatar starts a label gap after the bar's end.
		const bar = frame.layout.barRect(0);
		expect(rec.of('arc')[0]?.[1]).toBe(
			(bar?.x ?? 0) + (bar?.w ?? 0) + frame.theme.labelGap + frame.theme.avatarSize / 2,
		);
	});

	it('puts a label that does not fit beside its bar, not inside', () => {
		const m = modelOf([row(0, 0, D / 4, 'task', { name: 'A long task name' })]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		const text = rec.of('fillText')[0];
		expect(text?.[2]).toBeGreaterThanOrEqual(12 + 6);
		// Beside the bar the label is muted, at the smaller label size.
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.textMuted);
		expect(rec.of('set:font').map((c) => c[1])).toContain(
			`${frame.theme.labelSize}px ${frame.theme.fontSans}`,
		);
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

	it('does not rely on colour for text-only and engine-only', () => {
		const m = modelOf(
			[row(0, 0, 4 * D, 'task', { textOnly: 'unresolved' }), row(1, 0, 4 * D), row(2, 0, 4 * D)],
			[link(1, 2, { state: 'engine' }), link(0, 1, { critical: true })],
		);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		// Text-only: a dashed outline. Engine-only: dashed. Critical: thicker than a plain link.
		expect(rec.of('setLineDash').some((c) => (c[1] as number[]).length > 0)).toBe(true);
		const widths = rec.of('set:lineWidth').map((c) => c[1] as number);
		expect(widths).toContain(frame.theme.linkWidth);
		expect(widths).toContain(frame.theme.linkWidthCritical);
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
