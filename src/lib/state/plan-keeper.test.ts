// SPDX-License-Identifier: GPL-2.0-or-later
// The keeper (plan-keeper.ts): finding a stored plan with its lock (read-only when another tab has
// it, the lock given back when the plan is gone), a new plan stored at once, a plan opened
// unstored stored whole by its first save with the sample's preferences copied once, a lost lock
// that stops the saves, and changes that a lost plan leaves unstored, which are reported (T4
// re-check N1). On fake-indexeddb and the fake lock manager.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createLocalStore } from '../storage/local-store';
import { createAcquire, type HeldLock } from '../storage/lock';
import type { LocalStore } from '../storage/store-types';
import { fakeLocks } from '../storage/testing/fake-locks';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { planKey } from './app-storage';
import { copyPlanPrefs, PlanKeeper, type KeeperHost, type Kept } from './plan-keeper';
import type { ListedStorage } from './storage';

function memory(entries: Record<string, string> = {}): ListedStorage {
	const data = new Map(Object.entries(entries));
	return {
		get length() {
			return data.size;
		},
		key: (i) => [...data.keys()][i] ?? null,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
}

function rig() {
	const factory = new IDBFactory();
	const locks = fakeLocks();
	const prefs = memory({ 'mainspring.mode.one': 'text', 'mainspring.theme': 'dark' });
	const events: string[] = [];
	const host: KeeperHost = {
		saved: (_k, st) =>
			events.push(st.kind === 'failed' ? `saved failed ${st.error.kind}` : `saved ${st.kind}`),
		stored: (_k, id, key, label) => events.push(`stored ${key === `ws:${id}`} ${label}`),
		lost: () => events.push('lost'),
	};
	const keeper = (
		tab = createAcquire({ locks, handoverMs: 50 }),
		store: LocalStore = createLocalStore({ indexedDB: factory, marker: null }),
	) =>
		new PlanKeeper(host, {
			store,
			acquire: tab,
			prefs,
			keyOf: planKey,
		});
	return { factory, locks, prefs, events, keeper };
}

const SEED = { entry: 'plan.tjp', files: { 'plan.tjp': 'project p "P" 2026-01-05 +1m\n' } };
const workspace = (): Workspace => createWorkspace(SEED);

function type(ws: Workspace, insert: string): void {
	const state = ws.state('plan.tjp');
	ws.commit('plan.tjp', state.update({ changes: { from: 0, insert } }), 'typing');
}

describe('copyPlanPrefs', () => {
	it('copies every preference of one plan to another, keeping what the other has', () => {
		const p = memory({
			'mainspring.mode.one': 'text',
			'mainspring.gantt.zoom.one': '12',
			'mainspring.split.ws:x': 'mine',
			'mainspring.split.one': 'theirs',
			'mainspring.mode.oner': 'not this plan',
			'mainspring.theme': 'dark',
			'other.one': 'not ours',
		});
		copyPlanPrefs(p, 'one', 'ws:x');
		expect(p.getItem('mainspring.mode.ws:x')).toBe('text');
		expect(p.getItem('mainspring.gantt.zoom.ws:x')).toBe('12');
		expect(p.getItem('mainspring.split.ws:x')).toBe('mine');
		expect(p.getItem('mainspring.mode.ws:xr')).toBeNull();
		expect(p.getItem('other.ws:x')).toBeNull();
		expect(p.length).toBe(9);
		// No storage, or one that throws: nothing happens.
		expect(() => copyPlanPrefs(null, 'one', 'two')).not.toThrow();
		const broken = {
			...p,
			getItem: () => {
				throw new Error('blocked');
			},
		} as ListedStorage;
		expect(() => copyPlanPrefs(broken, 'one', 'two')).not.toThrow();
	});
});

describe('PlanKeeper', () => {
	it('stores a new plan at once with its lock, and finds it again', async () => {
		const r = rig();
		const k = r.keeper();
		const made = await k.create({ name: 'Web', label: 'Web (new)', from: { newPlan: true } }, SEED);
		expect(made).toMatchObject({ label: 'Web (new)', fresh: true, unstored: null });
		const id = made.stored?.id ?? '';
		expect(made.key).toBe(`ws:${id}`);
		expect(r.locks.isHeld(`mainspring.plan.${id}`)).toBe(true);
		made.stored?.lock?.release();
		await vi.waitFor(() => expect(r.locks.isHeld(`mainspring.plan.${id}`)).toBe(false));

		const found = await r.keeper().find(id, false);
		expect(found).toMatchObject({ key: `ws:${id}`, label: 'Web (new)', restored: true });
		expect(await found?.load()).toEqual(SEED);
		expect(found?.stored?.lock).not.toBeNull();
	});

	it('finds a plan another tab has with no lock (read-only), and nothing for a bad or missing id', async () => {
		const r = rig();
		const made = await r.keeper().create({ name: 'A', label: 'A', from: { opened: true } }, SEED);
		const id = made.stored?.id ?? '';
		const other = await r.keeper(createAcquire({ locks: r.locks })).find(id, false);
		expect(other?.stored).toEqual({ id, lock: null });
		const k = r.keeper();
		expect(await k.find('not an id!', false)).toBeNull();
		expect(await k.find('missing', false)).toBeNull();
		// The lock taken for a plan that is not there is given back.
		await vi.waitFor(() => expect(r.locks.isHeld('mainspring.plan.missing')).toBe(false));
	});

	it('stores a plan opened unstored whole on its first save, and copies its preferences once', async () => {
		const r = rig();
		const ws = workspace();
		const kept: Kept = r.keeper().keep(
			ws,
			null,
			null,
			{
				name: 'One (copy)',
				label: 'One (copy)',
				from: { sample: 'poc-sample' },
			},
			'one',
		);
		type(ws, '# 1\n');
		await kept.flush();
		expect(r.events).toEqual(['stored true One (copy)', 'saved saved']);
		const plans = await createLocalStore({ indexedDB: r.factory, marker: null }).plans();
		expect(plans).toHaveLength(1);
		const id = plans[0]?.id ?? '';
		expect(r.prefs.getItem(`mainspring.mode.ws:${id}`)).toBe('text');
		expect(r.locks.isHeld(`mainspring.plan.${id}`)).toBe(true);
		// Later saves write the changed files only, to the same plan.
		type(ws, '# 2\n');
		await kept.flush();
		const back = await createLocalStore({ indexedDB: r.factory, marker: null }).open(id);
		expect(back?.files.get('plan.tjp')).toBe(`# 2\n# 1\n${SEED.files['plan.tjp']}`);
		kept.end();
		await vi.waitFor(() => expect(r.locks.isHeld(`mainspring.plan.${id}`)).toBe(false));
	});

	it('turns read-only and says the changes were not kept when the store refuses them (M1, N1)', async () => {
		const r = rig();
		// No lock tells this tab that it lost the plan: only the store's owner epoch does.
		const blind = createAcquire({ locks: null, channel: () => null });
		const tabA = r.keeper(blind);
		const made = await tabA.create({ name: 'A', label: 'A', from: { opened: true } }, SEED);
		const id = made.stored?.id ?? '';
		const ws = workspace();
		const release = vi.fn();
		const lock: HeldLock = {
			release,
			lost: new Promise(() => undefined),
			onAsked: () => undefined,
		};
		const kept = tabA.keep(ws, id, lock, null, made.key);
		await r.keeper(blind).find(id, true);
		type(ws, '# late\n');
		await kept.flush();
		// Reported, not dropped: the tab says so and asks before the changes go (T4 re-check N1).
		expect(r.events).toEqual(['saved failed not-owner', 'lost']);
		// It owns nothing any more.
		expect(release).toHaveBeenCalled();
		const back = await createLocalStore({ indexedDB: r.factory, marker: null }).open(id);
		expect(back?.files.get('plan.tjp')).toBe(SEED.files['plan.tjp']);
		// Nothing more is tried.
		type(ws, '# later\n');
		await kept.flush();
		expect(r.events).toEqual(['saved failed not-owner', 'lost']);
	});

	it('says a slow save was not kept when another tab takes the plan by force meanwhile (N1)', async () => {
		const r = rig();
		const real = createLocalStore({ indexedDB: r.factory, marker: null });
		let go!: () => void;
		const gate = new Promise<void>((g) => (go = g));
		const slow: LocalStore = {
			...real,
			saveFiles: async (...a) => {
				await gate;
				return real.saveFiles(...a);
			},
		};
		// A lets go only once its save is stored; B does not wait that long.
		const tabA = r.keeper(createAcquire({ locks: r.locks, handoverMs: 5000 }), slow);
		const made = await tabA.create({ name: 'A', label: 'A', from: { opened: true } }, SEED);
		const id = made.stored?.id ?? '';
		const ws = workspace();
		const kept = tabA.keep(ws, id, made.stored?.lock ?? null, null, made.key);
		type(ws, '# slow\n');
		const saving = kept.flush();
		const taken = await r.keeper(createAcquire({ locks: r.locks, handoverMs: 50 })).find(id, true);
		expect(taken?.stored?.lock).not.toBeNull();
		await vi.waitFor(() => expect(r.events).toContain('lost'));
		go();
		await saving;
		await vi.waitFor(() => expect(r.events).toContain('saved failed not-owner'));
		expect(r.events).not.toContain('saved saved');
		expect(await taken?.load()).toEqual(SEED);
	});

	it('says what autosave still held was not kept when the lock is lost before it was stored (N1)', async () => {
		const r = rig();
		const tabA = r.keeper();
		const made = await tabA.create({ name: 'A', label: 'A', from: { opened: true } }, SEED);
		const id = made.stored?.id ?? '';
		made.stored?.lock?.release();
		// A frozen tab that wakes up: its lock was taken by force before autosave ran.
		let lose!: () => void;
		const lock: HeldLock = {
			release: () => undefined,
			lost: new Promise((l) => (lose = l)),
			onAsked: () => undefined,
		};
		const ws = workspace();
		tabA.keep(ws, id, lock, null, made.key);
		type(ws, '# frozen\n');
		lose();
		await vi.waitFor(() => expect(r.events).toEqual(['lost', 'saved failed not-owner']));
		const back = await createLocalStore({ indexedDB: r.factory, marker: null }).open(id);
		expect(back?.files.get('plan.tjp')).toBe(SEED.files['plan.tjp']);
	});

	it('stops saving when another tab takes the plan, after storing what it held', async () => {
		const r = rig();
		// One tab: the keeper (and its store instance) that made the plan owns it.
		const tabA = r.keeper();
		const made = await tabA.create({ name: 'A', label: 'A', from: { opened: true } }, SEED);
		const id = made.stored?.id ?? '';
		const ws = workspace();
		const kept = tabA.keep(ws, id, made.stored?.lock ?? null, null, made.key);
		type(ws, '# before\n');
		const taken = await r.keeper(createAcquire({ locks: r.locks })).find(id, true);
		expect(taken?.stored?.lock).not.toBeNull();
		expect(r.events).toContain('lost');
		expect(await taken?.load()).toMatchObject({
			files: { 'plan.tjp': `# before\n${SEED.files['plan.tjp']}` },
		});
		// Everything was stored: no false alarm.
		await vi.waitFor(() => expect(r.events.at(-1)).toBe('lost'));
		await new Promise((w) => setTimeout(w, 0));
		expect(r.events).not.toContain('saved failed not-owner');
		// Nothing more is stored from the tab that lost it.
		type(ws, '# after\n');
		await kept.flush();
		const back = await createLocalStore({ indexedDB: r.factory, marker: null }).open(id);
		expect(back?.files.get('plan.tjp')).not.toContain('# after');
	});
});
