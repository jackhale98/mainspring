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

/** The words drawn: consecutive characters of a tabular label are put back together. */
function words(rec: ReturnType<typeof recorder>): string[] {
	const out: string[] = [];
	let lastX = -Infinity;
	let lastY = -Infinity;
	for (const c of rec.of('fillText')) {
		const [, text, x, y] = c as unknown as [string, string, number, number];
		const joined = out.length > 0 && y === lastY && x - lastX <= 9 && text.length === 1;
		if (joined) out[out.length - 1] += text;
		else out.push(text);
		lastX = x;
		lastY = y;
	}
	return out;
}

describe('paintHeader', () => {
	it('sets the month in the display serif and the year italic, and the days in tabular figures', () => {
		const { f, rec } = frame(56);
		paintHeader(f);
		const w = words(rec);
		expect(w).toContain('January');
		expect(w).toContain('2026');
		expect(w).toContain('Mon 5');
		const fonts = rec.of('set:font').map((c) => c[1]);
		expect(fonts).toContain(`${FALLBACK_THEME.headerFontSize}px ${FALLBACK_THEME.fontDisplay}`);
		expect(fonts).toContain(
			`italic ${FALLBACK_THEME.headerFontSize}px ${FALLBACK_THEME.fontDisplay}`,
		);
		expect(rec.of('fillRect')[0]).toEqual(['fillRect', 0, 0, 1000, FALLBACK_THEME.headerRow * 2]);
		// The minor row is one character per fillText: digits on a fixed advance.
		const digits = rec.of('fillText').filter((c) => c[1] === '1' || c[1] === '2');
		expect(digits.length).toBeGreaterThan(2);
	});

	it('leaves out lower labels that do not fit their cell', () => {
		// At 16 px per day a day is narrower than its label: week cells carry the lower row.
		const { f, rec } = frame(16);
		paintHeader(f);
		const w = words(rec);
		expect(w).toContain('Jan 5');
		expect(w.some((l) => l.startsWith('Mon'))).toBe(false);
		const dense = frame(1.2);
		paintHeader(dense.f);
		expect(words(dense.rec)).toContain('2026');
	});

	it('keeps the upper label at the left of the view while its cell is under it', () => {
		const a = frame(16, 0);
		paintHeader(a.f);
		const b = frame(16, 100);
		paintHeader(b.f);
		const x = (r: ReturnType<typeof frame>) =>
			r.rec.of('fillText').find((c) => c[1] === 'January')?.[2] as number;
		expect(x(b)).toBeGreaterThan(x(a));
		expect(x(b)).toBe(100 + FALLBACK_THEME.labelPad);
	});

	it('draws a brass crown for today and a marker for the status date, and skips far ones', () => {
		const { f, rec } = frame(56, 0, {
			markers: [
				{ at: 2 * MIN_PER_DAY, kind: 'status' },
				{ at: 5 * MIN_PER_DAY, kind: 'today' },
				{ at: 900 * MIN_PER_DAY, kind: 'today' },
			],
		});
		paintHeader(f);
		expect(rec.of('set:fillStyle').map((c) => c[1])).toContain(FALLBACK_THEME.statusDate);
		// One crown: a gradient from the knob's lit top to the line colour, with an edge.
		expect(rec.of('createLinearGradient')).toHaveLength(1);
		expect(rec.of('addColorStop').map((c) => c[2])).toEqual([
			FALLBACK_THEME.crownTop,
			FALLBACK_THEME.today,
		]);
		expect(rec.of('set:strokeStyle').map((c) => c[1])).toContain(FALLBACK_THEME.crownEdge);
		// The crown's fill and the status marker's.
		expect(rec.of('fill')).toHaveLength(2);
	});
});
