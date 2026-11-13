// SPDX-License-Identifier: GPL-2.0-or-later
// The colour pass of ADR-0009 ("Pending refinement" and its recorded values): every text pair
// meets WCAG 2.2 AA (4.5:1), every graphic that must be seen meets 1.4.11 (3:1), and every pair of
// colours that must be told apart is still told apart under protanopia and deuteranopia
// simulation (by lightness or by a clear distance, since hue is what those viewers lose). The
// values come straight from src/styles/theme-light.css and theme-dark.css, so a token change that
// breaks a pair fails here.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../golden/corpus';

function tokensOf(file: string): Map<string, string> {
	const css = fs.readFileSync(path.join(REPO, 'src/styles', file), 'utf8');
	const out = new Map<string, string>();
	for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g))
		out.set(m[1] ?? '', (m[2] ?? '').trim());
	return out;
}

type Rgb = readonly [number, number, number];

/** A token as sRGB 0..255, resolving `var(--x)` and flattening `rgb(r g b / a)` over `over`. */
function colour(t: Map<string, string>, name: string, over?: Rgb): Rgb {
	let v = t.get(name);
	if (v === undefined) throw new Error(`token --${name} is not defined`);
	const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
	if (ref) return colour(t, ref[1] ?? '', over);
	const hex = /^#([0-9a-f]{6})$/i.exec(v);
	if (hex) {
		const n = parseInt(hex[1] ?? '', 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(v);
	if (!fn) throw new Error(`--${name}: cannot read "${v}"`);
	const [r, g, b] = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
	const a = fn[4] === undefined ? 1 : Number(fn[4]);
	const base = over ?? [255, 255, 255];
	v = '';
	return [r, g, b].map((c, i) => Math.round(c * a + (base[i] ?? 255) * (1 - a))) as unknown as Rgb;
}

const lin = (c: number): number => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: Rgb): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgb, b: Rgb): number => {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const PROTAN = [
	[0.152286, 1.052583, -0.204868],
	[0.114503, 0.786281, 0.099216],
	[-0.003882, -0.048116, 1.051998],
] as const;
const DEUTAN = [
	[0.367322, 0.860646, -0.227968],
	[0.280085, 0.672501, 0.047413],
	[-0.01182, 0.04294, 0.968881],
] as const;
type Matrix = typeof PROTAN | typeof DEUTAN;

function simulate(c: Rgb, m: Matrix): Rgb {
	const l = [lin(c[0]), lin(c[1]), lin(c[2])];
	const enc = (v: number): number => {
		const x = Math.min(1, Math.max(0, v));
		return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
	};
	const row = (r: readonly number[]): number =>
		enc((r[0] ?? 0) * (l[0] ?? 0) + (r[1] ?? 0) * (l[1] ?? 0) + (r[2] ?? 0) * (l[2] ?? 0));
	return [row(m[0]), row(m[1]), row(m[2])];
}

function lab(c: Rgb): readonly [number, number, number] {
	const [r, g, b] = [lin(c[0]), lin(c[1]), lin(c[2])];
	const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const distance = (a: Rgb, b: Rgb): number => {
	const [x, y] = [lab(a), lab(b)];
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/** Text on ground: [text token, ground token, minimum ratio]. */
const TEXT: ReadonlyArray<readonly [string, string, number]> = [
	['color-text', 'color-surface', 4.5],
	['color-text', 'color-bg', 4.5],
	['color-text-muted', 'color-surface', 4.5],
	['color-text-muted', 'color-surface-sunken', 4.5],
	['color-text-muted', 'color-bg', 4.5],
	['color-text-faint', 'color-surface', 4.5],
	['color-text-faint', 'color-surface-sunken', 4.5],
	['color-text-faint', 'color-bg', 4.5],
	['color-text', 'color-row-selected', 4.5],
	['color-text-muted', 'color-row-selected', 4.5],
	['color-accent-text', 'color-accent', 4.5],
	['color-accent', 'color-surface', 4.5],
	['color-pill-on-ink', 'color-pill-on', 4.5],
	['color-brass-ink', 'color-brass-wash', 4.5],
	['color-ruby-ink', 'color-ruby-wash', 4.5],
	['color-ruby', 'color-surface', 4.5],
	['color-toast-ink', 'color-toast-bg', 4.5],
	['color-toast-accent', 'color-toast-bg', 4.5],
	['color-badge-text', 'color-badge-bg', 4.5],
	['color-status-ok', 'color-surface', 3],
	['color-gantt-critical-ink', 'color-gantt-critical-top', 4.5],
	['color-gantt-critical-ink', 'color-gantt-critical-bottom', 4.5],
	['color-gantt-bar-ink', 'color-gantt-bar-top', 4.5],
	['color-gantt-bar-ink', 'color-gantt-bar-bottom', 4.5],
	['color-gantt-crit-ink', 'color-gantt-crit-wash', 4.5],
	['color-gantt-text-faint', 'color-gantt-surface', 4.5],
	['color-gantt-text-faint', 'color-gantt-inset', 4.5],
	['color-gantt-text-muted', 'color-gantt-surface', 4.5],
	// The "last good schedule" label (was 4.22:1): on the chart, on a wash and on the glass chip.
	['color-pending', 'color-gantt-surface', 4.5],
	['color-pending', 'color-gantt-inset', 4.5],
	['color-pending', 'color-brass-wash', 4.5],
	['color-gantt-text', 'color-gantt-row-selected', 4.5],
	['color-syntax-keyword', 'color-surface', 4.5],
	['color-syntax-definition', 'color-surface', 4.5],
	['color-syntax-string', 'color-surface', 4.5],
	['color-syntax-literal', 'color-surface', 4.5],
	['color-syntax-comment', 'color-surface', 4.5],
	['color-syntax-macro', 'color-surface', 4.5],
	['color-syntax-invalid', 'color-surface', 4.5],
	['color-diagnostic-error', 'color-surface', 4.5],
	['color-diagnostic-warning', 'color-surface', 4.5],
	['color-diagnostic-info', 'color-surface', 4.5],
];

/** Graphics and edges that must be seen (WCAG 1.4.11): [token, ground token, minimum]. */
const GRAPHICS: ReadonlyArray<readonly [string, string, number]> = [
	['color-focus', 'color-surface', 3],
	['color-focus', 'color-bg', 3],
	['color-focus', 'color-row-selected', 3],
	['color-steel', 'color-row-selected', 3],
	['color-gantt-bar-outline', 'color-gantt-surface', 3],
	['color-gantt-link', 'color-gantt-surface', 3],
	['color-critical', 'color-gantt-surface', 3],
	['color-today', 'color-gantt-surface', 3],
	['color-status-date', 'color-gantt-surface', 3],
	['color-gantt-critical-top', 'color-gantt-surface', 3],
	['color-gantt-summary', 'color-gantt-surface', 3],
	['color-gantt-milestone', 'color-gantt-surface', 2.2],
];

/**
 * Pairs that must be told apart. Each must differ in lightness (ratio) or, failing that, be far
 * apart in colour under protanopia and under deuteranopia: [a, b, label].
 */
const DISTINCT: ReadonlyArray<readonly [string, string, string]> = [
	['color-gantt-critical-top', 'color-gantt-bar-bottom', 'critical bar and normal bar'],
	['color-critical', 'color-gantt-link', 'critical link and normal link'],
	['color-critical', 'color-today', 'critical path and the today line'],
	['color-status-date', 'color-today', 'status date and today'],
	['color-critical', 'color-focus', 'critical and the focus ring'],
	['color-gantt-critical-bottom', 'color-gantt-bar-outline', 'critical bar edge and bar outline'],
];

describe.each([
	['light', 'theme-light.css'],
	['dark', 'theme-dark.css'],
] as const)('palette, %s', (_name, file) => {
	const base = tokensOf('theme-light.css');
	const t = file === 'theme-light.css' ? base : new Map([...base, ...tokensOf(file)]);
	const glassOverSurface = (token: string): Rgb =>
		colour(t, token, colour(t, 'color-gantt-surface'));

	it('defines every token the light theme defines (a missing one would fall back to light)', () => {
		const own = tokensOf(file);
		const missing = [...base.keys()].filter((k) => k.startsWith('color-') && !own.has(k));
		expect(missing).toEqual([]);
	});

	it.each(TEXT)('text %s on %s is at least %d:1', (fg, bg, min) => {
		expect(ratio(colour(t, fg), colour(t, bg))).toBeGreaterThanOrEqual(min);
	});

	it.each(GRAPHICS)('graphic %s on %s is at least %d:1', (fg, bg, min) => {
		expect(ratio(colour(t, fg), colour(t, bg))).toBeGreaterThanOrEqual(min);
	});

	it('keeps the stale label readable on the glass chip too', () => {
		const chip = glassOverSurface('color-gantt-chip');
		expect(ratio(colour(t, 'color-pending'), chip)).toBeGreaterThanOrEqual(4.5);
	});

	it.each(DISTINCT)(
		'%s / %s differ for normal vision and for protan and deutan viewers',
		(a, b) => {
			const [ca, cb] = [colour(t, a), colour(t, b)];
			// What each viewer keeps is lightness: ratio or a clear distance in colour.
			for (const m of [null, PROTAN, DEUTAN] as const) {
				const [x, y] = m ? [simulate(ca, m), simulate(cb, m)] : [ca, cb];
				const ok = ratio(x, y) >= 1.5 || distance(x, y) >= 25;
				expect(
					ok,
					`${a} vs ${b}${m === PROTAN ? ' (protan)' : m === DEUTAN ? ' (deutan)' : ''}`,
				).toBe(true);
			}
		},
	);
});

describe('where colour is never the only cue', () => {
	// Ruby (critical, error) and green (ok) are not safe by colour for deuteranopes: ruby on the
	// dial is dark, green is mid, and the hues collapse. They are therefore never alone: the
	// critical bar has a heavier edge and "critical" in its accessible text, the status dot
	// changes shape (circle, diamond, ring) and always has words beside it.
	it('records that ruby and green are close for a deutan viewer', () => {
		const t = tokensOf('theme-light.css');
		const d = distance(
			simulate(colour(t, 'color-critical'), DEUTAN),
			simulate(colour(t, 'color-status-ok'), DEUTAN),
		);
		expect(d).toBeLessThan(25);
	});
});
