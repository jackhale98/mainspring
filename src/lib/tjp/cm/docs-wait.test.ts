// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeywordDocsSource } from '../syntax/docs';
import { DOCS_WAIT_MS, docsWithin } from './docs-wait';
import { engineDocs, slowDocs, TABLE_ONLY } from './testing';

describe('docsWithin', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('gives the docs at once, without a load, once they are in', async () => {
		const loaded: KeywordDocsSource = { ...TABLE_ONLY, engine: engineDocs() };
		const load = vi.fn(() => Promise.resolve());
		expect(await docsWithin(() => loaded, load)).toBe(loaded);
		expect(load).not.toHaveBeenCalled();
	});

	it('neither waits nor loads while the loader rests after a failure', async () => {
		const resting: KeywordDocsSource = { ...TABLE_ONLY, coolingDown: true };
		const load = vi.fn(() => Promise.resolve());
		expect(await docsWithin(() => resting, load)).toBe(resting);
		expect(load).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('waits for a load that ends within the bound', async () => {
		const fake = slowDocs(120);
		const got = docsWithin(fake.docs, fake.loadDocs);
		await vi.advanceTimersByTimeAsync(120);
		expect((await got).engine).not.toBeNull();
	});

	it('stops waiting at the bound while the load is still running', async () => {
		const fake = slowDocs(10_000);
		let done: KeywordDocsSource | null = null;
		void docsWithin(fake.docs, fake.loadDocs).then((s) => (done = s));
		await vi.advanceTimersByTimeAsync(DOCS_WAIT_MS - 1);
		expect(done).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(done).toEqual({ ...TABLE_ONLY, loading: true, coolingDown: false });
		expect(vi.getTimerCount()).toBe(1); // only the load's own timer is left
	});

	it('never rejects, even when the load throws or rejects', async () => {
		const thrown = docsWithin(
			() => TABLE_ONLY,
			() => {
				throw new Error('boom');
			},
		);
		expect(await thrown).toBe(TABLE_ONLY);
		const rejected = docsWithin(
			() => TABLE_ONLY,
			() => Promise.reject(new Error('boom')),
		);
		expect(await rejected).toBe(TABLE_ONLY);
		expect(vi.getTimerCount()).toBe(0);
	});
});
