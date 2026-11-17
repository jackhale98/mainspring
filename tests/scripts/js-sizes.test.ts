// SPDX-License-Identifier: GPL-2.0-or-later
// The JS budgets (scripts/js-sizes.mjs; phase-2.md 13.4, amended by the user 2026-11-16): first
// loads are capped, the whole app has a loose guard, and named lazy chunks have their own caps.
import { describe, expect, it } from 'vitest';
import {
	checkBudgets,
	CHUNK_CAPS,
	isViewChunk,
	TEXT_FIRST_CAP,
	TOTAL_CAP,
	unmatchedCaps,
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

	it('caps the People shell and each People view chunk', () => {
		const cap = (name: string) => CHUNK_CAPS.find((c) => c.name === name)?.cap ?? 0;
		const one = (file: string, gzip: number) => [{ file, gzip }];
		// The shell is small: the views are imported when they open, so they have caps of their own.
		expect(cap('people')).toBeLessThan(10_000);
		expect(checkBudgets({ files: one('PeopleView.abc.js', cap('people')) })).toEqual([]);
		expect(checkBudgets({ files: one('PeopleView.abc.js', cap('people') + 1) }).join('\n')).toMatch(
			/people chunk/,
		);
		for (const [name, file] of [
			['workload', 'Workload.abc.js'],
			['heat', 'WorkloadBar.abc.js'],
			['lanes', 'Lanes.abc.js'],
			['calendar', 'Calendar.abc.js'],
		] as const) {
			expect(checkBudgets({ files: one(file, cap(name)) })).toEqual([]);
			expect(checkBudgets({ files: one(file, cap(name) + 1) }).join('\n')).toMatch(
				new RegExp(`${name} chunk`),
			);
		}
	});

	it('finds the chunk caps that match no built file', () => {
		const names = (files: string[]) => unmatchedCaps(files.map((file) => ({ file, gzip: 1 })));
		expect(names(['editor-controller.a.js'])).toHaveLength(CHUNK_CAPS.length - 1);
		expect(
			names([
				'editor-controller.a.js',
				'PeopleView.a.js',
				'Workload.a.js',
				'WorkloadBar.a.js',
				'Lanes.a.js',
				'Calendar.a.js',
			]),
		).toEqual([]);
	});

	it('fails a Gantt-first load that fetches a People chunk', () => {
		for (const f of [
			'PeopleView.a.js',
			'Workload.a.js',
			'WorkloadBar.a.js',
			'Lanes.a.js',
			'Calendar.a.js',
		])
			expect(isViewChunk(f)).toBe(true);
		expect(isViewChunk('App.a.js')).toBe(false);
		expect(isViewChunk('editor-controller.a.js')).toBe(false);
		const fetched = (v: boolean, t: boolean) => ({
			visualFirst: { ...load(290_000, false), loadsPeopleChunk: v },
			textFirst: { ...load(400_000, true), loadsPeopleChunk: t },
		});
		expect(checkBudgets({ files: [], loads: fetched(false, false) })).toEqual([]);
		for (const [v, t] of [
			[true, false],
			[false, true],
		] as const) {
			expect(checkBudgets({ files: [], loads: fetched(v, t) }).join('\n')).toMatch(
				/Gantt-first load fetched the People chunk/,
			);
		}
	});

	it('checks only the dist budgets without a browser measurement', () => {
		expect(checkBudgets({ files: [{ file: 'a.js', gzip: 1 }] })).toEqual([]);
	});
});
