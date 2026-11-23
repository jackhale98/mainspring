// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the export specs (export.spec.ts, export-screenshots.spec.ts) share: opening the "More
 * actions" menu on the small plan, running an export to its download, reading a PNG's size from its
 * header, and looking at a PNG's pixels in the page (the test process has no image decoder).
 */
import fs from 'node:fs';
import { expect, type Download, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { ScheduleResult } from '../../../src/engine/protocol';
import { Rig, isTouch } from './gantt-rig';

/** The plan the export specs run on: containers, people, a macro-made task, progress, one zone. */
export const PLAN = 'ui-basic';

export const press = (target: Locator, info: TestInfo): Promise<void> =>
	isTouch(info) ? target.tap() : target.click();

/** Opens the app on the small plan, with the Gantt hooks. */
export function openPlan(page: Page, info: TestInfo): Promise<Rig> {
	return Rig.open(page, info, undefined, 'visual', PLAN);
}

/** Opens the "More actions" menu (nothing needs to be selected). */
export async function openMenu(page: Page, info: TestInfo): Promise<Locator> {
	await press(page.getByTestId('row-menu'), info);
	const menu = page.getByRole('menu', { name: 'More actions' });
	await expect(menu).toBeVisible();
	return menu;
}

/** Chooses one of the export entries of the menu and returns the download it starts. */
export async function download(
	page: Page,
	info: TestInfo,
	entry: 'Copy Gantt as image' | 'Export tasks as CSV',
): Promise<Download> {
	await openMenu(page, info);
	const [file] = await Promise.all([
		page.waitForEvent('download'),
		press(page.getByRole('menuitem', { name: entry }), info),
	]);
	return file;
}

export const bytesOf = (file: Download): Promise<Buffer> =>
	file.path().then((p) => fs.promises.readFile(p));

/** Makes the page's clipboard unavailable for pictures, so that the export has to download. */
export async function withoutClipboardItem(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'ClipboardItem', { value: undefined, configurable: true });
	});
}

/** Takes the share sheet away, so that a finger's export is a download (and does not depend on the browser). */
export async function withoutShare(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
		Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
	});
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The size in pixels from a PNG's header; throws when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
	const b = Buffer.from(bytes);
	if (b.length < 24 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

export interface Geometry {
	/** The scale the picture is drawn at: the screen's, from 1 to 3. */
	dpr: number;
	/** The picture's size on screen, in CSS px: the name column and the visible plot, the header over both. */
	width: number;
	height: number;
	/** The name column and the header, in CSS px. */
	names: number;
	header: number;
}

/**
 * What the picture should measure, from the page: the name column's width and the plot's visible
 * width (the scroller's, less where the chart starts), and the scroller's height (header and rows).
 */
export function geometry(page: Page): Promise<Geometry> {
	return page.evaluate(() => {
		const root = document.querySelector('[data-testid="gantt"]') as HTMLElement;
		const scroller = root.querySelector('.scroller') as HTMLElement;
		const space = scroller.querySelector('.space') as HTMLElement;
		const plot = space.querySelector(':scope > .plot') as HTMLElement;
		const probe = root.querySelector('.probes i') as HTMLElement;
		const chartLeft = plot.getBoundingClientRect().left - space.getBoundingClientRect().left;
		const names = probe.clientWidth;
		const head = space.querySelector(':scope > .head') as HTMLElement;
		return {
			dpr: Math.min(3, Math.max(1, devicePixelRatio)),
			width: names + scroller.clientWidth - chartLeft,
			height: scroller.clientHeight,
			names,
			header: head.offsetHeight,
		};
	});
}

export interface Look {
	/** Mean brightness (0 to 1) of the name column's blank corner at the top, and of an empty spot of the plot. */
	corner: number;
	plot: number;
	/** The share of the name column's rows, and of the plot, that is not its background. */
	namesInk: number;
	plotInk: number;
	/** The share of the header's pixels that is not its background (the dates). */
	headerInk: number;
}

/** Decodes a PNG in the page and measures it: its colours and where there is something drawn. */
export function lookAt(page: Page, png: Buffer, g: Geometry): Promise<Look> {
	return page.evaluate(
		async ({ bytes, namesPx, headerPx }) => {
			const bitmap = await createImageBitmap(
				new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
			);
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
			ctx.drawImage(bitmap, 0, 0);
			const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const px = (x: number, y: number): [number, number, number] => {
				const i = (y * width + x) * 4;
				return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
			};
			const bright = ([r, g, b]: number[]): number =>
				((r ?? 0) * 0.2126 + (g ?? 0) * 0.7152 + (b ?? 0) * 0.0722) / 255;
			const differs = (a: number[], b: number[]): boolean =>
				Math.max(...a.map((v, k) => Math.abs(v - (b[k] ?? 0)))) > 40;
			const share = (x0: number, y0: number, x1: number, y1: number, bg: number[]): number => {
				let n = 0;
				let all = 0;
				for (let y = y0; y < y1; y++)
					for (let x = x0; x < x1; x++) {
						all++;
						if (differs(px(x, y), bg)) n++;
					}
				return all === 0 ? 0 : n / all;
			};
			// The corner is the header's colour at the top left; the plot's first pixel is its surface.
			const cornerBg = px(2, 2);
			const namesBg = px(2, headerPx + 2);
			const plotBg = px(namesPx + 2, headerPx + 2);
			return {
				corner: bright(cornerBg),
				plot: bright(plotBg),
				namesInk: share(0, headerPx, namesPx - 2, height, namesBg),
				plotInk: share(namesPx + 2, headerPx, width, height, plotBg),
				headerInk: share(namesPx + 2, 0, width, headerPx - 2, px(namesPx + 2, 2)),
			};
		},
		{
			bytes: [...png],
			namesPx: Math.round(g.names * g.dpr),
			headerPx: Math.round(g.header * g.dpr),
		},
	);
}

/** The schedule result the Gantt draws, through the test hook. */
export function resultOf(page: Page): Promise<ScheduleResult> {
	return page.evaluate(() => {
		const hook = (window as unknown as { __mainspringGantt: { result(): ScheduleResult | null } })
			.__mainspringGantt;
		const result = hook.result();
		if (!result) throw new Error('no schedule yet');
		return result;
	});
}
