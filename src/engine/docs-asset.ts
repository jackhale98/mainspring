// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The keyword docs asset (ADR-0017): the engine build writes the `syntax()` result of the bundle it
 * has just built as `tj-docs.<hash12>.json.gz` beside it, and names it in manifest.json as the
 * optional `docs` (engine/build-bundle.mjs). The app reads the full keyword docs from there, so it
 * never asks the worker for them and the worker runs only schedules.
 *
 * `load()` reads the manifest (revalidated, as the worker does, so it names this deploy's docs),
 * fetches the asset at low priority, gunzips it with DecompressionStream when it still is gzip, and
 * checks its size against the manifest. Docs for another TaskJuggler than the committed table's
 * (`engineDocsMatch`) are not used: nothing is mixed. Unlike the worker's assets, which run as code
 * (manifest.ts `openAsset`), the bytes get no SHA-256 check: the name carries the content hash, so
 * a manifest can only name the docs of its own build, and a garbled or truncated file fails gzip's
 * CRC and length, the size check or JSON.parse (the T26 review probed each case: the table is
 * used); a same-size rewrite would pass, but so would the manifest and the app's own code, which
 * come from the same origin. The check would cost about 100 bytes gzip on the Text-first load,
 * which is near its cap (scripts/js-sizes.mjs).
 *
 * One fetch at a time: a `load()` while one runs gets the same promise. It never rejects. It gives
 * null when the docs are unavailable (offline before the first fetch, a 404, a manifest from before
 * the asset, a failed check, or a load that took longer than `timeoutMs`, which is aborted), and a
 * later call tries again, but not before `retryAfterMs`: within that cooldown `load()` gives null
 * at once with no fetch, and the state says when the next try may start (`retryAt`). So hover and
 * completion, which ask on every look, make one attempt per cooldown, not one per look (T26
 * review). Once loaded, the docs stay.
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
	/** `retryAt`: the `Date.now()` from which `load()` tries again; until then it fetches nothing. */
	| { status: 'unavailable'; retryAt: number };

export interface EngineDocsLoader {
	readonly state: EngineDocsState;
	/** One fetch at a time; never rejects. Null when unavailable; a later call retries. */
	load(): Promise<SyntaxDocs | null>;
}

export interface EngineDocsLoaderOptions {
	/** The engine's manifest.json (`engineDirUrl` + "manifest.json"); the asset's path is relative. */
	manifestUrl: URL;
	/** Default: the global `fetch`. */
	fetch?: typeof fetch;
	/** How long after a failed load `load()` waits before it fetches again (default 5 s). */
	retryAfterMs?: number;
	/** How long one load may take before it is aborted and counts as failed (default 20 s). */
	timeoutMs?: number;
}

/** The default cooldown after a failed load. */
export const DOCS_RETRY_AFTER_MS = 5_000;
/** The default time one load may take: a stalled fetch must not keep the docs loading for good. */
export const DOCS_TIMEOUT_MS = 20_000;

export function createEngineDocsLoader(opts: EngineDocsLoaderOptions): EngineDocsLoader {
	const fetchFn: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
	let state: EngineDocsState = { status: 'idle' };
	let running: Promise<SyntaxDocs | null> | null = null;

	const retryAfterMs = opts.retryAfterMs ?? DOCS_RETRY_AFTER_MS;
	const timeoutMs = opts.timeoutMs ?? DOCS_TIMEOUT_MS;

	async function get(url: URL, init: RequestInit): Promise<Response> {
		const response = await fetchFn(url, init);
		if (!response.ok) throw new Error(String(response.status));
		return response;
	}

	async function attempt(signal: AbortSignal): Promise<SyntaxDocs | null> {
		try {
			const manifest = await get(opts.manifestUrl, { cache: 'no-cache', signal });
			const ref = docsRef(await manifest.json());
			if (!ref) return null;
			const fetched = await get(new URL(ref.path, opts.manifestUrl), { priority: 'low', signal });
			let raw: Uint8Array = new Uint8Array(await fetched.arrayBuffer());
			if (isGzip(raw)) raw = await gunzip(raw);
			if (raw.length !== ref.rawBytes) return null;
			const docs = (await new Response(raw as Uint8Array<ArrayBuffer>).json()) as SyntaxDocs;
			return Array.isArray(docs.keywords) && engineDocsMatch(docs) ? docs : null;
		} catch {
			return null;
		}
	}

	/**
	 * One attempt, ended at `timeoutMs`: its fetches are aborted, and it gives null even if a step
	 * ignores the signal. (A timer of our own rather than `AbortSignal.timeout`, so tests drive it
	 * with fake timers.)
	 */
	function bounded(): Promise<SyntaxDocs | null> {
		const ctl = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<null>((resolve) => {
			timer = setTimeout(() => {
				ctl.abort();
				resolve(null);
			}, timeoutMs);
		});
		return Promise.race([attempt(ctl.signal), timedOut]).finally(() => clearTimeout(timer));
	}

	return {
		get state() {
			return state;
		},
		load() {
			if (state.status === 'loaded') return Promise.resolve(state.docs);
			if (state.status === 'unavailable' && Date.now() < state.retryAt) return Promise.resolve(null);
			if (!running) {
				state = { status: 'loading' };
				running = bounded().then((docs) => {
					running = null;
					state = docs
						? { status: 'loaded', docs }
						: { status: 'unavailable', retryAt: Date.now() + retryAfterMs };
					return docs;
				});
			}
			return running;
		},
	};
}
