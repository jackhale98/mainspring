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
import { MARKER_KEY } from '../storage/marker';
import { statusOf } from '../sync/shown';
import { LAST_PLAN_KEY, type ListedStorage } from './storage';

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
		o: {
			initial?: string;
			store?: LocalStore;
			confirm?: () => boolean;
			keeper?: () => Promise<typeof import('./plan-keeper')>;
			acquire?: ReturnType<typeof createAcquire>;
		} = {},
	): AppState => {
		const app = new AppState({
			client: new FakeEngineClient(),
			samples: [A, B],
			confirm: o.confirm ?? (() => true),
			keyTarget: null,
			initial: o.initial ?? null,
			prefs,
			store: o.store ?? createLocalStore({ indexedDB: factory, marker: prefs }),
			acquire: o.acquire ?? createAcquire({ locks, handoverMs: 200 }),
			...(o.keeper && { keeper: o.keeper }),
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
		expect(a.keeping.keep).toEqual({ kind: 'sample' });
		expect(statusOf(a)).toEqual({ kind: 'sample' });
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
		await vi.waitFor(() => expect(a.keeping.keep.kind).toBe('stored'));
		expect(statusOf(a)).toMatchObject({ kind: 'browser-only' });
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
		await vi.waitFor(() => expect(first.keeping.keep.kind).toBe('stored'), { timeout: 3000 });
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
		// "Last kept" is when the store last wrote the plan, from the start (T14).
		expect(statusOf(again)).toMatchObject({ kind: 'browser-only', savedAt: expect.any(Number) });
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
		expect(a.keeping.keep).toEqual({ kind: 'stored', at: null });
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
		await vi.waitFor(() => expect(tabA.keeping.keep.kind).toBe('stored'));

		const tabB = await ready(b.tab());
		expect(tabB.storedId).toBe(id);
		expect(tabB.readOnly).toBe(true);
		expect(tabB.heldElsewhere).toBe(id);
		expect(statusOf(tabB)).toEqual({ kind: 'read-only' });
		expect(tabB.history.canUndo).toBe(false);
		// The editor cannot change the text.
		await tabB.ensureEditor();
		expect(tabB.workspace?.state('plan.tjp').readOnly).toBe(true);
		// Views cannot edit: there is no edit dispatcher (they offer no edit then, T4 review L4).
		expect(tabB.edits).toBeNull();

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
		expect(statusOf(tabA)).toEqual({ kind: 'read-only' });

		// B's changes are stored; A, read-only, stores nothing more.
		type(tabB, 'plan.tjp', '# B\n');
		expect(await tabB.flush()).toBe(true);
		const reader = createLocalStore({ indexedDB: b.factory, marker: null });
		expect((await reader.open(id))?.files.get('plan.tjp')).toBe(`# B\n# A2\n# A1\n${PLAN}`);
		// Read-only, an undo says nothing about a history (L4).
		tabA.note = null;
		tabA.history.undo();
		expect(tabA.note).toBeNull();

		// A takes the plan back and types: kept (a reopened plan starts its versions at 0, H1).
		expect(await tabA.openStored(id, { steal: true })).toBe(true);
		await vi.waitFor(() => expect(tabB.readOnly).toBe(true));
		type(tabA, 'plan.tjp', '# A again\n');
		expect(await tabA.flush()).toBe(true);
		expect(tabA.keeping.keep.kind).toBe('stored');
		expect((await reader.open(id))?.files.get('plan.tjp')).toBe(
			`# A again\n# B\n# A2\n# A1\n${PLAN}`,
		);
	});

	it('keeps changes the store refused on screen and asks before dropping them, when another tab took the plan (N1)', async () => {
		const b = browser();
		// An old browser: no Web Locks, no BroadcastChannel. Both tabs edit; the store's owner
		// epoch says which one owns the plan (the one that opened it last).
		const blind = createAcquire({ locks: null, channel: () => null });
		const confirm = vi.fn(() => false);
		const tabX = await ready(b.tab({ acquire: blind, confirm }));
		type(tabX, 'plan.tjp', '# X1\n');
		await vi.waitFor(() => expect(tabX.storedId).not.toBeNull(), { timeout: 3000 });
		const id = tabX.storedId ?? '';
		await vi.waitFor(() => expect(tabX.keeping.keep.kind).toBe('stored'));
		expect(await tabX.flush()).toBe(true);
		const tabY = await ready(b.tab({ acquire: blind }));
		expect(tabY.storedId).toBe(id);
		expect(tabY.readOnly).toBe(false);

		type(tabX, 'plan.tjp', '# X2\n');
		type(tabY, 'lib/x.tji', '# Y\n');
		expect(await tabY.flush()).toBe(true);
		expect(await tabX.flush()).toBe(false);
		// X: read-only, its changes on screen, said to be kept nowhere, and dirty.
		expect(tabX.readOnly).toBe(true);
		expect(tabX.keeping.keep).toMatchObject({ kind: 'failed', error: { kind: 'not-owner' } });
		expect(tabX.dirty).toBe(true);
		expect(statusOf(tabX)).toMatchObject({ kind: 'failed', where: 'store' });
		expect(tabX.workspace?.texts()['plan.tjp']).toBe(`# X2\n# X1\n${PLAN}`);
		// "Open here instead" and a switch ask first, and stay when the answer is no.
		expect(await tabX.openStored(id, { steal: true })).toBe(false);
		expect(confirm).toHaveBeenLastCalledWith(strings.keep.confirmTake);
		expect(await tabX.openSample('two')).toBe(false);
		expect(confirm).toHaveBeenLastCalledWith(strings.topBar.confirmSwitch);
		expect(tabX.workspace?.texts()['plan.tjp']).toBe(`# X2\n# X1\n${PLAN}`);
		// Yes: the plan opens here as it is stored (with Y's change), and X edits it again.
		confirm.mockReturnValue(true);
		expect(await tabX.openStored(id, { steal: true })).toBe(true);
		expect(tabX.readOnly).toBe(false);
		expect(tabX.dirty).toBe(false);
		expect(tabX.workspace?.texts()['plan.tjp']).toBe(`# X1\n${PLAN}`);
		expect(tabX.workspace?.texts()['lib/x.tji']).toMatch(/^# Y\n/);
	});

	it('flush stores what autosave holds at once, and keeping opens the database before the first save (L1)', async () => {
		const b = browser();
		const real = createLocalStore({ indexedDB: b.factory, marker: b.prefs });
		const calls: string[] = [];
		const spy: LocalStore = {
			...real,
			plans: () => (calls.push('plans'), real.plans()),
			create: (...a) => (calls.push('create'), real.create(...a)),
			saveFiles: (...a) => (calls.push('saveFiles'), real.saveFiles(...a)),
		};
		const a = await ready(b.tab({ store: spy }));
		type(a, 'plan.tjp', '# 1\n');
		// The keeper loads on the first change and lists the plans: the database is open before the
		// first save, which can then start its transaction in a pagehide task.
		await vi.waitFor(() => expect(calls[0]).toBe('plans'));
		expect(calls).not.toContain('create');
		expect(await a.flush()).toBe(true);
		expect(calls).toContain('create');
		type(a, 'plan.tjp', '# 2\n');
		expect(await a.flush()).toBe(true);
		const id = a.storedId ?? '';
		expect((await real.open(id))?.files.get('plan.tjp')).toBe(`# 2\n# 1\n${PLAN}`);
	});

	it('lists the plans kept here, newest first, and opens one of them', async () => {
		const b = browser();
		const a = await ready(b.tab());
		type(a, 'plan.tjp', '# mine\n');
		await vi.waitFor(() => expect(a.storedId).not.toBeNull(), { timeout: 3000 });
		const copy = a.storedId ?? '';
		await vi.waitFor(() => expect(a.keeping.plans.map((p) => p.id)).toEqual([copy]));
		expect(await a.openNewPlan({ name: 'Web', start: '2026-11-16', timezone: null })).toBe(true);
		const web = a.storedId ?? '';
		await vi.waitFor(() => expect(a.keeping.plans.map((p) => p.id)).toEqual([web, copy]));
		// A pick in the chooser opens the copy, with its edit.
		expect(await a.openStored(copy)).toBe(true);
		expect(a.workspace?.texts()['plan.tjp']).toBe(`# mine\n${PLAN}`);
		expect(a.planLabel).toBe('One (copy)');
	});

	it('keeps the last-plan pointer when the keeper chunk cannot load, says so, and Retry opens it (H2)', async () => {
		const b = browser();
		const first = await ready(b.tab());
		type(first, 'plan.tjp', '# kept\n');
		await vi.waitFor(() => expect(first.keeping.keep.kind).toBe('stored'), { timeout: 3000 });
		const id = first.storedId ?? '';
		first.dispose();
		open = open.filter((x) => x !== first);
		await vi.waitFor(() => expect(b.locks.isHeld(`mainspring.plan.${id}`)).toBe(false));

		let fail = true;
		const real = () => import('./plan-keeper');
		const keeper = () => (fail ? Promise.reject(new Error('chunk')) : real());
		const a = await ready(b.tab({ keeper }));
		// A sample opens meanwhile; it does not become the last plan.
		expect(a.planKey).toBe('one');
		expect(a.keeping.unopened).toBe(id);
		expect(b.prefs.getItem(LAST_PLAN_KEY)).toBe(`ws:${id}`);
		fail = false;
		expect(await a.openStored(id)).toBe(true);
		expect(a.keeping.unopened).toBeNull();
		expect(a.workspace?.texts()['plan.tjp']).toBe(`# kept\n${PLAN}`);
	});

	it('does not open a damaged plan: the lock goes back, a sample opens, the pointer stays (M2)', async () => {
		const b = browser();
		const real = createLocalStore({ indexedDB: b.factory, marker: b.prefs });
		const id = await real.create(
			{ name: 'Broken', entry: 'plan.tjp', location: { kind: 'browser' }, from: { opened: true } },
			new Map([['other.tji', 'task x "X"\n']]),
			null,
		);
		b.prefs.setItem(LAST_PLAN_KEY, `ws:${id}`);
		const a = await ready(b.tab());
		expect(a.planKey).toBe('one');
		expect(a.keeping.unopened).toBe(id);
		expect(b.prefs.getItem(LAST_PLAN_KEY)).toBe(`ws:${id}`);
		await vi.waitFor(() => expect(b.locks.isHeld(`mainspring.plan.${id}`)).toBe(false));
	});

	it('has nothing to edit before the keeper chunk has loaded a stored plan (M3)', async () => {
		const b = browser();
		const first = await ready(b.tab());
		type(first, 'plan.tjp', '# kept\n');
		await vi.waitFor(() => expect(first.keeping.keep.kind).toBe('stored'), { timeout: 3000 });
		first.dispose();
		open = open.filter((x) => x !== first);
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		const keeper = () => held.then(() => import('./plan-keeper'));
		const a = b.tab({ keeper });
		open.push(a);
		await flush();
		expect(a.phase).toBe('loading');
		expect(a.workspace).toBeNull();
		expect(a.edits).toBeNull();
		release();
		await vi.waitFor(() => expect(a.phase).toBe('ready'));
		expect(a.storedId).not.toBeNull();
		expect(a.workspace?.texts()['plan.tjp']).toBe(`# kept\n${PLAN}`);
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
		await vi.waitFor(() => expect(first.keeping.keep.kind).toBe('stored'), { timeout: 3000 });
		first.dispose();
		open = open.filter((x) => x !== first);
		await vi.waitFor(() => expect(b.locks.isHeld(`mainspring.plan.${first.storedId}`)).toBe(false));

		const confirm = vi.fn(() => false);
		const a = await ready(b.tab({ store: failing, confirm }));
		expect(a.keeping.keep.kind).toBe('stored');
		type(a, 'plan.tjp', '# 2\n');
		expect(await a.openSample('two')).toBe(false);
		expect(confirm).toHaveBeenCalledWith(strings.topBar.confirmSwitch);
		expect(a.keeping.keep).toEqual({ kind: 'failed', error: storageError('quota', 'full') });
		expect(statusOf(a)).toMatchObject({ kind: 'failed', where: 'store' });
		expect(a.dirty).toBe(true);
	});

	it('says once that the browser cleared its plans, and opens the first sample instead of the lost one', async () => {
		const b = browser();
		const first = await ready(b.tab());
		type(first, 'plan.tjp', '# 1\n');
		await vi.waitFor(() => expect(first.keeping.keep.kind).toBe('stored'), { timeout: 3000 });
		first.dispose();
		open = open.filter((x) => x !== first);
		expect(b.prefs.getItem(MARKER_KEY)).toBe('1');
		// The browser clears IndexedDB (not localStorage).
		const evicted = createLocalStore({ indexedDB: new IDBFactory(), marker: b.prefs });
		const a = await ready(b.tab({ store: evicted }));
		await vi.waitFor(() => expect(a.keeping.cleared).toBe(true));
		expect(a.planKey).toBe('one');
		expect(a.storedId).toBeNull();
		const later = await ready(b.tab({ store: evicted }));
		await flush();
		expect(later.keeping.cleared).toBe(false);
	});
});
