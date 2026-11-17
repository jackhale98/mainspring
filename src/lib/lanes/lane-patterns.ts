// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The hatches of the lanes' leave blocks, one pattern per leave type (phase-3.md 9.4: "leaves are
 * hatched, by type"). A type is told apart by its pattern, not by colour (WCAG 1.4.1): the legend
 * and each period's accessible name give the type's words. Each is a small repeating tile drawn
 * once per kind, colour and ratio (a canvas pattern is one fill, however large the block).
 *
 * Annual leave runs "\", holiday "/", sick "x", special leave dots, unpaid leave lines across,
 * project leave lines down, and the unemployed a coarse "\". The heatmap's own leave stripes are
 * "\" (heat-paint.ts), so a lane's annual leave reads as the heatmap's leave.
 */
import type { EngineLeaveType } from '../../engine/protocol';

export type HatchKind = 'back' | 'forward' | 'cross' | 'dots' | 'across' | 'down' | 'coarse';

export const HATCH_OF: Readonly<Record<EngineLeaveType, HatchKind>> = {
	annual: 'back',
	holiday: 'forward',
	sick: 'cross',
	special: 'dots',
	unpaid: 'across',
	project: 'down',
	unemployed: 'coarse',
};

const TILE = 6;
const tiles = new Map<string, CanvasPattern | null>();

/** Forgets the tiles (tests that stub a canvas). */
export function clearHatchCache(): void {
	tiles.clear();
}

function stroke(t: CanvasRenderingContext2D, kind: HatchKind, size: number): void {
	const h = size / 2;
	t.beginPath();
	switch (kind) {
		case 'back':
		case 'coarse':
			t.moveTo(0, 0);
			t.lineTo(size, size);
			t.moveTo(-h, h);
			t.lineTo(h, size + h);
			t.moveTo(h, -h);
			t.lineTo(size + h, h);
			break;
		case 'forward':
			t.moveTo(0, size);
			t.lineTo(size, 0);
			t.moveTo(-h, h);
			t.lineTo(h, -h);
			t.moveTo(h, size + h);
			t.lineTo(size + h, h);
			break;
		case 'cross':
			t.moveTo(0, 0);
			t.lineTo(size, size);
			t.moveTo(0, size);
			t.lineTo(size, 0);
			break;
		case 'across':
			t.moveTo(0, h);
			t.lineTo(size, h);
			break;
		case 'down':
			t.moveTo(h, 0);
			t.lineTo(h, size);
			break;
		case 'dots':
			t.arc(h, h, 1, 0, Math.PI * 2);
			break;
	}
	if (kind === 'dots') t.fill();
	else t.stroke();
}

/** The pattern of a kind in a colour, made once. Null where there is no canvas. */
export function hatchPattern(
	ctx: CanvasRenderingContext2D,
	kind: HatchKind,
	colour: string,
	dpr: number,
): CanvasPattern | null {
	const key = `${kind}|${colour}|${dpr}`;
	if (tiles.has(key)) return tiles.get(key) ?? null;
	let p: CanvasPattern | null = null;
	try {
		const size = kind === 'coarse' ? TILE * 2 : TILE;
		const c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(size * dpr));
		c.height = Math.max(1, Math.round(size * dpr));
		const t = c.getContext('2d');
		if (t) {
			t.scale(dpr, dpr);
			t.strokeStyle = colour;
			t.fillStyle = colour;
			t.lineWidth = 1.3;
			t.globalAlpha = 0.85;
			stroke(t, kind, size);
			p = ctx.createPattern(c, 'repeat');
			// The tile is drawn at the device ratio; the frame's transform scales it again.
			p?.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
		}
	} catch {
		p = null;
	}
	tiles.set(key, p);
	return p;
}
