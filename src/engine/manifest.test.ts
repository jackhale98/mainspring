// SPDX-License-Identifier: GPL-2.0-or-later
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildOutputs } from '../../engine/bundle-lib.mjs';
import { EngineFailure } from './failure';
import {
	gunzip,
	isGzip,
	loadAsset,
	loadManifest,
	openAsset,
	parseManifest,
	sha256Hex,
	type AssetRef,
} from './manifest';

const enc = new TextEncoder();
const COMMIT = '3b36c799605621103d7d065c69e3f958a3dd6698';

/** What engine/build-bundle.mjs would publish for a tiny wasm and bundle. */
function published() {
	return buildOutputs({
		rubyWasm: new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
		bundleFiles: { '/tj/lib/a.rb': 'puts 1\n', '/tj/bridge/wasm/b.rb': '# b\n' },
		tjCommit: COMMIT,
		rubyWasmVersion: '2.10.1',
		wasiShimVersion: '0.4.2',
		notices: 'notices\n',
	});
}

function loaderFor(files: Map<string, Uint8Array>) {
	return async (path: string): Promise<Uint8Array> => {
		const bytes = files.get(path);
		if (!bytes) throw new Error(`404 ${path}`);
		return bytes;
	};
}

async function rejection(promise: Promise<unknown>): Promise<EngineFailure> {
	const error: unknown = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(EngineFailure);
	return error as EngineFailure;
}

describe('sha256Hex', () => {
	it('matches the FIPS 180-2 test vector', async () => {
		expect(await sha256Hex(enc.encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});
});

describe('gzip handling', () => {
	it('recognises the gzip magic only', () => {
		expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
		expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
		expect(isGzip(enc.encode('{"a":1}'))).toBe(false);
	});

	it('gunzips with DecompressionStream', async () => {
		const text = 'TaskJuggler '.repeat(100);
		const out = await gunzip(new Uint8Array(gzipSync(enc.encode(text))));
		expect(new TextDecoder().decode(out)).toBe(text);
	});
});

describe('parseManifest', () => {
	it('accepts what the build script writes', () => {
		const { files, manifest } = published();
		const json: unknown = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
		expect(parseManifest(json)).toEqual(manifest);
	});

	it.each([
		['not an object', null],
		['schema 2', { ...published().manifest, schemaVersion: 2 }],
		['another TaskJuggler', { ...published().manifest, tj: { version: '3.8.3', commit: COMMIT } }],
		['a short commit', { ...published().manifest, tj: { version: '3.8.4', commit: '3b36c79' } }],
		['an asset path with a directory', { ...published().manifest, bundle: { ...published().manifest.bundle, path: '../x.gz' } }],
		['a bad sha256', { ...published().manifest, bundle: { ...published().manifest.bundle, sha256: 'abc' } }],
		['a negative size', { ...published().manifest, bundle: { ...published().manifest.bundle, rawBytes: -1 } }],
		['another shim package', { ...published().manifest, wasiShim: { package: 'x', version: '1' } }],
	])('rejects %s as a boot error', (_, json) => {
		expect(() => parseManifest(json)).toThrow(EngineFailure);
		try {
			parseManifest(json);
		} catch (error) {
			expect((error as EngineFailure).kind).toBe('boot');
		}
	});
});

describe('openAsset', () => {
	it('gunzips and verifies a published asset', async () => {
		const { files, manifest } = published();
		const raw = await openAsset(manifest.bundle, files.get(manifest.bundle.path) ?? new Uint8Array());
		const doc = JSON.parse(new TextDecoder().decode(raw)) as { files: Record<string, string> };
		expect(Object.keys(doc.files)).toEqual(['/tj/bridge/wasm/b.rb', '/tj/lib/a.rb']);
		expect(raw.length).toBe(manifest.bundle.rawBytes);
	});

	it('accepts bytes that arrive already decompressed (Content-Encoding: gzip)', async () => {
		const { files, manifest } = published();
		const gz = files.get(manifest.bundle.path) ?? new Uint8Array();
		const raw = await gunzip(gz);
		await expect(openAsset(manifest.bundle, raw)).resolves.toEqual(raw);
	});

	it('rejects a wrong size, a wrong hash and broken gzip', async () => {
		const ref: AssetRef = {
			path: 'x.json.gz',
			sha256: await sha256Hex(enc.encode('abc')),
			bytes: 3,
			rawBytes: 3,
		};
		expect((await rejection(openAsset(ref, enc.encode('abcd')))).detail).toContain('4 bytes');
		const wrong = await rejection(openAsset(ref, enc.encode('abd')));
		expect(wrong.kind).toBe('boot');
		expect(wrong.message).toContain('integrity');
		const broken = await rejection(openAsset(ref, new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2])));
		expect(broken.message).toContain('gzip');
	});
});

describe('loadManifest and loadAsset', () => {
	it('load through the loader and verify', async () => {
		const { files, manifest } = published();
		const load = loaderFor(files);
		expect(await loadManifest(load)).toEqual(manifest);
		const raw = await loadAsset(load, manifest.bundle);
		expect(await sha256Hex(raw)).toBe(manifest.bundle.sha256);
	});

	it('turn download and parse failures into boot errors', async () => {
		const empty = loaderFor(new Map());
		const missing = await rejection(loadManifest(empty));
		expect(missing.kind).toBe('boot');
		expect(missing.detail).toContain('404 manifest.json');
		const garbled = loaderFor(new Map([['manifest.json', enc.encode('{')]]));
		expect((await rejection(loadManifest(garbled))).kind).toBe('boot');
		const asset = await rejection(loadAsset(empty, published().manifest.bundle));
		expect(asset.message).toContain('could not be downloaded');
	});
});
