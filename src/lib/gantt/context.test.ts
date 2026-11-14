// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { previewContext, workingTimeFor } from './context';
import { manipulation } from './intents-testing';

const fx = manipulation();

describe('workingTimeFor', () => {
	it('builds one working time per result, and none without a project', () => {
		const a = workingTimeFor(fx.result);
		expect(a).not.toBeNull();
		expect(workingTimeFor(fx.result)).toBe(a);
		expect(workingTimeFor(null)).toBeNull();
		expect(workingTimeFor({ ...fx.result, project: null })).toBeNull();
	});

	it('keeps a working time per zone data: another zone is another working day', () => {
		const zones = {} as never;
		const other = {} as never;
		const a = workingTimeFor(fx.result, zones);
		expect(workingTimeFor(fx.result, zones)).toBe(a);
		expect(workingTimeFor(fx.result, other)).not.toBe(a);
		expect(workingTimeFor(fx.result)).not.toBe(a);
	});
});

describe('previewContext', () => {
	it('is the index, the shown pair and the working time; no preference', () => {
		const shown = { result: fx.result, analysis: null };
		const c = previewContext(fx.index, shown);
		expect(c).toMatchObject({ index: fx.index, result: fx.result, analysis: null, move: null });
		expect(c?.wt).toBe(workingTimeFor(fx.result));
	});

	it('is null without an index', () => {
		expect(previewContext(null, { result: fx.result, analysis: null })).toBeNull();
	});
});
