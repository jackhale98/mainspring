// SPDX-License-Identifier: GPL-2.0-or-later
// The JS budgets (scripts/js-sizes.mjs; phase-2.md 13.4, amended by the user 2026-11-16): first
// loads are capped, the whole app has a loose guard, and named lazy chunks have their own caps.
import { describe, expect, it } from 'vitest';
import {
	checkBudgets,
	TEXT_FIRST_CAP,
	TOTAL_CAP,
	VISUAL_FIRST_CAP,
} from '../../scripts/js-sizes.mjs';

const load = (gzipBytes: number, loadsEditorChunk: boolean) => ({ gzipBytes, loadsEditorChunk });
const ok = { visualFirst: load(290_000, false), textFirst: load(400_000, true) };

describe('checkBudgets', () => {
	it('passes a build within every budget', () => {
		expect(checkBudgets({ files: [{ file: 'a.js', gzip: 450_000 }], loads: ok })).toEqual([]);
	});

	it('fails each first load over its cap, and passes at the cap', () => {
		expect(
			checkBudgets({
				files: [],
				loads: {
					visualFirst: load(VISUAL_FIRST_CAP, false),
					textFirst: load(TEXT_FIRST_CAP, true),
				},
			}),
		).toEqual([]);
		const over = checkBudgets({
			files: [],
			loads: {
				visualFirst: load(VISUAL_FIRST_CAP + 1, false),
				textFirst: load(TEXT_FIRST_CAP + 1, true),
			},
		});
		expect(over).toHaveLength(2);
		expect(over[0]).toMatch(/Visual-first/);
		expect(over[1]).toMatch(/Text-first/);
	});

	it('fails the total guard, a capped lazy chunk, and a misplaced editor split', () => {
		const files = [
			{ file: 'editor-controller.abc.js', gzip: 200_000 },
			{ file: 'b.js', gzip: TOTAL_CAP },
		];
		const problems = checkBudgets({
			files,
			loads: { visualFirst: load(1, true), textFirst: load(1, false) },
		});
		expect(problems.join('\n')).toMatch(/guard/);
		expect(problems.join('\n')).toMatch(/editor chunk/);
		expect(problems.join('\n')).toMatch(/Visual-first load fetched the CodeMirror chunk/);
		expect(problems.join('\n')).toMatch(/Text-first load did not fetch/);
	});

	it('checks only the dist budgets without a browser measurement', () => {
		expect(checkBudgets({ files: [{ file: 'a.js', gzip: 1 }] })).toEqual([]);
	});
});
