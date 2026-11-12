// SPDX-License-Identifier: GPL-2.0-or-later
// Parse timings (T5). Spec 8.4 records performance targets rather than enforcing them, so this
// prints the numbers for the gate and asserts only sanity bounds ten times the targets: a full
// parse of the 1,000-task synthetic plan (5,629 lines) under 100 ms warm in Node, and an
// incremental reparse (reparse) after typing one line.
import { describe, expect, it } from 'vitest';
import { readTjp } from '../../../../tests/grammar/corpus';
import { reparse } from './fragments';
import { tjpGlobalParser } from './parser';

const FULL_TARGET_MS = 100;
const INCREMENTAL_TARGET_MS = 10;
const SANITY = 10;

const SCALE = 'engine/golden/plans/synthetic/20-scale-1000/plan.tjp';
const PLANS = [SCALE, 'engine/tj/examples/Fedora-20/f-20.tjp'];

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? NaN;
}

function time(f: () => void, runs = 7): number {
	f();
	const out: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		f();
		out.push(performance.now() - t0);
	}
	return median(out);
}

/** Inserts `insert` at the start of the line holding `offset`; returns the edit. */
function edit(text: string, offset: number, insert: string) {
	const at = text.lastIndexOf('\n', offset) + 1;
	return {
		text: text.slice(0, at) + insert + text.slice(at),
		change: [{ fromA: at, toA: at, fromB: at, toB: at + insert.length }],
	};
}

describe.each(PLANS)('%s', (file) => {
	const text = readTjp(file);
	const lines = text.split('\n').length;

	it('parses fully', () => {
		const ms = time(() => tjpGlobalParser.parse(text));
		console.info(`full parse ${file} (${lines} lines): median ${ms.toFixed(1)} ms`);
		expect(ms).toBeLessThan(FULL_TARGET_MS * SANITY);
	});

	it('reparses incrementally after typing one line', () => {
		const tree = tjpGlobalParser.parse(text);
		const e = edit(text, text.length >> 1, '  # typed\n');
		const ms = time(() => reparse(tjpGlobalParser, e.text, tree, e.change));
		console.info(`incremental reparse ${file}, reparse: median ${ms.toFixed(2)} ms`);
		expect(ms).toBeLessThan(INCREMENTAL_TARGET_MS * SANITY);
	});
});

describe('an unterminated string near the top of the 1,000-task plan', () => {
	const text = readTjp(SCALE);
	// After the project block. The plan has no single quote, so this string never closes: the rest
	// of the file is one runaway error token. (A `"` would close at the next double quote.)
	const e = edit(text, text.indexOf('resource grp0'), "note '\n");

	it('turns the rest of the file into one error token', () => {
		let scan = 0;
		tjpGlobalParser.parse(e.text).iterate({
			enter(n) {
				if (n.name === 'ScanError' && n.to === e.text.length) scan++;
			},
		});
		expect(scan).toBe(1);
	});

	it('parses fully and incrementally', () => {
		const full = time(() => tjpGlobalParser.parse(e.text));
		const tree = tjpGlobalParser.parse(text);
		const incremental = time(() => reparse(tjpGlobalParser, e.text, tree, e.change));
		console.info(
			`unterminated string at line ${text.slice(0, e.change[0]?.fromA).split('\n').length} of ` +
				`${SCALE}: full ${full.toFixed(2)} ms, incremental ${incremental.toFixed(2)} ms`,
		);
		expect(full).toBeLessThan(FULL_TARGET_MS * SANITY);
		expect(incremental).toBeLessThan(FULL_TARGET_MS * SANITY);
	});
});
