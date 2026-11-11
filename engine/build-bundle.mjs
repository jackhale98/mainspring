#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// build-bundle.mjs - build the hashed engine assets (docs/phases/phase-0.md, section 3.5).
//
//   node engine/build-bundle.mjs [--out public/engine] [--check]
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
//   manifest.json                EngineManifest (not hashed)
//   NOTICES.txt                  licenses of everything above and of the worker's JS libraries
// The bundle keeps the source layout the bridge's require_relative calls need:
//   /tj/lib/** (TaskJuggler), /tj/stubs/**, /tj/bridge/** with /tj/bridge/wasm/**, /tj/COPYING.
// <hash12> is the first 12 hex digits of SHA-256 over the uncompressed bytes, which is also
// what the manifest's sha256 covers (the worker verifies after gunzip). Hashed assets from
// earlier builds are removed. Any input that is not UTF-8 fails the build.
//
// --check rebuilds in memory and exits 1 if --out differs (missing, different or stale files).
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
} from './bundle-lib.mjs';

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
  which is GPL-2.0-only because it re-implements TaskJuggler code.

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

function main() {
	const { values } = parseArgs({
		options: { out: { type: 'string', default: 'public/engine' }, check: { type: 'boolean', default: false } },
	});
	const out = path.resolve(values.out);
	const rubyWasmVersion = packageVersion(RUBY_WASM_PACKAGE);
	const wasiShimVersion = packageVersion(WASI_SHIM_PACKAGE);
	const rubyRuntime = packageVersion('@ruby/wasm-wasi');
	if (rubyRuntime !== rubyWasmVersion) {
		throw new Error(`@ruby/wasm-wasi ${rubyRuntime} differs from ${RUBY_WASM_PACKAGE} ${rubyWasmVersion}`);
	}
	const commit = tjCommit();
	const { files, manifest } = buildOutputs({
		rubyWasm: fs.readFileSync(path.join(REPO, 'node_modules', RUBY_WASM_PACKAGE, RUBY_WASM_FILE)),
		bundleFiles: bundleFiles(),
		tjCommit: commit,
		rubyWasmVersion,
		wasiShimVersion,
		notices: notices({ commit, rubyWasmVersion, wasiShimVersion }),
	});

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
	for (const ref of [manifest.ruby, manifest.bundle]) {
		console.log(`${rel}/${ref.path}: ${ref.bytes} bytes (${ref.rawBytes} raw), sha256 ${ref.sha256}`);
	}
	console.log(`${rel}/manifest.json, ${rel}/NOTICES.txt written`);
}

try {
	main();
} catch (error) {
	console.error(`build-bundle: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
