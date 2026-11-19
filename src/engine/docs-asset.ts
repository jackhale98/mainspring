// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The keyword docs asset (ADR-0017): the engine build writes the `syntax()` result of the bundle it
 * has just built as `tj-docs.<hash12>.json.gz` beside it, and names it in manifest.json as the
 * optional `docs` (engine/build-bundle.mjs). The app reads the full keyword docs from there, so it
 * never asks the worker for them and the worker runs only schedules.
 *
 * `load()` reads the manifest (in the HTTP cache since the worker booted), fetches the asset at low
 * priority, gunzips it with DecompressionStream when it still is gzip, and checks its size against
 * the manifest. Docs for another TaskJuggler than the committed table's (`engineDocsMatch`) are not
 * used: nothing is mixed. Unlike the worker's assets, which run as code (manifest.ts `openAsset`),
 * the bytes get no SHA-256 check: the name carries the content hash, so a cached manifest can only
 * name the docs of its own build; and the check costs about 100 bytes gzip, where the Text-first
 * load had under 800 left below its cap (scripts/js-sizes.mjs). A garbled file fails gunzip, the
 * size check or JSON.parse.
 *
 * One fetch at a time: a `load()` while one runs gets the same promise. It never rejects. It gives
 * null when the docs are unavailable (offline before the first fetch, a 404, a manifest from before
 * the asset, a failed check), and a later call tries again. Once loaded, the docs stay.
 *
 * Only the editor bundle imports this module (lib/state/editor-bundle.ts), so it loads with the
 * editor chunk and a Visual-only session never fetches the docs.
 */
import { engineDocsMatch } from '../lib/tjp/syntax/docs';
import { docsRef, gunzip, isGzip } from './manifest';
import type { SyntaxDocs } from './protocol';

export type EngineDocsState =
	| { status: 'idle' | 'loading' }
	| { status: 'loaded'; docs: SyntaxDocs }
	| { status: 'unavailable' };

export interface EngineDocsLoader {
	readonly state: EngineDocsState;
	/** One fetch at a time; never rejects. Null when unavailable; a later call retries. */
	load(): Promise<SyntaxDocs | null>;
}

export interface EngineDocsLoaderOptions {
	/** The engine's manifest.json (`engineDirUrl` + "manifest.json"); the asset's path is relative to it. */
	manifestUrl: URL;
	/** Default: the global `fetch`. */
	fetch?: typeof fetch;
}

export function createEngineDocsLoader(opts: EngineDocsLoaderOptions): EngineDocsLoader {
	const fetchFn: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
	let state: EngineDocsState = { status: 'idle' };
	let running: Promise<SyntaxDocs | null> | null = null;

	async function get(url: URL, init?: RequestInit): Promise<Response> {
		const response = await fetchFn(url, init);
		if (!response.ok) throw new Error(String(response.status));
		return response;
	}

	async function attempt(): Promise<SyntaxDocs | null> {
		try {
			const ref = docsRef(await (await get(opts.manifestUrl)).json());
			if (!ref) return null;
			const fetched = await get(new URL(ref.path, opts.manifestUrl), { priority: 'low' });
			let raw: Uint8Array = new Uint8Array(await fetched.arrayBuffer());
			if (isGzip(raw)) raw = await gunzip(raw);
			if (raw.length !== ref.rawBytes) return null;
			const docs = (await new Response(raw as Uint8Array<ArrayBuffer>).json()) as SyntaxDocs;
			return Array.isArray(docs.keywords) && engineDocsMatch(docs) ? docs : null;
		} catch {
			return null;
		}
	}

	return {
		get state() {
			return state;
		},
		load() {
			if (state.status === 'loaded') return Promise.resolve(state.docs);
			if (!running) {
				state = { status: 'loading' };
				running = attempt().then((docs) => {
					running = null;
					state = docs ? { status: 'loaded', docs } : { status: 'unavailable' };
					return docs;
				});
			}
			return running;
		},
	};
}
