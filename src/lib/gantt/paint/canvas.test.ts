// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	MAX_DPR,
	begin,
	clearTextCache,
	effectiveDpr,
	roundedRect,
	sizeCanvas,
	snap,
	textWidth,
} from './canvas';
import { FALLBACK_THEME, readTheme } from './theme';
import { recorder } from './testing';

describe('effectiveDpr', () => {
	it('caps the ratio at 2 and never goes below 1', () => {
		expect(effectiveDpr(1)).toBe(1);
		expect(effectiveDpr(1.5)).toBe(1.5);
		expect(effectiveDpr(2.625)).toBe(MAX_DPR);
		expect(effectiveDpr(0)).toBe(1);
		expect(effectiveDpr(Number.NaN)).toBe(1);
	});
});

describe('sizeCanvas', () => {
	it('sizes the backing store by the ratio and the element by CSS pixels', () => {
		const style = { width: '', height: '' };
		const c = { width: 0, height: 0, style } as unknown as HTMLCanvasElement;
		expect(sizeCanvas(c, 300.4, 100, 2)).toBe(true);
		expect([c.width, c.height]).toEqual([601, 200]);
		expect(style).toEqual({ width: '300.4px', height: '100px' });
		expect(sizeCanvas(c, 300.4, 100, 2)).toBe(false);
		expect(sizeCanvas(c, 300.4, 100, 1)).toBe(true);
	});
});

describe('begin', () => {
	it('clears the whole canvas, then maps content coordinates to device pixels', () => {
		const rec = recorder(800, 400);
		begin(rec.ctx, { x: 50, y: 10, w: 400, h: 200 }, 2);
		expect(rec.calls).toEqual([
			['setTransform', 1, 0, 0, 1, 0, 0],
			['clearRect', 0, 0, 800, 400],
			['setTransform', 2, 0, 0, 2, -100, -20],
		]);
	});
});

describe('snap', () => {
	it('rounds to the nearest device pixel', () => {
		expect(snap(10.4, 1)).toBe(10);
		expect(snap(10.4, 2)).toBe(10.5);
		expect(snap(10.2, 2)).toBe(10);
	});
});

describe('roundedRect', () => {
	it('draws four arcs and limits the radius to half the size', () => {
		const rec = recorder();
		roundedRect(rec.ctx, 0, 0, 4, 100, 10);
		expect(rec.of('arcTo')).toHaveLength(4);
		expect(rec.of('arcTo')[0]).toEqual(['arcTo', 4, 0, 4, 100, 2]);
	});
});

describe('textWidth', () => {
	it('measures each text once per font', () => {
		clearTextCache();
		const rec = recorder();
		let measured = 0;
		const ctx = new Proxy(rec.ctx, {
			get(t, k) {
				if (k === 'measureText') {
					return (s: string) => {
						measured++;
						return t.measureText(s);
					};
				}
				return Reflect.get(t, k) as unknown;
			},
		});
		expect(textWidth(ctx, 'abcd')).toBe(24);
		expect(textWidth(ctx, 'abcd')).toBe(24);
		expect(measured).toBe(1);
	});
});

describe('readTheme', () => {
	it('reads each colour from its token and falls back to the light theme', () => {
		const tokens: Record<string, string> = {
			'--color-gantt-accent': ' #123456 ',
			'--color-gantt-bar-top': '#abcdef',
			'--font-sans': 'Inter Variable, sans-serif',
		};
		const p = readTheme((name) => tokens[name] ?? '');
		expect(p.accent).toBe('#123456');
		expect(p.barTop).toBe('#abcdef');
		expect(p.fontSans).toBe('Inter Variable, sans-serif');
		expect(p.surface).toBe(FALLBACK_THEME.surface);
		expect(p.fontMono).toBe(FALLBACK_THEME.fontMono);
	});
});
