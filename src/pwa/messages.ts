// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The page and the service worker (phase-4.md 6.6, 9.1, 9.2, 9.4; ADR-0020 #4 to #6, ADR-0012
 * #6). Types, the cache names and message guards only (T3). T11 implements both sides: `sw.ts`
 * (the service worker, built by `scripts/astro-sw.mjs`) and `src/lib/app/pwa.svelte.ts` (the
 * page's `PwaState`). This module imports nothing, so both builds can include it.
 *
 * ## Contract
 *
 * - **Messages.** The page posts `ToServiceWorker` with `postMessage`: `skip-waiting` to
 *   `registration.waiting` (the update's Reload: the page then reloads on `controllerchange`),
 *   `status` to `navigator.serviceWorker.controller`. The service worker answers `status` to the
 *   asking client, and posts `status` to every client whenever `offlineReady` or `engine` changes.
 *   Each side ignores data its guard (`isToServiceWorker`, `isFromServiceWorker`) refuses.
 * - **Caches** (9.1). `appCacheName(build)` holds the pages, every `_astro` chunk, fonts, icons,
 *   the web manifest and the engine `manifest.json` of one build; `ENGINE_CACHE` holds the engine
 *   assets by content-hashed name. On activate, every cache that starts with `APP_CACHE_PREFIX`
 *   and is not this build's is deleted; engine entries the new manifest does not name are deleted
 *   after the new ones verify. These names are kept across releases: a build must recognise the
 *   caches older builds made.
 * - **Never in the way.** The service worker answers same-origin GET only, never `api.github.com`
 *   or the sign-in relay; `version.json` is network-only; navigations get the cached shell with
 *   the search ignored. The worker's SHA-256 check of engine files stays the guard (manifest.ts).
 * - **Offline.** Messages work offline; `status` is how the page learns it can work offline.
 *
 * Contract notes (T3):
 * - `engine` holds the 12-hex-digit hashes of the cached file names (`ruby.<hash12>.wasm.gz`),
 *   null until every engine asset the current manifest names is cached and verified; `docs` is
 *   null when the manifest names no docs asset (ADR-0017). 6.6 says "the cached hashes".
 * - `offlineReady` is true once both caches are complete (9.1 "Ready to work offline").
 * - `build` is the service worker's build id (ADR-0012 #1), so the page can tell that an older or
 *   newer worker controls it.
 * - The cache names and `INITIAL_PWA_STATE` are added: 9.1 names the caches, and the page needs a
 *   state before the first `status`.
 */

/** From the page to the service worker (6.6). */
export type ToServiceWorker = { readonly type: 'skip-waiting' } | { readonly type: 'status' };

/** The cached engine assets' hashes (contract notes). */
export interface EngineCacheState {
	readonly ruby: string;
	readonly bundle: string;
	readonly docs: string | null;
}

/** From the service worker to the page (6.6). */
export type FromServiceWorker = {
	readonly type: 'status';
	readonly build: string;
	readonly offlineReady: boolean;
	readonly engine: EngineCacheState | null;
};

/** What the page knows of the PWA (6.6), as `app.pwa` (state/app-storage.ts). */
export interface PwaState {
	/** Both caches are complete: Settings show "Ready to work offline". */
	offlineReady: boolean;
	/** A new service worker waits: "New version · Reload" (ADR-0012 #6). */
	updateWaiting: boolean;
	/** Chromium's `beforeinstallprompt` was kept: "Install app" is offered (9.2). */
	installable: boolean;
	/** Running as an installed app (`display-mode: standalone`, or after `appinstalled`). */
	installed: boolean;
	/** `navigator.storage.persisted()`; null when unknown or not supported (9.4). */
	persisted: boolean | null;
}

/** Before the first `status` and without a service worker. */
export const INITIAL_PWA_STATE: Readonly<PwaState> = Object.freeze({
	offlineReady: false,
	updateWaiting: false,
	installable: false,
	installed: false,
	persisted: null,
});

/** Every app cache starts with this; the build id follows. */
export const APP_CACHE_PREFIX = 'mainspring-app-';
/** The engine assets, by content-hashed name, shared by every build. */
export const ENGINE_CACHE = 'mainspring-engine';

/** The app cache of one build (ADR-0012 build id, e.g. `3f2a91bc-202611131402`). */
export function appCacheName(build: string): string {
	return APP_CACHE_PREFIX + build;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isToServiceWorker(v: unknown): v is ToServiceWorker {
	return isRecord(v) && (v['type'] === 'skip-waiting' || v['type'] === 'status');
}

function isEngineCacheState(v: unknown): v is EngineCacheState {
	return (
		isRecord(v) &&
		typeof v['ruby'] === 'string' &&
		typeof v['bundle'] === 'string' &&
		(v['docs'] === null || typeof v['docs'] === 'string')
	);
}

export function isFromServiceWorker(v: unknown): v is FromServiceWorker {
	return (
		isRecord(v) &&
		v['type'] === 'status' &&
		typeof v['build'] === 'string' &&
		typeof v['offlineReady'] === 'boolean' &&
		(v['engine'] === null || isEngineCacheState(v['engine']))
	);
}
