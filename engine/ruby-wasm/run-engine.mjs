#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// run-engine.mjs - boot an engine on a given ruby.wasm in Node, check golden parity and report
// what the Ruby VM loaded (phase-4 T13: is OpenSSL reachable, and does a new binary keep parity?).
//
//   node engine/ruby-wasm/run-engine.mjs [--engine public/engine] [--ruby <file.wasm[.gz]>]
//                                        [--fs <dir>] [--only <id>]... [--repeat <n>] [--json <file>]
//                                        [--no-parity] [--expect-no-openssl]
//
// --engine: a built engine directory (npm run build:engine). Its manifest, TaskJuggler bundle and
//   keyword docs are used as they are; its ruby.wasm too, unless --ruby names another binary.
// --ruby: the binary to boot instead (a --no-vfs or --vfs output of build.sh). Not hash-checked.
// --fs: a directory whose top-level folders are preopened read-only at /<name> (build.sh --no-vfs
//   writes fs/usr and fs/bundle: what wasi-vfs packs into ruby+stdlib.wasm). In-memory files of
//   @bjorn3/browser_wasi_shim then stand in for wasi-vfs, so boot timings differ from a packed
//   binary's; scheduling does not touch them.
//
// The boot and the schedule call are src/engine/runtime.ts's (manifest and asset checks, the same
// WASI file system, the bridge, the reply parsing and timings; no progress beats), repeated here
// because the runtime cannot mount extra directories. Checks, in this order, in one VM:
//   1. syntax(): the keyword docs equal the engine's tj-docs asset (canonical JSON);
//   2. tokens(): every corpus file's token stream passes checkTokenStream;
//   3. every golden plan (engine/golden/manifest.json) equals its golden, as run-wasm.mjs checks;
//   4. the time-zone edge-case table;
//   5. one more fedora-res run with `retain: true` (the fast path's copy);
//   6. $LOADED_FEATURES: nothing whose path names openssl, digest or securerandom, and OpenSSL and
//      Digest undefined. Only then, `require "openssl"` is tried and the outcome reported (the
//      stock binary loads it; an OpenSSL-free one raises LoadError).
// Exits 1 if any check fails. --no-parity skips 1 to 5 (the features after a bare boot). --repeat n
// runs each plan of 3 n times (each run compared) and keeps the fastest run's timings.
// --expect-no-openssl: also fail unless `require "openssl"` raises LoadError for openssl itself
// (the OpenSSL-free build; CI passes it). Without it the outcome is only reported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Directory, File, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim';
import { RubyVM } from '@ruby/wasm-wasi';
import { decodeText, gunzip, isGzip, loadAsset, loadManifest } from '../../src/engine/manifest.ts';
import {
	bridgeRequest,
	fastTimings,
	installTimeZoneHost,
	parseBridgeReply,
	parseBundle,
} from '../../src/engine/runtime.ts';
import { BUNDLE_ROOT, clearDirectory, createEngineFs } from '../../src/engine/wasi-fs.ts';
import { checkTokenStream } from '../../src/engine/token-oracle.ts';
import { canonicalJson } from '../golden/lib.mjs';
import { compareWithGolden, loadCorpus, planRequest, syntaxDocsProblems } from '../golden/run-wasm.mjs';
import { checkTzEdgesWasm } from '../golden/tz-edges.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const round1 = (/** @type {number} */ ms) => Math.round(ms * 10) / 10;
const FORBIDDEN_FEATURE = /openssl|digest|securerandom/i;

/** A read-only directory tree of the files under `dir` (bytes as they are on disk). */
function treeFromDisk(dir) {
	/** @type {Map<string, import('@bjorn3/browser_wasi_shim').Inode>} */
	const out = new Map();
	for (const name of fs.readdirSync(dir).sort()) {
		const full = path.join(dir, name);
		const st = fs.statSync(full);
		if (st.isDirectory()) out.set(name, new Directory(treeFromDisk(full)));
		else if (st.isFile()) out.set(name, new File(new Uint8Array(fs.readFileSync(full)), { readonly: true }));
	}
	return out;
}

/**
 * Boots the engine in `engineDir`, optionally on another ruby.wasm and with extra preopens.
 * @param {{ engineDir: string, rubyFile?: string, fsDir?: string, log: (s: string, l: string) => void }} o
 */
async function boot(o) {
	// The extra trees are read from disk before the clock starts: a packed binary has them inside.
	const extra = o.fsDir ? fs.readdirSync(o.fsDir).filter((n) => fs.statSync(path.join(o.fsDir, n)).isDirectory()).sort() : [];
	const trees = extra.map((name) => /** @type {const} */ ([name, treeFromDisk(path.join(o.fsDir ?? '', name))]));
	const t0 = performance.now();
	const load = async (/** @type {string} */ name) => new Uint8Array(await fs.promises.readFile(path.join(o.engineDir, name)));
	const manifest = await loadManifest(load);
	const t1 = performance.now();
	let rubyBytes;
	if (o.rubyFile) {
		const raw = new Uint8Array(await fs.promises.readFile(o.rubyFile));
		rubyBytes = isGzip(raw) ? await gunzip(raw) : raw;
	} else rubyBytes = await loadAsset(load, manifest.ruby);
	const bundleBytes = await loadAsset(load, manifest.bundle);
	const t2 = performance.now();
	const module = await WebAssembly.compile(rubyBytes);
	const t3 = performance.now();
	const files = parseBundle(decodeText(bundleBytes));
	const efs = createEngineFs(files, o.log);
	for (const [name, tree] of trees) efs.fds.push(new PreopenDirectory(`/${name}`, tree));
	const wasi = new WASI([], ['LANG=C.UTF-8', 'HOME=/workspace'], efs.fds, { debug: false });
	const { vm, instance } = await RubyVM.instantiateModule({ module, wasip1: wasi });
	installTimeZoneHost();
	const t4 = performance.now();
	const lib = ['lib', 'stubs', 'bridge'].map((d) => JSON.stringify(`${BUNDLE_ROOT}/${d}`));
	vm.eval(`$LOAD_PATH.unshift(${lib.join(', ')}); require "tj_bridge"`);
	const versions = JSON.parse(vm.eval('TJBridge.versions').toString());
	const t5 = performance.now();
	const bridge = vm.eval('TJBridge');
	const memory = instance.exports['memory'];
	return {
		vm,
		manifest,
		versions,
		rubyBytes: rubyBytes.length,
		preopens: extra.map((n) => `/${n}`),
		bootTimings: {
			manifestMs: round1(t1 - t0), assetsMs: round1(t2 - t1), compileMs: round1(t3 - t2),
			instantiateMs: round1(t4 - t3), requireMs: round1(t5 - t4), totalMs: round1(t5 - t0),
		},
		/** runtime.ts WasmEngine#schedule, without progress beats. */
		schedule(/** @type {any} */ request) {
			const s0 = performance.now();
			const json = JSON.stringify(bridgeRequest(request));
			const s1 = performance.now();
			clearDirectory(efs.workspace);
			const reply = parseBridgeReply(bridge.call('schedule', vm.wrap(json)).toString());
			const t = /** @type {Record<string, any>} */ (reply['timings'] ?? {});
			const ms = (/** @type {string} */ k) => (typeof t[k] === 'number' ? t[k] : 0);
			reply['revision'] = request.revision;
			reply['timings'] = {
				writeFsMs: round1(s1 - s0 + ms('writeFsMs')), parseMs: ms('parseMs'), scheduleMs: ms('scheduleMs'),
				serializeMs: ms('serializeMs'), totalMs: round1(performance.now() - s0), ...fastTimings(t),
				...(memory instanceof WebAssembly.Memory ? { memoryBytes: memory.buffer.byteLength } : {}),
			};
			return reply;
		},
		syntax: () => parseBridgeReply(bridge.call('syntax').toString()),
		tokens: (/** @type {string} */ text) => parseBridgeReply(bridge.call('tokens', vm.wrap(text)).toString()),
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			engine: { type: 'string', default: 'public/engine' },
			ruby: { type: 'string' },
			fs: { type: 'string' },
			only: { type: 'string', multiple: true, default: [] },
			json: { type: 'string' },
			'no-parity': { type: 'boolean', default: false },
			'expect-no-openssl': { type: 'boolean', default: false },
			repeat: { type: 'string', default: '1' },
		},
	});
	const engineDir = path.resolve(REPO, values.engine);
	/** @type {string[]} */
	const stderr = [];
	const engine = await boot({
		engineDir,
		rubyFile: values.ruby && path.resolve(values.ruby),
		fsDir: values.fs && path.resolve(values.fs),
		log: (s, l) => {
			stderr.push(`[${s}] ${l}`);
			console.error(`[${s}] ${l}`);
		},
	});
	console.log(`ruby: ${values.ruby ?? engine.manifest.ruby.path} (${engine.rubyBytes} bytes)` +
		`${engine.preopens.length ? `, preopens ${engine.preopens.join(' ')}` : ''}; Ruby ${engine.versions.ruby}, TaskJuggler ${engine.versions.tj}`);
	console.log(`boot: ${JSON.stringify(engine.bootTimings)}`);
	/** @type {Record<string, any>} */
	const report = { ruby: values.ruby ?? engine.manifest.ruby.path, rubyBytes: engine.rubyBytes, preopens: engine.preopens,
		rubyVersion: engine.versions.ruby, boot: engine.bootTimings };
	let failures = 0;

	if (!values['no-parity']) {
		// 1. Keyword docs.
		const t = performance.now();
		const docs = engine.syntax();
		const docsMs = round1(performance.now() - t);
		const problems = syntaxDocsProblems(docs, engine.versions.tj);
		let docsMatch = null;
		const rawManifest = JSON.parse(fs.readFileSync(path.join(engineDir, 'manifest.json'), 'utf8'));
		if (rawManifest.docs) {
			const ref = rawManifest.docs;
			const asset = await loadAsset(async (n) => new Uint8Array(fs.readFileSync(path.join(engineDir, n))), ref);
			docsMatch = canonicalJson(JSON.parse(decodeText(asset))) === canonicalJson(docs);
		}
		const docsOk = problems.length === 0 && docsMatch !== false;
		if (!docsOk) failures++;
		console.log(`syntax: ${docs.keywords.length} keywords in ${docsMs} ms; equal to the engine's docs asset: ${docsMatch}` +
			`${problems.length ? `; problems: ${problems.join('; ')}` : ''}`);
		report.syntax = { keywords: docs.keywords.length, ms: docsMs, equalToAsset: docsMatch, ok: docsOk };

		// 2. Tokens, 3. plans.
		const corpus = loadCorpus(values.only);
		const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
		const seen = new Set();
		let badTokens = 0;
		for (const { plan, golden } of corpus) {
			for (const f of golden.files) {
				const file = path.join(plan.root, f);
				if (seen.has(file)) continue;
				seen.add(file);
				const text = decoder.decode(fs.readFileSync(path.join(REPO, file)));
				if (checkTokenStream(text, /** @type {any} */ (engine.tokens(text))).length) badTokens++;
			}
		}
		if (badTokens) failures++;
		console.log(`tokens: ${seen.size} files, ${seen.size - badTokens} consistent`);
		report.tokens = { files: seen.size, failed: badTokens };

		let revision = 0;
		/** @type {Record<string, unknown>} */
		const plans = {};
		let planFailures = 0;
		const repeat = Math.max(1, Number(values.repeat) || 1);
		for (const { plan, golden, native } of corpus) {
			/** @type {string[]} */
			let diffs = [];
			/** @type {Record<string, number> | null} */
			let timings = null;
			// --repeat n: n runs, every one compared; the fastest run's timings are kept.
			for (let i = 0; i < repeat; i++) {
				try {
					const result = engine.schedule(planRequest(plan, golden, ++revision));
					const t = /** @type {Record<string, number>} */ (result['timings']);
					if (!timings || t.totalMs < timings.totalMs) timings = t;
					const d = compareWithGolden(golden, result);
					if (d.length) diffs = d;
				} catch (error) {
					diffs = [`failed: ${error instanceof Error ? `${error.message} ${/** @type {any} */ (error).detail ?? ''}` : error}`];
					break;
				}
			}
			if (diffs.length) {
				planFailures++;
				console.log(`plan ${plan.id}: DIFFERS`);
				for (const d of diffs.slice(0, 10)) console.log(`    ${d}`);
			} else if (corpus.length <= 3 || plan.id === 'fedora-res') {
				console.log(`plan ${plan.id}: matches; best of ${repeat}: ${JSON.stringify(timings)}`);
			}
			plans[plan.id] = { match: diffs.length === 0, timings, nativeTotalMs: native?.totalMs ?? null };
		}
		if (planFailures) failures++;
		console.log(`${corpus.length - planFailures}/${corpus.length} plans match their golden`);
		report.plans = plans;

		// 4. Time zones.
		if (values.only.length === 0) {
			const tz = checkTzEdgesWasm(engine, undefined, ++revision);
			for (const d of tz.diffs) console.log(`    ${d}`);
			console.log(`${tz.total - tz.diffs.length}/${tz.total} tz edge cases match tz-edge-cases.json`);
			report.tzEdges = { total: tz.total, failed: tz.diffs.length };
			if (tz.diffs.length) failures++;
		}

		// 5. The fast path's retained copy.
		const fedora = loadCorpus(['fedora-res'])[0];
		const retained = engine.schedule({ ...planRequest(fedora.plan, fedora.golden, ++revision), retain: true });
		const retainDiffs = compareWithGolden(fedora.golden, retained);
		const rt = /** @type {any} */ (retained['timings']);
		console.log(`fedora-res with retain: ${retainDiffs.length ? 'DIFFERS' : 'matches'}; retainMs ${rt.retainMs ?? '-'}` +
			`${rt.retainError ? `, retainError ${rt.retainError}` : ''}`);
		if (retainDiffs.length) failures++;
		report.retain = { match: retainDiffs.length === 0, timings: rt };
	}

	// 6. What the VM loaded.
	const state = JSON.parse(engine.vm.eval(`require "json"; JSON.generate({
		"features" => $LOADED_FEATURES,
		"OpenSSL" => defined?(::OpenSSL) ? true : false,
		"Digest" => defined?(::Digest) ? true : false,
		"SecureRandom" => defined?(::SecureRandom) ? true : false,
	})`).toString());
	const names = state.features.map((/** @type {string} */ f) => f.replace(/^\/usr\/local\/lib\/ruby\/[^/]+\//, '<stdlib>/'));
	const forbidden = names.filter((/** @type {string} */ f) => FORBIDDEN_FEATURE.test(f));
	const native = names.filter((/** @type {string} */ f) => f.endsWith('.so')).map((/** @type {string} */ f) => path.basename(f, '.so'));
	console.log(`loaded features: ${names.length} (${native.length} native: ${native.join(' ')})`);
	console.log(`OpenSSL, Digest, SecureRandom defined: ${state.OpenSSL}, ${state.Digest}, ${state.SecureRandom}; ` +
		`features naming openssl/digest/securerandom: ${forbidden.length ? forbidden.join(' ') : 'none'}`);
	if (forbidden.length || state.OpenSSL || state.Digest || state.SecureRandom) failures++;
	const probe = engine.vm.eval(`begin
		require "openssl"
		"loaded: " + OpenSSL::OPENSSL_LIBRARY_VERSION
	rescue LoadError => e
		"LoadError: " + e.message
	end`).toString();
	console.log(`require "openssl" (after the checks): ${probe}`);
	// LoadError for openssl itself, not for something openssl.rb requires in turn.
	const opensslAbsent = probe === 'LoadError: cannot load such file -- openssl';
	if (values['expect-no-openssl']) {
		console.log(`--expect-no-openssl: ${opensslAbsent ? 'ok, openssl cannot be loaded' : `FAIL, expected "LoadError: cannot load such file -- openssl"`}`);
		if (!opensslAbsent) failures++;
	}
	report.features = { count: names.length, native, forbidden, defined: { OpenSSL: state.OpenSSL, Digest: state.Digest, SecureRandom: state.SecureRandom },
		list: names, requireOpenssl: probe, opensslAbsent };
	report.stderr = stderr;
	if (values.json) fs.writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
	console.log(failures ? `FAILED (${failures} check(s))` : 'all checks passed');
	if (failures) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? `${error.stack}${error.detail ? `\n${error.detail}` : ''}` : error);
	process.exit(1);
});
