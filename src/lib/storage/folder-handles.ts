// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The File System Access handles of the folder provider (folder.ts; phase-4.md 7.2): the parts of
 * the API it uses, as structural types (real handles and the test fake, testing/fake-fsa.ts, fit),
 * and where it keeps a folder's handle: the `handles` store of the storage database (db-schema.ts),
 * a `FileSystemDirectoryHandle` per key (Chromium stores the handle itself, structured-cloned).
 * Failures are `StorageFailure`s (idb.ts): `unsupported` without IndexedDB. Lazy, with folder.ts.
 */
import { DB_NAME, DB_VERSION, upgradeDb } from './db-schema';
import { failure, on, openDb, transact } from './idb';

/** What a `File` from `getFile()` gives (structural: real files and the test fake fit). */
export interface FsFile {
	readonly size: number;
	readonly lastModified: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FsWritable {
	write(data: Uint8Array): Promise<void>;
	close(): Promise<void>;
	abort(reason?: unknown): Promise<void>;
}

export interface FsFileHandle {
	readonly kind: 'file';
	readonly name: string;
	getFile(): Promise<FsFile>;
	createWritable(o?: { readonly keepExistingData?: boolean }): Promise<FsWritable>;
}

/** The parts of `FileSystemDirectoryHandle` used here (the permission methods are Chromium's). */
export interface FsDirHandle {
	readonly kind: 'directory';
	readonly name: string;
	values(): AsyncIterable<FsDirHandle | FsFileHandle>;
	getDirectoryHandle(name: string, o?: { readonly create?: boolean }): Promise<FsDirHandle>;
	getFileHandle(name: string, o?: { readonly create?: boolean }): Promise<FsFileHandle>;
	isSameEntry?(other: FsDirHandle): Promise<boolean>;
	queryPermission?(d: { readonly mode: 'readwrite' }): Promise<PermissionState>;
	requestPermission?(d: { readonly mode: 'readwrite' }): Promise<PermissionState>;
}

/** Where the folder handles are kept (module comment): the database's `handles` store. */
export interface HandleStore {
	get(key: string): Promise<FsDirHandle | null>;
	all(): Promise<ReadonlyArray<readonly [string, FsDirHandle]>>;
	put(key: string, h: FsDirHandle): Promise<void>;
}

/** The `handles` store of the storage database (module comment). */
export function idbHandles(
	o: { readonly indexedDB?: IDBFactory | undefined; readonly name?: string } = {},
): HandleStore {
	const factory = 'indexedDB' in o ? o.indexedDB : globalThis.indexedDB;
	let db: Promise<IDBDatabase> | null = null;
	const run = <T>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => () => T): Promise<T> =>
		(db ??= openDb(factory, o.name ?? DB_NAME, DB_VERSION, upgradeDb, () => (db = null)).catch(
			(e: unknown) => {
				db = null;
				throw e;
			},
		))
			.then((d) => transact(d, ['handles'], mode, (t) => body(t.objectStore('handles'))))
			.catch((e: unknown) => Promise.reject(failure(e)));
	return {
		get: (key) =>
			run('readonly', (s) => {
				let h: FsDirHandle | null = null;
				on(s.get(key) as IDBRequest<FsDirHandle | undefined>, (v) => (h = v ?? null));
				return () => h;
			}),
		all: () =>
			run('readonly', (s) => {
				let keys: IDBValidKey[] = [];
				let all: FsDirHandle[] = [];
				on(s.getAllKeys(), (v) => (keys = v));
				on(s.getAll() as IDBRequest<FsDirHandle[]>, (v) => (all = v));
				return () => keys.map((k, i) => [String(k), all[i]!] as const);
			}),
		put: (key, h) =>
			run('readwrite', (s) => {
				s.put(h, key);
				return () => undefined;
			}),
	};
}
