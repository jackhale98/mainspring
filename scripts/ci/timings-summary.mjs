#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Markdown table comparing the wasm engine timings (run-wasm.mjs --json) with the native
// timings recorded by golden:record. Reporting only: it never fails on a ratio.
//   node scripts/ci/timings-summary.mjs <wasm-timings.json> [native-timings.json]
import fs from 'node:fs';

const [wasmFile, nativeFile = 'engine/golden/native-timings.json'] = process.argv.slice(2);
if (!wasmFile) {
	console.error('usage: timings-summary.mjs <wasm-timings.json> [native-timings.json]');
	process.exit(2);
}
const wasm = JSON.parse(fs.readFileSync(wasmFile, 'utf8'));
const native = JSON.parse(fs.readFileSync(nativeFile, 'utf8')).plans ?? {};
const f = (n) => (typeof n === 'number' ? (n >= 100 ? Math.round(n) : n.toFixed(1)) : '-');

const lines = [
	'| plan | tasks | wasm total ms | native total ms | ratio | matches golden |',
	'| --- | ---: | ---: | ---: | ---: | --- |',
];
for (const [id, p] of Object.entries(wasm.plans ?? {})) {
	const w = p.timings?.totalMs;
	const n = native[id]?.totalMs;
	const ratio = typeof w === 'number' && n ? (w / n).toFixed(1) : '-';
	lines.push(`| ${id} | ${p.tasks} | ${f(w)} | ${f(n)} | ${ratio} | ${p.match ? 'yes' : 'NO'} |`);
}
console.log(lines.join('\n'));
