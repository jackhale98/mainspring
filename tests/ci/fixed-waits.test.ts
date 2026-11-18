// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import * as fw from '../../scripts/ci/fixed-waits.mjs';

describe('fixed waits in the e2e tests', () => {
	it('counts page.waitForTimeout calls', () => {
		expect(fw.countWaits('await page.waitForTimeout(300);\nawait page.waitForTimeout (5)')).toBe(2);
		expect(fw.countWaits('await expect(x).toBeVisible();')).toBe(0);
	});

	it('flags a file over its baseline and a new file with any, and asks to lower one under it', () => {
		const { over, under } = fw.compare({ a: 3, b: 1, n: 1 }, { a: 2, b: 2 });
		expect(over).toEqual(['a: 3 fixed waits, at most 2', 'n: 1 fixed waits, at most 0']);
		expect(under).toEqual(['b: 1, baseline 2']);
	});

	it('no e2e file has more fixed waits than tests/e2e/fixed-waits.json allows', () => {
		expect(fw.compare(fw.scan(), fw.loadBaseline()).over).toEqual([]);
	});
});
