// SPDX-License-Identifier: GPL-2.0-or-later
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOutputs, withDocs } from '../../engine/bundle-lib.mjs';
import { TJ_VERSION } from '../lib/tjp/syntax/keywords';
import { createEngineDocsLoader, DOCS_RETRY_AFTER_MS, DOCS_TIMEOUT_MS } from './docs-asset';
import type { SyntaxDocs } from './protocol';

const MANIFEST_URL = new URL('https://example.test/base/engine/manifest.json');

const DOCS: SyntaxDocs = {
	tjVersion: TJ_VERSION,
	keywords: [
		{
			keyword: 'effort',
			contexts: ['task'],
			syntax: 'effort <value>',
			summary: 'The effort.',
			doc: 'The full effort doc.',
			scenarioSpecific: true,
			seeAlso: ['duration'],
		},
	],
};

/** What engine/build-bundle.mjs publishes, with `docs` as the keyword docs (or none). */
function published(docs: SyntaxDocs | null): Map<string, Uint8Array> {
	const built = buildOutputs({
		rubyWasm: new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
		bundleFiles: { '/tj/lib/a.rb': 'puts 1\n' },
		tjCommit: '3b36c799605621103d7d065c69e3f958a3dd6698',
		rubyWasmVersion: '2.10.1',
		wasiShimVersion: '0.4.2',
		notices: 'notices\n',
	});
	return docs ? withDocs(built, JSON.stringify(docs)).files : built.files;
}

interface Call {
	path: string;
	init: RequestInit | undefined;
}

/**
 * A fetch that serves `files` under the engine directory and records each call. `fail` gives a
 * status (or 'network' for a rejection) for a file name instead of its bytes. `gate` holds every
 * response until it resolves.
 */
function server(files: Map<string, Uint8Array>) {
	const calls: Call[] = [];
	const fail = new Map<string, number | 'network'>();
	let gate: Promise<void> = Promise.resolve();
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const name = url.pathname.replace('/base/engine/', '');
		calls.push({ path: url.pathname, init });
		await gate;
		const failure = fail.get(name);
		if (failure === 'network') throw new TypeError('Failed to fetch');
		const bytes = files.get(name);
		if (failure !== undefined || !bytes) return new Response('missing', { status: failure ?? 404 });
		return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200 });
	}) as typeof globalThis.fetch;
	return {
		fetch,
		calls,
		fail,
		hold(): () => void {
			let open = (): void => undefined;
			gate = new Promise((resolve) => (open = resolve));
			return open;
		},
	};
}

const docsPath = (files: Map<string, Uint8Array>): string =>
	[...files.keys()].find((n) => n.startsWith('tj-docs.')) ?? '';

describe('createEngineDocsLoader', () => {
	it('makes one fetch for two loads while one runs, at the path the manifest names', async () => {
		const files = published(DOCS);
		const s = server(files);
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: s.fetch });
		expect(loader.state).toEqual({ status: 'idle' });
		const open = s.hold();
		const a = loader.load();
		const b = loader.load();
		expect(b).toBe(a);
		expect(loader.state).toEqual({ status: 'loading' });
		open();
		expect(await a).toEqual(DOCS);
		expect(await b).toEqual(DOCS);
		expect(loader.state).toEqual({ status: 'loaded', docs: DOCS });
		const path = docsPath(files);
		expect(path).toMatch(/^tj-docs\.[0-9a-f]{12}\.json\.gz$/);
		expect(s.calls.map((c) => c.path)).toEqual([
			'/base/engine/manifest.json',
			`/base/engine/${path}`,
		]);
		expect(s.calls[1]?.init?.priority).toBe('low');
		// Loaded docs stay: no more fetches.
		expect(await loader.load()).toBe(await a);
		expect(s.calls).toHaveLength(2);
	});

	it('gives unavailable for docs of another TaskJuggler version', async () => {
		const s = server(published({ ...DOCS, tjVersion: '3.7.0' }));
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: s.fetch });
		expect(await loader.load()).toBeNull();
		expect(loader.state).toMatchObject({ status: 'unavailable' });
	});

	it.each([
		['a 404', 404 as const],
		['a network error', 'network' as const],
	])('gives unavailable on %s, and the next load fetches again', async (_, failure) => {
		const files = published(DOCS);
		const s = server(files);
		const path = docsPath(files);
		s.fail.set(path, failure);
		const loader = createEngineDocsLoader({
			manifestUrl: MANIFEST_URL,
			fetch: s.fetch,
			retryAfterMs: 0,
		});
		expect(await loader.load()).toBeNull();
		expect(loader.state).toMatchObject({ status: 'unavailable' });
		s.fail.delete(path);
		expect(await loader.load()).toEqual(DOCS);
		expect(loader.state.status).toBe('loaded');
		expect(s.calls.filter((c) => c.path.endsWith(path))).toHaveLength(2);
	});

	it('gives unavailable when the manifest itself cannot be read, and retries', async () => {
		const s = server(published(DOCS));
		s.fail.set('manifest.json', 'network');
		const loader = createEngineDocsLoader({
			manifestUrl: MANIFEST_URL,
			fetch: s.fetch,
			retryAfterMs: 0,
		});
		expect(await loader.load()).toBeNull();
		s.fail.delete('manifest.json');
		expect(await loader.load()).toEqual(DOCS);
	});

	it('gives unavailable with no asset fetch for a manifest without docs', async () => {
		const s = server(published(null));
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: s.fetch });
		expect(await loader.load()).toBeNull();
		expect(loader.state).toMatchObject({ status: 'unavailable' });
		expect(s.calls.map((c) => c.path)).toEqual(['/base/engine/manifest.json']);
	});

	it('refuses an asset whose size is not the one the manifest names', async () => {
		const files = published(DOCS);
		const path = docsPath(files);
		const other = published({ ...DOCS, keywords: [] });
		files.set(path, other.get(docsPath(other)) ?? new Uint8Array());
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: server(files).fetch });
		expect(await loader.load()).toBeNull();
		expect(loader.state).toMatchObject({ status: 'unavailable' });
	});

	it('takes an asset that the server already decompressed (Content-Encoding: gzip)', async () => {
		const files = published(DOCS);
		const path = docsPath(files);
		files.set(path, new Uint8Array(gunzipSync(files.get(path) ?? new Uint8Array())));
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: server(files).fetch });
		expect(await loader.load()).toEqual(DOCS);
	});
});

describe('createEngineDocsLoader after a failure (T26 review)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('rests after a failed load: loads within the cooldown fetch nothing, one after it fetches', async () => {
		vi.useFakeTimers();
		const files = published(DOCS);
		const s = server(files);
		const path = docsPath(files);
		s.fail.set(path, 404);
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: s.fetch });
		expect(await loader.load()).toBeNull();
		const state = loader.state;
		expect(state).toEqual({ status: 'unavailable', retryAt: Date.now() + DOCS_RETRY_AFTER_MS });
		const fetches = s.calls.length;
		for (let i = 0; i < 10; i++) expect(await loader.load()).toBeNull();
		await vi.advanceTimersByTimeAsync(DOCS_RETRY_AFTER_MS - 1);
		expect(await loader.load()).toBeNull();
		expect(s.calls).toHaveLength(fetches);
		expect(loader.state).toBe(state);

		await vi.advanceTimersByTimeAsync(1);
		s.fail.delete(path);
		expect(await loader.load()).toEqual(DOCS);
		expect(s.calls.length).toBeGreaterThan(fetches);
		expect(loader.state.status).toBe('loaded');
	});

	it('ends a stalled load as unavailable after the timeout, with its fetch aborted', async () => {
		vi.useFakeTimers();
		const signals: AbortSignal[] = [];
		// Never answers, and ignores the abort: the loader must end the load on its own.
		const stalled = ((_: RequestInfo | URL, init?: RequestInit) => {
			if (init?.signal) signals.push(init.signal);
			return new Promise<Response>(() => undefined);
		}) as typeof globalThis.fetch;
		const loader = createEngineDocsLoader({ manifestUrl: MANIFEST_URL, fetch: stalled });
		let result: unknown = 'pending';
		void loader.load().then((r) => (result = r));
		await vi.advanceTimersByTimeAsync(DOCS_TIMEOUT_MS - 1);
		expect(result).toBe('pending');
		expect(loader.state).toEqual({ status: 'loading' });
		await vi.advanceTimersByTimeAsync(1);
		expect(result).toBeNull();
		expect(loader.state).toMatchObject({ status: 'unavailable' });
		expect(signals).toHaveLength(1);
		expect(signals[0]?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});
