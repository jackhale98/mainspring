#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// tz-edges.mjs - check the shared table of DST edge cases (tz-edge-cases.json): TaskJuggler
// date text read in a time zone, and the UTC instant native TaskJuggler gives it. The same
// table is checked natively and in the browser engine, and other code (the TJP value parsers in
// src/lib/tjp/values) can test against it.
//
//   node engine/golden/tz-edges.mjs [--engine public/engine]   the built wasm engine, in Node
//   node engine/golden/tz-edges.mjs --native                    native TaskJuggler (developer only)
//
// Wasm: each zone and change becomes a small generated plan (`timezone`, 15-minute
// resolution, one milestone per case starting at the case's local time), scheduled by the
// engine as run-wasm.mjs does; the milestone's start must be the case's instant. run-wasm.mjs
// runs this after the corpus, so `npm run golden:wasm` covers it.
//
// Native: tz-edge-cases.rb parses every case with TaskJuggler's TjTime after setting the zone,
// in one Ruby process under `bundle exec` with TZ=UTC (the recorder's environment).
// record-native.mjs runs it before recording, so the table stays true for the Ruby that records
// the goldens. Like the recorder, it needs Ruby and the gems in engine/golden/Gemfile.lock; CI
// never runs it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { minutesToIso } from './lib.mjs';

const GOLDEN = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(GOLDEN, '..', '..');
export const TZ_EDGE_FILE = path.join(GOLDEN, 'tz-edge-cases.json');

/** Case kinds; see the table's description. */
export const TZ_EDGE_KINDS = ['gap', 'overlap', 'before', 'after', 'plain'];
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2}):(\d{2})$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAY_MS = 86_400_000;
/** Cases of one zone whose dates lie within this many days share a generated plan. */
const CLUSTER_DAYS = 3;

/**
 * @typedef {{ zone: string, local: string, utc: string, kind: string }} TzEdgeCase
 * @typedef {{ zone: string, cases: TzEdgeCase[], text: string }} TzEdgePlan
 */

/**
 * The local time as if it were UTC, in ms, or null if `local` is not a real
 * YYYY-MM-DD-hh:mm date and time.
 * @param {string} local
 * @returns {number | null}
 */
function localMs(local) {
	const m = LOCAL_RE.exec(local);
	if (!m) return null;
	const [y, mo, d, h, mi] = m.slice(1).map(Number);
	const t = Date.UTC(y, mo - 1, d, h, mi);
	const back = new Date(t);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
	return h < 24 && mi < 60 ? t : null;
}

/**
 * Problems with the table that can be found without an engine, as strings;
 * empty when it is valid.
 * @param {unknown} table
 * @returns {string[]}
 */
export function tzEdgeProblems(table) {
	const cases = /** @type {{ cases?: unknown }} */ (table ?? {}).cases;
	if (!Array.isArray(cases) || cases.length === 0) return ['cases must be a non-empty array'];
	/** @type {string[]} */
	const out = [];
	const seen = new Set();
	cases.forEach((c, i) => {
		const bad = (/** @type {string} */ why) => out.push(`cases[${i}] ${JSON.stringify(c)}: ${why}`);
		if (typeof c?.zone !== 'string' || !(c.zone === 'UTC' || c.zone.includes('/'))) bad('zone must be UTC or Region/City');
		if (typeof c?.local !== 'string' || localMs(c.local) === null) bad('local must be a real YYYY-MM-DD-hh:mm');
		// TaskJuggler accepts years 1970 to 2035 only (TjTime#parse).
		else if (Number(c.local.slice(0, 4)) < 1970 || Number(c.local.slice(0, 4)) > 2035) bad('local must be in 1970 to 2035');
		if (typeof c?.utc !== 'string' || !UTC_RE.test(c.utc) || Number.isNaN(Date.parse(c.utc))) {
			bad('utc must be ISO 8601 UTC with seconds');
		} else if (Date.parse(c.utc) % (15 * 60_000) !== 0) {
			bad('utc must be on a quarter hour (the generated plans use 15-minute resolution)');
		}
		if (!TZ_EDGE_KINDS.includes(c?.kind)) bad(`kind must be one of ${TZ_EDGE_KINDS.join(', ')}`);
		const key = `${c?.zone} ${c?.local}`;
		if (seen.has(key)) bad('duplicate zone and local');
		seen.add(key);
	});
	return out;
}

/**
 * The table's cases; throws if the table is invalid.
 * @param {string} [file]
 * @returns {TzEdgeCase[]}
 */
export function loadTzEdgeCases(file = TZ_EDGE_FILE) {
	const table = JSON.parse(fs.readFileSync(file, 'utf8'));
	const problems = tzEdgeProblems(table);
	if (problems.length) throw new Error(`${path.relative(REPO, file)}:\n  ${problems.join('\n  ')}`);
	return table.cases;
}

/** @param {number} ms */
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * One plan per zone and cluster of nearby dates, in table order. Each case is
 * task `c<i>` (its index in the plan's `cases`), a milestone starting at the
 * case's local time. The project frame and `now` come before `timezone`, so
 * TaskJuggler reads them as UTC dates.
 * @param {TzEdgeCase[]} cases
 * @returns {TzEdgePlan[]}
 */
export function tzEdgePlans(cases) {
	/** @type {{ zone: string, cases: TzEdgeCase[], first: number, last: number }[]} */
	const groups = [];
	for (const c of cases) {
		const t = /** @type {number} */ (localMs(c.local));
		const g = groups.find((x) => x.zone === c.zone && Math.abs(t - x.first) <= CLUSTER_DAYS * DAY_MS);
		if (g) {
			g.cases.push(c);
			g.first = Math.min(g.first, t);
			g.last = Math.max(g.last, t);
		} else {
			groups.push({ zone: c.zone, cases: [c], first: t, last: t });
		}
	}
	return groups.map((g) => {
		const start = isoDate(g.first - 2 * DAY_MS);
		const lines = [
			'# Generated by engine/golden/tz-edges.mjs from tz-edge-cases.json.',
			`project tzedges "DST edge cases" ${start} - ${isoDate(g.last + 3 * DAY_MS)} {`,
			`  now ${start}`,
			'  timingresolution 15min',
			`  timezone "${g.zone}"`,
			'}',
			...g.cases.map((c, i) => `task c${i} "${c.local}" { start ${c.local} milestone }`),
		];
		return { zone: g.zone, cases: g.cases, text: `${lines.join('\n')}\n` };
	});
}

/**
 * Differences between a generated plan's ScheduleResult and its cases, at
 * most one per case.
 * @param {TzEdgePlan} plan
 * @param {Record<string, any>} result
 * @returns {string[]}
 */
export function tzEdgeDiffs(plan, result) {
	const errors = (result.messages ?? []).filter((/** @type {{ level: string }} */ m) => m.level === 'error');
	const failed = !result.ok || errors.length > 0 || !result.project;
	const why = failed ? `not scheduled: ${JSON.stringify(errors[0] ?? result.messages?.[0] ?? null)}` : '';
	/** @type {Map<string, number | null>} */
	const starts = new Map();
	for (const t of result.tasks ?? []) starts.set(t.id, t.scenarios?.plan?.start ?? null);
	return plan.cases.flatMap((c, i) => {
		const label = `${c.zone} ${c.local} (${c.kind})`;
		if (failed) return [`${label}: ${why}`];
		const got = minutesToIso(result.project.start, starts.get(`c${i}`) ?? null);
		return got === c.utc ? [] : [`${label}: expected ${c.utc}, got ${got}`];
	});
}

/**
 * Differences between the native results (tz-edge-cases.rb output) and the cases.
 * @param {TzEdgeCase[]} cases
 * @param {{ zone: string, local: string, utc?: string, error?: string }[]} results
 * @returns {string[]}
 */
export function nativeTzEdgeDiffs(cases, results) {
	if (results.length !== cases.length) return [`expected ${cases.length} native results, got ${results.length}`];
	return cases.flatMap((c, i) => {
		const r = results[i];
		if (r.zone !== c.zone || r.local !== c.local) return [`result ${i} is for ${r.zone} ${r.local}, not ${c.zone} ${c.local}`];
		return r.utc === c.utc ? [] : [`${c.zone} ${c.local} (${c.kind}): expected ${c.utc}, got ${r.utc ?? r.error}`];
	});
}

/**
 * Schedules every generated plan in a booted engine (bootNodeEngine) and
 * compares. `revision` numbers the requests.
 * @param {{ schedule(request: unknown): Record<string, any> }} engine
 * @param {TzEdgeCase[]} [cases]
 * @param {number} [revision]
 * @returns {{ total: number, plans: number, diffs: string[] }}
 */
export function checkTzEdgesWasm(engine, cases = loadTzEdgeCases(), revision = 1_000_000) {
	const plans = tzEdgePlans(cases);
	/** @type {string[]} */
	const diffs = [];
	for (const plan of plans) {
		/** @type {Record<string, any>} */
		let result;
		try {
			result = engine.schedule({ files: { 'plan.tjp': plan.text }, entry: 'plan.tjp', revision: revision++, options: {} });
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			diffs.push(...plan.cases.map((c) => `${c.zone} ${c.local} (${c.kind}): engine failed: ${why}`));
			continue;
		}
		diffs.push(...tzEdgeDiffs(plan, result));
	}
	return { total: cases.length, plans: plans.length, diffs };
}

/**
 * Runs tz-edge-cases.rb with native Ruby (bundle exec, TZ=UTC) and compares.
 * @param {TzEdgeCase[]} [cases]
 * @returns {{ total: number, ruby: string, diffs: string[] }}
 */
export function checkTzEdgesNative(cases = loadTzEdgeCases()) {
	const env = {
		...process.env,
		TZ: 'UTC',
		LANG: 'C.UTF-8',
		LC_ALL: 'C.UTF-8',
		BUNDLE_GEMFILE: path.join(GOLDEN, 'Gemfile'),
	};
	const r = spawnSync('bundle', ['exec', 'ruby', '-EUTF-8', '-I', path.join(REPO, 'engine', 'tj', 'lib'), '-e',
		'print RUBY_VERSION, "\\n"; load ARGV[0]', path.join(GOLDEN, 'tz-edge-cases.rb')], {
		cwd: REPO, env, encoding: 'utf8', input: JSON.stringify(cases.map((c) => ({ zone: c.zone, local: c.local }))),
		maxBuffer: 1 << 26,
	});
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`tz-edge-cases.rb exited ${r.status ?? r.signal}:\n${r.stderr}`);
	const [ruby, json] = r.stdout.split('\n');
	return { total: cases.length, ruby, diffs: nativeTzEdgeDiffs(cases, JSON.parse(json)) };
}

async function main() {
	const { values } = parseArgs({
		options: {
			native: { type: 'boolean', default: false },
			engine: { type: 'string', default: 'public/engine' },
		},
	});
	const cases = loadTzEdgeCases();
	let res;
	if (values.native) {
		res = checkTzEdgesNative(cases);
		console.log(`native Ruby ${res.ruby}`);
	} else {
		const { bootNodeEngine } = await import('./run-wasm.mjs');
		const engine = await bootNodeEngine({ dir: values.engine });
		res = checkTzEdgesWasm(engine, cases);
		console.log(`wasm engine, bundle ${engine.versions.bundleHash.slice(0, 12)}, ${res.plans} generated plans`);
	}
	for (const d of res.diffs) console.log(`    ${d}`);
	console.log(`${res.total - res.diffs.length}/${res.total} tz edge cases match tz-edge-cases.json`);
	if (res.diffs.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
