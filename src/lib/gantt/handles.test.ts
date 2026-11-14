// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	NO_HANDLES,
	dotCentre,
	handleAt,
	handlesOf,
	knobCentre,
	percentAt,
	resizeSpan,
	snapPercent,
	type HandleSet,
} from './handles';
import { hitTest } from './hit';
import { createLayout } from './layout';
import { createScale } from './scale';
import { D, metricsOf, modelOf, row } from './testing';

const scale = createScale(48, 0);
const all: HandleSet = { resize: 'end', link: true, progress: 50 };

function layoutFor(coarse: boolean) {
	const model = modelOf([row(0, 0, 4 * D, 'task', { complete: 50 }), row(1, 6 * D, 8 * D)]);
	return { model, layout: createLayout(model, scale, metricsOf(coarse)) };
}

describe('handlesOf', () => {
	it('gives a leaf the size handle, the dot and the knob', () => {
		expect(handlesOf(row(0, 0, 2 * D, 'task', { complete: 35 }), 'end')).toEqual({
			resize: 'end',
			link: true,
			progress: 35,
		});
		expect(handlesOf(row(0, 0, 2 * D), 'start')).toMatchObject({ resize: 'start', progress: 0 });
	});

	it('gives a milestone and a container the link dot only', () => {
		expect(handlesOf(row(0, 0, 0, 'milestone'), null)).toEqual({
			resize: null,
			link: true,
			progress: null,
		});
		expect(handlesOf(row(0, 0, 2 * D, 'container'), null)).toMatchObject({
			resize: null,
			progress: null,
			link: true,
		});
	});

	it('gives a text-only or unscheduled task nothing', () => {
		expect(handlesOf(row(0, 0, 2 * D, 'task', { textOnly: 'macro-call' }), 'end')).toBe(NO_HANDLES);
		expect(handlesOf(row(0, null, null), 'end')).toBe(NO_HANDLES);
		expect(handlesOf(undefined, null)).toBe(NO_HANDLES);
	});
});

describe('handleAt', () => {
	for (const coarse of [false, true]) {
		const name = coarse ? 'coarse' : 'fine';
		it(`finds each handle of the selected bar (${name} pointer)`, () => {
			const { layout } = layoutFor(coarse);
			const bar = layout.barRect(0)!;
			const mid = bar.y + bar.h / 2;
			const right = bar.x + bar.w;
			// The size handle: inside the end of the bar.
			expect(handleAt(layout, 0, all, right - 4, mid - 3)).toBe('end-handle');
			expect(handleAt(layout, 0, all, right + 1, mid)).toBe('end-handle');
			// The dot: outside the end, in a zone of its own.
			const dot = dotCentre(bar, layout.metrics);
			expect(handleAt(layout, 0, all, dot.x, dot.y)).toBe('link-dot');
			// The knob: on the foot, at the share done.
			const knob = knobCentre(bar, 50);
			expect(handleAt(layout, 0, all, knob.x, knob.y + 2)).toBe('progress');
			// The middle of the body is none of them.
			expect(handleAt(layout, 0, all, bar.x + bar.w * 0.25, mid - 3)).toBeNull();
		});

		it(`has hit zones of the minimum size (${name} pointer)`, () => {
			const { layout } = layoutFor(coarse);
			const bar = layout.barRect(0)!;
			const min = layout.metrics.hitMin;
			const [x0, x1] = resizeSpan(bar, 'end', layout.metrics);
			expect(x1 - x0).toBeGreaterThanOrEqual(min * 0.7);
			const dot = dotCentre(bar, layout.metrics);
			let lo = Infinity;
			let hi = -Infinity;
			for (let x = dot.x - min; x <= dot.x + min; x += 0.5) {
				if (handleAt(layout, 0, all, x, dot.y) === 'link-dot') {
					lo = Math.min(lo, x);
					hi = Math.max(hi, x);
				}
			}
			expect(hi - lo).toBeGreaterThanOrEqual(min - 1);
			let top = Infinity;
			let bottom = -Infinity;
			for (let y = dot.y - min; y <= dot.y + min; y += 0.5) {
				if (handleAt(layout, 0, all, dot.x, y) === 'link-dot') {
					top = Math.min(top, y);
					bottom = Math.max(bottom, y);
				}
			}
			expect(bottom - top).toBeGreaterThanOrEqual(min - 1);
		});
	}

	it('puts the size handle of an ALAP task on its start', () => {
		const { layout } = layoutFor(false);
		const bar = layout.barRect(0)!;
		const set: HandleSet = { resize: 'start', link: true, progress: null };
		expect(handleAt(layout, 0, set, bar.x + 3, bar.y + bar.h / 2)).toBe('end-handle');
		expect(handleAt(layout, 0, set, bar.x + bar.w - 3, bar.y + bar.h / 2)).toBeNull();
	});

	it('leaves a short bar its body: the handles take part of it, not all', () => {
		// One day wide at 48 px a day, on a coarse pointer (44 px zones): the upper left is still body.
		const model = modelOf([row(0, 0, D, 'task', { complete: 50 })]);
		const layout = createLayout(model, scale, metricsOf(true));
		const bar = layout.barRect(0)!;
		expect(handleAt(layout, 0, all, bar.x + 6, bar.y + 3)).toBeNull();
		expect(hitTest(layout, model, bar.x + 6, bar.y + 3, { selected: 0, handles: all })).toEqual({
			kind: 'bar',
			row: 0,
		});
		expect(handleAt(layout, 0, all, bar.x + bar.w - 3, bar.y + 3)).toBe('end-handle');
	});

	it('finds only the handles a task has', () => {
		const { layout } = layoutFor(false);
		const bar = layout.barRect(0)!;
		const right = bar.x + bar.w;
		const none: HandleSet = { resize: null, link: false, progress: null };
		expect(handleAt(layout, 0, none, right - 2, bar.y + 4)).toBeNull();
		const dotOnly: HandleSet = { resize: null, link: true, progress: null };
		expect(handleAt(layout, 0, dotOnly, right - 2, bar.y + 4)).toBeNull();
	});
});

describe('hitTest with handles', () => {
	it('returns a handle part only for the selected bar', () => {
		const { model, layout } = layoutFor(false);
		const bar = layout.barRect(0)!;
		const x = bar.x + bar.w - 3;
		const y = bar.y + bar.h / 2 - 3;
		expect(hitTest(layout, model, x, y, { selected: 0, handles: all })).toEqual({
			kind: 'bar',
			row: 0,
			part: 'end-handle',
		});
		expect(hitTest(layout, model, x, y, { selected: 1, handles: all })).toEqual({
			kind: 'bar',
			row: 0,
		});
		expect(hitTest(layout, model, x, y)).toEqual({ kind: 'bar', row: 0 });
	});

	it('finds the dot beyond the bar, where there is no bar to hit', () => {
		const { model, layout } = layoutFor(false);
		const bar = layout.barRect(0)!;
		const dot = dotCentre(bar, layout.metrics);
		expect(hitTest(layout, model, dot.x, dot.y, { selected: 0, handles: all })).toMatchObject({
			part: 'link-dot',
		});
		expect(hitTest(layout, model, dot.x, dot.y)).toMatchObject({ kind: 'empty', row: 0 });
	});
});

describe('progress', () => {
	it('reads a share from a pointer and snaps to 5 %', () => {
		const { layout } = layoutFor(false);
		const bar = layout.barRect(0)!;
		expect(percentAt(bar, bar.x + bar.w / 2)).toBeCloseTo(50);
		expect(percentAt(bar, bar.x - 20)).toBe(0);
		expect(percentAt(bar, bar.x + bar.w + 20)).toBe(100);
		expect(snapPercent(37)).toBe(35);
		expect(snapPercent(38)).toBe(40);
		expect(snapPercent(-4)).toBe(0);
		expect(snapPercent(130)).toBe(100);
	});
});
