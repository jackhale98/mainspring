// SPDX-License-Identifier: GPL-2.0-or-later
//
// bundle-lib.mjs - pure helpers for engine/build-bundle.mjs (docs/phases/phase-0.md, 3.5):
// deterministic gzip, content hashes, the bundle and manifest formats, and the --check
// comparison. No file system access, so tests/engine/bundle-lib.test.ts can test them directly.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const BUNDLE_SCHEMA = 1;
export const MANIFEST_SCHEMA = 1;
export const TJ_VERSION = '3.8.4';
export const RUBY_WASM_PACKAGE = '@ruby/3.4-wasm-wasi';
export const WASI_SHIM_PACKAGE = '@bjorn3/browser_wasi_shim';
/** Fixed gzip OS byte (255, "unknown"), so the platform's zlib build cannot change the bytes. */
export const GZIP_OS_UNKNOWN = 255;
/** Hashed engine assets, current or stale: `<name>.<hash12>.<ext>.gz`. */
export const HASHED_ASSET_RE = /^(?:ruby|tj-bundle)\.[0-9a-f]{12}\.(?:wasm|json)\.gz$/;

/**
 * @param {Uint8Array} bytes
 * @returns {string} lower-case hex SHA-256
 */
export function sha256Hex(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Gzip at level 9 with mtime 0, no file name and a fixed OS byte. The deflate stream itself
 * depends on the zlib in Node, which `.nvmrc` pins; asset names hash the uncompressed bytes, so
 * a different zlib can change the `.gz` bytes but never a name.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function gzipDeterministic(bytes) {
	const gz = new Uint8Array(gzipSync(bytes, { level: 9 }));
	// RFC 1952 header: ID1 ID2 CM FLG MTIME(4) XFL OS. Node writes no FNAME and mtime 0, but
	// set both explicitly so the format does not rest on zlib defaults.
	if (gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 8) throw new Error('zlib wrote no gzip header');
	gz[3] = 0;
	gz.fill(0, 4, 8);
	gz[9] = GZIP_OS_UNKNOWN;
	return gz;
}

/**
 * Decode UTF-8 strictly: invalid sequences throw, a leading BOM is kept.
 * @param {Uint8Array} bytes
 * @param {string} name for the error message
 * @returns {string}
 */
export function decodeUtf8Strict(bytes, name) {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		throw new Error(`${name} is not valid UTF-8`);
	}
}

/**
 * A copy of `v` with object keys sorted recursively (JS default sort).
 * @param {unknown} v
 * @returns {unknown}
 */
export function sortKeys(v) {
	if (Array.isArray(v)) return v.map(sortKeys);
	if (v && typeof v === 'object') {
		const o = /** @type {Record<string, unknown>} */ (v);
		return Object.fromEntries(
			Object.keys(o)
				.sort()
				.map((k) => [k, sortKeys(o[k])]),
		);
	}
	return v;
}

/**
 * Sorted keys, 2-space indent, trailing newline.
 * @param {unknown} v
 */
export function canonicalJson(v) {
	return `${JSON.stringify(sortKeys(v), null, 2)}\n`;
}

/**
 * The bundle document `{ "files": { "/tj/...": text }, "schemaVersion": 1 }`, keys sorted, as
 * compact JSON. Every key must be an absolute POSIX path under /tj/.
 * @param {Record<string, string>} files
 * @returns {string}
 */
export function bundleJson(files) {
	for (const p of Object.keys(files)) {
		const segments = p.split('/').slice(1);
		const ok =
			p.startsWith('/tj/') &&
			!p.includes('\\') &&
			segments.every((s) => s !== '' && s !== '.' && s !== '..');
		if (!ok) throw new Error(`bad bundle path: ${JSON.stringify(p)}`);
		if (typeof files[p] !== 'string') throw new Error(`bundle file ${p} is not text`);
	}
	return JSON.stringify(sortKeys({ files, schemaVersion: BUNDLE_SCHEMA }));
}

/**
 * One hashed asset: `<stem>.<hash12>.<ext>.gz` plus its AssetRef.
 * @param {string} stem e.g. "ruby" or "tj-bundle"
 * @param {string} ext e.g. "wasm" or "json"
 * @param {Uint8Array} raw uncompressed bytes
 */
export function hashedAsset(stem, ext, raw) {
	const sha256 = sha256Hex(raw);
	const gz = gzipDeterministic(raw);
	const path = `${stem}.${sha256.slice(0, 12)}.${ext}.gz`;
	return { path, gz, ref: { path, sha256, bytes: gz.length, rawBytes: raw.length } };
}

/**
 * Everything the build writes to `--out`, as name -> bytes, plus the manifest object.
 * @param {{
 *   rubyWasm: Uint8Array,
 *   bundleFiles: Record<string, string>,
 *   tjCommit: string,
 *   rubyWasmVersion: string,
 *   wasiShimVersion: string,
 *   notices: string,
 * }} input
 */
export function buildOutputs(input) {
	if (!/^[0-9a-f]{40}$/.test(input.tjCommit)) throw new Error(`bad TaskJuggler commit ${input.tjCommit}`);
	const enc = new TextEncoder();
	const ruby = hashedAsset('ruby', 'wasm', input.rubyWasm);
	const bundle = hashedAsset('tj-bundle', 'json', enc.encode(bundleJson(input.bundleFiles)));
	const manifest = {
		schemaVersion: MANIFEST_SCHEMA,
		ruby: ruby.ref,
		bundle: bundle.ref,
		tj: { version: TJ_VERSION, commit: input.tjCommit },
		rubyWasm: { package: RUBY_WASM_PACKAGE, version: input.rubyWasmVersion },
		wasiShim: { package: WASI_SHIM_PACKAGE, version: input.wasiShimVersion },
	};
	/** @type {Map<string, Uint8Array>} */
	const files = new Map([
		[ruby.path, ruby.gz],
		[bundle.path, bundle.gz],
		['manifest.json', enc.encode(canonicalJson(manifest))],
		['NOTICES.txt', enc.encode(input.notices)],
	]);
	return { files, manifest };
}

/**
 * Differences between the outputs a build would write and what `--out` holds. `present` maps
 * the names in `--out` that the build owns (its outputs and any hashed engine asset) to bytes.
 * @param {Map<string, Uint8Array>} expected
 * @param {Map<string, Uint8Array>} present
 * @returns {string[]}
 */
export function compareOutputs(expected, present) {
	const problems = [];
	for (const [name, bytes] of expected) {
		const got = present.get(name);
		if (!got) problems.push(`${name}: missing`);
		else if (Buffer.compare(Buffer.from(got), Buffer.from(bytes)) !== 0) {
			problems.push(`${name}: differs (${got.length} bytes, expected ${bytes.length})`);
		}
	}
	for (const name of present.keys()) {
		if (!expected.has(name)) problems.push(`${name}: stale, not produced by this build`);
	}
	return problems.sort();
}
