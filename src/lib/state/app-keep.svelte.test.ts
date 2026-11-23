// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Plans kept in the browser, in the app state (phase-4.md 7.1, 9.4, 18.7; app-storage.ts): a
// sample opens unstored and its first change stores "Label (copy)" with the sample's preferences as
// defaults; the last plan opens on start with its exact text and an empty history whose first undo
// says so; the address's sample wins; a new plan is stored at once; a second tab is read-only until
// "Open here instead", which makes the first one read-only; a store failure is shown and makes the
// changes "dirty"; the eviction notice; a last plan that is gone. On fake-indexeddb, a fake lock
// manager and an in-memory `localStorage`, shared by the "tabs" of a test.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../strings';
import { createLocalStore } from '../storage/local-store';
import { createAcquire } from '../storage/lock';
import type { LocalStore } from '../storage/store-types';
import { fakeLocks } from '../storage/testing/fake-locks';
import { StorageFailure, storageError } from '../storage/types';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';
import { LAST_PLAN_KEY, MARKER_KEY, type ListedStorage } from './storage';

const PLAN =
	'project p "P" 2026-01-05 +1m\r\ninclude "lib/x.tji"\r\ntask a "Alpha" { effort 1d }\r\n';
const A: Sample = {
	id: 'one' as Sample['id'],
	label: 'One',
	load: () =>
		Promise.resolve({
			entry: 'plan.tjp',
			files: { 'plan.tjp': PLAN, 'lib/x.tji': '﻿task x "X"\n' },
		}),
};
const B: Sample = {
	id: 'two' as Sample['id'],
	label: 'Two',
	load: () =>
		Promise.resolve({ entry: 'plan.tjp', files: { 'plan.tjp': 'project q "Q" 2026-01-05 +1m\n' } }),
};

/** `localStorage` in memory, listable like the real one. */
function memory(): ListedStorage & Pick<Storage, 'removeItem'> & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		get length() {
			return data.size;
		},
		key: (i) => [...data.keys()][i] ?? null,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k),
	};
}

/** One browser: its database, its locks and its `localStorage`, shared by its tabs. */
function browser() {
	const factory = new IDBFactory();
	const prefs = memory();
	const locks = fakeLocks();
	const apps: AppState[] = [];
	const tab = (
		o: { initial?: string; store?: LocalStore; confirm?: () => boolean } = {},
	): AppState => {
		const app = new AppState({
			client: new FakeEngineClient(),
			samples: [A, B],
			confirm: o.confirm ?? (() => true),
			keyTarget: null,
			initial: o.initial ?? null,
			prefs,
			store: o.store ?? createLocalStore({ indexedDB: factory, marker: prefs }),
			acquire: createAcquire({ locks, handoverMs: 200 }),
		});
		apps.push(app);
		return app;
	};
	return { factory, prefs, locks, tab, apps };
}

let open: AppState[] = [];
afterEach(() => {
	for (const a of open) a.dispose();
	open = [];
});

function type(a: AppState, path: string, insert: string): void {
	const ws = a.workspace;
	const state = ws?.state(path);
	if (!ws || !state) throw new Error('no workspace');
	ws.commit(
		path,
		state.update({ changes: { from: 0, insert }, userEvent: 'input.type' }),
		'typing',
	);
}

async function ready(a: AppState): Promise<AppState> {
	open.push(a);
	await vi.waitFor(() => expect(a.phase).toBe('ready'));
	await flush();
	return a;
}

describe('plans kept in the browser', () => {
	it('opens a sample unstored; its first change stores a copy, and the sample stays as it was', async () => {
		const b = browser();
		b.prefs.setItem('mainspring.mode.one', 'visual');
		b.prefs.setItem('mainspring.gantt.zoom.one', '12');
		const a = await ready(b.tab());
		expect(a.planKey).toBe('one');
		expect(a.storedId).toBeNull();
		expect(a.keep).toEqual({ kind: 'sample' });
		expect(a.keepLine).toBe(strings.keep.sample);
		const serial = a.openSerial;

		type(a, 'plan.tjp', '# mine\n');
		await vi.waitFor(() => expect(a.storedId).not.toBeNull(), { timeout: 3000 });
		const id = a.storedId ?? '';
		expect(a.planKey).toBe(`ws:${id}`);
		expect(a.planLabel).toBe('One (copy)');
		// The same plan, still on screen: nothing opened again.
		expect(a.openSerial).toBe(serial);
		expect(b.prefs.getItem(LAST_PLAN_KEY)).toBe(`ws:${id}`);
		// The sample's preferences are the copy's defaults; the sample keeps its own.
		expect(b.prefs.getItem(`mainspring.mode.ws:${id}`)).toBe('visual');
		expect(b.prefs.getItem(`mainspring.gantt.zoom.ws:${id}`)).toBe('12');
		expect(b.prefs.getItem('mainspring.mode.one')).toBe('visual');
		await vi.waitFor(() => expect(a.keep.kind).toBe('stored'));
		expect(a.keepLine).toBe(strings.keep.stored);
		expect(a.dirty).toBe(false);

		const store = createLocalStore({ indexedDB: b.factory, marker: null });
		const kept = await store.open(id);
		expect(kept?.plan).toMatchObject({
			name: 'One (copy)',
			from: { sample: 'one' },
			location: { kind: 'browser' },
		});
		expect(kept?.files.get('plan.tjp')).toBe(`# mine\n${PLAN}`);
		expect(kept?.files.get('lib/x.tji')).toBe('﻿task x "X"\n');

		// Switching plans no longer asks: nothing is lost.
		const confirm = vi.fn(() => false);
		const c = await ready(b.tab({ confirm }));
		expect(c.planKey).toBe(`ws:${id}`);
		// (that tab is read-only: `a` still has the plan; see below)
		expect(await a.openSample('one')).toBe(true);
		expect(a.storedId).toBeNull();
		expect(a.workspace?.texts()['plan.tjp']).toBe(PLAN);
	});

	it('opens the last plan on start with its exact text and an empty history; the first undo says so', async () => {
		const b = browser();
		const first = await ready(b.tab());
		type(first, 'lib/x.tji', 'task y "Y"\r\n');
		await vi.waitFor(() => expect(first.keep.kind).toBe('stored'), { timeout: 3000 });
		const id = first.storedId;
		first.dispose();
		open = open.filter((x) => x !== first);
		// The lock is given up once what autosave held is stored.
		await vi.waitFor(() => expect(b.locks.isHeld(`mainspring.plan.${id}`)).toBe(false));

		const again = await ready(b.tab());
		expect(again.storedId).toBe(id);
		expect(again.readOnly).toBe(false);
		expect(again.planLabel).toBe('One (copy)');
		expect(again.workspace?.texts()).toEqual({
			'plan.tjp': PLAN,
			'lib/x.tji': 'task y "Y"\r\n﻿task x "X"\n',
		});
		expect(again.history.canUndo).toBe(false);
		again.history.undo();
		expect(again.note).toBe(strings.history.reopened);
		// Once something changed, an empty undo says nothing of the sort.
		type(again, 'plan.tjp', '# a\n');
		again.history.undo();
		again.note = null;
		again.history.undo();
		expect(again.note).toBeNull();
	});

	it('opens the sample the address names, whatever the last plan was', async () => {
		const b = browser();
		const first = await ready(b.tab());
		type(first, 'plan.tjp', '# mine\n');
		await vi.waitFor(() => expect(first.storedId).not.toBeNull(), { timeout: 3000 });
		const linked = await ready(b.tab({ initial: 'two' }));
		expect(linked.planKey).toBe('two');
		expect(linked.storedId).toBeNull();
		expect(linked.readOnly).toBe(false);
	});

	it('stores a new plan at once, and lists it as "Name (new)" after a reload', async () => {
		const b = browser();
		const a = await ready(b.tab());
		expect(await a.openNewPlan({ name: 'Website', start: '2026-11-16', timezone: null })).toBe(
			true,
		);
		const id = a.storedId;
		expect(id).not.toBeNull();
		expect(a.planKey).toBe(`ws:${id}`);
		expect(a.fresh).toBe(true);
		expect(a.keep).toEqual({ kind: 'stored', at: null });
		a.dispose();
		open = open.filter((x) => x !== a);
		await vi.waitFor(() => expect(b.locks.isHeld(`mainspring.plan.${id}`)).toBe(false));
		const again = await ready(b.tab());
		expect(again.storedId).toBe(id);
		expect(again.planLabel).toBe('Website (new)');
		expect(again.fresh).toBe(false);
	});

	it('shows a plan another tab has read-only; "Open here instead" takes it, and the other tab is read-only', async () => {
		const b = browser();
		const tabA = await ready(b.tab());
		type(tabA, 'plan.tjp', '# A1\n');
		await vi.waitFor(() => expect(tabA.storedId).not.toBeNull(), { timeout: 3000 });
		const id = tabA.storedId ?? '';
		await vi.waitFor(() => expect(tabA.keep.kind).toBe('stored'));

		const tabB = await ready(b.tab());
		expect(tabB.storedId).toBe(id);
		expect(tabB.readOnly).toBe(true);
		expect(tabB.heldElsewhere).toBe(id);
		expect(tabB.keepLine).toBe(strings.keep.readOnly);
		expect(tabB.history.canUndo).toBe(false);
		// The editor cannot change the text.
		await tabB.ensureEditor();
		expect(tabB.workspace?.state('plan.tjp').readOnly).toBe(true);
		// Views cannot edit: the dispatcher answers `cancelled`.
		const outcome = await tabB.edits?.dispatch(
			{ type: 'setEffort', task: 'a', value: '2d' } as never,
			{ label: { text: 'set effort' } } as never,
		);
		expect(outcome).toEqual({ status: 'cancelled' });

		// A types again; B takes the plan over, and gets A's newest text (A stored it first).
		type(tabA, 'plan.tjp', '# A2\n');
		expect(await tabB.openStored(id, { steal: true })).toBe(true);
		expect(tabB.readOnly).toBe(false);
		expect(tabB.heldElsewhere).toBeNull();
		expect(tabB.workspace?.state('plan.tjp').readOnly).toBe(false);
		expect(tabB.workspace?.texts()['plan.tjp']).toBe(`# A2\n# A1\n${PLAN}`);
		await vi.waitFor(() => expect(tabA.readOnly).toBe(true));
		expect(tabA.heldElsewhere).toBeNull();
		await tabA.ensureEditor();
		expect(tabA.workspace?.state('plan.tjp').readOnly).toBe(true);
		expect(tabA.keepLine).toBe(strings.keep.readOnly);

		// B's changes are stored; A, read-only, stores nothing more.
		type(tabB, 'plan.tjp', '# B\n');
		expect(await tabB.openSample('two')).toBe(true);
		const kept = await createLocalStore({ indexedDB: b.factory, marker: null }).open(id);
		expect(kept?.files.get('plan.tjp')).toBe(`# B\n# A2\n# A1\n${PLAN}`);
	});

	it('shows a store that fails, and asks before switching then, since the changes are only in this tab', async () => {
		const b = browser();
		const real = createLocalStore({ indexedDB: b.factory, marker: b.prefs });
		const failing: LocalStore = {
			...real,
			saveFiles: () => Promise.reject(new StorageFailure(storageError('quota', 'full'))),
		};
		const first = await ready(b.tab());
		type(first, 'plan.tjp', '# 1\n');
		await vi.waitFor(() => expect(first.keep.kind).toBe('stored'), { timeout: 3000 });
		first.dispose();
		open = open.filter((x) => x !== first);
		await vi.waitFor(() => expect(b.locks.isHeld(`mainspring.plan.${first.storedId}`)).toBe(false));

		const confirm = vi.fn(() => false);
		const a = await ready(b.tab({ store: failing, confirm }));
		expect(a.keep.kind).toBe('stored');
		type(a, 'plan.tjp', '# 2\n');
		expect(await a.openSample('two')).toBe(false);
		expect(confirm).toHaveBeenCalledWith(strings.topBar.confirmSwitch);
		expect(a.keep).toEqual({ kind: 'failed', error: storageError('quota', 'full') });
		expect(a.keepLine).toBe(strings.keep.failed);
		expect(a.dirty).toBe(true);
	});

	it('says once that the browser cleared its plans, and opens the first sample instead of the lost one', async () => {
		const b = browser();
		const first = await ready(b.tab());
		type(first, 'plan.tjp', '# 1\n');
		await vi.waitFor(() => expect(first.keep.kind).toBe('stored'), { timeout: 3000 });
		first.dispose();
		open = open.filter((x) => x !== first);
		expect(b.prefs.getItem(MARKER_KEY)).toBe('1');
		// The browser clears IndexedDB (not localStorage).
		const evicted = createLocalStore({ indexedDB: new IDBFactory(), marker: b.prefs });
		const a = await ready(b.tab({ store: evicted }));
		await vi.waitFor(() => expect(a.cleared).toBe(true));
		expect(a.planKey).toBe('one');
		expect(a.storedId).toBeNull();
		const later = await ready(b.tab({ store: evicted }));
		await flush();
		expect(later.cleared).toBe(false);
	});
});
