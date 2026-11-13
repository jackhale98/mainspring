// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { MIN_PER_DAY, createScale } from '../scale';
import { ticksFor } from '../ticks';
import { paintHeader, type HeaderFrame } from './header';
import { FALLBACK_THEME } from './theme';
import { recorder } from './testing';

const cal = { startEpoch: Date.UTC(2026, 0, 5) / 1000, env: { zone: null }, locale: 'en-US' };

function frame(pxPerDay: number, viewLeft = 0, over: Partial<HeaderFrame> = {}) {
	const rec = recorder();
	const f: HeaderFrame = {
		ctx: rec.ctx,
		win: { x: 0, w: 1000 },
		dpr: 1,
		scale: createScale(pxPerDay, 0),
		ticks: ticksFor(cal, 0, (1000 / pxPerDay) * MIN_PER_DAY, pxPerDay),
		markers: [],
		theme: FALLBACK_THEME,
		viewLeft,
		...over,
	};
	return { f, rec };
}

describe('paintHeader', () => {
	it('draws month and day labels at day zoom', () => {
		const { f, rec } = frame(56);
		paintHeader(f);
		const labels = rec.of('fillText').map((c) => c[1]);
		expect(labels).toContain('January 2026');
		expect(labels).toContain('Mon 5');
		expect(rec.of('fillRect')[0]).toEqual(['fillRect', 0, 0, 1000, FALLBACK_THEME.headerRow * 2]);
	});

	it('leaves out lower labels that do not fit their cell', () => {
		// At 16 px per day a day is narrower than its label: week cells carry the lower row.
		const { f, rec } = frame(16);
		paintHeader(f);
		const labels = rec.of('fillText').map((c) => c[1] as string);
		expect(labels).toContain('Jan 5');
		expect(labels.some((l) => l.startsWith('Mon'))).toBe(false);
		const dense = frame(1.2);
		paintHeader(dense.f);
		const quarters = dense.rec.of('fillText').map((c) => c[1]);
		expect(quarters).toContain('2026');
	});

	it('keeps the upper label at the left of the view while its cell is under it', () => {
		const a = frame(16, 0);
		paintHeader(a.f);
		const b = frame(16, 100);
		paintHeader(b.f);
		const x = (r: ReturnType<typeof frame>) =>
			r.rec.of('fillText').find((c) => c[1] === 'January 2026')?.[2] as number;
		expect(x(b)).toBeGreaterThan(x(a));
		expect(x(b)).toBe(100 + FALLBACK_THEME.labelPad);
	});

	it('draws a marker in the line colour for today and the status date', () => {
		const { f, rec } = frame(56, 0, {
			markers: [
				{ at: 2 * MIN_PER_DAY, kind: 'status' },
				{ at: 5 * MIN_PER_DAY, kind: 'today' },
				{ at: 900 * MIN_PER_DAY, kind: 'today' },
			],
		});
		paintHeader(f);
		const fills = rec.of('set:fillStyle').map((c) => c[1]);
		expect(fills).toContain(FALLBACK_THEME.statusDate);
		expect(fills).toContain(FALLBACK_THEME.today);
		// Two triangles: the one far outside the window is skipped.
		expect(rec.of('fill')).toHaveLength(2);
	});
});
