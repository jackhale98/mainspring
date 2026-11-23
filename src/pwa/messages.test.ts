// SPDX-License-Identifier: GPL-2.0-or-later
// Page and service worker contract (phase-4.md 6.6, 9.1): the cache names, the initial state and
// the message guards. The service worker's own tests come with T11.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	APP_CACHE_PREFIX,
	appCacheName,
	ENGINE_CACHE,
	INITIAL_PWA_STATE,
	isFromServiceWorker,
	isToServiceWorker,
	type EngineCacheState,
	type FromServiceWorker,
	type PwaState,
	type ToServiceWorker,
} from './messages';

describe('caches (9.1)', () => {
	it('names one app cache per build and one engine cache', () => {
		expect(appCacheName('3f2a91bc-202611131402')).toBe('mainspring-app-3f2a91bc-202611131402');
		expect(appCacheName('dev').startsWith(APP_CACHE_PREFIX)).toBe(true);
		expect(ENGINE_CACHE).toBe('mainspring-engine');
		expect(ENGINE_CACHE.startsWith(APP_CACHE_PREFIX)).toBe(false);
	});
});

describe('state (6.6)', () => {
	it('starts with nothing ready and persistence unknown', () => {
		expect(INITIAL_PWA_STATE).toEqual({
			offlineReady: false,
			updateWaiting: false,
			installable: false,
			installed: false,
			persisted: null,
		});
		expect(Object.isFrozen(INITIAL_PWA_STATE)).toBe(true);
		expectTypeOf(INITIAL_PWA_STATE).toEqualTypeOf<Readonly<PwaState>>();
	});
});

describe('messages (6.6)', () => {
	it('accepts the two messages to the service worker, and nothing else', () => {
		expect(isToServiceWorker({ type: 'skip-waiting' })).toBe(true);
		expect(isToServiceWorker({ type: 'status' })).toBe(true);
		for (const bad of [{ type: 'skipWaiting' }, 'skip-waiting', null, [], { kind: 'status' }]) {
			expect(isToServiceWorker(bad)).toBe(false);
		}
		expectTypeOf<ToServiceWorker['type']>().toEqualTypeOf<'skip-waiting' | 'status'>();
	});

	it('accepts a status from the service worker, with or without a cached engine', () => {
		const ready: FromServiceWorker = {
			type: 'status',
			build: '3f2a91bc-202611131402',
			offlineReady: true,
			engine: { ruby: '4b814fc9d135', bundle: '0123456789ab', docs: null },
		};
		expect(isFromServiceWorker(ready)).toBe(true);
		expect(isFromServiceWorker({ ...ready, offlineReady: false, engine: null })).toBe(true);
		expect(
			isFromServiceWorker({ ...ready, engine: { ...ready.engine, docs: 'cafe01234567' } }),
		).toBe(true);
	});

	it('refuses a status that does not fit', () => {
		const ok = { type: 'status', build: 'b', offlineReady: true, engine: null };
		expect(isFromServiceWorker({ ...ok, type: 'skip-waiting' })).toBe(false);
		expect(isFromServiceWorker({ ...ok, build: 1 })).toBe(false);
		expect(isFromServiceWorker({ ...ok, offlineReady: 'yes' })).toBe(false);
		expect(isFromServiceWorker({ ...ok, engine: { ruby: 'a', bundle: 'b' } })).toBe(false);
		expect(isFromServiceWorker({ ...ok, engine: { ruby: 'a', docs: null } })).toBe(false);
		expect(isFromServiceWorker(undefined)).toBe(false);
		expectTypeOf<EngineCacheState['docs']>().toEqualTypeOf<string | null>();
	});
});
