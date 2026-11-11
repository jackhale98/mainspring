// SPDX-License-Identifier: GPL-2.0-or-later
// Parse timings (T5): a full parse of the 1,000-task synthetic plan (5,629 lines) must take under
// 100 ms warm in Node; an incremental reparse after one edit is reported and loosely bounded.
import { describe, expect, it } from 'vitest';
import { readTjp } from '../../../../tests/grammar/corpus';
import { reuseFragments } from './fragments';
import { tjpGlobalParser } from './parser';

const PLANS = [
	'engine/golden/plans/synthetic/20-scale-1000/plan.tjp',
	'engine/tj/examples/Fedora-20/f-20.tjp',
];

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? NaN;
}

function time(f: () => void, runs: number): number {
	const out: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		f();
		out.push(performance.now() - t0);
	}
	return median(out);
}

describe.each(PLANS)('%s', (file) => {
	const text = readTjp(file);
	const lines = text.split('\n').length;

	it('parses fully under 100 ms warm', () => {
		for (let i = 0; i < 3; i++) tjpGlobalParser.parse(text);
		const ms = time(() => tjpGlobalParser.parse(text), 7);
		console.info(`full parse ${file} (${lines} lines): median ${ms.toFixed(1)} ms`);
		expect(ms).toBeLessThan(100);
	});

	it('reparses incrementally after typing one line', () => {
		const tree = tjpGlobalParser.parse(text);
		const at = text.indexOf('\n', text.length >> 1) + 1;
		const insert = '  # typed\n';
		const edited = text.slice(0, at) + insert + text.slice(at);
		const change = [{ fromA: at, toA: at, fromB: at, toB: at + insert.length }];
		const fragments = reuseFragments(tree, change);
		tjpGlobalParser.parse(edited, fragments); // warm the reuse caches
		const ms = time(() => tjpGlobalParser.parse(edited, fragments), 7);
		console.info(`incremental reparse ${file}: median ${ms.toFixed(2)} ms`);
		// Typically 2 to 3 ms; bounded loosely so slow CI machines do not flake.
		expect(ms).toBeLessThan(25);
	});
});
