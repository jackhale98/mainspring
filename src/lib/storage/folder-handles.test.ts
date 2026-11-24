// SPDX-License-Identifier: GPL-2.0-or-later
// The folder handles store (folder-handles.ts, phase-4.md 7.2) on fake-indexeddb.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { idbHandles, type FsDirHandle } from './folder-handles';
import { StorageFailure } from './types';

async function rejection(p: Promise<unknown>): Promise<StorageFailure> {
	const e = await p.then(
		() => null,
		(x: unknown) => x,
	);
	expect(e).toBeInstanceOf(StorageFailure);
	return e as StorageFailure;
}

describe('the handles store', () => {
	it('keeps handles in the storage database, by key', async () => {
		const s = idbHandles({ indexedDB: new IDBFactory() });
		// fake-indexeddb clones plain data only; a real handle is structured-cloneable in Chromium.
		const h = { kind: 'directory', name: 'acme' } as unknown as FsDirHandle;
		expect(await s.get('k')).toBeNull();
		await s.put('k', h);
		await s.put('j', { ...h, name: 'other' } as FsDirHandle);
		expect(await s.get('k')).toEqual(h);
		expect((await s.all()).map(([k, v]) => [k, v.name])).toEqual([
			['j', 'other'],
			['k', 'acme'],
		]);
	});

	it('rejects with unsupported without IndexedDB', async () => {
		const s = idbHandles({ indexedDB: undefined });
		expect((await rejection(s.get('k'))).error.kind).toBe('unsupported');
	});
});
