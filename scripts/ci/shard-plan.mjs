// SPDX-License-Identifier: GPL-2.0-or-later
// Splits the e2e spec files over CI shards by measured duration (ADR-0016 change 4).
// Playwright's own `--shard` cuts the sorted test list into equal counts, which are very unequal
// in time (one Pixel 7 runner took 22 minutes while its sibling took 9). This picks whole files:
// longest first, each onto the shard with the least time so far, from the committed durations in
// tests/e2e/durations.json (seconds of worker time per file and project, measured locally with
// two workers; `node scripts/ci/shard-plan.mjs measure <project> <reports...>` rewrites one
// project from Playwright JSON reports). A spec file that is not in the file gets the median of
// its project, so a new file lands somewhere sensible until the next measurement.
//
//   node scripts/ci/shard-plan.mjs files <project> <i>/<n>   the spec files of one shard
//   node scripts/ci/shard-plan.mjs table                     every project's plan with times
//   node scripts/ci/shard-plan.mjs check                     fails if a shard of ci.yml is over target
//   node scripts/ci/shard-plan.mjs measure <project> <report.json>...   (CI: one per shard)
// The shard counts are the matrix of .github/workflows/ci.yml (e2e job); `check` reads them there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DURATIONS = path.join(ROOT, 'tests/e2e/durations.json');
/** Spec files that playwright.config.ts never runs in the merge tier (testIgnore). */
const NOT_IN_MERGE_TIER = new Set(['engine-responsiveness.spec.ts', 'text-mode-perf.spec.ts']);

/** The spec files of the merge tier, as repository paths, sorted. */
export function specFiles(root = ROOT) {
	return fs
		.readdirSync(path.join(root, 'tests/e2e'))
		.filter((f) => f.endsWith('.spec.ts') && !NOT_IN_MERGE_TIER.has(f))
		.sort()
		.map((f) => `tests/e2e/${f}`);
}

const median = (xs) => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
};

/** Estimated seconds of one file in one project (a missing file gets the project's median). */
export function estimate(durations, project, file) {
	const known = durations.projects?.[project] ?? {};
	return known[file] ?? median(Object.values(known));
}

/**
 * Longest-processing-time packing of whole files over `n` shards. Returns one {files, seconds}
 * per shard; the result depends only on the inputs (ties go to the lower shard, then the name).
 */
export function plan(files, durations, project, n) {
	if (!Number.isInteger(n) || n < 1) throw new Error(`bad shard count: ${n}`);
	const items = files
		.map((file) => ({ file, seconds: estimate(durations, project, file) }))
		.sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
	const shards = Array.from({ length: n }, () => ({ files: [], seconds: 0 }));
	for (const it of items) {
		let best = 0;
		for (let i = 1; i < n; i++) if (shards[i].seconds < shards[best].seconds) best = i;
		shards[best].files.push(it.file);
		shards[best].seconds += it.seconds;
	}
	for (const s of shards) s.files.sort();
	return shards;
}

/** Parses "2/3" into [index (0-based), count]. */
export function parseShard(text) {
	const m = /^(\d+)\/(\d+)$/.exec(text ?? '');
	if (!m) throw new Error(`shard must look like 2/3, got ${text}`);
	const i = Number(m[1]);
	const n = Number(m[2]);
	if (i < 1 || i > n) throw new Error(`shard ${text} is out of range`);
	return [i - 1, n];
}

/** The e2e matrix of ci.yml: shard counts per project. */
export function matrixFromWorkflow(text) {
	const counts = {};
	for (const m of text.matchAll(/project:\s*([\w-]+),\s*shard:\s*(\d+)\/(\d+)/g)) {
		counts[m[1]] = Number(m[3]);
	}
	return counts;
}

/** Sums a Playwright JSON report into seconds per spec file for one project, per worker. */
export function measure(report, project, workers = 2) {
	const out = {};
	const walk = (suite) => {
		for (const spec of suite.specs ?? []) {
			for (const t of spec.tests ?? []) {
				if (t.projectName !== project) continue;
				const ms = (t.results ?? []).reduce((a, r) => a + (r.duration ?? 0), 0);
				const file = `tests/e2e/${spec.file}`.replace('tests/e2e/tests/e2e/', 'tests/e2e/');
				out[file] = (out[file] ?? 0) + ms / 1000 / workers;
			}
		}
		for (const s of suite.suites ?? []) walk(s);
	};
	for (const s of report.suites ?? []) walk(s);
	for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10) / 10;
	return out;
}

function load() {
	return JSON.parse(fs.readFileSync(DURATIONS, 'utf8'));
}

function main(argv) {
	const [cmd, ...args] = argv;
	if (cmd === 'files') {
		const [i, n] = parseShard(args[1]);
		const shards = plan(specFiles(), load(), args[0], n);
		console.log(shards[i].files.join(' '));
	} else if (cmd === 'table' || cmd === 'check') {
		const d = load();
		const counts = matrixFromWorkflow(
			fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
		);
		let bad = 0;
		for (const [project, n] of Object.entries(counts)) {
			const shards = plan(specFiles(), d, project, n);
			shards.forEach((s, i) => {
				const ci = s.seconds * d.ciFactor[project] + d.setupSeconds;
				const over = ci > d.targetSeconds;
				if (over) bad++;
				console.log(
					`${project} ${i + 1}/${n}: ${s.files.length} files, ${Math.round(s.seconds)} s local, ` +
						`about ${(ci / 60).toFixed(1)} min on CI${over ? '  OVER TARGET' : ''}`,
				);
			});
		}
		if (cmd === 'check' && bad > 0) {
			console.error(`${bad} shard(s) over ${d.targetSeconds} s: add shards or re-measure`);
			process.exit(1);
		}
	} else if (cmd === 'measure') {
		const [file, project, workers] = args;
		const d = load();
		d.projects[project] = measure(
			JSON.parse(fs.readFileSync(file, 'utf8')),
			project,
			Number(workers ?? 2),
		);
		fs.writeFileSync(DURATIONS, `${JSON.stringify(d, null, '\t')}\n`);
	} else {
		console.error(
			'usage: shard-plan.mjs files <project> <i>/<n> | table | check | measure <report> <project>',
		);
		process.exit(2);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
