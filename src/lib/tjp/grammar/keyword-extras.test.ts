// SPDX-License-Identifier: GPL-2.0-or-later
// Keywords TaskJuggler accepts that the generated table leaves out (keyword-extras.ts).
import { describe, expect, it } from 'vitest';
import { KEYWORDS, keywordById, resolveKeyword } from '../syntax/keywords';
import { EXTRA_KEYWORDS, headBodyContext, resolveHeadKeyword } from './keyword-extras';

describe('keyword extras', () => {
	it('are all missing from the generated table, so the list stays minimal', () => {
		const ids = new Set(KEYWORDS.map((k) => k.keyword));
		for (const e of EXTRA_KEYWORDS) {
			expect(ids.has(e.keyword), e.keyword).toBe(false);
			for (const c of e.contexts) expect(resolveKeyword(e.name, c), `${e.name} in ${c}`).toBeNull();
		}
	});

	it('resolve where the table does not', () => {
		expect(resolveHeadKeyword('shift', 'task')?.keyword).toBe('shift.task');
		expect(resolveHeadKeyword('endcredit', 'supplement.task')?.keyword).toBe('endcredit');
		expect(resolveHeadKeyword('strict', 'projection')?.keyword).toBe('strict.projection');
		expect(resolveHeadKeyword('strict', 'task')).toBeNull();
	});

	it('are scenario attributes where TaskJuggler reads them as such', () => {
		expect(resolveHeadKeyword('startcredit', 'task')?.scenarioSpecific).toBe(true);
		expect(resolveHeadKeyword('shift', 'resource')?.scenarioSpecific).toBe(true);
		expect(resolveHeadKeyword('shift', 'allocate')?.scenarioSpecific).toBe(false);
		expect(resolveHeadKeyword('enabled', 'scenario')?.scenarioSpecific).toBe(false);
	});

	it('defer to the table where it has the keyword', () => {
		expect(resolveHeadKeyword('effort', 'task')).toBe(keywordById('effort'));
		// The table names it as written (gen-tjp-keywords.mjs), so it needs no extra.
		expect(resolveHeadKeyword('leaveallowances', 'resource')).toBe(keywordById('leaveallowance'));
		expect(resolveHeadKeyword('leaveallowance', 'resource')).toBeNull();
		expect(resolveHeadKeyword('shift', '')).toBe(keywordById('shift'));
	});

	it('give projection its own body context and the table its usual ones', () => {
		const projection = resolveHeadKeyword('projection', 'scenario');
		expect(projection && headBodyContext(projection)).toBe('projection');
		const endcredit = resolveHeadKeyword('endcredit', 'task');
		expect(endcredit && headBodyContext(endcredit)).toBeNull();
		const task = keywordById('task');
		expect(task && headBodyContext(task)).toBe('task');
	});
});
