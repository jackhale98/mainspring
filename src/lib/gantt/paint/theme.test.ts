// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { D, link, modelOf, row } from '../testing';
import { paintBars } from './bars';
import { NO_OVERLAY, paintOverlay } from './overlay';
import { FALLBACK_THEME, readTheme } from './theme';
import { frameOf } from './testing';

describe('readTheme sizes', () => {
	it('reads lengths in px and opacities as numbers, and keeps the fallback for junk', () => {
		const tokens: Record<string, string> = {
			'--gantt-row-height': '34px',
			'--gantt-bar-radius': '6px',
			'--gantt-link-width': '1.5px',
			'--gantt-dim-opacity': '0.35',
			'--gantt-font-weight-strong': ' 700 ',
			'--gantt-bar-height': 'tall',
		};
		const t = readTheme((n) => tokens[n] ?? '');
		expect(t).toMatchObject({
			rowHeight: 34,
			barRadius: 6,
			linkWidth: 1.5,
			dimOpacity: 0.35,
			fontWeightStrong: '700',
		});
		expect(t.barHeight).toBe(FALLBACK_THEME.barHeight);
	});
});

describe('painters follow the theme', () => {
	const rows = [
		row(0, 0, 4 * D),
		row(1, 5 * D, 5 * D + 30, 'task', { name: 'A task name too long for its bar' }),
		row(2, 0, 2 * D, 'container', { critical: true }),
	];
	const links = [link(0, 1)];

	it('draws link width, radius, opacity and label gap from the tokens, not constants', () => {
		const { frame, rec } = frameOf(modelOf(rows, links, { dimmed: true }));
		const themed = {
			...frame,
			theme: { ...frame.theme, linkWidth: 7, barRadius: 6, dimOpacity: 0.2, labelGap: 31 },
		};
		paintBars(themed);
		expect(rec.of('set:lineWidth').map((c) => c[1])).toContain(7);
		expect(rec.of('set:globalAlpha')[0]?.[1]).toBe(0.2);
		expect(rec.of('arcTo').map((c) => c[5])).toContain(6);
		// The label of a bar too short to hold it starts a themed gap after the bar's end.
		const bar = frame.layout.barRect(1);
		const label = rec.of('fillText').find((c) => c[1] === 'A task name too long for its bar');
		expect(label?.[2]).toBe((bar?.x ?? 0) + (bar?.w ?? 0) + 31);
	});

	it('draws the marker and its dashes from the tokens', () => {
		const m = modelOf(rows, [], { statusMin: 2 * D });
		const { frame, rec } = frameOf(m, { win: { x: 0, y: 0, w: 1000, h: 168 } });
		paintOverlay({ ...frame, theme: { ...frame.theme, markerWidth: 5, dash: 10 } }, NO_OVERLAY);
		// Dashes are 1.5 dashes long.
		const dashes = rec.of('fillRect').filter((c) => c[3] === 5 && c[4] === 15);
		expect(dashes.length).toBeGreaterThan(3);
	});

	it('draws the selection from the tokens', () => {
		const { frame, rec } = frameOf(modelOf(rows));
		paintOverlay(
			{ ...frame, theme: { ...frame.theme, ringWidth: 4, hoverRingWidth: 3 } },
			{ selectedRow: 0, hoverRow: 1, hoverLink: null },
		);
		const widths = rec.of('set:lineWidth').map((c) => c[1]);
		expect(widths).toEqual([3, 4]);
	});
});
