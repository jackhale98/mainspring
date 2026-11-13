// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A recording stand-in for a canvas context, for the painter tests: every method call is kept
 * with its arguments and every property assignment as a `set:name` call, and `measureText`
 * measures 6 px per character. Nothing is drawn.
 */
import type { GanttLayout } from '../layout';
import { createLayout } from '../layout';
import { FIXED_MEASURE, TEST_THEME, metricsOf } from '../testing';
import type { GanttModel } from '../model';
import { createScale } from '../scale';
import type { PaintFrame } from './canvas';

export type Call = readonly [name: string, ...args: readonly unknown[]];

export interface Recorder {
	readonly ctx: CanvasRenderingContext2D;
	readonly calls: Call[];
	of(name: string): Call[];
	clear(): void;
}

export function recorder(width = 1000, height = 600): Recorder {
	const calls: Call[] = [];
	const state: Record<string, unknown> = { font: '12px sans-serif' };
	const canvas = { width, height };
	const ctx = new Proxy(
		{},
		{
			get(_t, name: string) {
				if (name === 'canvas') return canvas;
				if (name === 'createLinearGradient') {
					return (...args: unknown[]) => {
						calls.push([name, ...args]);
						return {
							addColorStop: (...stop: unknown[]) => {
								calls.push(['addColorStop', ...stop]);
							},
						};
					};
				}
				if (name === 'measureText') {
					return (text: string) => ({ width: text.length * 6 });
				}
				if (name in state) return state[name];
				return (...args: unknown[]) => {
					calls.push([name, ...args]);
				};
			},
			set(_t, name: string, value: unknown) {
				state[name] = value;
				calls.push([`set:${name}`, value]);
				return true;
			},
		},
	) as unknown as CanvasRenderingContext2D;
	return {
		ctx,
		calls,
		of: (name) => calls.filter((c) => c[0] === name),
		clear: () => {
			calls.length = 0;
		},
	};
}

export function frameOf(
	model: GanttModel,
	over: {
		pxPerDay?: number;
		win?: PaintFrame['win'];
		dpr?: number;
		coarse?: boolean;
		/** Reserve where the names are (the layout's `labels`), as the app does. */
		names?: boolean;
	} = {},
): { frame: PaintFrame; rec: Recorder; layout: GanttLayout } {
	const rec = recorder();
	const layout = createLayout(
		model,
		createScale(over.pxPerDay ?? 48, model.originMin),
		metricsOf(over.coarse ?? false),
		1000,
		over.names ? FIXED_MEASURE : null,
	);
	const win = over.win ?? { x: 0, y: 0, w: 1000, h: Math.max(layout.height, 100) };
	return {
		rec,
		layout,
		frame: {
			ctx: rec.ctx,
			win,
			dpr: over.dpr ?? 1,
			layout,
			model,
			theme: TEST_THEME,
		},
	};
}
