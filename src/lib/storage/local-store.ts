// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plans in this browser (phase-4.md 6.2, 7.1, 9.4; ADR-0019): `createLocalStore` implements
 * store-types.ts `LocalStore` (its contract is the spec) over one IndexedDB database of its own,
 * through idb.ts. Each method that writes is one transaction, so it is all or nothing.
 *
 * Database `mainspring`, version 1:
 * - `plans` (key `id`): the `StoredPlan` records.
 * - `files` (key `[id, path]`): each file's text, as a string, exactly as the workspace holds it.
 *   One record per file, so autosave writes only the files that changed, and a plan can gain files
 *   (21): a path the plan has never had is a new record. Nothing here deletes a file but `remove`.
 * - `sync` (key `id`): `{ base, queue, conflict }`, the plan's sync base, queue and waiting conflict.
 * - `meta` (key a name): `stored`, the database's half of the eviction marker (9.4).
 * - `credentials` (key `account`, T8's `CredentialStore`) and `handles` (folder handles, T5):
 *   created with the database, so that their tasks need no upgrade.
 *
 * - **updatedAt** is set on every write to a plan's records, in the same transaction.
 * - **Ordering** (store-types.ts `saveFiles`): a save with a lower version than the last one this
 *   instance was asked to make for the plan is dropped. IndexedDB runs transactions over the same
 *   stores in the order they were made, so the saves that remain commit in version order.
 * - **The eviction marker** is set by `create` in the database and in `localStorage`. `cleared()`
 *   reports a database without plans while either half of the marker says plans were kept, once:
 *   reading it clears the marker. `remove` of the last plan clears it, so a plan the user deleted
 *   is never reported as cleared. The `localStorage` half is put back when it alone was lost. A
 *   browser that clears both (WebKit's seven-day rule clears every script-writable store) cannot
 *   be told from a first visit, which is why the location line says "Only in this browser" (11.2).
 *   The `localStorage` key is `MARKER_KEY` (state/storage.ts), which the app reads on start.
 * - **A plan that is gone** (removed meanwhile): a write to its records rejects with `not-found`
 *   and writes nothing (the contract does not say; nothing else fits).
 */
import { failure, on, openDb, transact } from './idb';
import type {
	LocalStore,
	OpenedPlan,
	PendingWrite,
	StoredConflict,
	StoredPlan,
	SyncBase,
} from './store-types';
import { StorageFailure, storageError, type WorkspaceId, type WorkspacePath } from './types';
import { MARKER_KEY } from '../state/storage';
const MARKER = 'stored';
const STORES = ['plans', 'files', 'sync', 'meta'] as const;

interface SyncRecord {
	readonly base: SyncBase | null;
	readonly queue: readonly PendingWrite[];
	readonly conflict: StoredConflict | null;
}

export interface LocalStoreOptions {
	/** Default `globalThis.indexedDB`; `undefined` stands for a browser without it. */
	readonly indexedDB?: IDBFactory | undefined;
	/** Where the marker's other half is kept; default `localStorage`, null for none. */
	readonly marker?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
	readonly name?: string;
	readonly now?: () => number;
}

function upgrade(db: IDBDatabase): void {
	db.createObjectStore('plans', { keyPath: 'id' });
	for (const s of ['files', 'sync', 'meta', 'handles']) db.createObjectStore(s);
	db.createObjectStore('credentials', { keyPath: 'account' });
}

/** Every file record of plan `id`: arrays sort after strings, so `[id, []]` ends the range. */
const filesOf = (id: WorkspaceId): IDBKeyRange => IDBKeyRange.bound([id], [id, []]);

export function createLocalStore(o: LocalStoreOptions = {}): LocalStore {
	const factory = 'indexedDB' in o ? o.indexedDB : globalThis.indexedDB;
	const now = o.now ?? Date.now;
	const last = new Map<WorkspaceId, number>();
	let db: Promise<IDBDatabase> | null = null;
	const conn = (): Promise<IDBDatabase> =>
		(db ??= openDb(factory, o.name ?? 'mainspring', 1, upgrade, () => (db = null)).catch((e) => {
			db = null;
			throw e;
		}));
	const run = <T>(
		stores: readonly string[],
		mode: IDBTransactionMode,
		body: (t: IDBTransaction, abort: (why: StorageFailure) => void) => () => T,
	): Promise<T> =>
		conn()
			.then((d) => transact(d, stores, mode, body))
			.catch((e: unknown) => Promise.reject(failure(e)));
	const ls = (): LocalStoreOptions['marker'] => {
		try {
			return o.marker === undefined ? globalThis.localStorage : o.marker;
		} catch {
			return null;
		}
	};
	const mark = (set: boolean): void => {
		try {
			if (set) ls()?.setItem(MARKER_KEY, '1');
			else ls()?.removeItem(MARKER_KEY);
		} catch {
			// Blocked storage: the database's half still records it.
		}
	};
	const marked = (): boolean => {
		try {
			return ls()?.getItem(MARKER_KEY) === '1';
		} catch {
			return false;
		}
	};
	/** Sets the plan's `updatedAt`; aborts when there is no such plan (it was removed). */
	const touch = (t: IDBTransaction, id: WorkspaceId, abort: (w: StorageFailure) => void): void => {
		const plans = t.objectStore('plans');
		on(plans.get(id) as IDBRequest<StoredPlan | undefined>, (p) => {
			if (p) plans.put({ ...p, updatedAt: now() });
			else abort(new StorageFailure(storageError('not-found', 'no such plan')));
		});
	};
	const editSync = (id: WorkspaceId, f: (s: SyncRecord) => SyncRecord): Promise<void> =>
		run(['plans', 'sync'], 'readwrite', (t, abort) => {
			touch(t, id, abort);
			const s = t.objectStore('sync');
			on(s.get(id) as IDBRequest<SyncRecord | undefined>, (r) =>
				s.put(f(r ?? { base: null, queue: [], conflict: null }), id),
			);
			return () => undefined;
		});

	return {
		plans: () =>
			run(['plans'], 'readonly', (t) => {
				let all: StoredPlan[] = [];
				on(t.objectStore('plans').getAll() as IDBRequest<StoredPlan[]>, (v) => (all = v));
				return () => all.sort((a, b) => b.updatedAt - a.updatedAt);
			}),

		open: (id) =>
			run(['plans', 'files', 'sync'], 'readonly', (t) => {
				let plan: StoredPlan | undefined;
				let sync: SyncRecord | undefined;
				let keys: IDBValidKey[] = [];
				let texts: string[] = [];
				const files = t.objectStore('files');
				on(t.objectStore('plans').get(id) as IDBRequest<StoredPlan | undefined>, (v) => (plan = v));
				on(files.getAllKeys(filesOf(id)), (v) => (keys = v));
				on(files.getAll(filesOf(id)) as IDBRequest<string[]>, (v) => (texts = v));
				on(t.objectStore('sync').get(id) as IDBRequest<SyncRecord | undefined>, (v) => (sync = v));
				return (): OpenedPlan | null =>
					plan
						? {
								plan,
								files: new Map(
									keys.map((k, i) => [(k as [WorkspaceId, WorkspacePath])[1], texts[i] ?? '']),
								),
								base: sync?.base ?? null,
								queue: sync?.queue ?? [],
								conflict: sync?.conflict ?? null,
							}
						: null;
			}),

		create: (p, files, base) => {
			const id = crypto.randomUUID();
			return run(STORES, 'readwrite', (t) => {
				t.objectStore('plans').put({ ...p, id, updatedAt: now() } satisfies StoredPlan);
				const f = t.objectStore('files');
				for (const [path, text] of files) f.put(text, [id, path]);
				t.objectStore('sync').put({ base, queue: [], conflict: null } satisfies SyncRecord, id);
				t.objectStore('meta').put(1, MARKER);
				return () => {
					mark(true);
					return id;
				};
			});
		},

		saveFiles: (id, files, version) => {
			if (version < (last.get(id) ?? -Infinity)) return Promise.resolve();
			last.set(id, version);
			return run(['plans', 'files'], 'readwrite', (t, abort) => {
				touch(t, id, abort);
				const f = t.objectStore('files');
				for (const [path, text] of files) f.put(text, [id, path]);
				return () => undefined;
			});
		},

		setBase: (id, base) => editSync(id, (s) => ({ ...s, base })),
		enqueue: (id, w) => editSync(id, (s) => ({ ...s, queue: [...s.queue, w] })),
		dequeue: (id, writeId) =>
			editSync(id, (s) => ({ ...s, queue: s.queue.filter((w) => w.id !== writeId) })),
		setConflict: (id, conflict) => editSync(id, (s) => ({ ...s, conflict })),

		remove: (id) =>
			run(STORES, 'readwrite', (t) => {
				const plans = t.objectStore('plans');
				plans.delete(id);
				t.objectStore('files').delete(filesOf(id));
				t.objectStore('sync').delete(id);
				let left = 1;
				on(plans.count(), (n) => {
					left = n;
					if (n === 0) t.objectStore('meta').delete(MARKER);
				});
				return () => {
					last.delete(id);
					if (left === 0) mark(false);
				};
			}),

		estimate: async () => {
			const s = globalThis.navigator?.storage;
			const e = await s?.estimate?.().catch(() => undefined);
			const persisted = (await s?.persisted?.().catch(() => false)) ?? false;
			return { usage: e?.usage ?? 0, quota: e?.quota ?? 0, persisted };
		},

		cleared: () =>
			run(['plans', 'meta'], 'readwrite', (t) => {
				let n = 0;
				let inDb = false;
				const meta = t.objectStore('meta');
				on(t.objectStore('plans').count(), (v) => (n = v));
				on(meta.get(MARKER), (v) => {
					inDb = v !== undefined;
					if (n === 0 && inDb) meta.delete(MARKER);
				});
				return () => {
					const inLs = marked();
					if (n > 0) {
						if (!inLs) mark(true);
						return false;
					}
					if (inLs) mark(false);
					return inLs || inDb;
				};
			}),
	};
}
