#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// run-wasm.mjs - boot the built browser engine (public/engine) in Node and schedule golden
// plans with it, comparing each result with expected/<id>.json the way spec 6.3 does: string
// equality of canonical JSON, `revision` and `timings` excluded.
//
//   node engine/golden/run-wasm.mjs [--engine public/engine] [--only <id>]... [--repeat <n>]
//                                   [--syntax] [--tokens] [--json <file>]
//
// It uses the real worker runtime (src/engine/runtime.ts, loaded through Node's type
// stripping) with a file-system loader instead of fetch, so it runs the same manifest and hash
// checks, WASI file system, bridge and serializer as the browser. All plans run through one
// long-lived engine, in manifest order. --repeat runs each plan n times and reports the fastest
// run; --syntax builds the syntax docs first, to show it leaves no state behind. --tokens runs the
// token oracle (phase-1 T19) over every file of the selected plans first and checks each stream
// with checkTokenStream; that too must leave no state behind. Without --only it then checks the
// time-zone edge-case table (tz-edges.mjs) in the same engine. Exits 1 if any plan differs from
// its golden, any token stream fails its check or any edge case differs from the table. Build
// the engine first: npm run build:engine.
//
// Exports bootNodeEngine (a NodeEngine, with the token oracle), loadCorpus, planRequest and
// compareWithGolden for other Node tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bootEngineForNode } from '../../src/engine/runtime.ts';
import { checkTokenStream } from '../../src/engine/token-oracle.ts';
import { canonicalJson, diffPaths } from './lib.mjs';
import { checkTzEdgesWasm } from './tz-edges.mjs';

const GOLDEN = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(GOLDEN, '..', '..');

/**
 * Boots the engine from a directory holding manifest.json and the hashed assets.
 * @param {{ dir?: string, log?: (stream: 'stdout' | 'stderr', line: string) => void }} [opts]
 * @returns {Promise<import('../../src/engine/runtime.ts').NodeEngine>}
 */
export async function bootNodeEngine(opts = {}) {
	const dir = path.resolve(REPO, opts.dir ?? 'public/engine');
	if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
		throw new Error(`${dir}/manifest.json not found; run npm run build:engine first`);
	}
	/** @param {string} name */
	const load = async (name) => new Uint8Array(await fs.promises.readFile(path.join(dir, name)));
	return bootEngineForNode({ load, log: opts.log ?? ((stream, line) => console.error(`[${stream}] ${line}`)) });
}

/**
 * The manifest plans with their goldens and native timings.
 * @param {string[]} [only] ids to keep (all when empty)
 */
export function loadCorpus(only = []) {
	const plans = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8'));
	const native = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'native-timings.json'), 'utf8')).plans;
	const unknown = only.filter((id) => !plans.some((/** @type {{id: string}} */ p) => p.id === id));
	if (unknown.length) throw new Error(`unknown plan id(s): ${unknown.join(', ')}`);
	return plans
		.filter((/** @type {{id: string}} */ p) => only.length === 0 || only.includes(p.id))
		.map((/** @type {{id: string, root: string}} */ plan) => ({
			plan,
			golden: JSON.parse(fs.readFileSync(path.join(GOLDEN, 'expected', `${plan.id}.json`), 'utf8')),
			native: native[plan.id] ?? null,
		}));
}

/**
 * The ScheduleRequest for a plan: exactly the golden's files, decoded as the browser decodes
 * them (UTF-8, invalid bytes to U+FFFD, a leading BOM kept for the bridge to drop).
 * @param {{ root: string }} plan
 * @param {{ entry: string, files: string[], options: { now: string | null } }} golden
 * @param {number} revision
 */
export function planRequest(plan, golden, revision) {
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	/** @type {Record<string, string>} */
	const files = {};
	for (const f of golden.files) files[f] = decoder.decode(fs.readFileSync(path.join(REPO, plan.root, f)));
	const options = golden.options.now ? { now: golden.options.now } : {};
	return { files, entry: golden.entry, revision, options };
}

/**
 * Differences between a ScheduleResult and the golden's result (empty when they match).
 * @param {{ result: unknown }} golden
 * @param {Record<string, unknown>} result
 */
export function compareWithGolden(golden, result) {
	const { revision: _r, timings: _t, ...rest } = result;
	if (canonicalJson(rest) === canonicalJson(golden.result)) return [];
	return diffPaths(JSON.parse(canonicalJson(golden.result)), JSON.parse(canonicalJson(rest)));
}

/**
 * Runs the token oracle over every file of the corpus and checks each stream; returns the number
 * of files that fail.
 * @param {import('../../src/engine/runtime.ts').NodeEngine} engine
 * @param {ReturnType<typeof loadCorpus>} corpus
 */
function checkTokens(engine, corpus) {
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const seen = new Set();
	let bad = 0;
	let items = 0;
	const t = performance.now();
	for (const { plan, golden } of corpus) {
		for (const f of golden.files) {
			const file = path.join(plan.root, f);
			if (seen.has(file)) continue;
			seen.add(file);
			const text = decoder.decode(fs.readFileSync(path.join(REPO, file)));
			const result = engine.tokens(text);
			const problems = checkTokenStream(text, result);
			items += result.tokens.length;
			if (result.scanError) console.log(`tokens: ${file}: scanner error ${result.scanError.id} at line ${result.scanError.line}`);
			if (problems.length) {
				bad++;
				console.log(`tokens: ${file}: ${problems.length} problem(s)`);
				for (const p of problems.slice(0, 5)) console.log(`    ${p}`);
			}
		}
	}
	console.log(`tokens: ${seen.size} files, ${items} items, ${seen.size - bad} consistent, ${fmt(performance.now() - t)} ms`);
	return bad;
}

/** @param {number | undefined} n */
const fmt = (n) => (n === undefined ? '-' : n >= 100 ? Math.round(n).toString() : n.toFixed(1));

async function main() {
	const { values } = parseArgs({
		options: {
			engine: { type: 'string', default: 'public/engine' },
			only: { type: 'string', multiple: true, default: [] },
			repeat: { type: 'string', default: '1' },
			syntax: { type: 'boolean', default: false },
			tokens: { type: 'boolean', default: false },
			json: { type: 'string' },
		},
	});
	const repeat = Math.max(1, Number(values.repeat) || 1);
	const corpus = loadCorpus(values.only);
	const engine = await bootNodeEngine({ dir: values.engine });
	const v = engine.versions;
	console.log(`engine: TaskJuggler ${v.tj} (${v.tjCommit.slice(0, 7)}), Ruby ${engine.rubyVersion}, ` +
		`ruby.wasm ${v.rubyWasm}, bundle ${v.bundleHash.slice(0, 12)}`);
	console.log(`boot: ${JSON.stringify(engine.bootTimings)}`);
	if (values.syntax) {
		const t = performance.now();
		const docs = engine.syntax();
		console.log(`syntax: ${docs.keywords.length} keywords in ${fmt(performance.now() - t)} ms`);
		const names = docs.keywords.map((/** @type {{keyword: string}} */ k) => k.keyword);
		const bad = docs.keywords.filter((/** @type {Record<string, unknown>} */ k) =>
			!k.syntax || !k.doc || !k.summary || !Array.isArray(k.contexts) || !Array.isArray(k.seeAlso));
		if (docs.tjVersion !== v.tj || names.length < 200 || new Set(names).size !== names.length ||
			names.join('\n') !== [...names].sort().join('\n') || bad.length) {
			throw new Error(`syntax docs look wrong (${bad.length} incomplete keyword(s))`);
		}
	}

	const tokenFailures = values.tokens ? checkTokens(engine, corpus) : 0;

	let revision = 0;
	let failures = 0;
	/** @type {Record<string, unknown>} */
	const report = {};
	console.log(['plan', 'tasks', 'write', 'parse', 'schedule', 'serialize', 'total', 'native', 'ratio', 'match']
		.join('\t'));
	for (const { plan, golden, native } of corpus) {
		/** @type {Record<string, number> | null} */
		let best = null;
		/** @type {string[]} */
		let diffs = [];
		for (let i = 0; i < repeat; i++) {
			/** @type {Record<string, any>} */
			let result;
			try {
				result = engine.schedule(planRequest(plan, golden, ++revision));
			} catch (error) {
				diffs = [`failed: ${error instanceof Error ? `${error.message} ${error.detail ?? ''}` : error}`];
				break;
			}
			const d = compareWithGolden(golden, result);
			if (d.length) diffs = d;
			if (!best || result.timings.totalMs < best.totalMs) best = result.timings;
		}
		const ok = diffs.length === 0;
		if (!ok) failures++;
		const nativeMs = native?.totalMs;
		const ratio = best && nativeMs ? (best.totalMs / nativeMs).toFixed(1) : '-';
		console.log([plan.id, golden.result.tasks.length, fmt(best?.writeFsMs), fmt(best?.parseMs),
			fmt(best?.scheduleMs), fmt(best?.serializeMs), fmt(best?.totalMs), fmt(nativeMs), ratio,
			ok ? 'yes' : 'NO'].join('\t'));
		for (const d of diffs.slice(0, 10)) console.log(`    ${d}`);
		report[plan.id] = { tasks: golden.result.tasks.length, match: ok, timings: best, nativeTotalMs: nativeMs ?? null };
	}
	console.log(`${corpus.length - failures}/${corpus.length} plans match their golden`);
	/** @type {{ total: number, failed: number } | null} */
	let tzEdges = null;
	if (values.only.length === 0) {
		const tz = checkTzEdgesWasm(engine, undefined, ++revision);
		for (const d of tz.diffs) console.log(`    ${d}`);
		console.log(`${tz.total - tz.diffs.length}/${tz.total} tz edge cases match tz-edge-cases.json`);
		tzEdges = { total: tz.total, failed: tz.diffs.length };
		if (tz.diffs.length) failures++;
	}
	if (values.json) {
		fs.writeFileSync(values.json, `${JSON.stringify({ boot: engine.bootTimings, plans: report, tzEdges }, null, 2)}\n`);
	}
	if (failures || tokenFailures) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? `${error.message}${error.detail ? `\n${error.detail}` : ''}` : error);
		process.exit(1);
	});
}
