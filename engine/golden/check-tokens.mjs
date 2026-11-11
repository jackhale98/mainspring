#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// check-tokens.mjs - check that the token oracle (engine/bridge/tokens.rb, phase-1 T19) gives the
// same token streams on native Ruby as in the browser engine. Developer-only, like
// record-native.mjs: it needs native Ruby, which CI never runs.
//
//   node engine/golden/check-tokens.mjs [--engine public/engine] [--json <file>] [<path>]...
//
// Each <path> is a .tjp/.tji file or a directory searched for them. The default corpus is every
// such file under tests/fixtures/tjp, engine/golden/plans and TaskJuggler's own
// engine/tj/test/TestSuite/Syntax/{Correct,Errors}, plus every file the golden manifest's plans
// list (the upstream examples). Each file is decoded as the browser decodes it (TextDecoder,
// ignoreBOM: true), then:
//  1. native Ruby runs engine/bridge/native/tokens.rb over all the texts in one process, under
//     `bundle exec` with engine/golden/Gemfile, TZ=UTC and LANG=C.UTF-8, on unmodified
//     TaskJuggler from engine/tj/lib;
//  2. the built engine (npm run build:engine first) runs NodeEngine.tokens on the same texts;
//  3. both results must be identical as canonical JSON, and checkTokenStream
//     (src/engine/token-oracle.ts) must find no problem in either;
//  4. in files with TaskJuggler's test marks (`# MARK: error <line> <id>`, Syntax/Errors), a
//     scanner error id must be the oracle's scanError with that line, and any other id (a parser
//     error, or a macro or environment error the oracle cannot raise) means no scanError.
// Prints one line per file and a summary. Exits 1 on any difference or problem.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkTokenStream } from '../../src/engine/token-oracle.ts';
import { canonicalJson, diffPaths } from './lib.mjs';
import { bootNodeEngine, loadCorpus } from './run-wasm.mjs';

const GOLDEN = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(GOLDEN, '..', '..');
const DEFAULT_DIRS = [
	'tests/fixtures/tjp',
	'engine/golden/plans',
	'engine/tj/test/TestSuite/Syntax/Correct',
	'engine/tj/test/TestSuite/Syntax/Errors',
];
const SOURCE_RE = /\.tj[pi]$/;
// Errors raised while scanning, without macro expansion (ProjectFileScanner, TextParser/Scanner).
const SCANNER_ERRORS = new Set(['runaway_token', 'no_token_match', 'unexpected_eof', 'junk_after_cut',
	'junk_at_eom', 'time_error', 'time_bad_hour', 'time_bad_minute', 'time_bad_time', 'scan_encoding_error']);
const MARK_RE = /^# MARK: error (\d+) (\w+)/m;

/**
 * Problems with a scanError against the file's `# MARK: error` line, if it has one.
 * @param {string} text
 * @param {{ id: string, line: number | null } | null} scanError
 */
function markProblems(text, scanError) {
	const m = MARK_RE.exec(text);
	if (!m) return [];
	const [line, id] = [Number(m[1]), m[2]];
	const got = scanError ? `${scanError.id} at line ${scanError.line}` : 'no scanError';
	if (SCANNER_ERRORS.has(id)) return scanError?.id === id && scanError.line === line ? [] : [`MARK ${id} at line ${line}, oracle ${got}`];
	return scanError ? [`MARK ${id} is not a scanner error, oracle ${got}`] : [];
}

/** Repository-relative POSIX paths of the .tjp/.tji files under `rel` (or `rel` itself). */
function sources(rel) {
	const full = path.resolve(REPO, rel);
	const st = fs.statSync(full);
	if (st.isFile()) return [path.relative(REPO, full).split(path.sep).join('/')];
	/** @type {string[]} */
	const out = [];
	for (const ent of fs.readdirSync(full, { withFileTypes: true })) {
		const child = path.join(rel, ent.name);
		if (ent.isDirectory()) out.push(...sources(child));
		else if (ent.isFile() && SOURCE_RE.test(ent.name)) out.push(...sources(child));
	}
	return out;
}

/** @param {string[]} paths */
function corpus(paths) {
	/** @type {Set<string>} */
	const files = new Set();
	if (paths.length) {
		for (const p of paths) for (const f of sources(p)) files.add(f);
	} else {
		for (const d of DEFAULT_DIRS) for (const f of sources(d)) files.add(f);
		for (const { plan, golden } of loadCorpus()) {
			for (const f of golden.files) files.add(path.posix.join(plan.root, f));
		}
	}
	return [...files].sort();
}

/** @param {Record<string, string>} texts */
function runNative(texts) {
	const r = spawnSync('bundle', ['exec', 'ruby', '-W0', '-EUTF-8', '-I', 'engine/tj/lib',
		'engine/bridge/native/tokens.rb'], {
		cwd: REPO,
		env: { ...process.env, TZ: 'UTC', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', BUNDLE_GEMFILE: path.join(GOLDEN, 'Gemfile') },
		input: JSON.stringify({ files: texts }),
		encoding: 'utf8',
		maxBuffer: 1 << 30,
	});
	if (r.error) throw r.error;
	if (r.status !== 0) {
		throw new Error(`native tokens.rb exited ${r.status ?? r.signal}; gems missing? ` +
			`BUNDLE_GEMFILE=engine/golden/Gemfile bundle install\n${r.stderr}`);
	}
	return /** @type {{ ruby: string, results: Record<string, any> }} */ (JSON.parse(r.stdout));
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { engine: { type: 'string', default: 'public/engine' }, json: { type: 'string' } },
	});
	const files = corpus(positionals);
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	/** @type {Record<string, string>} */
	const texts = {};
	for (const f of files) texts[f] = decoder.decode(fs.readFileSync(path.join(REPO, f)));

	let t = performance.now();
	const native = runNative(texts);
	const nativeMs = performance.now() - t;

	const engine = await bootNodeEngine({ dir: values.engine });
	t = performance.now();
	/** @type {Record<string, import('../../src/engine/token-oracle.ts').TokenOracleResult>} */
	const wasm = {};
	for (const f of files) wasm[f] = engine.tokens(texts[f]);
	const wasmMs = performance.now() - t;

	console.log(`native Ruby ${native.ruby}; engine Ruby ${engine.rubyVersion}, bundle ${engine.versions.bundleHash.slice(0, 12)}`);
	if (!native.ruby.startsWith('3.4.')) {
		console.log('note: native Ruby is not 3.4.x; the oracle should still agree, but goldens need 3.4');
	}
	console.log(['file', 'items', 'tokens', 'macros', 'scanError', 'identical', 'problems'].join('\t'));
	let identical = 0;
	let consistent = 0;
	let items = 0;
	/** @type {Record<string, unknown>} */
	const report = {};
	for (const f of files) {
		const a = native.results[f];
		const b = wasm[f];
		const same = canonicalJson(a) === canonicalJson(b);
		const problems = [...checkTokenStream(texts[f], a).map((p) => `native: ${p}`),
			...(same ? [] : checkTokenStream(texts[f], b).map((p) => `wasm: ${p}`)),
			...markProblems(texts[f], b.scanError)];
		const tokens = b.tokens.filter((i) => i.kind === 'token');
		const macros = tokens.reduce((n, i) => n + (i.kind === 'token' ? i.macros.length : 0), 0);
		if (same) identical++;
		if (!problems.length) consistent++;
		items += b.tokens.length;
		console.log([f, b.tokens.length, tokens.length, macros, b.scanError ? `${b.scanError.id}@${b.scanError.line}` : '-',
			same ? 'yes' : 'NO', problems.length].join('\t'));
		if (!same) for (const d of diffPaths(JSON.parse(canonicalJson(a)), JSON.parse(canonicalJson(b))).slice(0, 5)) console.log(`    ${d}`);
		for (const p of problems.slice(0, 5)) console.log(`    ${p}`);
		report[f] = { items: b.tokens.length, tokens: tokens.length, macros, scanError: b.scanError, identical: same, problems };
	}
	console.log(`${files.length} files, ${items} items: ${identical} identical native and wasm, ${consistent} consistent; ` +
		`native ${Math.round(nativeMs)} ms (one process), wasm ${Math.round(wasmMs)} ms`);
	if (values.json) {
		fs.writeFileSync(values.json, `${JSON.stringify({ nativeRuby: native.ruby, engineRuby: engine.rubyVersion, files: report }, null, 2)}\n`);
	}
	if (identical !== files.length || consistent !== files.length) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? `${error.message}${error.detail ? `\n${error.detail}` : ''}` : error);
	process.exit(1);
});
