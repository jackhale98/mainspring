// SPDX-License-Identifier: GPL-2.0-or-later
// One line per measurement of test-results/gantt-perf.json (tests/e2e/gantt-perf.spec.ts), for the
// gate file: frames, median, p95 and max interval, frames over 50 ms, the share on time, the
// compositor's dropped share, long animation frames, the longest task and the script times.
//   node scripts/gantt-perf-summary.mjs [file]
import fs from 'node:fs';

const file = process.argv[2] ?? 'test-results/gantt-perf.json';
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const row = (name, m) => {
	if (!m) return;
	const extra =
		m.dropToPaintMs === undefined
			? ''
			: ` paint ${m.dropToPaintMs} resched ${m.dropToRescheduleMs}`;
	const lb = m.loafBreakdown;
	const loafParts = lb
		? ` loafMs script/render/style+layout ${lb.scriptMs}/${lb.renderMs}/${lb.styleLayoutMs}`
		: '';
	console.log(
		`${name.padEnd(24)} frames ${m.frames} med ${m.medianMs} p95 ${m.p95Ms} max ${m.maxMs} ` +
			`>50:${m.over50} onTime ${m.onTimePct}% drop ${m.pipeline?.droppedPct}% ` +
			`loaf ${m.loafCount}/${m.loafMaxMs} task ${m.longestTaskMs} ` +
			`inLat p50/p95/max ${m.inputLatency?.p50Ms}/${m.inputLatency?.p95Ms}/${m.inputLatency?.maxMs} input95 ${m.inputScript?.p95Ms} raf95 ${m.rafScript?.p95Ms}${loafParts}${extra}`,
	);
};
for (const [key, v] of Object.entries(j)) {
	console.log(
		`== ${key} ${v.profile ?? ''} build ${v.build} load ${JSON.stringify(v.loadAverageAtStart)} -> ${JSON.stringify(v.loadAverageAtEnd)} input ${v.input ?? ''}`,
	);
	for (const [zoom, runs] of Object.entries(v.scroll ?? {}))
		runs.forEach((m, i) => row(`scroll ${zoom} #${i + 1}`, m));
	for (const [zoom, runs] of Object.entries(v.scrollExtra ?? {}))
		runs.forEach((m, i) => row(`scroll ${zoom} extra #${i + 1}`, m));
	row('pan', v.pan);
	row('zoom', v.zoom);
	row('drag 3 s', v.drag3s);
	row('scroll during result', v.scrollDuringResult);
	if (v.criterion18_7) console.log(JSON.stringify(v.criterion18_7));
	(v.runs ?? []).forEach((m, i) => row(`listener run ${i + 1}`, m));
}
