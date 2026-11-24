// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the app-state tests of plan-files.ts share (plan-files.svelte.test.ts,
 * plan-files-safety.svelte.test.ts): small samples, one "browser" (its database, locks,
 * preferences and a folder on disk that the picker gives), opened tabs that are disposed after each
 * test, and files as a picker hands them over. Tests only.
 */
import { IDBFactory } from 'fake-indexeddb';
import { expect, vi } from 'vitest';
import { createFolderProvider } from '../storage/folder';
import { createLocalStore } from '../storage/local-store';
import { createAcquire } from '../storage/lock';
import type { LocalStore } from '../storage/store-types';
import { fakeLocks } from '../storage/testing/fake-locks';
import { FakeFs, memoryHandles } from '../storage/testing/fake-fsa';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';
import { folderProvider } from './plan-files';
import type { ListedStorage } from './storage';

export const enc = new TextEncoder();

const sample = (id: string, label: string, files: Record<string, string>): Sample => ({
	id: id as Sample['id'],
	label,
	load: () => Promise.resolve({ entry: 'plan.tjp', files }),
});

/** A BOM, CRLF and an include in a folder. */
export const SAMPLE = sample('one', 'One', {
	'plan.tjp': '﻿project p "P" 2026-01-05 +1m\r\ninclude "lib/x.tji"\r\n',
	'lib/x.tji': 'task x "X"\n',
});
export const OTHER = sample('two', 'Two', { 'plan.tjp': 'project q "Q" 2026-01-05 +1m\n' });
/** Two files whose paths differ only by case. */
export const CASES = sample('cases', 'Cases', {
	'plan.tjp': 'project c "C" 2026-01-05 +1m\n',
	'lib.tji': '',
	'LIB.tji': '',
});
/** A file that is not UTF-8 (Latin-1 "é"). */
export const LATIN1 = Uint8Array.of(
	...enc.encode('# caf'),
	0xe9,
	...enc.encode('\nresource r "R"\n'),
);

export function memory(): ListedStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		get length() {
			return data.size;
		},
		key: (i) => [...data.keys()][i] ?? null,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
}

/**
 * One browser with a folder on disk, as the picker gives it. `store` replaces the tabs' local store
 * (one that refuses, say).
 */
export function browser(fs = new FakeFs('acme'), o: { readonly store?: () => LocalStore } = {}) {
	const factory = new IDBFactory();
	const prefs = memory();
	const locks = fakeLocks();
	const store = createLocalStore({ indexedDB: factory, marker: null });
	const handles = memoryHandles();
	let picked = fs;
	folderProvider(createFolderProvider({ handles, pick: async () => picked.root }));
	const confirm = vi.fn((_m: string) => true);
	const tab = (): AppState =>
		new AppState({
			client: new FakeEngineClient(),
			samples: [SAMPLE, OTHER, CASES],
			confirm,
			keyTarget: null,
			prefs,
			store: o.store?.() ?? createLocalStore({ indexedDB: factory, marker: null }),
			acquire: createAcquire({ locks, handoverMs: 200 }),
		});
	return { fs, store, prefs, handles, confirm, tab, pickNext: (f: FakeFs) => (picked = f) };
}

/** The tabs opened in a test; `disposeOpened` in an `afterEach`. */
const opened: AppState[] = [];

export function disposeOpened(): void {
	for (const a of opened.splice(0)) a.dispose();
}

export async function ready(a: AppState): Promise<AppState> {
	opened.push(a);
	await vi.waitFor(() => expect(a.phase).toBe('ready'));
	await flush();
	return a;
}

/** A picked file; `folder` '' for a plain file pick, else a folder import's top folder. */
export function picked(path: string, bytes: Uint8Array | string, folder = 'acme'): File {
	const b = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
	const name = path.slice(path.lastIndexOf('/') + 1);
	const f = new File([b as Uint8Array<ArrayBuffer>], name);
	Object.defineProperty(f, 'webkitRelativePath', {
		value: folder === '' ? '' : `${folder}/${path}`,
	});
	return f;
}

export const texts = (a: AppState): Record<string, string> => a.workspace?.texts() ?? {};
