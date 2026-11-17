// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { CELL_HEAD, CHIP_GAP, CHIP_PITCH, MORE_H, chipsShown } from './room';

/** The height of a cell that holds the head and exactly `n` chips (and the button, if `more`). */
const rowFor = (n: number, more = false): number =>
	CELL_HEAD + n * CHIP_PITCH + (more ? MORE_H : -CHIP_GAP);

describe('chip room of a tall day cell', () => {
	it('shows every chip when they all fit, to the pixel', () => {
		for (const n of [1, 2, 3, 8, 9]) {
			expect(chipsShown(n, rowFor(n))).toBe(n);
			// One pixel short: not all fit, so fewer chips and the button.
			expect(chipsShown(n, rowFor(n) - 1)).toBeLessThan(n);
		}
	});

	it('never hides a chip that fits: two chips in a cell that holds two show two', () => {
		expect(chipsShown(2, rowFor(2))).toBe(2);
		expect(chipsShown(2, 68)).toBe(2);
	});

	it('gives the last line to "+N more" when some do not fit', () => {
		expect(chipsShown(5, rowFor(3, true))).toBe(3);
		expect(chipsShown(5, rowFor(3, true) - 1)).toBe(2);
		expect(chipsShown(9, rowFor(7, true))).toBe(7);
		// An 8th chip of 9 on a tall row: 8 chips and no button do not fit, so 7 and the button.
		expect(chipsShown(9, rowFor(8))).toBe(7);
	});

	it('what is shown, and the button, end inside the cell', () => {
		for (let h = 40; h < 240; h++) {
			for (const total of [1, 2, 3, 5, 9, 12]) {
				const s = chipsShown(total, h);
				const end = CELL_HEAD + (s < total ? s * CHIP_PITCH + MORE_H : s * CHIP_PITCH - CHIP_GAP);
				expect(end <= h || s === 0, `row ${h}, ${total} chips, ${s} shown`).toBe(true);
			}
		}
	});

	it('shows no chip in a cell with no room, and nothing for no chips', () => {
		expect(chipsShown(4, 0)).toBe(0);
		expect(chipsShown(4, CELL_HEAD + 10)).toBe(0);
		expect(chipsShown(0, 200)).toBe(0);
	});
});
