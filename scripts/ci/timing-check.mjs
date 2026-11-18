// SPDX-License-Identifier: GPL-2.0-or-later
// The timing tier's judge (ADR-0016 section 1). Reads the JSON the @timing specs write in
// test-results/ (gantt-perf.json, workload-perf.json), prints a Markdown table for the step
// summary, and exits 1 only on a gross regression: a measure more than TWICE its budget in every
// run (and at least MIN_RUNS runs). Anything less is noise on a shared runner and is only shown.
//   node scripts/ci/timing-check.mjs [--dir test-results] [--out timing-summary.md]
// The budgets are the ones the specs enforce; they are not changed here (lib/perf.ts).
import fs from 'node:fs';
import path from 'node:path';

/** phase-2.md 8.4: at most 5 % dropped compositor frames, no rAF interval over 50 ms. */
export const BUDGETS = { droppedPct: 5, maxMs: 50, dragScriptP95Ms: 8 };
/** "Gross" is this many times the budget. */
export const GROSS_FACTOR = 2;
/** A measure is judged only when this many runs were made (the specs make three, then extras). */
export const MIN_RUNS = 3;

/**
 * Judges one measure over its runs: gross when the smallest value of any run is still over
 * `GROSS_FACTOR * budget`, that is, every run is over. Fewer than MIN_RUNS runs are not judged.
 */
export function judge(name, values, budget) {
	const limit = budget * GROSS_FACTOR;
	const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
	const best = nums.length ? Math.min(...nums) : null;
	const judged = nums.length >= MIN_RUNS;
	return {
		name,
		budget,
		limit,
		runs: nums.length,
		best,
		worst: nums.length ? Math.max(...nums) : null,
		gross: judged && best !== null && best > limit,
	};
}

/** The measures of a gantt-perf.json (the desktop profile only: it has the caps). */
export function ganttMeasures(j) {
	const d = j?.desktop;
	if (!d) return [];
	const out = [];
	for (const zoom of Object.keys(d.scroll ?? {})) {
		const runs = [...(d.scroll[zoom] ?? []), ...(d.scrollExtra?.[zoom] ?? [])];
		out.push(
			judge(
				`gantt scroll ${zoom}: dropped frames %`,
				runs.map((m) => m?.pipeline?.droppedPct),
				BUDGETS.droppedPct,
			),
			judge(
				`gantt scroll ${zoom}: longest frame ms`,
				runs.map((m) => m?.maxMs),
				BUDGETS.maxMs,
			),
		);
	}
	const drag = d.drag3s;
	if (drag?.inputScript && drag?.rafScript) {
		// One run: shown against its budget, never judged gross (fewer than MIN_RUNS).
		out.push(
			judge(
				'gantt drag: script p95 ms',
				[drag.inputScript.p95Ms + drag.rafScript.p95Ms],
				BUDGETS.dragScriptP95Ms,
			),
		);
	}
	return out;
}

/** The measures of a workload-perf.json (desktop: every zoom and axis, with every run it made). */
export function workloadMeasures(j) {
	const d = j?.desktop;
	if (!d) return [];
	const out = [];
	for (const [key, r] of Object.entries(d)) {
		// The spec stops at the first run within the caps, so fewer than three runs means it passed.
		const list = Array.isArray(r?.runList) ? r.runList : [];
		out.push(
			judge(
				`workload ${key}: dropped frames %`,
				list.map((m) => m.droppedPct),
				BUDGETS.droppedPct,
			),
			judge(
				`workload ${key}: longest frame ms`,
				list.map((m) => m.maxMs),
				BUDGETS.maxMs,
			),
		);
	}
	return out;
}

const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

export function markdown(rows, commit) {
	const lines = [
		`## Timing tier${commit ? ` (${commit})` : ''}`,
		'',
		'| Measure | Budget | Gross at | Runs | Best | Worst | Verdict |',
		'| --- | ---: | ---: | ---: | ---: | ---: | --- |',
	];
	for (const r of rows) {
		const verdict = r.gross
			? 'GROSS REGRESSION'
			: r.best !== null && r.best > r.budget
				? 'over budget (noise?)'
				: 'ok';
		lines.push(
			`| ${r.name} | ${r.budget} | ${r.limit} | ${r.runs} | ${r.best ?? 'n/a'} | ${r.worst ?? 'n/a'} | ${verdict} |`,
		);
	}
	if (rows.length === 0) lines.push('| no measures found | | | | | | |');
	return lines.join('\n') + '\n';
}

export function main(argv) {
	const arg = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const dir = arg('--dir', 'test-results');
	const rows = [
		...ganttMeasures(read(path.join(dir, 'gantt-perf.json'))),
		...workloadMeasures(read(path.join(dir, 'workload-perf.json'))),
	];
	const md = markdown(rows, process.env.GITHUB_SHA?.slice(0, 8));
	process.stdout.write(md);
	const out = arg('--out', '');
	if (out) fs.writeFileSync(out, md);
	const gross = rows.filter((r) => r.gross);
	if (gross.length) {
		console.error(
			`Gross regression (over ${GROSS_FACTOR}x budget in all runs): ${gross.map((r) => r.name).join('; ')}`,
		);
		return 1;
	}
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
