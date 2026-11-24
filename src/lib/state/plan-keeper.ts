// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Keeping the open plan in this browser (phase-4.md 7.1, 9.4, 18.7; state/app-storage.ts): the part
 * of `AppState` that loads lazily, with the local store, the owner lock and autosave (12.1). It is
 * fetched the first time a plan has to be kept: on start when the last plan is a stored one or the
 * eviction marker is set, at the first change of a plan opened unstored (a sample), and when "New
 * plan…" or a stored plan opens. A visit that only reads a sample never fetches it.
 *
 * `AppState` keeps what the views read (`planKey`, `keep`, `readOnly`, ...) and opens plans; this
 * module finds and creates stored plans and keeps the open one (`Kept`): its autosave, its lock, and
 * the copy that the first change of a plan opened unstored stores whole ("Tutorial (copy)", 18.7).
 * It tells `AppState` what happened through `KeeperHost`.
 *
 * - **The copy's preferences** (ADR-0008 #3 amended): when the copy is stored, the preferences kept
 *   under the sample's key are copied under the copy's, once, as its defaults (`copyPlanPrefs`).
 * - **The lock** (lock.ts): a tab that asks for the plan gets it after this one has stored what
 *   autosave holds; then nothing more is stored here and `KeeperHost.lost` makes the tab read-only.
 *   The owner opens the plan with `own` (local-store.ts, the owner epoch): a save of this tab that
 *   arrives after another tab took the plan is refused with `not-owner`, which is a loss too.
 * - **Changes a loss leaves unstored** (T4 re-check N1): a save refused with `not-owner`, or
 *   changes autosave still held when the lock was lost (taken by force from a slow or frozen tab,
 *   or typed while the handover was storing), are reported as a failed save (`not-owner`) besides
 *   the loss, so the tab says that they were not kept and asks before they are dropped.
 * - **A damaged plan** (T4 review M2): a stored plan without files, or without its entry file, is
 *   not opened: `find` gives its lock back and rejects, and the app says it could not be opened.
 */
import { strings } from '../strings';
import { createAutosave, type Autosave, type AutosaveState } from '../storage/autosave';
import { createLocalStore } from '../storage/local-store';
import { acquire, type HeldLock } from '../storage/lock';
import type { LocalStore, StoredPlan, SyncBase } from '../storage/store-types';
import { isWorkspaceId, StorageFailure, storageError } from '../storage/types';
import type { Location, WorkspaceId, WorkspacePath } from '../storage/types';
import type { SampleWorkspace } from '../workspace/samples';
import type { Workspace } from '../workspace/workspace';
import type { ListedStorage } from './storage';

export type Acquire = (
	id: WorkspaceId,
	o?: { readonly steal?: boolean },
) => Promise<HeldLock | 'held-elsewhere'>;

export interface KeeperOptions {
	/** Default the IndexedDB store (local-store.ts). */
	readonly store?: LocalStore | undefined;
	/** Default Web Locks' (lock.ts). */
	readonly acquire?: Acquire | undefined;
	readonly prefs: ListedStorage | null;
	/**
	 * A stored plan's preference key (app-storage.ts `planKey`), given by the app so that this chunk
	 * shares no module with a first load but the ones it already has.
	 */
	readonly keyOf: (id: WorkspaceId) => string;
}

/** How a plan that opened unstored is stored on its first change. */
export interface Unstored {
	readonly name: string;
	/** What the chooser lists once it is stored. */
	readonly label: string;
	readonly from: StoredPlan['from'];
}

/**
 * Where an opened plan lives and what it was made from (T5): Save to… and Export read it. `lossy`
 * names the files that had bytes that are not UTF-8 when they were read (the base's, or
 * `from.lossy` for opened files, 18.11): their text holds replacement characters.
 */
export interface Where {
	readonly location: Location;
	readonly from: StoredPlan['from'] | null;
	readonly lossy: ReadonlySet<WorkspacePath>;
}

/** A plan about to open (`AppState`'s `#load`). */
export interface Opening {
	/** Its `planKey`: a sample's id, `new` (a new plan the store did not take), or `ws:<id>`. */
	readonly key: string;
	readonly label: string;
	readonly load: () => Promise<SampleWorkspace>;
	/** A stored plan's id and lock; a null lock opens it read-only (another tab has it). */
	readonly stored: { readonly id: WorkspaceId; readonly lock: HeldLock | null } | null;
	/** How a plan opened unstored is stored on its first change. */
	readonly unstored: Unstored | null;
	/** Made with "New plan…" just now: it opens on the Gantt (ADR-0013). */
	readonly fresh?: boolean;
	/** Reopened from the store: an empty undo says why. */
	readonly restored?: boolean;
	/** Opened because the last plan could not be: it does not become the last plan (T4 review H2). */
	readonly fallback?: boolean;
	/** Where it lives (T5); default: only in this browser, from nothing known, nothing lossy. */
	readonly where?: Where;
	/**
	 * Its first save stores every file whole (Save to…, T5: the workspace stays open, and what was
	 * typed while the plan moved is kept too).
	 */
	readonly all?: boolean;
}

/** What the keeper tells `AppState` about the plan it keeps (`k`). */
export interface KeeperHost {
	/** An autosave finished or failed; `not-owner` when another tab took the plan first (N1). */
	saved(k: Kept, st: AutosaveState): void;
	/** The plan that opened unstored is stored now, as `id` (preference key `key`), listed as `label`. */
	stored(k: Kept, id: WorkspaceId, key: string, label: string): void;
	/** Another tab took the plan ("Open here instead"); nothing is stored here any more. */
	lost(k: Kept): void;
}

/** One open plan being kept. */
export interface Kept {
	/** Stores what autosave holds; resolves once that is stored or has failed. */
	flush(): Promise<void>;
	/** The plan closes: what is left is stored, then the lock is given up. */
	end(): void;
	/** Read-only from now on: nothing more is stored. */
	stop(): void;
}

const BROWSER: Location = { kind: 'browser' };
const NOT_OWNER = storageError('not-owner', 'taken');

/**
 * Copies every preference of plan `from` (`mainspring.<what>.<from>`) to plan `to`, keeping any that
 * `to` has already (module comment).
 */
export function copyPlanPrefs(storage: ListedStorage | null, from: string, to: string): void {
	const end = `.${from}`;
	try {
		if (!storage) return;
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const k = storage.key(i);
			if (k?.startsWith('mainspring.') && k.endsWith(end)) keys.push(k);
		}
		for (const k of keys) {
			const into = k.slice(0, -from.length) + to;
			const v = storage.getItem(k);
			if (v !== null && storage.getItem(into) === null) storage.setItem(into, v);
		}
	} catch {
		// Blocked storage: the copy starts from the defaults.
	}
}

export class PlanKeeper {
	readonly #host: KeeperHost;
	readonly #store: LocalStore;
	readonly #acquire: Acquire;
	readonly #prefs: ListedStorage | null;
	readonly #keyOf: (id: WorkspaceId) => string;

	constructor(host: KeeperHost, o: KeeperOptions) {
		this.#host = host;
		this.#store = o.store ?? createLocalStore();
		this.#acquire = o.acquire ?? acquire;
		this.#prefs = o.prefs;
		this.#keyOf = o.keyOf;
	}

	/**
	 * The stored plan `id` as it opens, with its lock, taken from another tab when `steal`; a null
	 * lock when another tab has it (it opens read-only). Null when there is no such plan. Rejects
	 * with the store's `StorageFailure`.
	 */
	async find(id: string, steal: boolean): Promise<Opening | null> {
		if (!isWorkspaceId(id)) return null;
		const l = await this.#acquire(id, steal ? { steal } : undefined);
		const lock = l === 'held-elsewhere' ? null : l;
		try {
			const opened = await this.#store.open(id, { own: lock !== null });
			if (!opened) {
				lock?.release();
				return null;
			}
			const { plan } = opened;
			if (!opened.files.has(plan.entry)) {
				throw new StorageFailure(storageError('server', 'damaged: no entry file'));
			}
			const seed = { entry: plan.entry, files: Object.fromEntries(opened.files) };
			const lossy = new Set(opened.base?.lossy);
			if ('opened' in plan.from) for (const p of plan.from.lossy ?? []) lossy.add(p);
			return {
				key: this.#keyOf(id),
				label: 'newPlan' in plan.from ? strings.newPlan.listed(plan.name) : plan.name,
				load: () => Promise.resolve(seed),
				stored: { id, lock },
				unstored: null,
				restored: true,
				where: { location: plan.location, from: plan.from, lossy },
			};
		} catch (e) {
			lock?.release();
			throw e;
		}
	}

	/**
	 * Stores a new plan with its lock, and how it opens: "New plan…" (18.7, opens on the Gantt),
	 * opened files, or a folder (T5: at `at.location`, with its sync base and the files it read
	 * lossy).
	 */
	async create(
		p: Unstored,
		seed: SampleWorkspace,
		at: { readonly location: Location; readonly base: SyncBase | null } = {
			location: BROWSER,
			base: null,
		},
	): Promise<Opening> {
		const id = await this.#store.create(
			{ name: p.name, entry: seed.entry, location: at.location, from: p.from },
			new Map(Object.entries(seed.files)),
			at.base,
		);
		const l = await this.#acquire(id);
		const lossy = new Set(at.base?.lossy);
		if ('opened' in p.from) for (const f of p.from.lossy ?? []) lossy.add(f);
		return {
			key: this.#keyOf(id),
			label: p.label,
			load: () => Promise.resolve(seed),
			stored: { id, lock: l === 'held-elsewhere' ? null : l },
			unstored: null,
			fresh: 'newPlan' in p.from,
			where: { location: at.location, from: p.from, lossy },
		};
	}

	/** Deletes a stored plan and all its records (Save to… moved it elsewhere, T5). */
	remove(id: WorkspaceId): Promise<void> {
		return this.#store.remove(id);
	}

	/** The plans kept in this browser, most recently changed first (the chooser lists them). */
	plans(): Promise<readonly StoredPlan[]> {
		return this.#store.plans();
	}

	/** True once when the browser cleared the plans it kept (9.4). */
	cleared(): Promise<boolean> {
		return this.#store.cleared();
	}

	/**
	 * Keeps the open plan: a stored one by `id`, with its `lock`; one that opened unstored (`id`
	 * null) is stored whole by its first save, as `unstored` says, and so is every file of one that
	 * `all` names (Opening `all`). `key` is its preference key now.
	 */
	keep(
		ws: Workspace,
		id: WorkspaceId | null,
		lock: HeldLock | null,
		unstored: Unstored | null,
		key: string,
		all = false,
	): Kept {
		let sid = id;
		let held = lock;
		const k: Kept = {
			flush: () => saves.flush(),
			end: () =>
				void saves.flush().then(() => {
					saves.dispose();
					held?.release();
				}),
			stop: () => saves.dispose(),
		};
		const saves = createAutosave({
			workspace: ws,
			// Unstored: the first save is the whole plan.
			all: all || sid === null,
			save: async (files, snap) => {
				if (sid !== null) return this.#store.saveFiles(sid, files, snap.version);
				if (!unstored) return;
				const made = await this.#store.create(
					{ name: unstored.name, entry: snap.entry, location: BROWSER, from: unstored.from },
					files,
					null,
				);
				sid = made;
				const l = await this.#acquire(made);
				held = l === 'held-elsewhere' ? null : l;
				if (held) this.#hold(k, held, saves);
				const to = this.#keyOf(made);
				copyPlanPrefs(this.#prefs, key, to);
				this.#host.stored(k, made, to, unstored.label);
			},
			onState: (st) => {
				this.#host.saved(k, st);
				// Another tab owns the plan now (it took it first): this tab only reads it, and the
				// refused changes stay on screen (module comment).
				if (st.kind === 'failed' && st.error.kind === 'not-owner') {
					k.stop();
					held?.release();
					this.#host.lost(k);
				}
			},
		});
		if (held) this.#hold(k, held, saves);
		return k;
	}

	#hold(k: Kept, lock: HeldLock, saves: Autosave): void {
		lock.onAsked(() => k.flush());
		void lock.lost.then(async () => {
			k.stop();
			this.#host.lost(k);
			// A save in flight settles (no new one starts); what is left was not stored (N1).
			await saves.flush();
			if (saves.pending) this.#host.saved(k, { kind: 'failed', error: NOT_OWNER });
		});
	}
}
