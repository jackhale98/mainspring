// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine asset manifest (phase-0 spec 3.5) and the checks the worker runs on every asset
 * before it uses it: gunzip when the bytes start with the gzip magic, then SHA-256 and length
 * against the manifest.
 *
 * The manifest's `sha256` and `rawBytes` describe the uncompressed bytes, the same bytes the
 * `<hash12>` in the file name is taken from (engine/build-bundle.mjs). So the check does not
 * depend on whether the server or the browser already removed the gzip layer (for example when
 * a `.gz` file is served with `Content-Encoding: gzip`).
 *
 * Runs in the worker and in Node (the golden harness, unit tests): it only needs
 * `crypto.subtle`, `DecompressionStream` and `TextDecoder`.
 */
import { EngineFailure } from './failure.ts';

export interface AssetRef {
	/** File name next to manifest.json, e.g. "ruby.4b814fc9d135.wasm.gz". */
	path: string;
	/** Lower-case hex SHA-256 of the uncompressed bytes. */
	sha256: string;
	/** Size of the file as published (gzip). */
	bytes: number;
	/** Size of the uncompressed bytes. */
	rawBytes: number;
}

export interface EngineManifest {
	schemaVersion: 1;
	ruby: AssetRef;
	bundle: AssetRef;
	tj: { version: '3.8.4'; commit: string };
	rubyWasm: { package: '@ruby/3.4-wasm-wasi'; version: string };
	wasiShim: { package: '@bjorn3/browser_wasi_shim'; version: string };
}

/** Reads one published engine file (relative to the engine directory) as bytes. */
export type AssetLoader = (path: string) => Promise<Uint8Array>;

const HEX64 = /^[0-9a-f]{64}$/;
/** A plain file name: no directories, so an asset can never point outside the engine dir. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function bootError(message: string, detail?: string): EngineFailure {
	return new EngineFailure('boot', message, detail);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
	return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function assetRef(v: unknown, what: string): AssetRef {
	if (
		!isRecord(v) ||
		typeof v['path'] !== 'string' ||
		!FILE_NAME.test(v['path']) ||
		typeof v['sha256'] !== 'string' ||
		!HEX64.test(v['sha256']) ||
		!isCount(v['bytes']) ||
		!isCount(v['rawBytes'])
	) {
		throw bootError(`The engine manifest has no valid ${what} entry.`);
	}
	return { path: v['path'], sha256: v['sha256'], bytes: v['bytes'], rawBytes: v['rawBytes'] };
}

function versioned<P extends string>(v: unknown, pkg: P, what: string): { package: P; version: string } {
	if (!isRecord(v) || v['package'] !== pkg || typeof v['version'] !== 'string' || !v['version']) {
		throw bootError(`The engine manifest has no valid ${what} entry.`);
	}
	return { package: pkg, version: v['version'] };
}

/** Validates parsed manifest JSON; throws an `EngineFailure` of kind `boot`. */
export function parseManifest(json: unknown): EngineManifest {
	if (!isRecord(json) || json['schemaVersion'] !== 1) {
		throw bootError('The engine manifest is not schema version 1.');
	}
	const tj = json['tj'];
	if (
		!isRecord(tj) ||
		tj['version'] !== '3.8.4' ||
		typeof tj['commit'] !== 'string' ||
		!/^[0-9a-f]{40}$/.test(tj['commit'])
	) {
		throw bootError('The engine manifest does not name TaskJuggler 3.8.4 and its commit.');
	}
	return {
		schemaVersion: 1,
		ruby: assetRef(json['ruby'], 'ruby'),
		bundle: assetRef(json['bundle'], 'bundle'),
		tj: { version: '3.8.4', commit: tj['commit'] },
		rubyWasm: versioned(json['rubyWasm'], '@ruby/3.4-wasm-wasi', 'rubyWasm'),
		wasiShim: versioned(json['wasiShim'], '@bjorn3/browser_wasi_shim', 'wasiShim'),
	};
}

/** UTF-8 text; a leading BOM is kept (ADR-0002, decision 13). Invalid bytes become U+FFFD. */
export function decodeText(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

export function isGzip(bytes: Uint8Array): boolean {
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The uncompressed bytes of an asset as fetched: gunzipped if they start with the gzip magic,
 * then checked against the manifest's length and SHA-256.
 */
export async function openAsset(ref: AssetRef, fetched: Uint8Array): Promise<Uint8Array> {
	let raw = fetched;
	if (isGzip(fetched)) {
		try {
			raw = await gunzip(fetched);
		} catch (error) {
			throw bootError(`The engine file ${ref.path} is not valid gzip.`, String(error));
		}
	}
	if (raw.length !== ref.rawBytes) {
		throw bootError(
			`The engine file ${ref.path} has the wrong size.`,
			`${raw.length} bytes after decompression, manifest says ${ref.rawBytes}`,
		);
	}
	const sha256 = await sha256Hex(raw);
	if (sha256 !== ref.sha256) {
		throw bootError(
			`The engine file ${ref.path} failed its integrity check.`,
			`sha256 ${sha256}, manifest says ${ref.sha256}`,
		);
	}
	return raw;
}

/** Loads and validates manifest.json through `load`. */
export async function loadManifest(load: AssetLoader): Promise<EngineManifest> {
	let json: unknown;
	try {
		json = JSON.parse(decodeText(await load('manifest.json')));
	} catch (error) {
		if (error instanceof EngineFailure) throw error;
		throw bootError('The engine manifest could not be read.', String(error));
	}
	return parseManifest(json);
}

/** Loads one asset through `load` and returns its verified, uncompressed bytes. */
export async function loadAsset(load: AssetLoader, ref: AssetRef): Promise<Uint8Array> {
	let fetched: Uint8Array;
	try {
		fetched = await load(ref.path);
	} catch (error) {
		if (error instanceof EngineFailure) throw error;
		throw bootError(`The engine file ${ref.path} could not be downloaded.`, String(error));
	}
	return openAsset(ref, fetched);
}
