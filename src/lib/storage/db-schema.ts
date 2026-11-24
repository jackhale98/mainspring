// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The one IndexedDB database of Mainspring's storage (phase-4.md 6.2; local-store.ts names its
 * stores): its name, version and upgrade, shared by the local store and the folder provider's
 * handles (folder.ts), so whichever opens it first creates every store.
 */
export const DB_NAME = 'mainspring';
export const DB_VERSION = 1;

/** Version 1: `plans`, `files`, `sync`, `meta`, `handles` (out-of-line keys) and `credentials`. */
export function upgradeDb(db: IDBDatabase): void {
	db.createObjectStore('plans', { keyPath: 'id' });
	for (const s of ['files', 'sync', 'meta', 'handles']) db.createObjectStore(s);
	db.createObjectStore('credentials', { keyPath: 'account' });
}
