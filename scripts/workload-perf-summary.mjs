// SPDX-License-Identifier: GPL-2.0-or-later
// The Pixel 7 swipe and pinch measures of test-results/workload-perf.json (tests/e2e/workload-perf.spec.ts)
// as a Markdown table for the nightly step summary: one row per measure and rate (1x and 4x CPU), so a
// night's numbers can be read next to the last nights' (each night uploads the JSON as
// timing-nightly-<run>, kept 90 days). Reporting only: the verdict is scripts/ci/timing-check.mjs.
//   node scripts/workload-perf-summary.mjs [file]
import fs from 'node:fs';

const file = process.argv[2] ?? 'test-results/workload-perf.json';
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const p = j['pixel-7'];
if (!p) {
	console.log('No Pixel 7 workload measures in the file.');
	process.exit(0);
}
console.log(`DOM nodes mounted: ${p.nodes}\n`);
console.log('| Measure | frames | on time % | max ms | over 50 ms | dropped % | longest task ms |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const [key, m] of Object.entries(p)) {
	if (typeof m !== 'object' || m === null) continue;
	console.log(
		`| ${key} | ${m.frames} | ${m.onTimePct} | ${m.maxMs} | ${m.over50} | ${m.droppedPct} | ${m.longestTaskMs} |`,
	);
}
