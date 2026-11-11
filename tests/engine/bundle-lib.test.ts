// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests for engine/bundle-lib.mjs, the pure helpers of engine/build-bundle.mjs (spec 3.5).
// src/engine/manifest.test.ts checks that the worker accepts what these helpers publish.
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	GZIP_OS_UNKNOWN,
	HASHED_ASSET_RE,
	buildOutputs,
	bundleJson,
	canonicalJson,
	compareOutputs,
	decodeUtf8Strict,
	gzipDeterministic,
	hashedAsset,
	sha256Hex,
} from '../../engine/bundle-lib.mjs';

const enc = new TextEncoder();
const BOM = String.fromCharCode(0xfeff);

function outputs(notices = 'n\n') {
	return buildOutputs({
		rubyWasm: new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
		bundleFiles: { '/tj/lib/b.rb': 'b', '/tj/lib/a.rb': 'a' },
		tjCommit: '3b36c799605621103d7d065c69e3f958a3dd6698',
		rubyWasmVersion: '2.10.1',
		wasiShimVersion: '0.4.2',
		notices,
	});
}

describe('gzipDeterministic', () => {
	it('writes level-9 gzip with mtime 0, no name and a fixed OS byte', () => {
		const raw = enc.encode('TaskJuggler '.repeat(1000));
		const gz = gzipDeterministic(raw);
		expect([...gz.slice(0, 4)]).toEqual([0x1f, 0x8b, 8, 0]);
		expect([...gz.slice(4, 8)]).toEqual([0, 0, 0, 0]);
		expect(gz[8]).toBe(2); // XFL: maximum compression
		expect(gz[9]).toBe(GZIP_OS_UNKNOWN);
		expect(new Uint8Array(gunzipSync(gz))).toEqual(raw);
		expect(gzipDeterministic(raw)).toEqual(gz);
	});
});

describe('hashedAsset', () => {
	it('names the file after the hash of the uncompressed bytes', () => {
		const raw = enc.encode('abc');
		const asset = hashedAsset('tj-bundle', 'json', raw);
		const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
		expect(asset.path).toBe(`tj-bundle.${sha.slice(0, 12)}.json.gz`);
		expect(asset.ref).toEqual({ path: asset.path, sha256: sha, bytes: asset.gz.length, rawBytes: 3 });
		expect(sha256Hex(raw)).toBe(sha);
		expect(HASHED_ASSET_RE.test(asset.path)).toBe(true);
	});
});

describe('bundleJson', () => {
	it('sorts keys and writes compact JSON', () => {
		expect(bundleJson({ '/tj/z.rb': 'z', '/tj/a/b.rb': 'b' })).toBe(
			'{"files":{"/tj/a/b.rb":"b","/tj/z.rb":"z"},"schemaVersion":1}',
		);
	});

	it.each(['/lib/a.rb', '/tj/../a.rb', '/tj//a.rb', '/tj/a\\b.rb', 'tj/a.rb'])(
		'rejects the path %j',
		(p) => {
			expect(() => bundleJson({ [p]: 'x' })).toThrow(/^bad \S+ path:/);
		},
	);
});

describe('decodeUtf8Strict', () => {
	it('decodes UTF-8 and keeps a BOM', () => {
		expect(decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xc3, 0xa9]), 'f')).toBe(BOM + 'Aé');
	});

	it('fails on invalid UTF-8, naming the file', () => {
		expect(() => decodeUtf8Strict(new Uint8Array([0x41, 0xff]), 'engine/x.rb')).toThrow(
			'engine/x.rb is not valid UTF-8',
		);
	});
});

describe('buildOutputs', () => {
	it('is deterministic and writes a canonical manifest', () => {
		const a = outputs();
		const b = outputs();
		expect([...a.files.keys()].sort()).toEqual([...b.files.keys()].sort());
		for (const [name, bytes] of a.files) expect(b.files.get(name)).toEqual(bytes);
		const manifest = new TextDecoder().decode(a.files.get('manifest.json'));
		expect(manifest).toBe(canonicalJson(a.manifest));
		expect(manifest.endsWith('}\n')).toBe(true);
		expect(a.manifest.tj).toEqual({ version: '3.8.4', commit: '3b36c799605621103d7d065c69e3f958a3dd6698' });
		const refs = Object.values(a.manifest).filter((v) => typeof v === 'object' && 'sha256' in v);
		expect(refs).toHaveLength(2);
		for (const ref of refs) expect(a.files.has((ref as { path: string }).path)).toBe(true);
	});

	it('rejects a commit that is not a full SHA-1', () => {
		expect(() =>
			buildOutputs({
				rubyWasm: new Uint8Array(),
				bundleFiles: {},
				tjCommit: '3b36c79',
				rubyWasmVersion: '2.10.1',
				wasiShimVersion: '0.4.2',
				notices: '',
			}),
		).toThrow(/commit/);
	});
});

describe('compareOutputs', () => {
	it('reports missing, different and stale files', () => {
		const expected = outputs().files;
		expect(compareOutputs(expected, new Map(expected))).toEqual([]);
		const present = new Map(expected);
		present.delete('manifest.json');
		present.set('NOTICES.txt', enc.encode('changed'));
		present.set('tj-bundle.0123456789ab.json.gz', new Uint8Array([1]));
		expect(compareOutputs(expected, present)).toEqual([
			'NOTICES.txt: differs (7 bytes, expected 2)',
			'manifest.json: missing',
			'tj-bundle.0123456789ab.json.gz: stale, not produced by this build',
		]);
	});
});
