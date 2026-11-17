// SPDX-License-Identifier: GPL-2.0-or-later
// The lanes' sizes (lane-theme.ts): every token read from the getter it is given, the fallbacks
// when one is missing, not a number or not positive, the column width of each zoom, and that the
// fallbacks are the tokens' own values (so a missing token never resizes a lane).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../../../tests/golden/corpus';
import { FALLBACK_LANE_THEME, laneColWidth, readLaneTheme } from './lane-theme';

const tokens = fs.readFileSync(path.join(REPO, 'src/styles/tokens.css'), 'utf8');
const tokenPx = (name: string): number =>
	Number.parseFloat(new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1] ?? '');

describe('lane theme', () => {
	it('takes each size from the getter', () => {
		const t = readLaneTheme((name) => (name === '--lane-row-height' ? '44px' : ''));
		expect(t.rowHeight).toBe(44);
		expect(t.barHeight).toBe(FALLBACK_LANE_THEME.barHeight);
	});

	it('falls back for a value that is not a positive number', () => {
		const t = readLaneTheme((name) => (name === '--lane-bar-height' ? '-3px' : 'wide'));
		expect(t).toEqual(FALLBACK_LANE_THEME);
	});

	it('has the row of Phase 2 (40 px: the exemption of 10) and the Gantt zoom presets', () => {
		expect(FALLBACK_LANE_THEME.rowHeight).toBe(40);
		expect(FALLBACK_LANE_THEME.colDay).toBe(56);
		expect(FALLBACK_LANE_THEME.colWeek).toBe(112);
	});

	it('picks the width of the zoom', () => {
		const t = FALLBACK_LANE_THEME;
		expect([laneColWidth(t, 'day'), laneColWidth(t, 'week'), laneColWidth(t, 'month')]).toEqual([
			t.colDay,
			t.colWeek,
			t.colMonth,
		]);
	});

	it('has fallbacks equal to the tokens of tokens.css', () => {
		expect(tokenPx('lane-row-height')).toBe(FALLBACK_LANE_THEME.rowHeight);
		expect(tokenPx('lane-bar-height')).toBe(FALLBACK_LANE_THEME.barHeight);
		expect(tokenPx('lane-bar-radius')).toBe(FALLBACK_LANE_THEME.barRadius);
		expect(tokenPx('lane-over-height')).toBe(FALLBACK_LANE_THEME.overHeight);
		expect(tokenPx('lane-group-height')).toBe(FALLBACK_LANE_THEME.groupHeight);
		expect(tokenPx('lane-min-bar')).toBe(FALLBACK_LANE_THEME.minBar);
		expect(tokenPx('lane-col-day')).toBe(FALLBACK_LANE_THEME.colDay);
		expect(tokenPx('lane-col-week')).toBe(FALLBACK_LANE_THEME.colWeek);
		expect(tokenPx('lane-col-month')).toBe(FALLBACK_LANE_THEME.colMonth);
	});
});
