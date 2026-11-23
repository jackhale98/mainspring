// SPDX-License-Identifier: GPL-2.0-or-later
// The local store (phase-4.md 6.2, 9.4, 13.1) on fake-indexeddb: create, open and restore, a plan
// that gains files, saves ordered by version and all or nothing, the sync records and the queue
// order, remove, a quota error surfaced as `quota`, a missing IndexedDB as `unsupported`, and the
// eviction marker.
import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { MARKER_KEY } from '../state/storage';
import { createLocalStore } from './local-store';
import type { PendingWrite, StoredConflict, StoredPlan, SyncBase } from './store-types';
import { isStorageFailure, isWorkspaceId, type StorageErrorKind } from './types';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
	data: Map<string, string>;
} {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k),
	};
}

function store(
	o: { factory?: IDBFactory; marker?: ReturnType<typeof memory>; now?: () => number } = {},
) {
	const factory = o.factory ?? new IDBFactory();
	const marker = o.marker ?? memory();
	let t = 1000;
	const s = createLocalStore({ indexedDB: factory, marker, now: o.now ?? (() => ++t) });
	return { s, factory, marker };
}

const PLAN: Omit<StoredPlan, 'id' | 'updatedAt'> = {
	name: 'Tutorial (copy)',
	entry: 'plan.tjp',
	location: { kind: 'browser' },
	from: { sample: 'upstream-tutorial' },
};
const files = (o: Record<string, string>) => new Map(Object.entries(o));

async function kind(p: Promise<unknown>): Promise<StorageErrorKind | 'resolved'> {
	try {
		await p;
		return 'resolved';
	} catch (e) {
		if (!isStorageFailure(e)) throw e;
		return e.error.kind;
	}
}

function write(id: string, text: Record<string, string>): PendingWrite {
	return {
		id,
		createdAt: 1,
		base: 'r1',
		files: files(text),
		changed: new Set(Object.keys(text)),
		message: null,
		summary: null,
		checkedVersion: 3,
	};
}

describe('local store', () => {
	it('creates a plan with a random id and opens it with its exact text', async () => {
		const { s } = store();
		const text = '﻿project p "P" 2026-01-05 +1m\r\ntask a "é�" {}\r\n';
		const id = await s.create(PLAN, files({ 'plan.tjp': text, 'lib/x.tji': 'task x "X"\n' }), null);
		expect(isWorkspaceId(id)).toBe(true);
		const opened = await s.open(id);
		expect(opened?.plan).toMatchObject({ ...PLAN, id });
		expect(opened?.files).toEqual(files({ 'lib/x.tji': 'task x "X"\n', 'plan.tjp': text }));
		expect(opened?.base).toBeNull();
		expect(opened?.queue).toEqual([]);
		expect(opened?.conflict).toBeNull();
		expect(await s.open('no-such-plan')).toBeNull();
		const other = await s.create(PLAN, files({ 'plan.tjp': 'x' }), null);
		expect(other).not.toBe(id);
	});

	it('survives a new instance on the same database (a reload)', async () => {
		const { s, factory, marker } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
		await s.saveFiles(id, files({ 'plan.tjp': 'b' }), 1);
		const again = createLocalStore({ indexedDB: factory, marker });
		expect((await again.open(id))?.files.get('plan.tjp')).toBe('b');
	});

	it('saves the files named, adds a path it has never seen (21), and keeps the others', async () => {
		const { s } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'p0', 'a.tji': 'a0' }), null);
		const before = (await s.open(id))?.plan.updatedAt ?? 0;
		await s.saveFiles(id, files({ 'plan.tjp': 'p1', 'parts/new.tji': 'n1' }), 4);
		const o = await s.open(id);
		expect(o?.files).toEqual(files({ 'a.tji': 'a0', 'parts/new.tji': 'n1', 'plan.tjp': 'p1' }));
		expect(o?.plan.updatedAt).toBeGreaterThan(before);
	});

	it('drops a save with a lower version than the last it was asked for (a slower write)', async () => {
		const { s } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'v0' }), null);
		const late = s.saveFiles(id, files({ 'plan.tjp': 'v5' }), 5);
		const early = s.saveFiles(id, files({ 'plan.tjp': 'v3' }), 3);
		await Promise.all([late, early]);
		expect((await s.open(id))?.files.get('plan.tjp')).toBe('v5');
		// The same version again is a retry, not a race: it is written.
		await s.saveFiles(id, files({ 'plan.tjp': 'v5b' }), 5);
		expect((await s.open(id))?.files.get('plan.tjp')).toBe('v5b');
	});

	it('writes all or nothing: a save to a plan that is gone writes no file', async () => {
		const { s } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'x' }), null);
		await s.remove(id);
		expect(await kind(s.saveFiles(id, files({ 'plan.tjp': 'y' }), 1))).toBe('not-found');
		expect(await s.open(id)).toBeNull();
	});

	it('keeps the sync base, the queue oldest first, and the conflict', async () => {
		const { s } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'x' }), null);
		const base: SyncBase = {
			revision: 'r1',
			files: files({ 'plan.tjp': 'x', 'gone.tji': 'g' }),
			lossy: new Set(['plan.tjp']),
			kept: new Set(['gone.tji']),
			summary: null,
		};
		await s.setBase(id, base);
		await s.enqueue(id, write('w1', { 'plan.tjp': 'y' }));
		await s.enqueue(id, write('w2', { 'plan.tjp': 'z' }));
		await s.enqueue(id, write('w3', { 'plan.tjp': 'zz' }));
		await s.dequeue(id, 'w2');
		const conflict: StoredConflict = {
			theirs: {
				revision: 'r2',
				files: files({ 'plan.tjp': 't' }),
				lossy: new Set(),
				author: 'A',
				at: 5,
			},
			foundAt: 9,
			choices: [],
		};
		await s.setConflict(id, conflict);
		let o = await s.open(id);
		expect(o?.base).toEqual(base);
		expect(o?.queue.map((w) => w.id)).toEqual(['w1', 'w3']);
		expect(o?.queue[0]).toEqual(write('w1', { 'plan.tjp': 'y' }));
		expect(o?.conflict).toEqual(conflict);
		await s.setConflict(id, null);
		o = await s.open(id);
		expect(o?.conflict).toBeNull();
		expect(o?.queue.map((w) => w.id)).toEqual(['w1', 'w3']);
	});

	it('lists plans most recently updated first', async () => {
		const { s } = store();
		const a = await s.create({ ...PLAN, name: 'A' }, files({ 'plan.tjp': 'a' }), null);
		const b = await s.create({ ...PLAN, name: 'B' }, files({ 'plan.tjp': 'b' }), null);
		expect((await s.plans()).map((p) => p.id)).toEqual([b, a]);
		await s.saveFiles(a, files({ 'plan.tjp': 'a2' }), 1);
		expect((await s.plans()).map((p) => p.id)).toEqual([a, b]);
	});

	it('removes a plan and every record of it, and leaves the others', async () => {
		const { s } = store();
		const a = await s.create(PLAN, files({ 'plan.tjp': 'a', 'x.tji': 'x' }), null);
		const b = await s.create(PLAN, files({ 'plan.tjp': 'b' }), null);
		await s.enqueue(a, write('w1', { 'plan.tjp': 'y' }));
		await s.remove(a);
		expect(await s.open(a)).toBeNull();
		expect((await s.open(b))?.files).toEqual(files({ 'plan.tjp': 'b' }));
		// A plan of the same id made again starts empty (no file of the old one is left).
		expect((await s.plans()).map((p) => p.id)).toEqual([b]);
	});

	it('reports a quota error as quota, and nothing is written', async () => {
		const { s } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
		const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError');
		});
		try {
			expect(await kind(s.saveFiles(id, files({ 'plan.tjp': 'b' }), 1))).toBe('quota');
			expect(await kind(s.create(PLAN, files({ 'plan.tjp': 'c' }), null))).toBe('quota');
		} finally {
			full.mockRestore();
		}
		expect((await s.open(id))?.files.get('plan.tjp')).toBe('a');
		expect(await s.plans()).toHaveLength(1);
	});

	it('is unsupported where IndexedDB is missing or refuses to open', async () => {
		expect(await kind(createLocalStore({ indexedDB: undefined }).open('x'))).toBe('unsupported');
		const refusing = {
			open: () => {
				throw new DOMException('blocked', 'SecurityError');
			},
		} as unknown as IDBFactory;
		const s = createLocalStore({ indexedDB: refusing });
		expect(await kind(s.plans())).toBe('unsupported');
		expect(await kind(s.create(PLAN, files({}), null))).toBe('unsupported');
	});

	describe('the eviction marker (9.4)', () => {
		it('is set by create in both halves, and says nothing while plans are there', async () => {
			const { s, marker } = store();
			expect(await s.cleared()).toBe(false);
			await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
			expect(marker.getItem(MARKER_KEY)).toBe('1');
			expect(await s.cleared()).toBe(false);
		});

		it('reports a database emptied by the browser, once', async () => {
			const { s, marker } = store();
			await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
			// The browser clears the site's IndexedDB but not localStorage.
			const fresh = createLocalStore({ indexedDB: new IDBFactory(), marker });
			expect(await fresh.cleared()).toBe(true);
			expect(await fresh.cleared()).toBe(false);
			expect(marker.getItem(MARKER_KEY)).toBeNull();
		});

		it('reports it from the database half when localStorage lost its half', async () => {
			const { s, factory } = store();
			const id = await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
			// Plans are deleted from the database (the browser), the marker record stays.
			const db = await new Promise<IDBDatabase>((resolve) => {
				const r = factory.open('mainspring');
				r.onsuccess = () => resolve(r.result);
			});
			await new Promise<void>((resolve) => {
				const t = db.transaction(['plans'], 'readwrite');
				t.objectStore('plans').delete(id);
				t.oncomplete = () => resolve();
			});
			db.close();
			const lost = memory();
			expect(await createLocalStore({ indexedDB: factory, marker: lost }).cleared()).toBe(true);
		});

		it('puts the localStorage half back when only it was lost', async () => {
			const { s, factory } = store();
			await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
			const lost = memory();
			expect(await createLocalStore({ indexedDB: factory, marker: lost }).cleared()).toBe(false);
			expect(lost.getItem(MARKER_KEY)).toBe('1');
		});

		it('is cleared when the user removes the last plan, which is not an eviction', async () => {
			const { s, marker } = store();
			const a = await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
			const b = await s.create(PLAN, files({ 'plan.tjp': 'b' }), null);
			await s.remove(a);
			expect(marker.getItem(MARKER_KEY)).toBe('1');
			await s.remove(b);
			expect(marker.getItem(MARKER_KEY)).toBeNull();
			expect(await s.cleared()).toBe(false);
		});
	});

	it('estimates zeros and false where the Storage API is missing', async () => {
		const { s } = store();
		expect(await s.estimate()).toEqual({ usage: 0, quota: 0, persisted: false });
	});

	it('never blocks a newer version opened in another tab, and then says it cannot be used', async () => {
		const { s, factory } = store();
		const id = await s.create(PLAN, files({ 'plan.tjp': 'a' }), null);
		// A newer app upgrades the database: this connection closes itself instead of blocking it.
		await new Promise<void>((resolve, reject) => {
			const r = factory.open('mainspring', 2);
			r.onblocked = () => reject(new Error('blocked'));
			r.onsuccess = () => {
				r.result.close();
				resolve();
			};
		});
		// The next call opens again, at version 1, which is older than the database now.
		expect(await kind(s.open(id))).toBe('unsupported');
	});
});
