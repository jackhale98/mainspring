// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as sp from '../../scripts/ci/shard-plan.mjs';

const ROOT = path.resolve(__dirname, '../..');
const d = { projects: { p: { a: 100, b: 60, c: 50, d: 40, e: 10 } } };

describe('shard-plan', () => {
	it('packs the longest first onto the emptiest shard', () => {
		const s = sp.plan(['a', 'b', 'c', 'd', 'e'], d, 'p', 2);
		expect(s.map((x: { seconds: number }) => x.seconds)).toEqual([140, 120]);
		expect(s[0]?.files).toEqual(['a', 'd']);
		expect(s[1]?.files).toEqual(['b', 'c', 'e']);
	});

	it('estimates a file with no time from another project, scaled by their median ratio', () => {
		const two = {
			projects: {
				slow: { a: 300, b: 90 },
				fast: { a: 100, b: 30, c: 20 },
			},
		};
		expect(sp.ratio(two, 'slow', 'fast')).toBe(3);
		expect(sp.estimate(two, 'slow', 'c')).toBe(60);
		// No other project has it: the project's median.
		expect(sp.estimate(two, 'slow', 'zz')).toBe(300);
	});

	it('gives every file to exactly one shard, and an unknown file the median', () => {
		const files = ['a', 'b', 'c', 'd', 'e', 'new'];
		expect(sp.estimate(d, 'p', 'new')).toBe(50);
		for (const n of [1, 2, 3, 5]) {
			const all = sp.plan(files, d, 'p', n).flatMap((x: { files: string[] }) => x.files);
			expect(all.sort()).toEqual([...files].sort());
		}
	});

	it('is deterministic and rejects bad shard counts', () => {
		expect(sp.plan(['a', 'b'], d, 'p', 2)).toEqual(sp.plan(['b', 'a'], d, 'p', 2));
		expect(() => sp.plan(['a'], d, 'p', 0)).toThrow();
		expect(sp.parseShard('2/3')).toEqual([1, 3]);
		expect(() => sp.parseShard('4/3')).toThrow();
		expect(() => sp.parseShard('x')).toThrow();
	});

	it('reads the matrix of ci.yml', () => {
		const yml =
			'- { project: desktop, shard: 1/3, browsers: chromium }\n- { project: pixel-7, shard: 2/2 }';
		expect(sp.matrixFromWorkflow(yml)).toEqual({ desktop: 3, 'pixel-7': 2 });
	});

	it('sums a Playwright report per file and worker', () => {
		const report = {
			suites: [
				{
					specs: [],
					suites: [
						{
							specs: [
								{
									file: 'x.spec.ts',
									tests: [{ projectName: 'desktop', results: [{ duration: 4000 }] }],
								},
								{
									file: 'x.spec.ts',
									tests: [{ projectName: 'pixel-7', results: [{ duration: 9000 }] }],
								},
								{
									file: 'x.spec.ts',
									tests: [
										{ projectName: 'desktop', results: [{ duration: 2000 }, { duration: 2000 }] },
									],
								},
							],
						},
					],
				},
			],
		};
		expect(sp.measure(report, 'desktop', 2)).toEqual({ 'tests/e2e/x.spec.ts': 4 });
		expect(sp.measure([report, report], 'desktop', 2)).toEqual({ 'tests/e2e/x.spec.ts': 8 });
	});

	it('plans a 0 from the alike project, so that a file a skip batch turns on is not planned at 0', () => {
		const d2 = {
			alike: { iphone: ['pixel'] },
			projects: {
				desktop: { only: 50, both: 10, lifted: 10 },
				pixel: { only: 0, both: 20, lifted: 20 },
				iphone: { only: 0, both: 60, lifted: 0 },
			},
		};
		// Turned on by a batch: the Pixel time times the iPhone's ratio to it.
		expect(sp.estimate(d2, 'iphone', 'lifted')).toBe(60);
		// Desktop-only (no phone runs it): stays 0, not the desktop time.
		expect(sp.estimate(d2, 'iphone', 'only')).toBe(0);
		expect(sp.estimate(d2, 'iphone', 'both')).toBe(60);
		// Still skipped by a pending batch: stays 0.
		expect(sp.estimate(d2, 'iphone', 'lifted', new Set(['lifted']))).toBe(0);
	});

	it('every committed shard of ci.yml is within the time target', () => {
		const dur = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/e2e/durations.json'), 'utf8'));
		const counts = sp.matrixFromWorkflow(
			fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
		);
		expect(Object.keys(counts).sort()).toEqual(['desktop', 'iphone-14', 'pixel-7']);
		const files = sp.specFiles(ROOT);
		for (const [project, n] of Object.entries(counts) as [string, number][]) {
			for (const s of sp.plan(files, dur, project, n)) {
				expect(
					s.seconds * dur.ciFactor[project] + dur.setupSeconds,
					`${project} ${n}`,
				).toBeLessThanOrEqual(dur.targetSeconds);
			}
		}
	});
	it('every spec file under tests/e2e (subfolders too, not lib/) lands in exactly one shard per project', () => {
		const dur = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/e2e/durations.json'), 'utf8'));
		const counts = sp.matrixFromWorkflow(
			fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
		);
		const found: string[] = [];
		const walk = (dir: string): void => {
			for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
				if (e.isDirectory()) {
					if (e.name !== 'lib') walk(`${dir}/${e.name}`);
				} else if (e.name.endsWith('.spec.ts')) found.push(`${dir}/${e.name}`);
			}
		};
		walk('tests/e2e');
		// The files that playwright.config.ts ignores in the merge tier.
		const merge = found.filter(
			(f) => !/(engine-responsiveness|text-mode-perf|engine-cost)\.spec\.ts$/.test(f),
		);
		expect(merge.some((f) => f.startsWith('tests/e2e/primitives/'))).toBe(true);
		expect([...sp.specFiles(ROOT)].sort()).toEqual([...merge].sort());
		for (const [project, n] of Object.entries(counts) as [string, number][]) {
			const placed = sp
				.plan(sp.specFiles(ROOT), dur, project, n)
				.flatMap((x: { files: string[] }) => x.files);
			expect([...placed].sort(), project).toEqual([...merge].sort());
		}
	});
});
