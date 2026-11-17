// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { LazyModule } from './lazy.svelte';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('LazyModule', () => {
	it('imports once, however often it is asked', async () => {
		let calls = 0;
		const lazy = new LazyModule(async () => {
			calls++;
			return { name: 'view' };
		});
		expect(lazy.module).toBeNull();
		lazy.load();
		lazy.load();
		await flush();
		lazy.load();
		expect(calls).toBe(1);
		expect(lazy.module).toEqual({ name: 'view' });
		expect(lazy.failed).toBe(false);
	});

	it('reads failed after a failed import, and imports again on the next load', async () => {
		let calls = 0;
		const lazy = new LazyModule(async () => {
			calls++;
			if (calls === 1) throw new Error('offline');
			return 7;
		});
		lazy.load();
		await flush();
		expect(lazy.failed).toBe(true);
		expect(lazy.module).toBeNull();
		lazy.load();
		expect(lazy.failed).toBe(false);
		await flush();
		expect(lazy.module).toBe(7);
		expect(calls).toBe(2);
	});
});
