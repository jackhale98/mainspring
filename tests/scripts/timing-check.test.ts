// SPDX-License-Identifier: GPL-2.0-or-later
// The timing tier's judge (scripts/ci/timing-check.mjs; ADR-0016 section 1): red only when a
// measure is more than twice its budget in every run; and the flaky-test lister beside it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	BUDGETS,
	ganttMeasures,
	judge,
	main,
	markdown,
	workloadMeasures,
} from '../../scripts/ci/timing-check.mjs';
import { flakyTests } from '../../scripts/ci/flaky-summary.mjs';

const run = (droppedPct: number, maxMs: number) => ({ pipeline: { droppedPct }, maxMs });

describe('judge', () => {
	it('is not gross at exactly twice the budget, and is above it', () => {
		expect(judge('x', [10, 10, 10], 5).gross).toBe(false);
		expect(judge('x', [10.1, 10.1, 10.1], 5).gross).toBe(true);
	});

	it('is not gross when any run is at or under twice the budget', () => {
		expect(judge('x', [30, 9, 40], 5).gross).toBe(false);
	});

	it('does not judge fewer than three runs', () => {
		expect(judge('x', [50, 50], 5).gross).toBe(false);
		expect(judge('x', [], 5)).toMatchObject({ gross: false, best: null, runs: 0 });
	});
});

describe('gantt measures', () => {
	const file = (scroll: unknown[], extra: unknown[] = []) => ({
		desktop: { scroll: { day: scroll }, scrollExtra: { day: extra } },
	});

	it('passes a clean run and one noisy run among three', () => {
		const rows = ganttMeasures(file([run(1, 30), run(22, 400), run(2, 40)]));
		expect(rows.some((r) => r.gross)).toBe(false);
	});

	it('is gross when every run, extras included, is over twice the dropped-frame budget', () => {
		const rows = ganttMeasures(file([run(11, 30), run(25, 30), run(12, 30)], [run(40, 30)]));
		expect(rows.filter((r) => r.gross).map((r) => r.name)).toEqual([
			'gantt scroll day: dropped frames %',
		]);
	});

	it('is not gross if one extra run came back within twice the budget', () => {
		const rows = ganttMeasures(file([run(11, 30), run(25, 30), run(12, 30)], [run(6, 30)]));
		expect(rows.some((r) => r.gross)).toBe(false);
	});

	it('is gross on the longest frame alone', () => {
		const rows = ganttMeasures(file([run(1, 101), run(1, 150), run(1, 120)]));
		expect(rows.filter((r) => r.gross).map((r) => r.name)).toEqual([
			'gantt scroll day: longest frame ms',
		]);
	});

	it('shows the drag script time against its budget and never calls one run gross', () => {
		const rows = ganttMeasures({
			desktop: { drag3s: { inputScript: { p95Ms: 20 }, rafScript: { p95Ms: 20 } } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ budget: BUDGETS.dragScriptP95Ms, best: 40, gross: false });
	});

	it('finds nothing in a file without a desktop profile', () => {
		expect(ganttMeasures({ 'pixel-7-4x': {} })).toEqual([]);
		expect(ganttMeasures(null)).toEqual([]);
	});
});

describe('workload measures', () => {
	const runList = (...r: [number, number][]) => ({
		runList: r.map(([droppedPct, maxMs]) => ({ droppedPct, maxMs })),
	});

	it('judges every zoom and axis from the runs it made', () => {
		const rows = workloadMeasures({
			desktop: {
				'Week-rows': runList([30, 20], [40, 20], [12, 20]),
				'Day-rows': runList([1, 20]),
			},
		});
		expect(rows.filter((r) => r.gross).map((r) => r.name)).toEqual([
			'workload Week-rows: dropped frames %',
		]);
	});
});

describe('the report and the exit code', () => {
	it('names the gross measure, and says ok otherwise', () => {
		const md = markdown([judge('m', [60, 70, 80], 5), judge('n', [1, 2, 3], 5)], 'abc');
		expect(md).toContain('| m | 5 | 10 | 3 | 60 | 80 | GROSS REGRESSION |');
		expect(md).toContain('| n | 5 | 10 | 3 | 1 | 3 | ok |');
	});

	it('exits 1 on a gross regression in a results directory, 0 on a clean one', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-'));
		const write = (v: unknown) =>
			fs.writeFileSync(path.join(dir, 'gantt-perf.json'), JSON.stringify(v));
		const quiet = (fn: () => number): number => {
			const out = process.stdout.write.bind(process.stdout);
			const err = console.error;
			process.stdout.write = (() => true) as typeof process.stdout.write;
			console.error = () => undefined;
			try {
				return fn();
			} finally {
				process.stdout.write = out;
				console.error = err;
			}
		};
		write({ desktop: { scroll: { day: [run(1, 30), run(1, 30), run(1, 30)] } } });
		expect(quiet(() => main(['--dir', dir]))).toBe(0);
		write({ desktop: { scroll: { day: [run(50, 30), run(60, 30), run(70, 30)] } } });
		expect(quiet(() => main(['--dir', dir]))).toBe(1);
		fs.rmSync(dir, { recursive: true });
	});
});

describe('flakyTests', () => {
	const report = {
		suites: [
			{
				title: 'a.spec.ts',
				file: 'a.spec.ts',
				specs: [
					{
						title: 'passes first time',
						file: 'a.spec.ts',
						tests: [
							{ projectName: 'desktop', status: 'expected', results: [{ status: 'passed' }] },
						],
					},
				],
				suites: [
					{
						title: 'group',
						specs: [
							{
								title: 'wobbles',
								file: 'a.spec.ts',
								tests: [
									{
										projectName: 'iphone-14',
										status: 'flaky',
										results: [{ status: 'failed' }, { status: 'passed' }],
									},
								],
							},
						],
					},
				],
			},
		],
	};

	it('lists only the tests that failed and then passed, with their group', () => {
		expect(flakyTests(report)).toEqual([
			{ project: 'iphone-14', file: 'a.spec.ts', title: 'group > wobbles', failedAttempts: 1 },
		]);
	});

	it('lists nothing for an empty report', () => {
		expect(flakyTests({})).toEqual([]);
	});
});
