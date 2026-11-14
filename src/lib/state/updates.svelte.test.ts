// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { AppUpdates } from './updates.svelte';

const build = { id: 'a-1', builtAt: '2026-11-13T14:00:00Z' };
const deployed = (id: string) => vi.fn(async () => ({ ok: true, json: async () => ({ id }) }));

describe('AppUpdates', () => {
	it('reports a newer deployed build when asked', async () => {
		const u = new AppUpdates({ build, url: '/version.json', fetch: deployed('b-2') });
		expect(u.status).toBe('unknown');
		expect(await u.checkNow()).toBe('available');
		expect(u.status).toBe('available');
		expect(u.checking).toBe(false);
		u.stop();
	});

	it('says current when the deployed build is this one', async () => {
		const u = new AppUpdates({ build, url: '/version.json', fetch: deployed('a-1') });
		expect(await u.checkNow()).toBe('current');
		u.stop();
	});

	it('asks before a reload would discard unsaved changes, and keeps the page on no', async () => {
		const reload = vi.fn();
		const u = new AppUpdates({
			build,
			url: '/version.json',
			fetch: deployed('b-2'),
			location: { href: 'https://x.test/app', reload },
		});
		expect(await u.reload(true, () => false)).toBe(false);
		expect(reload).not.toHaveBeenCalled();
		expect(await u.reload(true, () => true)).toBe(true);
		expect(await u.reload(false, () => false)).toBe(true);
		expect(reload).toHaveBeenCalledTimes(2);
	});

	it("reloadAsking puts the app's question to the user when work would be lost", async () => {
		const reload = vi.fn();
		const confirm = vi.fn(() => false);
		vi.stubGlobal('confirm', confirm);
		const u = new AppUpdates({
			build,
			url: '/version.json',
			fetch: deployed('b-2'),
			location: { href: 'https://x.test/app', reload },
		});
		expect(await u.reloadAsking(true)).toBe(false);
		expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/discards your changes/));
		expect(reload).not.toHaveBeenCalled();
		expect(await u.reloadAsking(false)).toBe(true);
		expect(confirm).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});
});
