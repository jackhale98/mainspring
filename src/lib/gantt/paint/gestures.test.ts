// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { dotCentre } from '../handles';
import { D, link, modelOf, row } from '../testing';
import { NO_GESTURE, drawsGesture, paintGestures, type GestureOverlay } from './gestures';
import { NO_OVERLAY, paintOverlay } from './overlay';
import { frameOf } from './testing';

const rows = [
	row(0, 0, 2 * D),
	row(1, 2 * D, 5 * D, 'task', { complete: 40 }),
	row(2, 6 * D, 6 * D, 'milestone'),
];
const g = (over: Partial<GestureOverlay>): GestureOverlay => ({ ...NO_GESTURE, ...over });
const all = { resize: 'end', link: true, progress: 40 } as const;

describe('drawsGesture', () => {
	it('is false for nothing, and for handles alone, which are not a gesture in flight', () => {
		expect(drawsGesture(undefined)).toBe(false);
		expect(drawsGesture(NO_GESTURE)).toBe(false);
		expect(drawsGesture(g({ handles: all }))).toBe(false);
		expect(drawsGesture(g({ label: { text: 'x', x: 1, y: 1, blocked: false } }))).toBe(true);
	});
});

describe('the handles', () => {
	it('draws a grip, the dot and the knob of the selected bar, and reports where', () => {
		const { frame, rec, layout } = frameOf(modelOf(rows));
		const notes: number[][] = [];
		paintGestures(
			frame,
			g({ handles: all }),
			1,
			() => true,
			(...n) => notes.push(n),
		);
		expect(rec.of('arc')).toHaveLength(2);
		const bar = layout.barRect(1)!;
		const dot = dotCentre(bar, layout.metrics);
		const arcs = rec.of('arc').map((c) => [c[1], c[2]]);
		expect(arcs[0]).toEqual([dot.x, dot.y]);
		expect(notes.length).toBeGreaterThanOrEqual(3);
	});

	it('draws none while a bar is being dragged, or for a row out of the window', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		const ghost = { row: 1, start: 2 * D, end: 6 * D, state: 'preview', complete: null } as const;
		paintGestures(
			frame,
			g({ handles: all, ghosts: [ghost] }),
			1,
			() => true,
			() => undefined,
		);
		expect(rec.of('arc')).toHaveLength(0);
		rec.clear();
		paintGestures(
			frame,
			g({ handles: all }),
			1,
			() => false,
			() => undefined,
		);
		expect(rec.of('arc')).toHaveLength(0);
	});
});

describe('previews and pending bars', () => {
	const ghost = (state: 'preview' | 'pending' | 'not-scheduled') =>
		({ row: 0, start: 3 * D, end: 6 * D, state, complete: null }) as const;

	it('draws a preview as a translucent bar with a dashed outline in the pending colour', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintGestures(
			frame,
			g({ ghosts: [ghost('preview')] }),
			null,
			() => true,
			() => undefined,
		);
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(frame.theme.pending);
		expect(rec.of('setLineDash').some((c) => (c[1] as number[]).length > 0)).toBe(true);
		expect(rec.of('clip')).toHaveLength(0);
	});

	it('hatches a pending bar and draws it with a solid outline', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintGestures(
			frame,
			g({ ghosts: [ghost('pending')] }),
			null,
			() => true,
			() => undefined,
		);
		expect(rec.of('clip')).toHaveLength(1);
		expect(rec.of('moveTo').length).toBeGreaterThan(3);
		const last = rec.of('setLineDash').at(-1);
		expect(last?.[1]).toEqual([]);
	});

	it('marks a bar that does not schedule in the critical colour, with no fill', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintGestures(
			frame,
			g({ ghosts: [ghost('not-scheduled')] }),
			null,
			() => true,
			() => undefined,
		);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toContain(frame.theme.critical);
		expect(rec.of('fill')).toHaveLength(0);
	});

	it('places the ghost where its minutes are, not where the bar is', () => {
		const { frame, layout, rec } = frameOf(modelOf(rows));
		paintGestures(
			frame,
			g({ ghosts: [ghost('preview')] }),
			null,
			() => true,
			() => undefined,
		);
		const x = layout.scale.x(3 * D);
		const firstMove = rec.of('moveTo')[0];
		// A rounded rectangle starts one radius in from the left edge.
		expect(Math.abs((firstMove?.[1] as number) - x)).toBeLessThanOrEqual(frame.theme.barRadius + 1);
	});

	it('shows the share done on a progress preview', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		const p = { row: 1, start: 2 * D, end: 5 * D, state: 'preview', complete: 75 } as const;
		paintGestures(
			frame,
			g({ ghosts: [p] }),
			null,
			() => true,
			() => undefined,
		);
		const fills = rec.of('fillRect');
		expect(fills).toHaveLength(1);
		const w = fills[0]?.[3] as number;
		expect(w).toBeGreaterThan(0);
	});
});

describe('links and labels', () => {
	it('draws the rubber band from the dot to the pointer, and rings the target', () => {
		const { frame, rec } = frameOf(modelOf(rows, [link(0, 1)]));
		paintGestures(
			frame,
			g({
				band: { fromRow: 0, x: 300, y: 50 },
				target: { row: 1, ok: false },
			}),
			null,
			() => true,
			() => undefined,
		);
		expect(rec.of('lineTo').some((c) => c[1] === 300 && c[2] === 50)).toBe(true);
		const strokes = rec.of('set:strokeStyle').map((c) => c[1]);
		expect(strokes).toContain(frame.theme.critical);
	});

	it('hangs a label beside the pointer and keeps it inside the window', () => {
		const { frame, rec } = frameOf(modelOf(rows), { win: { x: 0, y: 0, w: 400, h: 200 } });
		paintGestures(
			frame,
			g({ label: { text: 'Starts Tue 3 Mar', x: 395, y: 60, blocked: false } }),
			null,
			() => true,
			() => undefined,
		);
		expect(rec.of('fillText')[0]?.[1]).toBe('Starts Tue 3 Mar');
		const x = rec.of('fillText')[0]?.[2] as number;
		const width = 'Starts Tue 3 Mar'.length * 6;
		expect(x + width).toBeLessThanOrEqual(400);
	});
});

describe('inside the overlay', () => {
	it('draws the gesture layer last, and not the shortcut for a moved window', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(frame, {
			...NO_OVERLAY,
			selectedRow: 1,
			gesture: g({ label: { text: 'x', x: 100, y: 80, blocked: true } }),
		});
		expect(rec.of('fillText')).toHaveLength(1);
		const strokeOrder = rec.of('set:strokeStyle').map((c) => c[1]);
		expect(strokeOrder[0]).toBe(frame.theme.focus);
	});

	it('draws the selected link like a hovered one', () => {
		const m = modelOf(rows, [link(0, 1)]);
		const a = frameOf(m);
		paintOverlay(a.frame, { ...NO_OVERLAY, hoverLink: 0 });
		const b = frameOf(m);
		paintOverlay(b.frame, { ...NO_OVERLAY, gesture: g({ selectedLink: 0 }) });
		expect(b.rec.calls.filter((c) => c[0] === 'lineTo')).toEqual(
			a.rec.calls.filter((c) => c[0] === 'lineTo'),
		);
	});
});
