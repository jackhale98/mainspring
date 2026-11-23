// SPDX-License-Identifier: GPL-2.0-or-later
// The JS budgets (scripts/js-sizes.mjs; phase-2.md 13.4, amended by the user 2026-11-16): first
// loads are capped, the whole app has a loose guard, and named lazy chunks have their own caps.
import { describe, expect, it } from 'vitest';
import {
	checkBudgets,
	CHUNK_CAPS,
	isLazyChunk,
	isViewChunk,
	PEOPLE_VIEWS_CAP,
	peopleViewsSize,
	TEXT_FIRST_CAP,
	TOTAL_CAP,
	unmatchedCaps,
	viewChunkSet,
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
			['resources', 'ResourcesView.abc.js'],
			['person', 'ResourcePanel.abc.js'],
		] as const) {
			expect(checkBudgets({ files: one(file, cap(name)) })).toEqual([]);
			expect(checkBudgets({ files: one(file, cap(name) + 1) }).join('\n')).toMatch(
				new RegExp(`${name} chunk`),
			);
		}
	});

	it('caps the health panel and the checks, and neither is a People chunk', () => {
		const cap = (name: string) => CHUNK_CAPS.find((c) => c.name === name);
		const one = (file: string, gzip: number) => [{ file, gzip }];
		for (const [name, file] of [
			['health', 'HealthPanel.abc.js'],
			['health', 'WhyHere.abc.js'],
			['health-checks', 'compute.abc.js'],
		] as const) {
			const c = cap(name);
			expect(c?.view).toBeUndefined();
			expect(checkBudgets({ files: one(file, c?.cap ?? 0) })).toEqual([]);
			expect(checkBudgets({ files: one(file, (c?.cap ?? 0) + 1) }).join('\n')).toMatch(
				new RegExp(`${name} chunk`),
			);
			expect(isViewChunk(file)).toBe(false);
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
				'WhichTask.a.js',
				'Lanes.a.js',
				'Calendar.a.js',
				'ResourcesView.a.js',
				'ResourcePanel.a.js',
				'HealthPanel.a.js',
				'compute.a.js',
				'run-export.a.js',
				'plan-keeper.a.js',
				'PlanNotice.a.js',
			]),
		).toEqual([]);
	});

	it('fails a Gantt-first load that fetches a People chunk', () => {
		for (const f of [
			'PeopleView.a.js',
			'Workload.a.js',
			'WorkloadBar.a.js',
			'Lanes.a.js',
			'ResourcesView.a.js',
			'WorkingHoursEditor.a.js',
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

	it('fails a first load that fetches the export chunk, and caps the chunk', () => {
		expect(isLazyChunk('run-export.a.js')).toBe(true);
		expect(isLazyChunk('run.a.js')).toBe(false);
		expect(isLazyChunk('App.a.js')).toBe(false);
		const fetched = (v: string[], t: string[]) => ({
			visualFirst: { ...load(290_000, false), loadsLazy: v },
			textFirst: { ...load(400_000, true), loadsLazy: t },
		});
		expect(checkBudgets({ files: [], loads: fetched([], []) })).toEqual([]);
		for (const [v, t] of [
			[['run-export.a.js'], []],
			[[], ['run-export.a.js']],
		] as const) {
			expect(checkBudgets({ files: [], loads: fetched([...v], [...t]) }).join('\n')).toMatch(
				/must stay lazy: run-export\.a\.js/,
			);
		}
		const cap = CHUNK_CAPS.find((c) => c.name === 'export');
		expect(cap?.lazy).toBe(true);
		const over = checkBudgets({ files: [{ file: 'run-export.a.js', gzip: (cap?.cap ?? 0) + 1 }] });
		expect(over.join('\n')).toMatch(/export chunk is/);
	});

	it('fails a Visual-first load that requests the keyword docs asset, not a Text-first one', () => {
		const docs = (v: boolean, t: boolean) => ({
			visualFirst: { ...load(290_000, false), loadsDocs: v },
			textFirst: { ...load(400_000, true), loadsDocs: t },
		});
		expect(checkBudgets({ files: [], loads: docs(false, true) })).toEqual([]);
		expect(checkBudgets({ files: [], loads: docs(false, false) })).toEqual([]);
		expect(checkBudgets({ files: [], loads: docs(true, true) })).toEqual([
			'a Visual-first load requested the keyword docs asset (only an editor loads it)',
		]);
	});

	it('checks only the dist budgets without a browser measurement', () => {
		expect(checkBudgets({ files: [{ file: 'a.js', gzip: 1 }] })).toEqual([]);
	});
});

describe('viewChunkSet', () => {
	// A shell that imports a view dynamically, a shared module the view and the first load both
	// use, a module only the views use (no cap names it), and a lazy chunk that is not a view.
	const sources = {
		'App.a.js': 'import{x}from"./shared.a.js";import"./strings.a.js";',
		'shared.a.js': 'export const x=1;',
		'strings.a.js': 'export const s=1;',
		'PeopleView.a.js': 'import{x}from"./shared.a.js";const l=()=>import("./Calendar.a.js");',
		'Calendar.a.js': 'import{c}from"./leave-card.a.js";import{s}from"./strings-calendar.a.js";',
		'leave-card.a.js': 'import{x}from"./shared.a.js";export const c=1;',
		'strings-calendar.a.js': 'export const cs=1;',
		'ResourcePanel.a.js': 'import{c}from"./leave-card.a.js";import("./WorkingHoursEditor.a.js")',
		'WorkingHoursEditor.a.js': 'export const w=1;',
		'editor-controller.a.js': 'export const e=1;',
	};
	const html = '<script type="module" src="/_astro/App.a.js"></script>';

	it('is what the shell and the person details reach, minus what the first load imports', () => {
		expect([...viewChunkSet(sources, html)].sort()).toEqual([
			'Calendar.a.js',
			'PeopleView.a.js',
			'ResourcePanel.a.js',
			'WorkingHoursEditor.a.js',
			'leave-card.a.js',
			'strings-calendar.a.js',
		]);
	});

	it('leaves out what plan health shares: the checks the first load fetches, and Why here?', () => {
		// The heatmap's cell details fetch WhyHere, which imports the checks' context; the first load
		// fetches the same context (the Health button's count) with a dynamic import of its own.
		const withHealth = {
			...sources,
			'App.a.js': `${sources['App.a.js']}const h=()=>import("./compute.a.js");`,
			'compute.a.js': 'import{d}from"./demand.a.js";export const c=1;',
			'demand.a.js': 'export const d=1;',
			'WhyHere.a.js': 'import{c}from"./compute.a.js";import{t}from"./text.a.js";',
			'text.a.js': 'export const t=1;',
			'Calendar.a.js': `${sources['Calendar.a.js']}import("./WhyHere.a.js");`,
		};
		const set = viewChunkSet(withHealth, html);
		for (const f of ['compute.a.js', 'demand.a.js', 'WhyHere.a.js', 'text.a.js'])
			expect(set.has(f)).toBe(false);
		// What only the views use is still theirs.
		expect(set.has('Calendar.a.js')).toBe(true);
	});

	it('leaves a module the first load imports out, even when a view imports it too', () => {
		const set = viewChunkSet(sources, html);
		expect(set.has('shared.a.js')).toBe(false);
		expect(set.has('strings.a.js')).toBe(false);
		expect(set.has('editor-controller.a.js')).toBe(false);
	});
});

describe('the People views together (T22)', () => {
	const files = [
		{ file: 'Lanes.a.js', gzip: 60_000 },
		{ file: 'Calendar.a.js', gzip: 30_000 },
		{ file: 'App.a.js', gzip: 300_000 },
	];
	const views = new Set(['Lanes.a.js', 'Calendar.a.js']);

	it('sums the view chunks and not the first load', () => {
		expect(peopleViewsSize(files, views)).toEqual({
			files: 2,
			gzipBytes: 90_000,
			cap: PEOPLE_VIEWS_CAP,
		});
	});

	it('fails over the cap and passes at it', () => {
		const at = { files: 2, gzipBytes: PEOPLE_VIEWS_CAP, cap: PEOPLE_VIEWS_CAP };
		expect(checkBudgets({ files: [], peopleViews: at })).toEqual([]);
		expect(
			checkBudgets({ files: [], peopleViews: { ...at, gzipBytes: PEOPLE_VIEWS_CAP + 1 } }),
		).toHaveLength(1);
	});

	it('caps the chunk the heatmap and the lanes share', () => {
		expect(CHUNK_CAPS.some((c) => c.pattern.test('WhichTask.DNL4xTRu.js'))).toBe(true);
	});
});
