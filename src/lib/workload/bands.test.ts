// SPDX-License-Identifier: GPL-2.0-or-later
// The band rule (phase-3.md 6.2, 18.3; ADR-0014 #3 and amendment; the T2 order ruling): each rule
// at its boundary, the order (off before over, over before spare), held and unmet work, custom
// thresholds, and properties against a direct reading of the rule.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bandOf, overCauses, percentOf, type CellMinutes } from './bands';
import { DEFAULT_THRESHOLDS, type Band, type Thresholds } from './types';

const T = DEFAULT_THRESHOLDS;
const cell = (booked: number, available: number, held = 0, unmet = 0): CellMinutes => ({
	booked,
	available,
	held,
	unmet,
});

describe('bandOf', () => {
	it('is off with nothing available and nothing booked, even when work waits', () => {
		expect(bandOf(cell(0, 0), T)).toBe('off');
		expect(bandOf(cell(0, 0, 480), T)).toBe('off');
		expect(bandOf(cell(0, 0, 0, 120), T)).toBe('off');
		expect(overCauses(cell(0, 0, 480), T)).toEqual([]);
	});

	it('is spare below the lower threshold, full from it up to the upper one inclusive', () => {
		// 40 h available: 80 % is 32 h, 100 % is 40 h.
		expect(bandOf(cell(32 * 60 - 1, 2400), T)).toBe('spare');
		expect(bandOf(cell(32 * 60, 2400), T)).toBe('full');
		expect(bandOf(cell(2400, 2400), T)).toBe('full');
		expect(bandOf(cell(0, 2400), T)).toBe('spare');
	});

	it('is over above the upper threshold', () => {
		const t: Thresholds = { spareBelow: 50, overAbove: 90 };
		expect(bandOf(cell(36 * 60, 2400), t)).toBe('full'); // exactly 90 %
		expect(bandOf(cell(36 * 60 + 1, 2400), t)).toBe('over');
		expect(overCauses(cell(36 * 60 + 1, 2400), t)).toEqual(['threshold']);
		expect(bandOf(cell(20 * 60, 2400), t)).toBe('full'); // exactly 50 %
		expect(bandOf(cell(20 * 60 - 1, 2400), t)).toBe('spare');
	});

	it('is over with held or unmet work, whatever the load', () => {
		expect(bandOf(cell(0, 2400, 60), T)).toBe('over');
		expect(bandOf(cell(600, 2400, 0, 60), T)).toBe('over');
		expect(overCauses(cell(2400, 2400, 60, 30), T)).toEqual(['held', 'unmet']);
	});

	it('is over when booked exceeds available (a guard: overtime counts as working time)', () => {
		expect(bandOf(cell(60, 0), T)).toBe('over');
		expect(overCauses(cell(60, 0), T)).toEqual(['booked']);
		expect(overCauses(cell(2500, 2400), T)).toEqual(['booked', 'threshold']);
	});

	it('keeps the rule order when the thresholds cross', () => {
		const t: Thresholds = { spareBelow: 120, overAbove: 100 };
		expect(bandOf(cell(2400, 2400), t)).toBe('spare');
		expect(bandOf(cell(2401, 2400), t)).toBe('over');
	});

	it('gives the percent of available time, or null', () => {
		expect(percentOf(1200, 2400)).toBe(50);
		expect(percentOf(60, 0)).toBeNull();
	});
});

/** The rule read straight from 6.2, with division. */
function direct(c: CellMinutes, t: Thresholds): Band {
	if (c.available === 0 && c.booked === 0) return 'off';
	const u = c.available > 0 ? (100 * c.booked) / c.available : Infinity;
	if (c.booked > c.available || c.held > 0 || c.unmet > 0 || u > t.overAbove) return 'over';
	if (u < t.spareBelow) return 'spare';
	return 'full';
}

const minutes = fc.integer({ min: 0, max: 20_000 });
const cells = fc.record({
	booked: minutes,
	available: minutes,
	held: fc.oneof(fc.constant(0), minutes),
	unmet: fc.oneof(fc.constant(0), minutes),
});
const thresholds = fc.record({
	spareBelow: fc.integer({ min: 0, max: 150 }),
	overAbove: fc.integer({ min: 0, max: 150 }),
});

describe('band properties', () => {
	it('match the rule as written', () => {
		fc.assert(
			fc.property(cells, thresholds, (c, t) => {
				expect(bandOf(c, t)).toBe(direct(c, t));
			}),
		);
	});

	it('only become worse as more is booked, with spare at or below over', () => {
		const rank: Record<Band, number> = { off: 0, spare: 1, full: 2, over: 3 };
		fc.assert(
			fc.property(cells, minutes, (c, more) => {
				const t = DEFAULT_THRESHOLDS;
				if (c.available === 0) return;
				const a = bandOf(c, t);
				const b = bandOf({ ...c, booked: c.booked + more }, t);
				expect(rank[b]).toBeGreaterThanOrEqual(rank[a]);
			}),
		);
	});

	it('say over exactly when there is a cause', () => {
		fc.assert(
			fc.property(cells, thresholds, (c, t) => {
				expect(bandOf(c, t) === 'over').toBe(overCauses(c, t).length > 0);
			}),
		);
	});
});
