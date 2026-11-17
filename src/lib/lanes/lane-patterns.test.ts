// SPDX-License-Identifier: GPL-2.0-or-later
// The leave hatches (lane-patterns.ts): each leave type has a pattern, no two types that the legend
// lists share one except where documented, a tile is made once per kind, colour and ratio, and a
// missing canvas is no pattern.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineLeaveType } from '../../engine/protocol';
import { HATCH_OF, clearHatchCache, hatchPattern, type HatchKind } from './lane-patterns';

const TYPES: EngineLeaveType[] = [
	'project',
	'annual',
	'special',
	'sick',
	'unpaid',
	'holiday',
	'unemployed',
];

describe('hatch of a leave type', () => {
	it('has a pattern for every leave type', () => {
		for (const t of TYPES) expect(HATCH_OF[t]).toBeTruthy();
	});

	it('tells the types people take most apart: annual, holiday, sick and special differ', () => {
		const four = (['annual', 'holiday', 'sick', 'special'] as const).map((t) => HATCH_OF[t]);
		expect(new Set(four).size).toBe(4);
	});

	it('gives each type its own pattern', () => {
		const kinds: HatchKind[] = TYPES.map((t) => HATCH_OF[t]);
		expect(new Set(kinds).size).toBe(TYPES.length);
	});
});

describe('hatchPattern', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		clearHatchCache();
	});

	function stubCanvas() {
		const made: string[] = [];
		const tile = {
			width: 0,
			height: 0,
			getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }),
		};
		vi.stubGlobal('document', {
			createElement: () => {
				made.push('tile');
				return tile;
			},
		});
		vi.stubGlobal(
			'DOMMatrix',
			class {
				constructor(public v: number[]) {}
			},
		);
		const ctx = {
			createPattern: () => ({ setTransform() {} }),
		} as unknown as CanvasRenderingContext2D;
		return { ctx, made };
	}

	it('makes a tile once per kind, colour and ratio', () => {
		const { ctx, made } = stubCanvas();
		const a = hatchPattern(ctx, 'back', '#777', 1);
		const b = hatchPattern(ctx, 'back', '#777', 1);
		expect(a).not.toBeNull();
		expect(b).toBe(a);
		expect(made).toHaveLength(1);
		hatchPattern(ctx, 'cross', '#777', 1);
		hatchPattern(ctx, 'back', '#888', 1);
		hatchPattern(ctx, 'back', '#777', 2);
		expect(made).toHaveLength(4);
	});

	it('is null where there is no canvas', () => {
		vi.stubGlobal('document', {
			createElement: () => {
				throw new Error('no canvas');
			},
		});
		expect(hatchPattern({} as CanvasRenderingContext2D, 'dots', '#777', 1)).toBeNull();
	});
});
