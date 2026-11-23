#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// build-bundle.mjs - build the hashed engine assets (docs/phases/phase-0.md, section 3.5).
//
//   node engine/build-bundle.mjs [--out public/engine] [--check]
//                                [--ruby-wasm <file> --ruby-wasm-version <label>]
//   (npm run build:engine; npm run build runs it before astro build)
//
// Inputs: the .rb files under engine/tj/lib, engine/stubs/**, engine/bridge/** except
// engine/bridge/native/, engine/tj/COPYING (so the bundle carries TaskJuggler's license),
// dist/ruby+stdlib.wasm from @ruby/3.4-wasm-wasi (the PoC's binary, see poc/INVENTORY.md) and
// engine/tj.pin.json. Package versions come from node_modules and must match package-lock.json.
//
// Outputs in --out (relative to the current directory):
//   ruby.<hash12>.wasm.gz        the Ruby interpreter
//   tj-bundle.<hash12>.json.gz   { "files": { "/tj/...": text }, "schemaVersion": 1 }
//   tj-docs.<hash12>.json.gz     the keyword docs: the SyntaxDocs JSON that `syntax()` of the engine
//                                built from the two files above returns (ADR-0017)
//   manifest.json                EngineManifest (not hashed), with the docs as the optional `docs`
//   NOTICES.txt                  licenses of everything above and of the worker's JS libraries
// The bundle keeps the source layout the bridge's require_relative calls need:
//   /tj/lib/** (TaskJuggler), /tj/stubs/**, /tj/bridge/** with /tj/bridge/wasm/**, /tj/COPYING.
// <hash12> is the first 12 hex digits of SHA-256 over the uncompressed bytes, which is also
// what the manifest's sha256 covers (the worker verifies after gunzip). Hashed assets from
// earlier builds are removed. Any input that is not UTF-8 fails the build.
//
// To write the docs, the build boots the bundle it has just built in Node (bootNodeEngine, from the
// files in memory, before anything is written) and asks it for `syntax()`; a bundle that does not
// boot fails the build. So the docs and the bundle they describe come from one build and cannot
// drift apart.
//
// --check rebuilds in memory (the docs included) and exits 1 if --out differs (missing, different
// or stale files).
//
// --ruby-wasm (or MAINSPRING_RUBY_WASM) builds on another interpreter binary instead of the
// package's, for checking one (phase-4 T13: the OpenSSL-free build of engine/ruby-wasm/build.sh).
// The manifest then records --ruby-wasm-version (or MAINSPRING_RUBY_WASM_VERSION, default
// "<package version>+custom") as the rubyWasm version, and NOTICES.txt gains a line saying the
// binary is not the package's; the rest of NOTICES.txt still describes the package's binary, so
// such a build is for checks, not for release, until T13 updates the notices. Without either, the
// build is exactly as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
	HASHED_ASSET_RE,
	RUBY_WASM_PACKAGE,
	TJ_VERSION,
	WASI_SHIM_PACKAGE,
	buildOutputs,
	compareOutputs,
	decodeUtf8Strict,
	withDocs,
} from './bundle-lib.mjs';
import { bootNodeEngine, syntaxDocsProblems } from './golden/run-wasm.mjs';

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ENGINE, '..');
const RUBY_WASM_FILE = 'dist/ruby+stdlib.wasm';

/** Relative POSIX paths of the regular files under `dir`, sorted. */
function walk(dir, prefix = '') {
	const out = [];
	for (const ent of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
		if (ent.isDirectory()) out.push(...walk(dir, rel));
		else if (ent.isFile()) out.push(rel);
		else throw new Error(`${path.join(dir, rel)}: not a regular file or directory`);
	}
	return out.sort();
}

function readText(file) {
	return decodeUtf8Strict(fs.readFileSync(file), path.relative(REPO, file));
}

function bundleFiles() {
	/** @type {Record<string, string>} */
	const files = {};
	const add = (dir, mount, keep) => {
		for (const rel of walk(dir)) if (keep(rel)) files[`${mount}/${rel}`] = readText(path.join(dir, rel));
	};
	add(path.join(ENGINE, 'tj', 'lib'), '/tj/lib', (rel) => rel.endsWith('.rb'));
	add(path.join(ENGINE, 'stubs'), '/tj/stubs', () => true);
	add(path.join(ENGINE, 'bridge'), '/tj/bridge', (rel) => !rel.startsWith('native/'));
	files['/tj/COPYING'] = readText(path.join(ENGINE, 'tj', 'COPYING'));
	return files;
}

/** The installed version of `name`, which must be the one package-lock.json pins. */
function packageVersion(name) {
	const pkgFile = path.join(REPO, 'node_modules', name, 'package.json');
	if (!fs.existsSync(pkgFile)) throw new Error(`${name} is not installed; run npm ci`);
	const installed = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
	const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));
	const locked = lock.packages?.[`node_modules/${name}`]?.version;
	if (installed !== locked) {
		throw new Error(`${name} ${installed} is installed but package-lock.json pins ${locked}; run npm ci`);
	}
	return installed;
}

function tjCommit() {
	const pin = JSON.parse(fs.readFileSync(path.join(ENGINE, 'tj.pin.json'), 'utf8'));
	if (pin.version !== TJ_VERSION) throw new Error(`tj.pin.json version ${pin.version}, expected ${TJ_VERSION}`);
	const versionRb = fs.readFileSync(path.join(ENGINE, 'tj', 'lib', 'taskjuggler', 'version.rb'), 'utf8');
	if (!versionRb.includes(`VERSION = '${TJ_VERSION}'`)) {
		throw new Error(`engine/tj/lib/taskjuggler/version.rb does not say ${TJ_VERSION}`);
	}
	return pin.commit;
}

function notices({ commit, rubyWasmVersion, wasiShimVersion }) {
	const nm = (...p) => path.join(REPO, 'node_modules', ...p);
	const section = (title, text) => `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n\n${text.trimEnd()}\n`;
	const intro = `Mainspring engine: licenses and notices

These files make up Mainspring's TaskJuggler engine. Mainspring itself is
GPL-2.0-or-later; see its LICENSE and THIRD_PARTY_NOTICES.md.

tj-bundle.*.json.gz
  TaskJuggler ${TJ_VERSION} (commit ${commit}), Copyright (c) 2006-2014
  Chris Schlaeger and contributors, under the GNU General Public License
  version 2 only. The license text is below and inside the bundle as
  /tj/COPYING. The bundle also holds Mainspring's bridge (/tj/bridge) and
  stubs (/tj/stubs), GPL-2.0-or-later, except /tj/bridge/wasm/tj_wasm_time.rb,
  /tj/bridge/wasm/tj_wasm_jumps.rb and /tj/bridge/fast_path_procs.rb, which
  are GPL-2.0-only because they re-implement TaskJuggler code.

tj-docs.*.json.gz
  TaskJuggler's keyword documentation, as the engine in tj-bundle.*.json.gz
  gives it: TaskJuggler ${TJ_VERSION}, the same copyright and license (GNU General
  Public License version 2 only) as above.

ruby.*.wasm.gz
  CRuby 3.4 compiled to WebAssembly by ruby.wasm (${RUBY_WASM_PACKAGE}
  ${rubyWasmVersion}, file ${RUBY_WASM_FILE}). ruby.wasm is MIT licensed; the
  interpreter and the libraries linked into it are listed in its NOTICE below.

The engine worker script contains @ruby/wasm-wasi ${rubyWasmVersion} (MIT, the same
ruby.wasm project and copyright as the LICENSE below) and ${WASI_SHIM_PACKAGE}
${wasiShimVersion} (dual-licensed MIT OR Apache-2.0; Mainspring uses it under MIT).
`;
	return (
		intro +
		section('TaskJuggler: COPYING', fs.readFileSync(path.join(ENGINE, 'tj', 'COPYING'), 'utf8')) +
		section(`${RUBY_WASM_PACKAGE}: LICENSE`, fs.readFileSync(nm(RUBY_WASM_PACKAGE, 'dist', 'LICENSE'), 'utf8')) +
		section(`${RUBY_WASM_PACKAGE}: NOTICE`, fs.readFileSync(nm(RUBY_WASM_PACKAGE, 'dist', 'NOTICE'), 'utf8')) +
		section(`${WASI_SHIM_PACKAGE}: LICENSE-MIT`, fs.readFileSync(nm(WASI_SHIM_PACKAGE, 'LICENSE-MIT'), 'utf8'))
	);
}

/** The files in `out` this build owns: its own outputs and any hashed engine asset. */
function presentOutputs(out, expected) {
	/** @type {Map<string, Uint8Array>} */
	const present = new Map();
	if (!fs.existsSync(out)) return present;
	for (const name of fs.readdirSync(out)) {
		if (expected.has(name) || HASHED_ASSET_RE.test(name)) {
			present.set(name, fs.readFileSync(path.join(out, name)));
		}
	}
	return present;
}

/**
 * The SyntaxDocs JSON of the engine in `files` (built, not yet written): boots it in Node and asks
 * for `syntax()`. Throws when it does not boot or the docs look wrong.
 * @param {ReadonlyMap<string, Uint8Array>} files
 */
async function engineDocs(files) {
	/** @type {string[]} */
	const lines = [];
	const engine = await bootNodeEngine({ files, log: (stream, line) => lines.push(`[${stream}] ${line}`) });
	const docs = engine.syntax();
	const problems = syntaxDocsProblems(docs, TJ_VERSION);
	if (problems.length) {
		throw new Error(`the built engine's syntax() looks wrong: ${problems.join('; ')}\n${lines.join('\n')}`);
	}
	return JSON.stringify(docs);
}

async function main() {
	const { values } = parseArgs({
		options: {
			out: { type: 'string', default: 'public/engine' },
			check: { type: 'boolean', default: false },
			'ruby-wasm': { type: 'string' },
			'ruby-wasm-version': { type: 'string' },
		},
	});
	const customRuby = values['ruby-wasm'] ?? process.env.MAINSPRING_RUBY_WASM ?? '';
	const out = path.resolve(values.out);
	const rubyWasmVersion = packageVersion(RUBY_WASM_PACKAGE);
	const wasiShimVersion = packageVersion(WASI_SHIM_PACKAGE);
	const rubyRuntime = packageVersion('@ruby/wasm-wasi');
	if (rubyRuntime !== rubyWasmVersion) {
		throw new Error(`@ruby/wasm-wasi ${rubyRuntime} differs from ${RUBY_WASM_PACKAGE} ${rubyWasmVersion}`);
	}
	const commit = tjCommit();
	const rubyFile = customRuby ? path.resolve(customRuby) : path.join(REPO, 'node_modules', RUBY_WASM_PACKAGE, RUBY_WASM_FILE);
	const recordedVersion = customRuby
		? (values['ruby-wasm-version'] ?? process.env.MAINSPRING_RUBY_WASM_VERSION ?? `${rubyWasmVersion}+custom`)
		: rubyWasmVersion;
	if (customRuby) {
		console.log(`build-bundle: interpreter ${path.relative(process.cwd(), rubyFile)}, recorded as ${RUBY_WASM_PACKAGE} ${recordedVersion} (not for release)`);
	}
	const baseNotices = notices({ commit, rubyWasmVersion, wasiShimVersion });
	const built = buildOutputs({
		rubyWasm: fs.readFileSync(rubyFile),
		bundleFiles: bundleFiles(),
		tjCommit: commit,
		rubyWasmVersion: recordedVersion,
		wasiShimVersion,
		notices: customRuby
			? `NOTE: ruby.*.wasm.gz in this build is not the package's binary but ${path.basename(rubyFile)}, recorded\nas version ${recordedVersion}; see engine/ruby-wasm/README.md. Not for release.\n\n${baseNotices}`
			: baseNotices,
	});
	const { files, manifest } = withDocs(built, await engineDocs(built.files));

	const present = presentOutputs(out, files);
	const rel = path.relative(process.cwd(), out) || '.';
	if (values.check) {
		const problems = compareOutputs(files, present);
		if (problems.length) {
			console.error(`build-bundle --check: ${rel} differs from a fresh build:\n  ${problems.join('\n  ')}`);
			process.exit(1);
		}
		console.log(`build-bundle --check: ${rel} is up to date`);
		return;
	}
	fs.mkdirSync(out, { recursive: true });
	for (const name of present.keys()) if (!files.has(name)) fs.rmSync(path.join(out, name));
	for (const [name, bytes] of files) fs.writeFileSync(path.join(out, name), bytes);
	for (const ref of [manifest.ruby, manifest.bundle, manifest.docs]) {
		console.log(`${rel}/${ref.path}: ${ref.bytes} bytes (${ref.rawBytes} raw), sha256 ${ref.sha256}`);
	}
	console.log(`${rel}/manifest.json, ${rel}/NOTICES.txt written`);
}

main().catch((error) => {
	const detail = error instanceof Error ? `${error.message}${error.detail ? `\n${error.detail}` : ''}` : String(error);
	console.error(`build-bundle: ${detail}`);
	process.exit(1);
});
