// SPDX-License-Identifier: GPL-2.0-or-later
// The IndexedDB wrapper (phase-4.md 18.5): errors as StorageFailures by kind, a transaction that
// settles on complete or abort, and a body that throws writes nothing.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { failure, on, openDb, transact } from './idb';
import { StorageFailure, storageError } from './types';

const open = (f: IDBFactory, closed = () => undefined): Promise<IDBDatabase> =>
	openDb(f, 'test', 1, (db) => void db.createObjectStore('s'), closed);

describe('idb', () => {
	it('maps errors to storage failures by kind, and never shows data', () => {
		expect(failure(new DOMException('x', 'QuotaExceededError')).error).toEqual({
			kind: 'quota',
			retryAfterMs: null,
			detail: 'idb: QuotaExceededError',
		});
		expect(failure(new DOMException('x', 'InvalidStateError')).error.kind).toBe('server');
		expect(failure(new DOMException('x', 'SecurityError'), 'unsupported').error.kind).toBe(
			'unsupported',
		);
		expect(failure('secret text').error.detail).toBe('idb: error');
		const f = new StorageFailure(storageError('not-found', 'gone'));
		expect(failure(f)).toBe(f);
	});

	it('resolves once the transaction committed, with what the body read', async () => {
		const db = await open(new IDBFactory());
		await transact(db, ['s'], 'readwrite', (t) => {
			t.objectStore('s').put('one', 1);
			return () => undefined;
		});
		const got = await transact(db, ['s'], 'readonly', (t) => {
			let v: unknown;
			on(t.objectStore('s').get(1), (x) => (v = x));
			return () => v;
		});
		expect(got).toBe('one');
	});

	it('writes nothing when the body throws or aborts, and rejects with the reason', async () => {
		const db = await open(new IDBFactory());
		const thrown = transact(db, ['s'], 'readwrite', (t) => {
			t.objectStore('s').put('two', 2);
			throw new DOMException('full', 'QuotaExceededError');
		});
		await expect(thrown).rejects.toMatchObject({ error: { kind: 'quota' } });
		const why = new StorageFailure(storageError('not-found', 'no plan'));
		const aborted = transact(db, ['s'], 'readwrite', (t, abort) => {
			const s = t.objectStore('s');
			s.put('three', 3);
			on(s.get(3), () => abort(why));
			return () => undefined;
		});
		await expect(aborted).rejects.toBe(why);
		const left = await transact(db, ['s'], 'readonly', (t) => {
			let n = -1;
			on(t.objectStore('s').count(), (x) => (n = x));
			return () => n;
		});
		expect(left).toBe(0);
	});

	it('rejects as unsupported without IndexedDB, and tells when the connection closes', async () => {
		await expect(open(undefined as unknown as IDBFactory)).rejects.toMatchObject({
			error: { kind: 'unsupported' },
		});
		const f = new IDBFactory();
		let closed = 0;
		await open(f, () => void closed++);
		await new Promise<void>((resolve) => {
			const r = f.open('test', 2);
			r.onsuccess = () => {
				r.result.close();
				resolve();
			};
		});
		expect(closed).toBe(1);
	});
});
