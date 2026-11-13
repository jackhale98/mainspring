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
		// The pill's path four times (shadow, fill, clip, outline), four corners each; the jewel's
		// three (glow twice, body), each a rounded square turned a quarter.
		expect(rec.of('arcTo').length).toBe(4 * 4 + 3 * 4);
		expect(rec.of('rotate')).toEqual([
			['rotate', Math.PI / 4],
			['rotate', Math.PI / 4],
			['rotate', Math.PI / 4],
		]);
	});

	it('gives a brass pill a gradient, a shadow, a lit edge and an outline', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 0, 10 * D)]));
		paintBars(frame);
		const stops = rec.of('addColorStop').map((c) => c[2]);
		expect(stops).toEqual([frame.theme.barTop, frame.theme.barBottom]);
		// The shadow is an offset fill in the shadow colour, under the bar's own fill.
		const fills = rec.of('set:fillStyle').map((c) => c[1]);
		expect(fills[0]).toBe(frame.theme.barShadow);
		expect(fills).toContain(frame.theme.barHighlight);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toEqual([frame.theme.barOutline]);
		expect(rec.of('set:lineWidth').map((c) => c[1])).toContain(frame.theme.barOutlineWidth);
		// Text inside, in the bar ink.
		expect(fills).toContain(frame.theme.barInk);
	});

	it('never uses shadowBlur, which costs several times the fill: shadows are offset fills', () => {
		const m = modelOf([
			row(0, 0, 10 * D, 'task', { critical: true }),
			row(1, 0, 10 * D),
			row(2, 2 * D, 2 * D, 'milestone'),
			row(3, 2 * D, 2 * D, 'milestone', { critical: true }),
		]);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		expect(rec.calls.some((c) => c[0].startsWith('set:shadow'))).toBe(false);
		// The brass pill's shadow is one fill moved down by the shadow offset and grown by half the blur.
		const t = frame.theme;
		const bar = frame.layout.barRect(1);
		const pill = rec
			.of('moveTo')
			.find(
				(c) =>
					c[1] ===
					(bar?.x ?? 0) -
						t.barShadowBlur / 2 +
						Math.min(t.barRadius, (bar?.w ?? 0) / 3) +
						t.barShadowBlur / 2,
			);
		expect(pill).toBeDefined();
	});

	it('makes one gradient per style however many bars, and moves it onto each bar', () => {
		const rows = Array.from({ length: 12 }, (_, i) =>
			row(i, 0, 6 * D, 'task', { critical: i % 4 === 0 }),
		);
		const { frame, rec } = frameOf(modelOf(rows));
		paintBars(frame);
		// A brass and a steel gradient, in unit space (the bar's box is the transform's job).
		expect(rec.of('createLinearGradient')).toEqual([
			['createLinearGradient', 0, 0, 0, 1],
			['createLinearGradient', 0, 0, 0, 1],
		]);
		const transforms = rec.of('transform');
		expect(transforms.length).toBe(12);
		const bar = frame.layout.barRect(1);
		expect(transforms).toContainEqual(['transform', 1, 0, 0, bar?.h, bar?.x, bar?.y]);
		// The frame is put back after each, so what follows draws in content coordinates.
		expect(rec.of('setTransform').length).toBeGreaterThanOrEqual(12);
		// A second frame on the same context and theme makes none.
		rec.clear();
		paintBars(frame);
		expect(rec.of('createLinearGradient')).toHaveLength(0);
	});

	it('gives a critical bar a second cue besides its colour: a heavier edge and a finish post', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 0, 10 * D, 'task', { critical: true })]));
		paintBars(frame);
		const t = frame.theme;
		expect(rec.of('addColorStop').map((c) => c[2])).toEqual([t.criticalTop, t.criticalBottom]);
		const fills = rec.of('set:fillStyle').map((c) => c[1]);
		expect(fills[0]).toBe(t.criticalShadow);
		expect(fills).toContain(t.criticalInk);
		// The edge: heavier than the brass outline, in the critical colour.
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toEqual([t.criticalEdge]);
		expect(rec.of('set:lineWidth').map((c) => c[1])).toEqual([t.criticalEdgeWidth]);
		expect(t.criticalEdgeWidth).toBeGreaterThan(t.barOutlineWidth);
		// The post: past the bar's finish edge, taller than the bar by the reach on each side.
		const bar = frame.layout.barRect(0);
		const post = rec
			.of('fillRect')
			.find(
				(c) => c[3] === t.criticalPostWidth && c[4] === (bar?.h ?? 0) + 2 * t.criticalPostReach,
			);
		expect(post?.[1]).toBeGreaterThan((bar?.x ?? 0) + (bar?.w ?? 0));
		// A plain bar has neither.
		const plain = frameOf(modelOf([row(0, 0, 10 * D)]));
		paintBars(plain.frame);
		expect(plain.rec.of('fillRect').some((c) => c[3] === t.criticalPostWidth)).toBe(false);
	});

	it('marks a critical summary with the post too, and a critical milestone with a heavier edge', () => {
		const t = frameOf(modelOf([])).frame.theme;
		const summary = frameOf(modelOf([row(0, 0, 10 * D, 'container', { critical: true })]));
		paintBars(summary.frame);
		expect(summary.rec.of('set:fillStyle').map((c) => c[1])).toContain(t.critical);
		expect(summary.rec.of('fillRect').some((c) => c[3] === t.criticalPostWidth)).toBe(true);
		const jewel = frameOf(modelOf([row(0, 2 * D, 2 * D, 'milestone', { critical: true })]));
		paintBars(jewel.frame);
		expect(jewel.rec.of('set:lineWidth').map((c) => c[1])).toEqual([t.criticalEdgeWidth]);
		expect(jewel.rec.of('set:strokeStyle').map((c) => c[1])).toEqual([t.criticalEdge]);
		expect(jewel.rec.of('fillRect').some((c) => c[3] === t.criticalPostWidth)).toBe(false);
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

	it('draws a jewel with a glow, an edge, and a critical one in steel', () => {
		const { frame, rec } = frameOf(modelOf([row(0, 2 * D, 2 * D, 'milestone')]));
		paintBars(frame);
		expect(rec.of('set:fillStyle')[0]?.[1]).toBe(frame.theme.jewelGlow);
		expect(rec.of('addColorStop').map((c) => c[2])).toEqual([
			frame.theme.jewelHigh,
			frame.theme.milestone,
			frame.theme.jewelDeep,
		]);
		// An edge in the link colour: the jewel's upper half alone is under 3:1 on the light panel.
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toEqual([frame.theme.link]);
		expect(rec.of('set:lineWidth').map((c) => c[1])).toEqual([frame.theme.barOutlineWidth]);
		expect(rec.of('stroke')).toHaveLength(1);
		const steel = frameOf(modelOf([row(0, 2 * D, 2 * D, 'milestone', { critical: true })]));
		paintBars(steel.frame);
		expect(steel.rec.of('addColorStop').map((c) => c[2])).toContain(steel.frame.theme.criticalTop);
		expect(steel.rec.of('set:fillStyle')[0]?.[1]).toBe(steel.frame.theme.criticalShadow);
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

	it('fades the shapes when the schedule shown is not the newest outcome, and never the labels', () => {
		const m = modelOf(
			[
				row(0, 0, 4 * D, 'task', { name: 'Code', people: ['Ana'], peopleIndex: [0] }),
				row(1, 2 * D, 2 * D, 'milestone', { name: 'Ship' }),
			],
			[link(0, 1)],
			{ dimmed: true },
		);
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		// The alpha in force at each call: the shapes at the dim opacity, every text at 1.
		let alpha = 1;
		const textAlpha: number[] = [];
		const shapeAlpha = new Set<number>();
		for (const c of rec.calls) {
			if (c[0] === 'set:globalAlpha') alpha = c[1] as number;
			else if (c[0] === 'fillText') textAlpha.push(alpha);
			else if (c[0] === 'stroke' || c[0] === 'fill') shapeAlpha.add(alpha);
		}
		// "Code" inside the bar, "A" in the avatar, "Ship" beside the jewel.
		expect(rec.of('fillText').map((c) => c[1])).toEqual(['Code', 'A', 'Ship']);
		expect(textAlpha).toEqual([1, 1, 1]);
		expect(shapeAlpha.has(frame.theme.dimOpacity)).toBe(true);
		expect(rec.of('set:globalAlpha').at(-1)?.[1]).toBe(1);
	});

	it('reports where it drew the avatars, so that hit testing can leave links out of them', () => {
		const m = modelOf([
			row(0, 0, 4 * D, 'task', { people: ['Ana', 'Ben'], peopleIndex: [0, 1] }),
			row(1, 0, 4 * D),
		]);
		const { frame, layout } = frameOf(m);
		paintBars(frame);
		const bar = layout.barRect(0);
		const first = (bar?.x ?? 0) + (bar?.w ?? 0) + frame.theme.labelGap;
		const t = frame.theme;
		expect(layout.avatars[0]).toBe(first - 2);
		expect(layout.avatars[1]).toBe(first + 2 * t.avatarSize + t.avatarGap + 2);
		expect(Number.isNaN(layout.avatars[2])).toBe(true);
	});

	it('draws every name where the layout reserved it, inside the bar or beside it', () => {
		const m = modelOf([
			row(0, 0, 10 * D, 'task', { name: 'Code' }),
			row(1, 0, D / 3, 'task', { name: 'A short one', floatMin: 3 * D, lateEnd: 4 * D }),
			row(2, 3 * D, 3 * D, 'milestone', { name: 'Ship' }),
			row(3, 0, 10 * D, 'task', { name: 'Not editable', textOnly: 'unresolved' }),
		]);
		const { frame, rec, layout } = frameOf(m, { names: true });
		paintBars(frame);
		const drawn = new Map(rec.of('fillText').map((c) => [c[1], c[2]] as const));
		for (const [i, name] of ['Code', 'A short one', 'Ship', 'Not editable'].entries()) {
			expect(drawn.get(name)).toBe(layout.labels[3 * i]);
		}
		expect([0, 1, 2, 3].map((i) => layout.labels[3 * i + 2])).toEqual([1, 0, 0, 0]);
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
		// A fine dotted line from the bar's end (x 96) to the late finish (x 192), and a stop there.
		const h = frame.theme.floatHeight;
		expect(rec.of('lineTo').some((c) => c[1] === 192)).toBe(true);
		expect(rec.of('fillRect').some((c) => c[1] === 192 - h / 2 && c[3] === h)).toBe(true);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toContain(frame.theme.float);
	});

	it('dims the float tail with the rest of an out-of-date chart', () => {
		const m = {
			...modelOf([row(0, 0, 2 * D, 'task', { floatMin: 2 * D, lateEnd: 4 * D })]),
			dimmed: true,
		};
		const { frame, rec } = frameOf(m);
		paintBars(frame);
		// The alphas set between the tail's stroke style and its stop (the dotted line and the stop).
		const calls = rec.calls;
		const from = calls.findIndex((c) => c[0] === 'set:strokeStyle' && c[1] === frame.theme.float);
		expect(from).toBeGreaterThanOrEqual(0);
		const to = calls.findIndex((c, i) => i > from && c[0] === 'restore');
		const alphas = calls
			.slice(from, to)
			.filter((c) => c[0] === 'set:globalAlpha')
			.map((c) => c[1] as number);
		expect(alphas).toHaveLength(2);
		for (const a of alphas) expect(a).toBeLessThanOrEqual(frame.theme.dimOpacity);
		expect(rec.of('save').length).toBe(rec.of('restore').length);
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

	it('paints a moved window again in pieces, the rows in the middle first, and never copies', () => {
		const rows = Array.from({ length: 60 }, (_, i) => row(i, 0, 2 * D, 'task', { name: `T${i}` }));
		const { frame, rec } = frameOf(modelOf(rows), { win: { x: 0, y: 0, w: 1000, h: 560 } });
		paintBars(frame);
		expect(rec.of('fillText')).toHaveLength(20);
		rec.clear();
		// Down by 56 px (two rows): the window is y 56 to 616, rows 2 to 21. With no frame to wait
		// for here every band is painted, but in the order of the middle first: row 7 is the first
		// row of the band round y 336, and row 2 comes last.
		paintBars({ ...frame, win: { x: 0, y: 56, w: 1000, h: 560 } });
		expect(rec.of('drawImage')).toHaveLength(0);
		const names = rec.of('fillText').map((c) => c[1] as string);
		expect(names[0]).toBe('T7');
		expect(names).toContain('T2');
		// A row on the edge of two bands is drawn in each, clipped, so some names come twice.
		expect(new Set(names).size).toBe(20);
		// The same window again: nothing to do.
		rec.clear();
		paintBars({ ...frame, win: { x: 0, y: 56, w: 1000, h: 560 } });
		expect(rec.calls.filter((c) => c[0] === 'fillText')).toHaveLength(0);
		// A new theme repaints everything at once.
		rec.clear();
		paintBars({ ...frame, theme: { ...frame.theme }, win: { x: 0, y: 56, w: 1000, h: 560 } });
		expect(rec.of('fillText')).toHaveLength(20);
	});
});
