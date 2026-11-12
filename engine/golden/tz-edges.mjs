#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// tz-edges.mjs - check the shared table of time-zone edge cases (tz-edge-cases.json) natively
// and in the browser engine. The table has two lists:
//
// - cases: TaskJuggler date text read in a time zone, and the UTC instant native TaskJuggler
//   gives it (DST gaps and overlaps; Time.local). Other code, such as the TJP value parsers in
//   src/lib/tjp/values, can test against these too.
// - resolutions: the largest `timingresolution` TaskJuggler allows after `timezone`
//   (Project.maxScheduleGranularity, which reads Time#getlocal on 2000-01-01).
//
//   node engine/golden/tz-edges.mjs [--engine public/engine]   the built wasm engine, in Node
//   node engine/golden/tz-edges.mjs --native                    native TaskJuggler (developer only)
//
// Wasm: small generated plans scheduled by the engine as run-wasm.mjs does. For cases, one plan
// per zone and change (`timezone`, 15-minute resolution, one milestone per case starting at its
// local time; the milestone's start must be the case's instant). For resolutions, one plan per
// zone that sets the next allowed value above the cap (it must fail with too_large_timing_res
// naming the cap) or, for a 60-minute cap, 60min (it must schedule). run-wasm.mjs runs this
// after the corpus, so `npm run golden:wasm` covers it.
//
// Native: tz-edge-cases.rb evaluates both lists with TaskJuggler's own TjTime and Project code
// after setting the zone, in one Ruby process under `bundle exec` with TZ=UTC (the recorder's
// environment). record-native.mjs runs it before recording, so the table stays true for the
// Ruby that records the goldens. Like the recorder, it needs Ruby and the gems in
// engine/golden/Gemfile.lock; CI never runs it.
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
/** The values Project.maxScheduleGranularity can return, in minutes. */
export const TZ_RESOLUTION_CAPS = [15, 30, 60];
/** TaskJuggler's allowed `timingresolution` values (TjpSyntaxRules, goodValues). */
const GOOD_RESOLUTIONS = [5, 10, 15, 20, 30, 60];
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2}):(\d{2})$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAY_MS = 86_400_000;
/** Cases of one zone whose dates lie within this many days share a generated plan. */
const CLUSTER_DAYS = 3;

/**
 * @typedef {{ zone: string, local: string, utc: string, kind: string }} TzEdgeCase
 * @typedef {{ zone: string, maxMinutes: number, note?: string }} TzResolutionCase
 * @typedef {{ cases: TzEdgeCase[], resolutions: TzResolutionCase[] }} TzEdgeTable
 * @typedef {{ zone: string, cases: TzEdgeCase[], text: string }} TzEdgePlan
 * @typedef {{ zone: string, maxMinutes: number, tried: number, text: string }} TzResolutionPlan
 * @typedef {{ zone: string, local: string, utc?: string, error?: string }} NativeCaseResult
 * @typedef {{ zone: string, maxMinutes?: number, error?: string }} NativeResolutionResult
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

/** @param {unknown} zone */
const goodZone = (zone) => typeof zone === 'string' && (zone === 'UTC' || zone.includes('/'));

/**
 * Problems with the table that can be found without an engine, as strings;
 * empty when it is valid.
 * @param {unknown} table
 * @returns {string[]}
 */
export function tzEdgeProblems(table) {
	const t = /** @type {{ cases?: unknown, resolutions?: unknown }} */ (table ?? {});
	/** @type {string[]} */
	const out = [];
	if (!Array.isArray(t.cases) || t.cases.length === 0) out.push('cases must be a non-empty array');
	if (!Array.isArray(t.resolutions) || t.resolutions.length === 0) out.push('resolutions must be a non-empty array');
	if (out.length) return out;
	const seen = new Set();
	/** @type {unknown[]} */ (t.cases).forEach((c, i) => {
		const bad = (/** @type {string} */ why) => out.push(`cases[${i}] ${JSON.stringify(c)}: ${why}`);
		if (!goodZone(c?.zone)) bad('zone must be UTC or Region/City');
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
	const zones = new Set();
	/** @type {unknown[]} */ (t.resolutions).forEach((r, i) => {
		const bad = (/** @type {string} */ why) => out.push(`resolutions[${i}] ${JSON.stringify(r)}: ${why}`);
		if (!goodZone(r?.zone)) bad('zone must be UTC or Region/City');
		if (!TZ_RESOLUTION_CAPS.includes(r?.maxMinutes)) bad(`maxMinutes must be one of ${TZ_RESOLUTION_CAPS.join(', ')}`);
		if (r?.note !== undefined && typeof r.note !== 'string') bad('note must be a string');
		if (zones.has(r?.zone)) bad('duplicate zone');
		zones.add(r?.zone);
	});
	return out;
}

/**
 * The whole table; throws if it is invalid.
 * @param {string} [file]
 * @returns {TzEdgeTable}
 */
export function loadTzEdgeTable(file = TZ_EDGE_FILE) {
	const table = JSON.parse(fs.readFileSync(file, 'utf8'));
	const problems = tzEdgeProblems(table);
	if (problems.length) throw new Error(`${path.relative(REPO, file)}:\n  ${problems.join('\n  ')}`);
	return { cases: table.cases, resolutions: table.resolutions };
}

/**
 * The table's local-time cases; throws if the table is invalid.
 * @param {string} [file]
 * @returns {TzEdgeCase[]}
 */
export function loadTzEdgeCases(file = TZ_EDGE_FILE) {
	return loadTzEdgeTable(file).cases;
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
 * One plan per resolution case. It sets `timingresolution` after `timezone`
 * to the next allowed value above the cap (60 for a 60-minute cap). `now`
 * comes before `timezone` (a UTC date) and the milestone starts at
 * ${projectstart}, so every date is on a whole UTC hour.
 * @param {TzResolutionCase[]} resolutions
 * @returns {TzResolutionPlan[]}
 */
export function tzResolutionPlans(resolutions) {
	return resolutions.map((r) => {
		const tried = GOOD_RESOLUTIONS.find((v) => v > r.maxMinutes) ?? 60;
		const lines = [
			'# Generated by engine/golden/tz-edges.mjs from tz-edge-cases.json (resolutions).',
			'project tzres "Resolution cap" 2026-01-05 - 2026-01-12 {',
			'  now 2026-01-05',
			`  timezone "${r.zone}"`,
			`  timingresolution ${tried}min`,
			'}',
			'task t "T" { start ${projectstart} milestone }',
		];
		return { zone: r.zone, maxMinutes: r.maxMinutes, tried, text: `${lines.join('\n')}\n` };
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

/** The text of TaskJuggler's too_large_timing_res error for a cap in minutes. */
const capText = (/** @type {number} */ max) => `The maximum allowed timing resolution for the timezone is ${max} minutes.`;

/**
 * Differences between a resolution plan's ScheduleResult and its case (one at most).
 * @param {TzResolutionPlan} plan
 * @param {Record<string, any>} result
 * @returns {string[]}
 */
export function tzResolutionDiffs(plan, result) {
	const label = `${plan.zone} timingresolution ${plan.tried}min (cap ${plan.maxMinutes})`;
	const errors = (result.messages ?? []).filter((/** @type {{ level: string }} */ m) => m.level === 'error');
	const first = errors[0] ?? null;
	if (plan.tried > plan.maxMinutes) {
		if (first?.id === 'too_large_timing_res' && first.text === capText(plan.maxMinutes) && !result.ok) return [];
		return [`${label}: expected error too_large_timing_res "${capText(plan.maxMinutes)}", got ${first ? JSON.stringify(first) : `ok ${result.ok}`}`];
	}
	if (result.ok && !first && result.project?.timingResolutionMin === plan.tried) return [];
	return [`${label}: expected to schedule at ${plan.tried} min, got ${first ? JSON.stringify(first) : `ok ${result.ok}, resolution ${result.project?.timingResolutionMin}`}`];
}

/**
 * Differences between the native results (tz-edge-cases.rb output) and the table.
 * @param {TzEdgeTable} table
 * @param {{ cases: NativeCaseResult[], resolutions: NativeResolutionResult[] }} results
 * @returns {string[]}
 */
export function nativeTzEdgeDiffs(table, results) {
	const { cases, resolutions } = table;
	if (results.cases.length !== cases.length || results.resolutions.length !== resolutions.length) {
		return [`expected ${cases.length} + ${resolutions.length} native results, got ${results.cases.length} + ${results.resolutions.length}`];
	}
	const a = cases.flatMap((c, i) => {
		const r = /** @type {NativeCaseResult} */ (results.cases[i]);
		if (r.zone !== c.zone || r.local !== c.local) return [`result ${i} is for ${r.zone} ${r.local}, not ${c.zone} ${c.local}`];
		return r.utc === c.utc ? [] : [`${c.zone} ${c.local} (${c.kind}): expected ${c.utc}, got ${r.utc ?? r.error}`];
	});
	const b = resolutions.flatMap((c, i) => {
		const r = /** @type {NativeResolutionResult} */ (results.resolutions[i]);
		if (r.zone !== c.zone) return [`resolution result ${i} is for ${r.zone}, not ${c.zone}`];
		return r.maxMinutes === c.maxMinutes ? [] : [`${c.zone} resolution cap: expected ${c.maxMinutes} min, got ${r.maxMinutes ?? r.error}`];
	});
	return [...a, ...b];
}

/**
 * Schedules every generated plan in a booted engine (bootNodeEngine) and
 * compares. `revision` numbers the requests. `total` counts cases plus
 * resolution cases; each failing one gives one diff.
 * @param {{ schedule(request: unknown): Record<string, any> }} engine
 * @param {TzEdgeTable} [table]
 * @param {number} [revision]
 * @returns {{ total: number, plans: number, diffs: string[] }}
 */
export function checkTzEdgesWasm(engine, table = loadTzEdgeTable(), revision = 1_000_000) {
	/** @type {string[]} */
	const diffs = [];
	/** @param {string} text */
	const run = (text) => engine.schedule({ files: { 'plan.tjp': text }, entry: 'plan.tjp', revision: revision++, options: {} });
	/** @param {unknown} error */
	const failure = (error) => `engine failed: ${error instanceof Error ? error.message : String(error)}`;
	const edgePlans = tzEdgePlans(table.cases);
	for (const plan of edgePlans) {
		try {
			diffs.push(...tzEdgeDiffs(plan, run(plan.text)));
		} catch (error) {
			diffs.push(...plan.cases.map((c) => `${c.zone} ${c.local} (${c.kind}): ${failure(error)}`));
		}
	}
	const resPlans = tzResolutionPlans(table.resolutions);
	for (const plan of resPlans) {
		try {
			diffs.push(...tzResolutionDiffs(plan, run(plan.text)));
		} catch (error) {
			diffs.push(`${plan.zone} resolution cap: ${failure(error)}`);
		}
	}
	return { total: table.cases.length + table.resolutions.length, plans: edgePlans.length + resPlans.length, diffs };
}

/**
 * Runs tz-edge-cases.rb with native Ruby (bundle exec, TZ=UTC) and compares.
 * @param {TzEdgeTable} [table]
 * @returns {{ total: number, ruby: string, diffs: string[] }}
 */
export function checkTzEdgesNative(table = loadTzEdgeTable()) {
	const env = {
		...process.env,
		TZ: 'UTC',
		LANG: 'C.UTF-8',
		LC_ALL: 'C.UTF-8',
		BUNDLE_GEMFILE: path.join(GOLDEN, 'Gemfile'),
	};
	const input = {
		cases: table.cases.map((c) => ({ zone: c.zone, local: c.local })),
		resolutions: table.resolutions.map((r) => ({ zone: r.zone })),
	};
	const r = spawnSync('bundle', ['exec', 'ruby', '-EUTF-8', '-I', path.join(REPO, 'engine', 'tj', 'lib'), '-e',
		'print RUBY_VERSION, "\\n"; load ARGV[0]', path.join(GOLDEN, 'tz-edge-cases.rb')], {
		cwd: REPO, env, encoding: 'utf8', input: JSON.stringify(input), maxBuffer: 1 << 26,
	});
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`tz-edge-cases.rb exited ${r.status ?? r.signal}:\n${r.stderr}`);
	const [ruby = '', json = ''] = r.stdout.split('\n');
	return { total: table.cases.length + table.resolutions.length, ruby, diffs: nativeTzEdgeDiffs(table, JSON.parse(json)) };
}

async function main() {
	const { values } = parseArgs({
		options: {
			native: { type: 'boolean', default: false },
			engine: { type: 'string', default: 'public/engine' },
		},
	});
	const table = loadTzEdgeTable();
	let res;
	if (values.native) {
		res = checkTzEdgesNative(table);
		console.log(`native Ruby ${res.ruby}`);
	} else {
		const { bootNodeEngine } = await import('./run-wasm.mjs');
		const engine = await bootNodeEngine({ dir: values.engine });
		res = checkTzEdgesWasm(engine, table);
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
