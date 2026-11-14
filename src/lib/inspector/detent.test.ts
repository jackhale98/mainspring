// SPDX-License-Identifier: GPL-2.0-or-later
// The bottom sheet's heights (detent.ts): which height a drag ends at, and the tap alternative.
import { describe, expect, it } from 'vitest';
import { SNAP_DISTANCE, TAP_SLOP, detentAfterDrag, dragHeight, toggled } from './detent';

describe('detents', () => {
	it('goes up to full, back to half, and closes from half', () => {
		expect(detentAfterDrag('half', -SNAP_DISTANCE)).toBe('full');
		expect(detentAfterDrag('half', -SNAP_DISTANCE + 1)).toBe('half');
		expect(detentAfterDrag('half', SNAP_DISTANCE)).toBe('close');
		expect(detentAfterDrag('full', SNAP_DISTANCE)).toBe('half');
		expect(detentAfterDrag('full', -200)).toBe('full');
		expect(detentAfterDrag('full', 10)).toBe('full');
	});

	it('toggles for a tap and keeps the dragged height on screen', () => {
		expect(toggled('half')).toBe('full');
		expect(toggled('full')).toBe('half');
		expect(TAP_SLOP).toBeLessThan(SNAP_DISTANCE);
		expect(dragHeight(400, -100, 800)).toBe(500);
		expect(dragHeight(400, -900, 800)).toBe(800);
		expect(dragHeight(400, 900, 800)).toBe(0);
	});
});

describe('a peek', () => {
	it('opens to half on a drag up, stays a peek otherwise, and toggles to half', () => {
		expect(detentAfterDrag('peek', -60)).toBe('half');
		expect(detentAfterDrag('peek', 60)).toBe('peek');
		expect(detentAfterDrag('peek', 0)).toBe('peek');
		expect(toggled('peek')).toBe('half');
	});
});
