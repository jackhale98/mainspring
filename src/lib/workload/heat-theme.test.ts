// SPDX-License-Identifier: GPL-2.0-or-later
// The heatmap's look (heat-theme.ts): every token read from the getter it is given, the fallbacks
// when a token is missing or not a number, the cell width of each zoom, and that the fallbacks are
// the light theme's own values (so a missing token never paints another theme's colour).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../../../tests/golden/corpus';
import { FALLBACK_HEAT_THEME, MIN_TEXT_WIDTH, colWidthOf, readHeatTheme } from './heat-theme';

const light = fs.readFileSync(path.join(REPO, 'src/styles/theme-light.css'), 'utf8');
const tokens = fs.readFileSync(path.join(REPO, 'src/styles/tokens.css'), 'utf8');
const tokenOf = (css: string, name: string): string =>
	(new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1] ?? '').trim();

describe('reading the tokens', () => {
	it('takes each colour and size from the getter, trimmed', () => {
		const t = readHeatTheme((name) => {
			const v: Record<string, string> = {
				'--load-over': ' #112233 ',
				'--load-row-height': '44px',
				'--load-col-week': '48',
			};
			return v[name] ?? '';
		});
		expect(t.over).toBe('#112233');
		expect(t.rowHeight).toBe(44);
		expect(t.colWeek).toBe(48);
	});

	it('falls back for a token that is missing or not a number', () => {
		const t = readHeatTheme((name) => (name === '--load-row-height' ? 'tall' : ''));
		expect(t.rowHeight).toBe(FALLBACK_HEAT_THEME.rowHeight);
		expect(t.spare).toBe(FALLBACK_HEAT_THEME.spare);
	});

	it('has fallbacks equal to the light theme and the size tokens', () => {
		const f = FALLBACK_HEAT_THEME;
		expect(f.spare).toBe(tokenOf(light, 'load-spare'));
		expect(f.full).toBe(tokenOf(light, 'load-full'));
		expect(f.over).toBe(tokenOf(light, 'load-over'));
		expect(f.off).toBe(tokenOf(light, 'load-off'));
		expect(f.held).toBe(tokenOf(light, 'held'));
		expect(f.leaveHatch).toBe(tokenOf(light, 'leave-hatch'));
		expect(f.rowHeight).toBe(parseFloat(tokenOf(tokens, 'load-row-height')));
		expect(f.colWeek).toBe(parseFloat(tokenOf(tokens, 'load-col-week')));
		expect(f.headerRow).toBe(parseFloat(tokenOf(tokens, 'load-header-row')));
	});
});

describe('cell widths', () => {
	it('gives each zoom its own width, wider as the period grows, never under the text width', () => {
		const t = FALLBACK_HEAT_THEME;
		expect(colWidthOf(t, 'day')).toBe(t.colDay);
		expect(colWidthOf(t, 'week')).toBe(t.colWeek);
		expect(colWidthOf(t, 'month')).toBe(t.colMonth);
		expect(t.colDay).toBeLessThan(t.colWeek);
		expect(t.colWeek).toBeLessThan(t.colMonth);
		expect(t.colDay).toBeGreaterThanOrEqual(MIN_TEXT_WIDTH);
	});
});
