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
});
