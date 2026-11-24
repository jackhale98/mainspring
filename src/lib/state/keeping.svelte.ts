// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The app's side of keeping plans in this browser (phase-4.md 7.1, 9.4, 18.7; app-storage.ts):
 * what `AppState` needs of it in a first load, apart from opening plans, which stays there. The
 * store, the owner lock and autosave are the keeper chunk (plan-keeper.ts), loaded here the first
 * time a plan has to be kept (12.1): a stored plan restoring on start, the eviction check when the
 * marker says plans were kept, the first change of a plan opened unstored, "New plan…".
 *
 * - **Keeping the open plan.** `opened` after a plan opened: a stored plan is kept at once (its
 *   lock is held); a plan opened unstored (a sample) from its first change (`changed`), whose first
 *   save stores it whole. `end` when it closes: what autosave holds is stored, then the lock is
 *   given up. `stop` when the tab becomes read-only.
 * - **What the line says** (`keep`), and `dirty` through the host: changes are only in this tab
 *   while the store refuses them or cannot be used (8.1 #8).
 * - **`flush`** stores what autosave holds now and says whether everything is kept: before another
 *   plan opens and before any reload the app starts itself (T4 review L1).
 * - **The plans kept here** (`plans`): listed when the keeper loads and again whenever a plan is
 *   stored or opens, most recently changed first; the chooser shows them (T4 review H2).
 * - **A stored plan that could not be opened** (`unopened`): the store or the chunk failed, or the
 *   plan is damaged. The app opens a sample meanwhile, leaves the last-plan pointer as it was, and
 *   the notice offers Retry (T4 review H2, M2).
 * - **Eviction** (9.4): `cleared` once the store says the browser cleared the plans it kept.
 */
import type { LocalStore, StoredPlan } from '../storage/store-types';
import type { StorageError, WorkspaceId } from '../storage/types';
import type { Workspace } from '../workspace/workspace';
import { planKey } from './app-storage';
import type { Acquire, KeeperHost, Kept, Opening, PlanKeeper } from './plan-keeper';
import type { ListedStorage } from './storage';

/** Where the open plan is kept: what the sync status control shows (`statusOf`, lib/sync/shown.ts). */
export type KeepState =
	/** A sample opened unstored: its first change stores a copy (18.7). */
	| { readonly kind: 'sample' }
	/** In this browser's store; `at` is the last autosave, or for a plan reopened from the store when it last wrote it; null before either. */
	| { readonly kind: 'stored'; readonly at: number | null }
	/** The store refused the last save or cannot be used: changes are only in this tab. */
	| { readonly kind: 'failed'; readonly error: StorageError };

/** What `Keeping` asks of the app. */
export interface KeepingHost {
	/** The open workspace; null while none is open (an event of a closed plan is dropped). */
	current(): Workspace | null;
	/** The open plan's preference key now. */
	key(): string;
	readOnly(): boolean;
	/** The open plan, opened unstored, is stored now as `id`, under `key`, listed as `label`. */
	stored(id: WorkspaceId, key: string, label: string): void;
	/** Another tab took the open plan: nothing edits it here any more. */
	lost(): void;
	/** Changes are only in this tab (the store refused them), or no longer. */
	dirty(on: boolean): void;
}

export interface KeepingOptions {
	readonly prefs: ListedStorage | null;
	/** The plans in this browser; default the keeper's IndexedDB store. */
	readonly store?: LocalStore | undefined;
	readonly acquire?: Acquire | undefined;
	/** Loads the keeper chunk; default `import('./plan-keeper')` (a test holds it back or fails it). */
	readonly load?: (() => Promise<typeof import('./plan-keeper')>) | undefined;
}

const SAMPLE: KeepState = { kind: 'sample' };

export class Keeping {
	keep = $state.raw<KeepState>(SAMPLE);
	/** The browser cleared the plans it kept (9.4): the notice shows until it is dismissed. */
	cleared = $state(false);
	/** The stored plan that could not be opened (module comment); the notice offers Retry. */
	unopened = $state<WorkspaceId | null>(null);
	/** The plans kept here, most recently changed first; empty until the keeper chunk loads. */
	plans = $state.raw<readonly StoredPlan[]>([]);

	readonly #host: KeepingHost;
	readonly #o: KeepingOptions;
	#keeper: Promise<PlanKeeper> | null = null;
	/** The open plan's keeping, once it started; `#starting` while the chunk loads for it. */
	#kept: Kept | null = null;
	#starting: Promise<void> | null = null;
	/** Why the store cannot be used, once it said so: plans then open as if unstored. */
	#error: StorageError | null = null;
	readonly #keeperHost: KeeperHost = {
		saved: (k, st) => {
			if (k !== this.#kept) return;
			this.keep = st.kind === 'saved' ? { kind: 'stored', at: st.at } : st;
			this.#host.dirty(st.kind !== 'saved');
		},
		stored: (k, id, key, label) => {
			if (k !== this.#kept) return;
			this.#host.stored(id, key, label);
			this.refresh();
		},
		lost: (k) => {
			if (k === this.#kept) this.#host.lost();
		},
	};

	constructor(host: KeepingHost, o: KeepingOptions) {
		this.#host = host;
		this.#o = o;
	}

	/** The keeper chunk, loaded once (a failed load is tried again next time); lists the plans. */
	keeper(): Promise<PlanKeeper> {
		if (this.#keeper) return this.#keeper;
		const o = this.#o;
		const k = (this.#keeper = (o.load ?? (() => import('./plan-keeper')))().then(
			(m) =>
				new m.PlanKeeper(this.#keeperHost, {
					store: o.store,
					acquire: o.acquire,
					prefs: o.prefs,
					keyOf: planKey,
				}),
			(e: unknown) => {
				this.#keeper = null;
				throw e;
			},
		));
		this.refresh();
		return k;
	}

	/** Lists the plans kept here again (the database opens with it, so a first save starts at once). */
	refresh(): void {
		this.keeper()
			.then((k) => k.plans())
			.then(
				(p) => (this.plans = p),
				() => undefined,
			);
	}

	/** On start, when the marker says plans were kept here: were they cleared since (9.4)? */
	check(): void {
		this.keeper()
			.then((k) => k.cleared())
			.then(
				(c) => void (c && (this.cleared = true)),
				(e: unknown) => this.broken(e),
			);
	}

	/** A plan opened as `o`: what the line says, and a stored plan is kept at once. */
	opened(ws: Workspace, o: Opening): void {
		const err = this.#error;
		this.keep = o.stored
			? { kind: 'stored', at: o.keptAt ?? null }
			: err
				? { kind: 'failed', error: err }
				: SAMPLE;
		if (o.stored?.lock) this.#start(ws, o);
		// A stored plan opened: the store works (again).
		if (o.stored) {
			this.unopened = null;
			this.#error = null;
		}
	}

	/** The open plan changed: one opened unstored is kept from its first change (18.7). */
	changed(ws: Workspace, o: Opening): void {
		if (!this.#starting && !this.#host.readOnly()) this.#start(ws, o);
		if (this.keep.kind === 'failed') this.#host.dirty(true);
	}

	#start(ws: Workspace, o: Opening): void {
		this.#starting = this.keeper().then(
			(k) => {
				// Not once the plan closed (another opened, or the app was disposed).
				if (this.#host.current() !== ws || this.#host.readOnly()) return;
				const s = o.stored;
				this.#kept = k.keep(ws, s?.id ?? null, s?.lock ?? null, o.unstored, this.#host.key());
			},
			(e: unknown) => void this.broken(e),
		);
	}

	/** Stores what autosave holds; true when nothing is only in this tab (module comment). */
	async flush(): Promise<boolean> {
		await this.#starting;
		await this.#kept?.flush();
		return this.keep.kind !== 'failed';
	}

	/** The plan closes: what is left is stored, then its lock is given up. */
	end(): void {
		this.#kept?.end();
		this.#kept = null;
		this.#starting = null;
	}

	/** Read-only from now on: nothing more is stored. */
	stop(): void {
		this.#kept?.stop();
	}

	/** The store failed or cannot be used (a `StorageFailure`, or the chunk could not load). */
	broken(e: unknown): StorageError {
		const error = (e as { error?: StorageError } | null)?.error ?? {
			kind: 'unsupported',
			retryAfterMs: null,
			detail: 'keeper',
		};
		this.#error = error;
		if (this.keep.kind === 'sample') this.keep = { kind: 'failed', error };
		return error;
	}
}
