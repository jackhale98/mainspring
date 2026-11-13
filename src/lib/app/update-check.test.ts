// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	compareBuild,
	latestBuild,
	reloadToLatest,
	watchForUpdates,
	type CheckResult,
} from './update-check';

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

describe('latestBuild', () => {
	it('reads the id past every cache, with a query that defeats CDN caching too', async () => {
		const f = reply({ id: 'abc-1', builtAt: 'x' });
		expect(await latestBuild(f, '/base/version.json', 42)).toBe('abc-1');
		expect(f).toHaveBeenCalledWith('/base/version.json?t=42', { cache: 'no-store' });
	});

	it('gives null when the file is missing, malformed or the network is down', async () => {
		expect(await latestBuild(reply({}, false), '/v.json', 1)).toBeNull();
		expect(await latestBuild(reply({ nope: 1 }), '/v.json', 1)).toBeNull();
		expect(await latestBuild(reply({ id: '' }), '/v.json', 1)).toBeNull();
		const down = vi.fn(async () => {
			throw new TypeError('offline');
		});
		expect(await latestBuild(down, '/v.json', 1)).toBeNull();
	});
});

describe('compareBuild', () => {
	it('is current on the same id, available on another, unknown without one', () => {
		expect(compareBuild('a', 'a')).toBe('current');
		expect(compareBuild('a', 'b')).toBe('available');
		expect(compareBuild('a', null)).toBe('unknown');
	});
});

describe('watchForUpdates', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const visibility = () => {
		const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
		target.visibilityState = 'visible';
		return target as unknown as Document;
	};

	it('checks soon after start, then on a schedule, and stops asking once a newer build is found', async () => {
		let deployed = 'a';
		const f = vi.fn(async () => ({ ok: true, json: async () => ({ id: deployed }) }));
		const results: CheckResult[] = [];
		const w = watchForUpdates({
			current: { id: 'a', builtAt: '' },
			url: '/version.json',
			fetch: f,
			onResult: (r) => results.push(r),
			firstDelayMs: 1_000,
			intervalMs: 60_000,
		});
		await vi.advanceTimersByTimeAsync(1_000);
		expect(results).toEqual(['current']);
		deployed = 'b';
		await vi.advanceTimersByTimeAsync(60_000);
		expect(results).toEqual(['current', 'available']);
		await vi.advanceTimersByTimeAsync(180_000);
		expect(f).toHaveBeenCalledTimes(2);
		w.stop();
	});

	it('checks when the tab comes back into view, at most once a minute', async () => {
		const f = reply({ id: 'a' });
		const doc = visibility();
		const w = watchForUpdates({
			current: { id: 'a', builtAt: '' },
			url: '/version.json',
			fetch: f,
			onResult: () => undefined,
			visibility: doc,
			firstDelayMs: 1_000,
		});
		await vi.advanceTimersByTimeAsync(1_000);
		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(f).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(61_000);
		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(f).toHaveBeenCalledTimes(2);
		w.stop();
	});

	it('never checks on a dev server, and nothing fires after stop', async () => {
		const f = reply({ id: 'x' });
		const dev = watchForUpdates({
			current: { id: 'dev', builtAt: '' },
			url: '/version.json',
			fetch: f,
			onResult: () => undefined,
		});
		expect(await dev.check()).toBe('unknown');
		const results: CheckResult[] = [];
		const w = watchForUpdates({
			current: { id: 'a', builtAt: '' },
			url: '/version.json',
			fetch: f,
			onResult: (r) => results.push(r),
			firstDelayMs: 1_000,
		});
		w.stop();
		await vi.advanceTimersByTimeAsync(20 * 60_000);
		expect(f).not.toHaveBeenCalled();
		expect(results).toEqual([]);
	});
});

describe('reloadToLatest', () => {
	it('refetches the page past the HTTP cache, then reloads, even when offline', async () => {
		const order: string[] = [];
		const loc = { href: 'https://x.test/app', reload: () => order.push('reload') };
		await reloadToLatest(loc, async (url, init) => {
			order.push(`fetch ${url} ${init.cache}`);
			return { ok: true, json: async () => ({}) };
		});
		expect(order).toEqual(['fetch https://x.test/app reload', 'reload']);
		const offline: string[] = [];
		await reloadToLatest({ href: 'h', reload: () => offline.push('reload') }, async () => {
			throw new TypeError('offline');
		});
		expect(offline).toEqual(['reload']);
	});
});
