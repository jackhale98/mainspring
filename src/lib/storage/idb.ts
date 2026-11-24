// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A small IndexedDB wrapper of our own (phase-4.md 18.5; ADR-0019 #5: no Dexie). Three calls:
 * `openDb` opens or upgrades a database, `transact` runs one transaction and settles when it has
 * committed or aborted, and `on` reads a request's result inside it.
 *
 * - **No promise inside a transaction.** A transaction commits once no request is pending at the
 *   end of a task, so the body issues its requests at once or from `on` callbacks (a read, then a
 *   write from its result); it never awaits. `transact` resolves only on `complete`: what it
 *   resolves with is written.
 * - **Failures** are `StorageFailure`s (types.ts): `quota` for `QuotaExceededError`, `unsupported`
 *   when the database cannot be opened (no IndexedDB, a private window that blocks it), `server`
 *   for anything else (the error's name is the detail, never data).
 * - **Another tab upgrading** the database closes this tab's connection (`versionchange`), so the
 *   upgrade is never blocked; `openDb` is called again for the next transaction.
 */
import { StorageFailure, storageError, type StorageErrorKind } from './types';

/** An IndexedDB error, or anything thrown, as a `StorageFailure` (module comment). */
export function failure(e: unknown, kind?: StorageErrorKind): StorageFailure {
	if (e instanceof StorageFailure) return e;
	const name = (e as { name?: unknown } | null)?.name;
	const detail = typeof name === 'string' ? name : 'error';
	return new StorageFailure(
		storageError(kind ?? (detail === 'QuotaExceededError' ? 'quota' : 'server'), `idb: ${detail}`),
	);
}

/**
 * Opens `name` at `version`, running `upgrade` first when the stored version is older (`old` is 0
 * for a new database). Rejects with `unsupported` when it cannot be opened. `closed` is called
 * when the connection closes by itself, so the caller opens a new one for its next transaction.
 */
export function openDb(
	factory: IDBFactory | undefined,
	name: string,
	version: number,
	upgrade: (db: IDBDatabase, old: number) => void,
	closed: () => void,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		try {
			const r = factory!.open(name, version);
			r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
			r.onsuccess = () => {
				const db = r.result;
				// Closed by the browser (storage cleared) or for another tab's upgrade: open again.
				db.onclose = closed;
				db.onversionchange = () => {
					db.close();
					closed();
				};
				resolve(db);
			};
			r.onerror = () => reject(failure(r.error, 'unsupported'));
		} catch (e) {
			reject(failure(e, 'unsupported'));
		}
	});
}

/**
 * One transaction over `stores` (module comment): `body` issues the requests and returns a function
 * that gives the result once the transaction has committed. Rejects, with nothing written, when a
 * request fails, the body throws or calls `abort(why)`.
 */
export function transact<T>(
	db: IDBDatabase,
	stores: readonly string[],
	mode: IDBTransactionMode,
	body: (t: IDBTransaction, abort: (why: StorageFailure) => void) => () => T,
): Promise<T> {
	return new Promise((resolve, reject) => {
		let why: StorageFailure | null = null;
		let t: IDBTransaction;
		try {
			t = db.transaction([...stores], mode);
		} catch (e) {
			return reject(failure(e));
		}
		const abort = (w: StorageFailure): void => {
			why ??= w;
			t.abort();
		};
		t.onabort = () => reject(why ?? failure(t.error));
		try {
			const result = body(t, abort);
			t.oncomplete = () => resolve(result());
		} catch (e) {
			abort(failure(e));
		}
	});
}

/** Calls `f` with the request's result once it succeeds (inside the transaction). */
export function on<T>(r: IDBRequest<T>, f: (v: T) => void): void {
	r.onsuccess = () => f(r.result);
}
